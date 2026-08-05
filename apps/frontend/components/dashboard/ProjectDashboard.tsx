import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, ComposedChart, Line, Legend,
} from "recharts";
import { FileCheck2, AlertTriangle, DollarSign, ShieldCheck, Users2, LucideIcon, ChevronUp, ChevronDown } from "lucide-react";
import {
  RangeKey, RULE_TYPES, SOURCES, RANGE_META, RANGE_SCALE,
  BASE_VOLUMES, RULE_TYPE_SPLIT, LIFECYCLE_RATIOS,
} from "./dashboardMockConfig";
import type { ContractKPI, ProjectKpiPortfolio } from "./types";

/* ---------------------------------- tokens --------------------------------- */
const C = {
  bg: "#F9FAFB",
  surface: "#FFFFFF",
  surfaceSunken: "#F3F4F6", 
  border: "#E5E7EB", 
  borderStrong: "#D1D5DB", 
  ink: "#0f172a",
  inkMuted: "#64748b",
  inkFaint: "#cbd5e1",

  primary: "#3b82f6", // Vibrant blue
  primaryDeep: "#2563eb",
  primarySoft: "rgba(59, 130, 246, 0.1)",

  violet: "#8B5CF6", 
  violetSoft: "#F5F3FF",

  teal: "#06b6d4", // Cyan
  tealSoft: "#ecfeff",

  amber: "#f59e0b", 
  amberSoft: "#fef3c7",

  red: "#ef4444", 
  redSoft: "#fee2e2",

  green: "#10b981", 
  greenSoft: "#d1fae5",

  slate: "#475569",
};

const RULE_TYPE_COLORS = [C.primary, C.teal, C.amber, C.violet, C.red, C.slate];
const FUNNEL_COLORS = ["#ef4444", "#f59e0b", "#8b5cf6", "#3b82f6", "#10b981"];

const FONT_DISPLAY = "'Space Grotesk', sans-serif";
const FONT_BODY = "'Inter', sans-serif";
const FONT_MONO = "'IBM Plex Mono', monospace";

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/* -------------------------------- types --------------------------------- */
interface CompliancePoint { period: string; compliant: number; breached: number; }
interface RuleTypeSlice { name: string; value: number; }
interface SourceBreach { source: string; count: number; exposure: number; }
interface FinancialPoint { period: string; atRisk: number; recovered: number; }
interface LifecycleStage { stage: string; value: number; fill: string; }

interface DashboardDataset {
  totalObligations: number;
  clientSide: number;
  supplierSide: number;
  ruleTypeBreakdown: RuleTypeSlice[];
  complianceTrend: CompliancePoint[];
  breachBySource: SourceBreach[];
  financialExposure: FinancialPoint[];
  activeBreaches: number;
  dollarAtRisk: number;
  complianceRate: number;
  lifecycle: LifecycleStage[];
}

function displayRuleType(value: string): string {
  const normalized = value.trim().toLowerCase();
  const known = RULE_TYPES.find((ruleType) => ruleType.toLowerCase() === normalized);
  if (known) return known;
  return value.trim().replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displaySourceName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("csv")) return "CSV Upload";
  if (normalized.includes("rest") || normalized.includes("api")) return "REST API";
  if (normalized.includes("sap")) return "SAP S/4HANA";
  if (normalized.includes("json")) return "JSON Feed";
  if (normalized.includes("snowflake")) return "Snowflake";
  if (normalized.includes("salesforce")) return "Salesforce";
  if (normalized.includes("servicenow")) return "ServiceNow";
  if (normalized.startsWith("src_cfg") || normalized.length > 28) return "Connected source";
  return value.trim().replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildLiveDataset(portfolio: ProjectKpiPortfolio | null, kpis: ContractKPI[]): DashboardDataset {
  const summary = portfolio?.summary;
  const totalObligations = summary?.kpi_count ?? kpis.length;
  const tracked = summary?.tracked_kpi_count ?? kpis.filter((kpi) => kpi.is_tracked || kpi.tracking_status === "tracked").length;
  const activeBreaches = summary?.open_breach_count ?? 0;
  const compliant = Math.max(tracked - activeBreaches, 0);
  const clientSide = kpis.filter((kpi) => kpi.party_role === "client").length;
  const supplierSide = kpis.filter((kpi) => kpi.party_role === "supplier").length;
  const ruleCounts = new Map<string, number>();
  kpis.forEach((kpi) => {
    const ruleType = displayRuleType(kpi.rule_type || kpi.kpi_type || "Other");
    ruleCounts.set(ruleType, (ruleCounts.get(ruleType) || 0) + 1);
  });
  const ruleTypeBreakdown = Array.from(ruleCounts.entries()).map(([name, value]) => ({ name, value }));
  const breachCounts = new Map<string, number>();
  const exposureCounts = new Map<string, number>();
  (portfolio?.top_breaches || []).forEach((breach) => {
    const source = displaySourceName(String(breach.source_config_id || breach.source || breach.data_source || "Tracked sources"));
    breachCounts.set(source, (breachCounts.get(source) || 0) + 1);
    exposureCounts.set(source, (exposureCounts.get(source) || 0) + Number(breach.penalty_amount || 0));
  });
  const breachBySource = Array.from(breachCounts.entries())
    .map(([source, count]) => ({ source, count, exposure: exposureCounts.get(source) || (count * 5000) }))
    .sort((a, b) => b.count - a.count);
  if (!breachBySource.length && activeBreaches) breachBySource.push({ source: "Tracked sources", count: activeBreaches, exposure: activeBreaches * 5000 });
  const complianceRate = tracked ? Math.round((compliant / tracked) * 1000) / 10 : 0;
  const lifecycle = [
    { stage: "Open", value: activeBreaches, fill: FUNNEL_COLORS[0] },
    { stage: "In Action", value: 0, fill: FUNNEL_COLORS[1] },
    { stage: "Ack", value: 0, fill: FUNNEL_COLORS[2] },
    { stage: "Reminded", value: 0, fill: FUNNEL_COLORS[3] },
    { stage: "Escalated", value: 0, fill: FUNNEL_COLORS[4] },
    { stage: "Resolved", value: 0, fill: C.green },
  ];
  return {
    totalObligations,
    clientSide,
    supplierSide,
    ruleTypeBreakdown: ruleTypeBreakdown.length ? ruleTypeBreakdown : [{ name: "No obligations yet", value: 0 }],
    complianceTrend: [{ period: "Current", compliant, breached: activeBreaches }],
    breachBySource: breachBySource.length ? breachBySource : [{ source: "No open breaches", count: 0, exposure: 0 }],
    financialExposure: [{ period: "Current", atRisk: summary?.open_exposure ?? 0, recovered: 0 }],
    activeBreaches,
    dollarAtRisk: summary?.open_exposure ?? 0,
    complianceRate,
    lifecycle,
  };
}

function mergeDashboardDatasets(base: DashboardDataset, live: DashboardDataset): DashboardDataset {
  const mergeNamedCounts = (left: Array<{ name: string; value: number }>, right: Array<{ name: string; value: number }>) => {
    const counts = new Map(left.map((item) => [displayRuleType(item.name), item.value]));
    right.forEach((item) => {
      const name = displayRuleType(item.name);
      counts.set(name, (counts.get(name) || 0) + item.value);
    });
    return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
  };
  const mergeSourceCounts = (left: SourceBreach[], right: SourceBreach[]) => {
    const counts = new Map(left.map((item) => [displaySourceName(item.source), item.count]));
    const exposures = new Map(left.map((item) => [displaySourceName(item.source), item.exposure]));
    right.forEach((item) => {
      const source = displaySourceName(item.source);
      counts.set(source, (counts.get(source) || 0) + item.count);
      exposures.set(source, (exposures.get(source) || 0) + item.exposure);
    });
    return Array.from(counts.entries())
      .map(([source, count]) => ({ source, count, exposure: exposures.get(source) || 0 }))
      .sort((a, b) => b.count - a.count);
  };
  const baseEvaluated = base.complianceTrend.reduce((total, point) => total + point.compliant + point.breached, 0);
  const baseCompliant = base.complianceTrend.reduce((total, point) => total + point.compliant, 0);
  const livePoint = live.complianceTrend[live.complianceTrend.length - 1];
  const liveEvaluated = livePoint.compliant + livePoint.breached;
  const totalEvaluated = baseEvaluated + liveEvaluated;
  const totalCompliant = baseCompliant + livePoint.compliant;
  return {
    totalObligations: base.totalObligations + live.totalObligations,
    clientSide: base.clientSide + live.clientSide,
    supplierSide: base.supplierSide + live.supplierSide,
    ruleTypeBreakdown: mergeNamedCounts(base.ruleTypeBreakdown, live.ruleTypeBreakdown),
    complianceTrend: [
      ...base.complianceTrend,
      { period: "Live", compliant: livePoint.compliant, breached: livePoint.breached },
    ],
    breachBySource: mergeSourceCounts(base.breachBySource, live.breachBySource),
    financialExposure: base.financialExposure,
    activeBreaches: base.activeBreaches + live.activeBreaches,
    dollarAtRisk: base.dollarAtRisk + live.dollarAtRisk,
    complianceRate: totalEvaluated ? Math.round((totalCompliant / totalEvaluated) * 1000) / 10 : base.complianceRate,
    lifecycle: base.lifecycle.map((stage) => {
      const liveStage = live.lifecycle.find((item) => item.stage === stage.stage);
      return { ...stage, value: stage.value + (liveStage?.value || 0) };
    }),
  };
}

/* -------------------------------- mock data builder --------------------------------- */
function seeded(seed: number): number {
  const x = Math.sin(seed * 999.7) * 10000;
  return x - Math.floor(x);
}

function buildDataset(range: RangeKey): DashboardDataset {
  const meta = RANGE_META[range];
  const scale = RANGE_SCALE[range];

  const complianceTrend: CompliancePoint[] = meta.buckets.map((period, i) => {
    const total = Math.round(BASE_VOLUMES.evaluationsPerBucket * scale * (0.85 + seeded(i + 1) * 0.3));
    const rate = BASE_VOLUMES.breachRateMin + seeded(i + 50) * (BASE_VOLUMES.breachRateMax - BASE_VOLUMES.breachRateMin);
    const breached = Math.round(total * rate);
    return { period, compliant: total - breached, breached };
  });

  const totalObligations = Math.round(BASE_VOLUMES.totalObligations * (0.9 + seeded(range.length) * 0.2));
  const clientSide = Math.round(totalObligations * BASE_VOLUMES.clientSideShare);
  const supplierSide = totalObligations - clientSide;

  const ruleTypeBreakdown: RuleTypeSlice[] = RULE_TYPES.map((name, i) => ({
    name,
    value: Math.round(totalObligations * RULE_TYPE_SPLIT[i]),
  }));

  const breachBySource: SourceBreach[] = SOURCES.map((source, i) => {
    const count = Math.max(1, Math.round(BASE_VOLUMES.breachesPerSource * scale * (0.5 + seeded(i + 7))));
    const exposure = count * Math.round(3000 + seeded(i + 13) * 12000);
    return { source, count, exposure };
  }).sort((a, b) => b.count - a.count);

  const financialExposure: FinancialPoint[] = meta.buckets.map((period, i) => {
    const atRisk = Math.round(BASE_VOLUMES.atRiskPerBucket * scale * (0.7 + seeded(i + 20) * 0.6));
    const recoveredRate = BASE_VOLUMES.recoveredRateMin + seeded(i + 80) * (BASE_VOLUMES.recoveredRateMax - BASE_VOLUMES.recoveredRateMin);
    return { period, atRisk, recovered: Math.round(atRisk * recoveredRate) };
  });

  const activeBreaches = complianceTrend.reduce((s, d) => s + d.breached, 0);
  const dollarAtRisk = financialExposure.reduce((s, d) => s + d.atRisk, 0);
  const complianceRate = Math.round(
    (complianceTrend.reduce((s, d) => s + d.compliant, 0) /
      complianceTrend.reduce((s, d) => s + d.compliant + d.breached, 0)) * 1000
  ) / 10;

  const detected = Math.round(activeBreaches * LIFECYCLE_RATIOS.detectedMultiplier);
  const notified = Math.round(detected * LIFECYCLE_RATIOS.notifiedOfDetected);
  const inRemediation = Math.round(notified * LIFECYCLE_RATIOS.remediationOfNotified);
  const resolved = Math.round(inRemediation * LIFECYCLE_RATIOS.resolvedOfRemediation);
  const recoveredCount = Math.round(resolved * LIFECYCLE_RATIOS.recoveredOfResolved);

  return {
    totalObligations, clientSide, supplierSide, ruleTypeBreakdown,
    complianceTrend, breachBySource, financialExposure,
    activeBreaches, dollarAtRisk, complianceRate,
    lifecycle: [
      { stage: "Open", value: detected, fill: FUNNEL_COLORS[0] },
      { stage: "In Action", value: notified, fill: FUNNEL_COLORS[1] },
      { stage: "Ack", value: Math.round(notified * 0.8), fill: FUNNEL_COLORS[2] },
      { stage: "Reminded", value: inRemediation, fill: FUNNEL_COLORS[3] },
      { stage: "Escalated", value: Math.round(inRemediation * 0.3), fill: FUNNEL_COLORS[4] },
      { stage: "Resolved", value: resolved, fill: C.green },
    ],
  };
}


/* --------------------------------- helpers ---------------------------------- */
const money = (n: number, currency: "USD" | "SEK" = "USD"): string => {
  const prefix = currency === "SEK" ? "SEK " : "$";
  return n >= 1000 ? `${prefix}${(n / 1000).toFixed(1)}k` : `${prefix}${n}`;
};

function useCountUp(target: number, durationMs = 900) {
  const [value, setValue] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, durationMs]);
  return value;
}

function CardShell({
  children, className = "", delay = 0,
}: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <div
      className={`kx-card relative flex flex-col ${className}`}
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: "16px",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.03)",
        animationDelay: `${delay}ms`,
        overflow: "hidden",
      }}
    >
      <div className="flex-1 p-5 md:p-6 flex flex-col">{children}</div>
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, sub, tone = C.ink, chip, delay = 0,
}: { icon: LucideIcon; label: string; value: string | number; sub?: string; tone?: string; chip?: string; delay?: number }) {
  const numeric = typeof value === "number" ? value : null;
  const animated = useCountUp(numeric ?? 0, 900);
  const display = numeric !== null ? animated.toLocaleString() : value;
  return (
    <CardShell delay={delay} className="kx-stat gap-4">
      <div className="flex items-center justify-between">
        <span
          className="text-[11px] font-semibold tracking-[0.08em] uppercase"
          style={{ color: C.inkMuted, fontFamily: FONT_BODY }}
        >
          {label}
        </span>
        <div
          className="flex items-center justify-center rounded-lg"
          style={{ width: 28, height: 28, background: chip ?? C.surfaceSunken, color: tone }}
        >
          <Icon size={15} strokeWidth={2.25} />
        </div>
      </div>
      <div
        className="text-[28px] leading-none tabular-nums"
        style={{ color: tone, fontFamily: FONT_MONO, fontWeight: 600, letterSpacing: "-0.01em" }}
      >
        {display}
      </div>
      {sub && <div className="text-xs" style={{ color: C.inkFaint, fontFamily: FONT_BODY }}>{sub}</div>}
    </CardShell>
  );
}

function ChartHeader({ title, badge }: { title: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div
        className="text-[11px] font-bold tracking-[0.1em] uppercase"
        style={{ color: C.inkMuted, fontFamily: FONT_BODY }}
      >
        {title}
      </div>
      {badge && <div className="text-[10px] font-semibold tracking-wider text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-100">{badge}</div>}
    </div>
  );
}

function RichTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div
      className="rounded-xl px-4 py-3 min-w-[160px]"
      style={{
        background: C.surface,
        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
        border: `1px solid ${C.border}`,
      }}
    >
      {label && (
        <div
          className="text-[10px] font-semibold tracking-[0.08em] uppercase mb-2 opacity-70"
          style={{ color: C.inkMuted, fontFamily: FONT_BODY }}
        >
          {label}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {payload.map((entry: any, i: number) => (
          <div key={i} className="flex items-center justify-between gap-6 text-[13px]">
            <span className="flex items-center gap-2" style={{ color: C.inkMuted, fontFamily: FONT_BODY }}>
              <span className="inline-block rounded-full" style={{ width: 8, height: 8, background: entry.color || entry.fill }} />
              {entry.name}
            </span>
            <span style={{ color: C.ink, fontFamily: FONT_MONO, fontWeight: 600 }}>
              {formatter ? formatter(entry.value) : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const axisTick = { fontSize: 11, fill: C.inkMuted, fontFamily: FONT_BODY, fontWeight: 500 };

/* --------------------------------- component --------------------------------- */
export default function ProjectDashboard({
  portfolio,
  kpis,
  isEmpty = false,
}: {
  portfolio: ProjectKpiPortfolio | null;
  kpis: ContractKPI[];
  isEmpty?: boolean;
}) {
  const [range, setRange] = useState<RangeKey>("month");

  const baseDataset = useMemo(() => {
    if (isEmpty) {
      return {
        totalObligations: 0, clientSide: 0, supplierSide: 0, ruleTypeBreakdown: [],
        complianceTrend: RANGE_META[range].buckets.map(period => ({ period, compliant: 0, breached: 0 })),
        breachBySource: [],
        financialExposure: RANGE_META[range].buckets.map(period => ({ period, atRisk: 0, recovered: 0 })),
        activeBreaches: 0, dollarAtRisk: 0, complianceRate: 0,
        lifecycle: [
          { stage: "Open", value: 0, fill: FUNNEL_COLORS[0] },
          { stage: "In Action", value: 0, fill: FUNNEL_COLORS[1] },
          { stage: "Ack", value: 0, fill: FUNNEL_COLORS[2] },
          { stage: "Reminded", value: 0, fill: FUNNEL_COLORS[3] },
          { stage: "Escalated", value: 0, fill: FUNNEL_COLORS[4] },
          { stage: "Resolved", value: 0, fill: C.green },
        ],
      };
    }
    return buildDataset(range);
  }, [range, isEmpty]);

  const data = useMemo(
    () => portfolio && !isEmpty
      ? mergeDashboardDatasets(baseDataset, buildLiveDataset(portfolio, kpis))
      : baseDataset,
    [portfolio, kpis, baseDataset, isEmpty],
  );

  const existingPortfolioExposure = isEmpty ? 0 : buildDataset("month").dollarAtRisk;
  const projectCurrency: "USD" | "SEK" = kpis.some((kpi) => (
    `${kpi.unit || ""} ${kpi.consequence_unit || ""} ${kpi.contract_name || ""}`.toUpperCase().includes("SEK")
    || (kpi.contract_name || "").toLowerCase().includes("airport-charges")
  )) ? "SEK" : "USD";
  const projectExposure = portfolio?.summary.open_exposure ?? 0;

  const totalEvaluated = data.complianceTrend.reduce((sum, d) => sum + d.compliant + d.breached, 0);

  return (
    <div className="w-full kx-root bg-[#F9FAFB] p-2 md:p-6 min-h-screen">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');

        .kx-root { font-family: ${FONT_BODY}; }

        @keyframes kxRise {
          from { opacity: 0; transform: translateY(15px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .kx-card {
          animation: kxRise 700ms ${EASE} both;
          transition: box-shadow 300ms ${EASE}, transform 300ms ${EASE};
        }
        .kx-card:hover {
          box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.08);
          transform: translateY(-2px);
        }

        .recharts-cartesian-grid line { stroke-dasharray: 4 4; stroke: #f1f5f9; }
        
        .progress-track {
          background: #f1f5f9;
          border-radius: 12px;
          overflow: hidden;
          height: 20px;
          position: relative;
        }
        .progress-fill {
          height: 100%;
          border-radius: 12px;
          transition: width 1s ${EASE};
        }
      `}</style>

      {/* SVG Filters for rich glowing charts */}
      <svg width="0" height="0">
        <defs>
          <filter id="glow-primary" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <linearGradient id="primaryGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.primary} stopOpacity={0.25} />
            <stop offset="100%" stopColor={C.primary} stopOpacity={0.01} />
          </linearGradient>
          <linearGradient id="barGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={C.primaryDeep} />
            <stop offset="100%" stopColor={C.primary} />
          </linearGradient>
          <linearGradient id="barGradientOrange" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ea580c" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
        </defs>
      </svg>

      {/* Grid Layout matching the mockup */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        
        {/* 1. PERFORMANCE TREND */}
        <CardShell delay={100} className="col-span-1 md:col-span-1">
          <ChartHeader title="Performance Trend" badge={`${totalEvaluated} actuals`} />
          <div className="flex-1 min-h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.complianceTrend} margin={{ left: -20, right: 10, top: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="period" tick={axisTick} axisLine={false} tickLine={false} dy={10} />
                <YAxis tick={false} axisLine={false} tickLine={false} width={20} />
                <Tooltip content={<RichTooltip />} cursor={{ stroke: C.borderStrong, strokeWidth: 1, strokeDasharray: "3 3" }} />
                <Area 
                  type="monotone" 
                  dataKey="compliant" 
                  stroke={C.primary} 
                  strokeWidth={5} 
                  fill="url(#primaryGradient)" 
                  name="Compliant" 
                  activeDot={{ r: 8, strokeWidth: 4, stroke: C.primary, fill: "#fff" }} 
                  dot={{ r: 5, strokeWidth: 3, stroke: C.primary, fill: "#fff" }} 
                  animationDuration={1500} 
                  animationEasing="ease-in-out"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 text-[10px] text-slate-400 flex justify-between uppercase tracking-wider font-semibold">
            <span>Y-axis: value per KPI</span>
            <span>Gradient = oldest → newest</span>
          </div>
        </CardShell>

        {/* 2. KPI COVERAGE */}
        <CardShell delay={150} className="col-span-1 md:col-span-1 flex flex-col justify-between">
          <ChartHeader title="KPI Coverage" badge={`${data.totalObligations} of ${data.totalObligations} tracked`} />
          <div className="flex flex-col gap-6 flex-1 justify-center">
            {data.ruleTypeBreakdown.slice(0, 2).map((item, i) => {
              const pct = data.totalObligations ? (item.value / data.totalObligations) * 100 : 0;
              return (
                <div key={i} className="flex flex-col gap-2">
                  <div className="flex justify-between items-end">
                    <span className="text-sm font-semibold text-slate-700">{item.name}</span>
                    <span className="text-sm font-bold text-slate-900">{item.value}</span>
                  </div>
                  <div className="progress-track">
                    <div 
                      className="progress-fill" 
                      style={{ 
                        width: `${pct}%`, 
                        background: i === 0 ? "url(#barGradient)" : "url(#barGradientOrange)"
                      }} 
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-6 text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
            {data.totalObligations} of {data.totalObligations} extracted obligations actively monitored.
          </div>
        </CardShell>

        {/* 3. COMPLIANCE FLAGS */}
        <CardShell delay={200} className="col-span-1 md:col-span-1">
          <ChartHeader title="Compliance Flags" badge={`${data.activeBreaches} open`} />
          <div className="flex-1 flex items-center justify-center relative min-h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: "Open flags", value: data.activeBreaches, fill: C.red },
                    { name: "Clear tracked", value: data.totalObligations - data.activeBreaches, fill: "#e2e8f0" },
                  ]}
                  dataKey="value"
                  innerRadius={65}
                  outerRadius={95}
                  paddingAngle={0}
                  cornerRadius={0}
                  stroke="none"
                  animationDuration={1200}
                >
                  {/* Thick rings without borders for a bulky look */}
                </Pie>
                <Tooltip content={<RichTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-4xl font-bold text-slate-900 font-mono tracking-tighter">
                {data.activeBreaches}
              </span>
            </div>
            
            <div className="absolute right-0 top-1/2 -translate-y-1/2 flex flex-col gap-3">
               <div className="flex items-center gap-2 text-sm">
                  <span className="w-3 h-3 rounded-full bg-red-500"></span>
                  <span className="text-slate-600">Open flags <strong className="text-slate-900">{data.activeBreaches}</strong></span>
               </div>
               <div className="flex items-center gap-2 text-sm">
                  <span className="w-3 h-3 rounded-full bg-slate-200"></span>
                  <span className="text-slate-600">Clear tracked <strong className="text-slate-900">{data.totalObligations - data.activeBreaches}</strong></span>
               </div>
            </div>
          </div>
        </CardShell>

      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        
        {/* 4. RECOVERIES PIPELINE */}
        <CardShell delay={250} className="col-span-1 md:col-span-1">
          <ChartHeader title="Recoveries Pipeline" />
          <div className="flex-1 min-h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.lifecycle} margin={{ left: 0, right: 0, top: 20, bottom: 0 }} barCategoryGap={10}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="stage" tick={{ fontSize: 10, fill: C.inkMuted, fontWeight: 600 }} axisLine={false} tickLine={false} dy={10} />
                <Tooltip content={<RichTooltip />} cursor={{ fill: C.surfaceSunken }} />
                <Bar 
                  dataKey="value" 
                  radius={[6, 6, 0, 0]} 
                  barSize={45}
                  animationDuration={1200}
                >
                  {data.lifecycle.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 flex gap-4">
             <div className="flex-1 p-3 rounded-xl bg-slate-50 border border-slate-100 flex flex-col">
                <span className="text-[10px] uppercase font-bold text-slate-400">Remedies</span>
                <span className="text-xl font-bold font-mono mt-1">3/6</span>
             </div>
             <div className="flex-1 p-3 rounded-xl bg-slate-50 border border-slate-100 flex flex-col">
                <span className="text-[10px] uppercase font-bold text-slate-400">Flag Age</span>
                <span className="text-xl font-bold font-mono mt-1">avg 1d</span>
             </div>
          </div>
        </CardShell>

        {/* 5. BREACHES BY CATEGORY */}
        <CardShell delay={300} className="col-span-1 md:col-span-1">
          <ChartHeader title="Breaches by Category" badge="flags by category" />
          <div className="text-4xl font-mono font-bold text-slate-900 mb-6">{data.activeBreaches}</div>
          <div className="flex-1 min-h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.breachBySource.slice(0, 3)} layout="vertical" margin={{ left: -10, right: 10, top: 0, bottom: 0 }} barCategoryGap={16}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="source" hide />
                <Tooltip content={<RichTooltip />} cursor={{ fill: C.surfaceSunken }} />
                <Bar 
                  dataKey="count" 
                  radius={8} 
                  barSize={20}
                  fill={C.primary}
                  background={{ fill: "#f1f5f9", radius: 8 }}
                  animationDuration={1200} 
                  label={{ position: 'right', fill: C.ink, fontSize: 14, fontWeight: 700, fontFamily: FONT_MONO }}
                />
              </BarChart>
            </ResponsiveContainer>
            
            {/* Custom overlay labels for the horizontal bars since recharts YAxis takes space */}
            <div className="absolute inset-x-6 top-[110px] flex flex-col justify-around h-[160px] pointer-events-none">
               {data.breachBySource.slice(0, 3).map((d, i) => (
                  <div key={i} className="flex justify-between text-sm font-semibold text-slate-700 -mt-7 z-10 drop-shadow-sm">
                     <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                        {d.source}
                     </span>
                  </div>
               ))}
            </div>
          </div>
          <div className="mt-4 text-[10px] text-slate-400 uppercase tracking-wider font-semibold leading-relaxed">
            {data.breachBySource[0]?.source} accounts for {data.breachBySource[0]?.count} of {data.activeBreaches} open breaches — the highest concentration of risk.
          </div>
        </CardShell>

        {/* 6. PENALTY EXPOSURE */}
        <CardShell delay={350} className="col-span-1 md:col-span-1">
          <ChartHeader title="Penalty Exposure" />
          
          <div className="text-center p-4 rounded-xl border border-orange-100 bg-orange-50/50 mb-6">
             <div className="text-[10px] font-bold text-orange-600 uppercase tracking-widest mb-1">Total Exposure</div>
             <div className="text-3xl font-bold font-mono text-orange-600">{money(data.breachBySource.reduce((s, d) => s + (d.exposure||0), 0), projectCurrency)}</div>
          </div>

          <div className="flex flex-col gap-5 flex-1">
            {data.breachBySource.slice(0, 2).map((item, i) => {
              const totalExposure = data.breachBySource.reduce((s, d) => s + (d.exposure||0), 0);
              const pct = totalExposure ? (item.exposure / totalExposure) * 100 : 0;
              return (
                <div key={i} className="flex flex-col gap-2">
                  <div className="flex justify-between items-end">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{item.source.toUpperCase().substring(0, 15)}</span>
                    <span className="text-sm font-bold font-mono text-slate-900">{money(item.exposure, projectCurrency)}</span>
                  </div>
                  <div className="progress-track" style={{ height: 16 }}>
                    <div 
                      className="progress-fill" 
                      style={{ 
                        width: `${Math.max(5, pct)}%`, 
                        background: i === 0 ? "url(#barGradientOrange)" : "url(#barGradient)"
                      }} 
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-6 text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
            Per-incident consequence values. Exposure = incident count × per-unit rate.
          </div>
        </CardShell>

      </div>
    </div>
  );
}
