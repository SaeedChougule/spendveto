"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  IndianRupee,
  Clock,
  ArrowRight,
  ShoppingBag,
  TrendingUp,
  AlertTriangle,
  Calendar,
  Snowflake,
  Trash2,
  History,
  ShieldCheck,
  Bookmark,
  RotateCcw,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type WageMode = "monthly" | "daily" | "hourly";
type DecisionStatus = "pending_icebox" | "vetoed" | "bought";

interface PresetItem {
  label: string;
  name: string;
  price: number;
}

interface DecisionEntry {
  id: string;
  itemName: string;
  price: number;
  evaluatedAt: number; // timestamp
  regretScore: number;
  regretLevel: "Low" | "Moderate" | "High Danger";
  status: DecisionStatus;
  iceboxUntil?: number; // timestamp for 48h countdown
}

const PRESET_ITEMS: PresetItem[] = [
  { label: "₹1,500 Weekend Dinner", name: "Weekend Dinner", price: 1500 },
  { label: "₹8,000 Sneakers", name: "Sneakers", price: 8000 },
  { label: "₹85,000 Flagship Phone", name: "Flagship Phone", price: 85000 },
  { label: "₹1,50,000 Gaming Set-Up", name: "Gaming Set-Up", price: 150000 },
];

const LOCAL_STORAGE_KEY = "spendveto_decisions_v2";

function formatINR(val: number): string {
  if (isNaN(val)) return "0";
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(Math.round(val));
}

function calculateEMI(principal: number, annualRatePct: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  const monthlyRate = annualRatePct / 12 / 100;
  if (monthlyRate === 0) return principal / months;
  const factor = Math.pow(1 + monthlyRate, months);
  return (principal * monthlyRate * factor) / (factor - 1);
}

function formatRemainingTime(iceboxUntil?: number): string {
  if (!iceboxUntil) return "Cooling off";
  const diff = iceboxUntil - Date.now();
  if (diff <= 0) return "Cool-off completed • Ready to decide";
  const totalMinutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m left to cool off`;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: {
      yearLabel: string;
      baseline: number;
      compounded: number;
    };
  }>;
}

const CustomChartTooltip = ({ active, payload }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const baseline = data.baseline;
    const compounded = data.compounded;
    const gap = Math.max(0, compounded - baseline);

    return (
      <div className="bg-slate-900 border border-slate-700/80 px-4 py-3 rounded-xl shadow-2xl backdrop-blur-md min-w-[230px] text-xs">
        <div className="font-semibold text-slate-200 border-b border-slate-800 pb-1.5 mb-2 flex items-center justify-between">
          <span>{data.yearLabel}</span>
          <span className="text-[11px] text-cyan-400 font-mono">12% CAGR</span>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-slate-400">
            <span>Money Spent:</span>
            <span className="font-medium text-slate-300">₹{formatINR(baseline)}</span>
          </div>
          <div className="flex justify-between items-center text-slate-300">
            <span>Amount Invested Instead:</span>
            <span className="font-semibold text-cyan-400">₹{formatINR(compounded)}</span>
          </div>
          <div className="pt-2 mt-2 border-t border-slate-800/80 flex justify-between items-center">
            <span className="text-slate-400 font-medium">Opportunity Gap:</span>
            <span className="text-amber-400 font-semibold font-mono">
              +₹{formatINR(gap)} forfeited
            </span>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

export default function SpendVetoHome() {
  const [isMounted, setIsMounted] = useState<boolean>(false);
  const [itemName, setItemName] = useState<string>("Flagship Phone");
  const [purchasePrice, setPurchasePrice] = useState<string>("85000");
  const [wageMode, setWageMode] = useState<WageMode>("monthly");
  const [income, setIncome] = useState<string>("75000");
  const [workSchedule, setWorkSchedule] = useState<string>(
    "8 hrs/day (5 days/week)"
  );
  const [customHours, setCustomHours] = useState<string>("8");
  const [customDays, setCustomDays] = useState<string>("5");
  const [chartView, setChartView] = useState<"area" | "bar">("area");
  const [hasEvaluated, setHasEvaluated] = useState<boolean>(true);

  // Decision log & Undo state
  const [decisionHistory, setDecisionHistory] = useState<DecisionEntry[]>([]);
  const [confirmClear, setConfirmClear] = useState<boolean>(false);
  const [undoBuffer, setUndoBuffer] = useState<DecisionEntry[] | null>(null);
  const [showUndo, setShowUndo] = useState<boolean>(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [, setTick] = useState<number>(Date.now());

  const resultsRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const undoTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load decision log safely from localStorage on mount
  useEffect(() => {
    setIsMounted(true);
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setDecisionHistory(parsed);
        }
      }
    } catch {
      // LocalStorage access fallback
    }

    const interval = setInterval(() => {
      setTick(Date.now());
    }, 30000);

    return () => {
      clearInterval(interval);
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

  const updateDecisions = (newHistory: DecisionEntry[]) => {
    setDecisionHistory(newHistory);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newHistory));
    } catch {
      // Ignore write errors
    }
  };

  const recordUndoState = (previousState: DecisionEntry[]) => {
    setUndoBuffer(previousState);
    setShowUndo(true);
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
    }
    undoTimerRef.current = setTimeout(() => {
      setShowUndo(false);
      setUndoBuffer(null);
    }, 10000); // Visible for 10 seconds
  };

  const handleUndo = () => {
    if (undoBuffer) {
      updateDecisions(undoBuffer);
      setShowUndo(false);
      setUndoBuffer(null);
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
      }
    }
  };

  const handlePresetSelect = (preset: PresetItem) => {
    setItemName(preset.name);
    setPurchasePrice(preset.price.toString());
  };

  const getIncomeConfig = () => {
    switch (wageMode) {
      case "daily":
        return {
          label: "Daily Wage",
          unit: "₹/day",
          placeholder: "e.g., 2,500",
        };
      case "hourly":
        return {
          label: "Hourly Rate",
          unit: "₹/hour",
          placeholder: "e.g., 400",
        };
      case "monthly":
      default:
        return {
          label: "Monthly Salary",
          unit: "₹/month",
          placeholder: "e.g., 85,000",
        };
    }
  };

  const incomeConfig = getIncomeConfig();

  // --- Calculation Engine ---
  let dailyHours = 8;
  let daysPerWeek = 5;

  if (workSchedule === "9 hrs/day (6 days/week)") {
    dailyHours = 9;
    daysPerWeek = 6;
  } else if (workSchedule === "Custom") {
    dailyHours = Math.max(1, Math.min(24, parseFloat(customHours) || 8));
    daysPerWeek = Math.max(1, Math.min(7, parseFloat(customDays) || 5));
  }

  const workdaysPerMonth = (52 * daysPerWeek) / 12; // ~21.67 or 26
  const monthlyWorkingHours = workdaysPerMonth * dailyHours;

  const priceNum = Math.max(0, parseFloat(purchasePrice) || 0);
  const incomeNum = Math.max(0, parseFloat(income) || 0);

  let effectiveHourlyRate = 0;
  let computedMonthlyIncome = 0;

  if (wageMode === "monthly") {
    computedMonthlyIncome = incomeNum;
    effectiveHourlyRate =
      monthlyWorkingHours > 0 ? incomeNum / monthlyWorkingHours : 0;
  } else if (wageMode === "daily") {
    effectiveHourlyRate = dailyHours > 0 ? incomeNum / dailyHours : 0;
    computedMonthlyIncome = incomeNum * workdaysPerMonth;
  } else if (wageMode === "hourly") {
    effectiveHourlyRate = incomeNum;
    computedMonthlyIncome = incomeNum * monthlyWorkingHours;
  }

  // Card 1: Labor Required
  const totalWorkingHours =
    effectiveHourlyRate > 0 ? priceNum / effectiveHourlyRate : 0;
  const standardWorkDays =
    dailyHours > 0 ? totalWorkingHours / dailyHours : 0;
  const equivalentMonths =
    workdaysPerMonth > 0 ? standardWorkDays / workdaysPerMonth : 0;

  // Adaptive Primary Metric for "Labor Required":
  let primaryLaborDisplay = "";
  let primaryLaborUnit = "";

  if (wageMode === "hourly") {
    primaryLaborDisplay = totalWorkingHours.toFixed(1);
    primaryLaborUnit = "Hours";
  } else if (wageMode === "daily") {
    if (standardWorkDays < 1) {
      primaryLaborDisplay = totalWorkingHours.toFixed(1);
      primaryLaborUnit = "Hours";
    } else {
      primaryLaborDisplay = standardWorkDays.toFixed(1);
      primaryLaborUnit = standardWorkDays === 1 ? "Day" : "Days";
    }
  } else {
    // monthly salary
    if (priceNum >= computedMonthlyIncome && computedMonthlyIncome > 0) {
      primaryLaborDisplay = equivalentMonths.toFixed(1);
      primaryLaborUnit = equivalentMonths === 1 ? "Month" : "Months";
    } else if (standardWorkDays >= 1) {
      primaryLaborDisplay = standardWorkDays.toFixed(1);
      primaryLaborUnit = standardWorkDays === 1 ? "Day" : "Days";
    } else {
      primaryLaborDisplay = totalWorkingHours.toFixed(1);
      primaryLaborUnit = "Hours";
    }
  }

  // Card 2: 10-Yr Opportunity Cost (12% CAGR: A = P * (1.12)^10)
  const futureValue10Yr = priceNum * Math.pow(1.12, 10);
  const multiplierStr =
    priceNum > 0 ? (futureValue10Yr / priceNum).toFixed(2) : "3.11";

  // Card 3: Regret & Burden Score (1 - 10)
  const priceToMonthlyRatio =
    computedMonthlyIncome > 0 ? priceNum / computedMonthlyIncome : 0;

  let daysScore = 1;
  if (standardWorkDays <= 0.5) daysScore = 1;
  else if (standardWorkDays <= 1.5) daysScore = 2;
  else if (standardWorkDays <= 3) daysScore = 4;
  else if (standardWorkDays <= 6) daysScore = 6;
  else if (standardWorkDays <= 12) daysScore = 8;
  else daysScore = 10;

  let ratioScore = 1;
  if (priceToMonthlyRatio <= 0.05) ratioScore = 1;
  else if (priceToMonthlyRatio <= 0.15) ratioScore = 3;
  else if (priceToMonthlyRatio <= 0.3) ratioScore = 5;
  else if (priceToMonthlyRatio <= 0.5) ratioScore = 7;
  else if (priceToMonthlyRatio <= 0.8) ratioScore = 9;
  else ratioScore = 10;

  const rawBurdenScore = Math.round(daysScore * 0.5 + ratioScore * 0.5);
  const burdenScore = Math.min(10, Math.max(1, rawBurdenScore || 1));

  let burdenLevel: "Low" | "Moderate" | "High Danger" = "Low";
  let burdenBadgeClasses =
    "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
  let burdenBarColor = "bg-emerald-400";

  if (burdenScore <= 3) {
    burdenLevel = "Low";
    burdenBadgeClasses =
      "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    burdenBarColor = "bg-emerald-400";
  } else if (burdenScore <= 6) {
    burdenLevel = "Moderate";
    burdenBadgeClasses = "bg-amber-500/10 text-amber-400 border-amber-500/30";
    burdenBarColor = "bg-amber-400";
  } else {
    burdenLevel = "High Danger";
    burdenBadgeClasses = "bg-rose-500/10 text-rose-400 border-rose-500/30";
    burdenBarColor = "bg-rose-500";
  }

  // Cost exceeds 50% of monthly income OR Regret Score is 10/10
  const showFinancingRealityCheck =
    burdenScore === 10 ||
    (computedMonthlyIncome > 0 && priceNum > 0.5 * computedMonthlyIncome);

  // EMI Computations (standard 12% p.a. consumer credit benchmark)
  const emi6 = calculateEMI(priceNum, 12, 6);
  const emi12 = calculateEMI(priceNum, 12, 12);
  const emi6Pct =
    computedMonthlyIncome > 0
      ? Math.round((emi6 / computedMonthlyIncome) * 100)
      : 0;
  const emi12Pct =
    computedMonthlyIncome > 0
      ? Math.round((emi12 / computedMonthlyIncome) * 100)
      : 0;

  // 2. Smooth Continuous Chart Data across all years from Year 0 to Year 10
  const chartData = Array.from({ length: 11 }, (_, i) => {
    const compoundedVal = Math.round(priceNum * Math.pow(1.12, i));
    return {
      yearLabel: `Year ${i}`,
      year: i,
      baseline: Math.round(priceNum),
      compounded: compoundedVal,
    };
  });

  // Top Hero Stat: Total Money Saved
  const totalSavedByVetoing = isMounted
    ? decisionHistory
        .filter((d) => d.status === "vetoed")
        .reduce((sum, d) => sum + d.price, 0)
    : 0;

  const handleRunRealityCheck = () => {
    setHasEvaluated(true);
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  // 3. Simplified Save Action: Single primary action button directly below results
  const handleSaveDecision = () => {
    const newEntry: DecisionEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      itemName: itemName.trim() || "Untitled Purchase",
      price: priceNum,
      evaluatedAt: Date.now(),
      regretScore: burdenScore,
      regretLevel: burdenLevel,
      status: "pending_icebox",
      iceboxUntil: Date.now() + 48 * 60 * 60 * 1000,
    };

    updateDecisions([newEntry, ...decisionHistory]);
    setSaveToast(`Saved "${newEntry.itemName}" to Decision History`);

    setTimeout(() => {
      setSaveToast(null);
    }, 3000);

    setTimeout(() => {
      historyRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
  };

  const handleUpdateStatus = (id: string, newStatus: DecisionStatus) => {
    const updated = decisionHistory.map((item) => {
      if (item.id === id) {
        return {
          ...item,
          status: newStatus,
          iceboxUntil:
            newStatus === "pending_icebox"
              ? Date.now() + 48 * 60 * 60 * 1000
              : item.iceboxUntil,
        };
      }
      return item;
    });
    updateDecisions(updated);
  };

  const handleDeleteItem = (id: string) => {
    recordUndoState(decisionHistory);
    const updated = decisionHistory.filter((item) => item.id !== id);
    updateDecisions(updated);
  };

  const handleClearHistory = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    recordUndoState(decisionHistory);
    updateDecisions([]);
    setConfirmClear(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-cyan-500/30 selection:text-cyan-200 font-sans antialiased">
      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-14 flex-1">
        {/* Header Section */}
        <header className="text-center mb-6 sm:mb-8">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-slate-100 mb-2">
            Spend<span className="text-cyan-400">Veto</span>
          </h1>
          <p className="text-sm sm:text-base text-slate-400 max-w-lg mx-auto">
            Pre-Purchase Behavioral & Opportunity Cost Evaluator
          </p>
        </header>

        {/* 1. Top Hero Stat: Total Money Saved */}
        <div className="mb-8 p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-slate-900/90 via-slate-900/70 to-slate-900/90 border border-cyan-500/25 shadow-xl shadow-cyan-950/20 backdrop-blur-md flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 text-center sm:text-left">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 shrink-0">
              <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider font-semibold text-cyan-300">
                Total Money Saved
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Capital protected across impulse purchases averted
              </div>
            </div>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-cyan-400 font-mono tracking-tight">
              ₹{formatINR(totalSavedByVetoing)}
            </span>
            <span className="text-xs font-medium text-slate-400">
              protected
            </span>
          </div>
        </div>

        {/* Input Card */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl shadow-slate-950/60 mb-8">
          {/* Popular Examples */}
          <div className="mb-6">
            <div className="mb-2.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Popular Examples
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PRESET_ITEMS.map((preset) => {
                const isSelected =
                  itemName === preset.name &&
                  purchasePrice === preset.price.toString();
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => handlePresetSelect(preset)}
                    className={`text-left text-xs font-medium px-3.5 py-2.5 rounded-xl transition-all duration-150 border cursor-pointer ${
                      isSelected
                        ? "bg-cyan-500/15 border-cyan-400 text-cyan-200 shadow-sm shadow-cyan-950"
                        : "bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-slate-100 hover:bg-slate-800/40"
                    }`}
                  >
                    <span className="block font-semibold text-slate-100 truncate">
                      {preset.label.split(" ")[0]}
                    </span>
                    <span className="block text-[11px] text-slate-400 truncate">
                      {preset.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleRunRealityCheck();
            }}
            className="space-y-5"
          >
            {/* Purchase Details Group */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Item Name */}
              <div>
                <label
                  htmlFor="item-name"
                  className="block text-xs font-medium text-slate-300 uppercase tracking-wider mb-2"
                >
                  Item Name
                </label>
                <div className="relative rounded-xl">
                  <div className="pointer-events-none absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                    <ShoppingBag className="w-4 h-4 text-slate-400" />
                  </div>
                  <input
                    id="item-name"
                    type="text"
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    placeholder="e.g., Flagship Smartphone, Noise-cancelling Headphones"
                    className="block w-full pl-10 pr-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-slate-100 placeholder:text-slate-500 text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition-colors"
                  />
                </div>
              </div>

              {/* Purchase Price */}
              <div>
                <label
                  htmlFor="purchase-price"
                  className="block text-xs font-medium text-slate-300 uppercase tracking-wider mb-2"
                >
                  Purchase Price (₹)
                </label>
                <div className="relative rounded-xl">
                  <div className="pointer-events-none absolute inset-y-0 left-0 pl-3.5 flex items-center text-cyan-400 font-semibold">
                    <IndianRupee className="w-4 h-4" />
                  </div>
                  <input
                    id="purchase-price"
                    type="number"
                    min="0"
                    step="any"
                    value={purchasePrice}
                    onChange={(e) => setPurchasePrice(e.target.value)}
                    placeholder="e.g., 85,000"
                    className="block w-full pl-10 pr-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-slate-100 placeholder:text-slate-500 text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>
            </div>

            {/* Clean spacing divider */}
            <div className="pt-2 border-t border-slate-800/80" />

            {/* Pay Frequency */}
            <div>
              <label className="block text-xs font-medium text-slate-300 uppercase tracking-wider mb-2">
                Pay Frequency
              </label>
              <div className="p-1 bg-slate-950/90 border border-slate-800 rounded-xl flex gap-1">
                {(
                  [
                    { id: "monthly", label: "Monthly Salary" },
                    { id: "daily", label: "Daily Wage" },
                    { id: "hourly", label: "Hourly Rate" },
                  ] as const
                ).map((mode) => {
                  const isActive = wageMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setWageMode(mode.id)}
                      className={`flex-1 py-2 px-3 text-xs sm:text-sm font-medium rounded-lg transition-all duration-150 text-center cursor-pointer ${
                        isActive
                          ? "bg-cyan-400 text-slate-950 font-semibold shadow-sm"
                          : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                      }`}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Income & Schedule Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Income Input */}
              <div>
                <label
                  htmlFor="income-input"
                  className="block text-xs font-medium text-slate-300 uppercase tracking-wider mb-2"
                >
                  {incomeConfig.label}
                </label>
                <div className="relative rounded-xl">
                  <div className="pointer-events-none absolute inset-y-0 left-0 pl-3.5 flex items-center text-cyan-400 font-semibold">
                    <IndianRupee className="w-4 h-4" />
                  </div>
                  <input
                    id="income-input"
                    type="number"
                    min="0"
                    step="any"
                    value={income}
                    onChange={(e) => setIncome(e.target.value)}
                    placeholder={incomeConfig.placeholder}
                    className="block w-full pl-10 pr-20 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-slate-100 placeholder:text-slate-500 text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <div className="pointer-events-none absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 text-xs font-mono">
                    {incomeConfig.unit}
                  </div>
                </div>
              </div>

              {/* Work Schedule Dropdown */}
              <div>
                <label
                  htmlFor="work-schedule"
                  className="block text-xs font-medium text-slate-300 uppercase tracking-wider mb-2"
                >
                  Work Schedule
                </label>
                <div className="relative">
                  <select
                    id="work-schedule"
                    value={workSchedule}
                    onChange={(e) => setWorkSchedule(e.target.value)}
                    className="block w-full pl-3.5 pr-10 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition-colors appearance-none cursor-pointer"
                  >
                    <option value="8 hrs/day (5 days/week)">
                      8 hrs/day (5 days/week)
                    </option>
                    <option value="9 hrs/day (6 days/week)">
                      9 hrs/day (6 days/week)
                    </option>
                    <option value="Custom">Custom</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400">
                    <svg
                      className="w-4 h-4 text-slate-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Work Schedule Customization: Side-by-Side Inputs */}
            {workSchedule === "Custom" && (
              <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl grid grid-cols-1 sm:grid-cols-2 gap-4 animate-fadeIn">
                <div>
                  <label
                    htmlFor="custom-hours"
                    className="block text-xs font-medium text-slate-400 mb-1.5"
                  >
                    Hours / Day (1 - 24)
                  </label>
                  <div className="relative">
                    <input
                      id="custom-hours"
                      type="number"
                      min="1"
                      max="24"
                      value={customHours}
                      onChange={(e) => setCustomHours(e.target.value)}
                      className="block w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50"
                      placeholder="8"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-0 pr-3 flex items-center text-xs text-slate-500">
                      hrs
                    </span>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="custom-days"
                    className="block text-xs font-medium text-slate-400 mb-1.5"
                  >
                    Days / Week (1 - 7)
                  </label>
                  <div className="relative">
                    <input
                      id="custom-days"
                      type="number"
                      min="1"
                      max="7"
                      value={customDays}
                      onChange={(e) => setCustomDays(e.target.value)}
                      className="block w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50"
                      placeholder="5"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-0 pr-3 flex items-center text-xs text-slate-500">
                      days
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Action Button: Run Reality Check */}
            <div className="pt-2">
              <button
                type="submit"
                className="w-full group relative flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-semibold text-sm sm:text-base text-slate-950 bg-cyan-400 hover:bg-cyan-300 active:scale-[0.99] transition-all duration-150 shadow-lg shadow-cyan-500/20 hover:shadow-cyan-400/30 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-slate-950"
              >
                <span>Run Reality Check</span>
                <ArrowRight className="w-4 h-4 transition-transform duration-150 group-hover:translate-x-1" />
              </button>
            </div>
          </form>
        </div>

        {/* Results & Analysis Section */}
        {hasEvaluated && (
          <div ref={resultsRef} className="space-y-6 animate-fadeIn">
            {/* 3 Metric Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Card 1: Adaptive Primary Metric for Labor Required */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 backdrop-blur-md flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-slate-400 mb-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                      Labor Required
                    </span>
                    <Clock className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="text-2xl sm:text-3xl font-extrabold text-slate-100 tracking-tight flex items-baseline gap-1.5">
                    <span>{primaryLaborDisplay}</span>
                    <span className="text-base sm:text-lg font-semibold text-cyan-400">
                      {primaryLaborUnit}
                    </span>
                  </div>
                  <div className="mt-1.5 text-xs text-slate-400 font-medium">
                    ≈ {standardWorkDays.toFixed(1)} work days ({totalWorkingHours.toFixed(1)} total hours)
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 leading-normal">
                  Based on effective hourly earning power of{" "}
                  <span className="text-slate-200 font-mono">
                    ₹{formatINR(effectiveHourlyRate)}/hr
                  </span>
                  .
                </div>
              </div>

              {/* Card 2: 10-Yr Opportunity Cost */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 backdrop-blur-md flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-slate-400 mb-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                      10-Yr Opportunity Cost
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-800/60">
                      {multiplierStr}x Lost Capital
                    </span>
                  </div>
                  <div className="text-2xl sm:text-3xl font-extrabold text-slate-100 tracking-tight">
                    ₹{formatINR(futureValue10Yr)}
                  </div>
                  <div className="mt-1.5 text-xs text-amber-400 font-medium">
                    +₹{formatINR(futureValue10Yr - priceNum)} forfeited growth
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 leading-normal">
                  Projected using a conservative 12% historical annualized CAGR
                  benchmark (Nifty 50 Index). Past performance does not guarantee
                  future market returns.
                </div>
              </div>

              {/* Card 3: Regret & Burden Score (1-10) */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 backdrop-blur-md flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-slate-400 mb-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                      Regret & Burden Score
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${burdenBadgeClasses}`}
                    >
                      {burdenLevel}
                    </span>
                  </div>

                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl sm:text-3xl font-extrabold text-slate-100 tracking-tight">
                      {burdenScore}
                    </span>
                    <span className="text-sm font-semibold text-slate-500">
                      / 10
                    </span>
                  </div>

                  {/* Meter Bar */}
                  <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden mt-3 border border-slate-800">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${burdenBarColor}`}
                      style={{ width: `${burdenScore * 10}%` }}
                    />
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80">
                  <div className="text-[11px] text-slate-400 leading-normal">
                    Item represents{" "}
                    <span className="text-slate-200 font-mono">
                      {(priceToMonthlyRatio * 100).toFixed(1)}%
                    </span>{" "}
                    of monthly earning capacity.
                  </div>
                </div>
              </div>
            </div>

            {/* Score 10/10 & High Danger EMI Breakdown Card */}
            {showFinancingRealityCheck && (
              <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-br from-rose-950/40 via-slate-900/90 to-slate-900/90 border border-rose-500/30 shadow-xl backdrop-blur-md animate-fadeIn">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 mb-4 border-b border-rose-900/40">
                  <div className="flex items-center gap-2 text-rose-400 font-bold text-sm sm:text-base">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <span>Financing & EMI Reality Check</span>
                  </div>
                  <span className="self-start sm:self-auto px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                    High Cash Flow Strain
                  </span>
                </div>

                <p className="text-xs text-slate-300 mb-4 leading-relaxed">
                  Flagged: On a 12-month financing plan, this claims a notable share of monthly cash flow. When high-ticket purchases are deferred to installments, they quietly erode discretionary savings:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* 6-Month Plan */}
                  <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                        <span>6-Month Plan (~12% p.a.)</span>
                        <span className="font-mono text-slate-300">Total: ₹{formatINR(emi6 * 6)}</span>
                      </div>
                      <div className="text-xl font-bold text-slate-100 font-mono">
                        ₹{formatINR(emi6)}
                        <span className="text-xs font-normal text-slate-400">/mo</span>
                      </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-800 text-[11px] text-amber-400 font-medium">
                      Locks {emi6Pct}% of monthly income for 6 months
                    </div>
                  </div>

                  {/* 12-Month Plan */}
                  <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                        <span>12-Month Plan (~12% p.a.)</span>
                        <span className="font-mono text-slate-300">Total: ₹{formatINR(emi12 * 12)}</span>
                      </div>
                      <div className="text-xl font-bold text-slate-100 font-mono">
                        ₹{formatINR(emi12)}
                        <span className="text-xs font-normal text-slate-400">/mo</span>
                      </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-800 text-[11px] text-rose-400 font-medium">
                      Locks {emi12Pct}% of monthly income for 12 months
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 2. Interactive Chart Visual: Smooth Continuous Tooltip on Area Curve across Year 0 to 10 */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 sm:p-6 backdrop-blur-md">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-100 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-cyan-400" />
                    Money Spent vs. Amount Invested Instead
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Continuous 10-year growth projection at 12% CAGR historical benchmark
                  </p>
                </div>

                {/* View Switcher: Area / Bar */}
                <div className="flex items-center gap-1 bg-slate-950/90 border border-slate-800 rounded-xl p-1 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setChartView("area")}
                    className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                      chartView === "area"
                        ? "bg-slate-800 text-cyan-300 font-semibold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Area Curve
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartView("bar")}
                    className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                      chartView === "bar"
                        ? "bg-slate-800 text-cyan-300 font-semibold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Comparison Bars
                  </button>
                </div>
              </div>

              {/* Chart Legends */}
              <div className="flex flex-wrap items-center gap-5 text-xs text-slate-400 mb-4 px-1">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-cyan-400" />
                  <span className="text-slate-300 font-medium">Amount Invested Instead</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-slate-600" />
                  <span className="text-slate-400 font-medium">Money Spent</span>
                </div>
              </div>

              {/* Chart Canvas */}
              <div className="h-[290px] w-full">
                {isMounted ? (
                  chartView === "area" ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={chartData}
                        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id="compoundedGradient"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#22d3ee"
                              stopOpacity={0.35}
                            />
                            <stop
                              offset="95%"
                              stopColor="#22d3ee"
                              stopOpacity={0.0}
                            />
                          </linearGradient>
                          <linearGradient
                            id="baselineGradient"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#475569"
                              stopOpacity={0.2}
                            />
                            <stop
                              offset="95%"
                              stopColor="#475569"
                              stopOpacity={0.0}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#1e293b"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="yearLabel"
                          stroke="#64748b"
                          fontSize={12}
                          tickLine={false}
                          axisLine={{ stroke: "#334155" }}
                          ticks={["Year 0", "Year 2", "Year 5", "Year 7", "Year 10"]}
                          interval={0}
                        />
                        <YAxis
                          stroke="#64748b"
                          fontSize={11}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) =>
                            `₹${
                              v >= 100000
                                ? (v / 100000).toFixed(1) + "L"
                                : v >= 1000
                                ? (v / 1000).toFixed(0) + "k"
                                : v
                            }`
                          }
                        />
                        <Tooltip content={<CustomChartTooltip />} />
                        <Area
                          type="monotone"
                          dataKey="compounded"
                          name="Amount Invested Instead"
                          stroke="#22d3ee"
                          strokeWidth={2.5}
                          fillOpacity={1}
                          fill="url(#compoundedGradient)"
                          dot={{
                            fill: "#22d3ee",
                            r: 3,
                            strokeWidth: 1.5,
                            stroke: "#020617",
                          }}
                          activeDot={{
                            r: 6,
                            fill: "#67e8f9",
                            stroke: "#020617",
                            strokeWidth: 2,
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="baseline"
                          name="Money Spent"
                          stroke="#64748b"
                          strokeWidth={1.5}
                          strokeDasharray="4 4"
                          fillOpacity={1}
                          fill="url(#baselineGradient)"
                          dot={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={chartData.filter((d) =>
                          [0, 2, 5, 7, 10].includes(d.year)
                        )}
                        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#1e293b"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="yearLabel"
                          stroke="#64748b"
                          fontSize={12}
                          tickLine={false}
                          axisLine={{ stroke: "#334155" }}
                        />
                        <YAxis
                          stroke="#64748b"
                          fontSize={11}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) =>
                            `₹${
                              v >= 100000
                                ? (v / 100000).toFixed(1) + "L"
                                : v >= 1000
                                ? (v / 1000).toFixed(0) + "k"
                                : v
                            }`
                          }
                        />
                        <Tooltip content={<CustomChartTooltip />} />
                        <Bar
                          dataKey="baseline"
                          name="Money Spent"
                          fill="#475569"
                          radius={[4, 4, 0, 0]}
                        />
                        <Bar
                          dataKey="compounded"
                          name="Amount Invested Instead"
                          fill="#22d3ee"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  )
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-xs text-slate-500">
                    Loading projection visual...
                  </div>
                )}
              </div>
            </div>

            {/* 3. Sleek Single Primary Action Button: Save this Decision */}
            <div className="pt-1 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={handleSaveDecision}
                className="group relative flex items-center justify-center gap-2 py-3 px-8 rounded-xl font-semibold text-sm text-cyan-300 bg-slate-900 border border-cyan-500/40 hover:border-cyan-400 hover:bg-cyan-500/10 active:scale-[0.99] transition-all duration-150 shadow-md shadow-cyan-950 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-slate-950"
              >
                <Bookmark className="w-4 h-4 text-cyan-400 transition-transform group-hover:scale-110" />
                <span>Save this Decision</span>
              </button>

              {/* Save Confirmation Toast */}
              {saveToast && (
                <div className="text-xs text-cyan-300 bg-cyan-950/70 border border-cyan-500/30 px-3 py-1.5 rounded-lg animate-fadeIn">
                  {saveToast}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 4. Renamed Section: Decision History with Stateful Undo */}
        <section ref={historyRef} className="mt-12 pt-8 border-t border-slate-800/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <div>
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <History className="w-4 h-4 text-cyan-400" />
                Decision History
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Track past evaluations, cooling-off items, and protected savings
              </p>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              {/* Stateful Undo Button (Visible for 10s after delete or clear) */}
              {showUndo && (
                <button
                  type="button"
                  onClick={handleUndo}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-cyan-500/60 bg-cyan-950/80 text-cyan-300 font-semibold hover:bg-cyan-900/90 transition-all cursor-pointer shadow-sm shadow-cyan-950 animate-fadeIn"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Undo</span>
                </button>
              )}

              {/* Clear History Button */}
              {decisionHistory.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearHistory}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                    confirmClear
                      ? "bg-rose-950/80 text-rose-300 border-rose-600 font-bold"
                      : "text-slate-400 border-slate-800 hover:text-rose-400 hover:border-slate-700"
                  }`}
                >
                  {confirmClear ? "Click again to confirm clear" : "Clear History"}
                </button>
              )}
            </div>
          </div>

          {/* Decision List */}
          {decisionHistory.length === 0 ? (
            <div className="p-8 rounded-2xl bg-slate-900/40 border border-slate-800/80 text-center text-xs text-slate-500">
              <History className="w-8 h-8 mx-auto mb-2 text-slate-600 stroke-1" />
              <p className="text-slate-400 font-medium">No decisions recorded yet</p>
              <p className="mt-1 text-slate-500">
                Run a reality check above and save items to your icebox or decision history.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {decisionHistory.map((item) => {
                const isIceboxActive =
                  item.status === "pending_icebox" &&
                  item.iceboxUntil &&
                  item.iceboxUntil > Date.now();

                return (
                  <div
                    key={item.id}
                    className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-slate-700/80 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-100 text-sm sm:text-base">
                          {item.itemName}
                        </span>
                        <span className="font-mono font-bold text-sm text-cyan-400">
                          ₹{formatINR(item.price)}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                            item.regretLevel === "Low"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                              : item.regretLevel === "Moderate"
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                              : "bg-rose-500/10 text-rose-400 border-rose-500/30"
                          }`}
                        >
                          Score {item.regretScore}/10 • {item.regretLevel}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                        <span>
                          {new Date(item.evaluatedAt).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </span>

                        {/* Status Pills */}
                        {item.status === "vetoed" && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-full">
                            <ShieldCheck className="w-3 h-3" />
                            Vetoed (+₹{formatINR(item.price)} Protected)
                          </span>
                        )}

                        {item.status === "bought" && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
                            <ShoppingBag className="w-3 h-3" />
                            Purchased
                          </span>
                        )}

                        {item.status === "pending_icebox" && (
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                              isIceboxActive
                                ? "text-cyan-300 bg-cyan-950/60 border-cyan-700/50"
                                : "text-amber-300 bg-amber-950/60 border-amber-800/50"
                            }`}
                          >
                            <Snowflake className="w-3 h-3 text-cyan-400" />
                            {item.iceboxUntil
                              ? formatRemainingTime(item.iceboxUntil)
                              : "Pending Decision"}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Status Action Controls */}
                    <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(item.id, "vetoed")}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border font-semibold transition-colors cursor-pointer ${
                          item.status === "vetoed"
                            ? "bg-emerald-500/20 border-emerald-500 text-emerald-300"
                            : "bg-slate-950/80 border-slate-800 text-slate-300 hover:border-emerald-600 hover:text-emerald-300"
                        }`}
                        title="Mark as Vetoed (adds to saved total)"
                      >
                        Veto (Save ₹)
                      </button>

                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(item.id, "bought")}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors cursor-pointer ${
                          item.status === "bought"
                            ? "bg-slate-800 border-slate-600 text-slate-200"
                            : "bg-slate-950/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                        }`}
                        title="Mark as Bought"
                      >
                        Bought
                      </button>

                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(item.id, "pending_icebox")}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors cursor-pointer ${
                          item.status === "pending_icebox"
                            ? "bg-cyan-500/20 border-cyan-500 text-cyan-300"
                            : "bg-slate-950/80 border-slate-800 text-slate-400 hover:text-cyan-300 hover:border-cyan-700"
                        }`}
                        title="Reset 48h Cooling-off period"
                      >
                        Re-Ice 48h
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteItem(item.id)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800/80 rounded-lg transition-colors cursor-pointer"
                        title="Delete item"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Footer */}
        <footer className="mt-14 text-center text-xs text-slate-400 flex items-center justify-center gap-1.5 pb-8">
          <span>SpendVeto • Pre-Purchase Opportunity Cost & Impulse Spending Evaluator</span>
        </footer>
      </div>
    </div>
  );
}
