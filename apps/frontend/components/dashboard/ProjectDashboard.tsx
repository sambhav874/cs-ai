import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, ComposedChart, Line, Legend,
} from "recharts";
import { FileCheck2, AlertTriangle, DollarSign, ShieldCheck, Users2, LucideIcon } from "lucide-react";
import {
  RangeKey, RULE_TYPES, SOURCES, RANGE_META, RANGE_SCALE,
  BASE_VOLUMES, RULE_TYPE_SPLIT, LIFECYCLE_RATIOS,
} from "./dashboardMockConfig";
import type { ContractKPI, ProjectKpiPortfolio } from "./types";

/* ---------------------------------- tokens --------------------------------- */
// A deliberately "ledger" palette: deep indigo as the anchor (compliance /
// governance reads as authoritative, not playful), warm jewel accents for
// status, and a warm-white paper surface instead of clinical gray-white.
const C = {
  bg: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceSunken: "#F9FAFB", // Tailwind gray-50
  border: "#E5E7EB", // Tailwind gray-200
  borderStrong: "#D1D5DB", // Tailwind gray-300
  ink: "#111827", // Tailwind gray-900
  inkMuted: "#A7A9AC", // UI Guidelines Muted
  inkFaint: "#D1D5DB",

  primary: "#015CA9", // Corporate Blue
  primaryDeep: "#01447D",
  primarySoft: "rgba(1, 92, 169, 0.1)",

  violet: "#8B5CF6", // Vibrant violet restored
  violetSoft: "#F5F3FF",

  teal: "#0D9488", // Deep teal restored
  tealSoft: "#F0FDFA",

  amber: "#D97706", // Rich amber restored
  amberSoft: "#FFFBEB",

  red: "#EE3224", // UI Guidelines Red
  redSoft: "rgba(238, 50, 36, 0.1)",

  green: "#059669", // Emerald green restored
  greenSoft: "#ECFDF5",

  slate: "#475569",
};

const RULE_TYPE_COLORS = [C.primary, C.violet, C.teal, C.amber, C.red, C.slate];

const FONT_DISPLAY = "'Space Grotesk', sans-serif";
const FONT_BODY = "'Inter', sans-serif";
const FONT_MONO = "'IBM Plex Mono', monospace";

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/* -------------------------------- types --------------------------------- */
interface CompliancePoint { period: string; compliant: number; breached: number; }
interface RuleTypeSlice { name: string; value: number; }
interface SourceBreach { source: string; count: number; }
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
  (portfolio?.top_breaches || []).forEach((breach) => {
    const source = displaySourceName(String(breach.source_config_id || breach.source || breach.data_source || "Tracked sources"));
    breachCounts.set(source, (breachCounts.get(source) || 0) + 1);
  });
  const breachBySource = Array.from(breachCounts.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
  if (!breachBySource.length && activeBreaches) breachBySource.push({ source: "Tracked sources", count: activeBreaches });
  const complianceRate = tracked ? Math.round((compliant / tracked) * 1000) / 10 : 0;
  const lifecycle = [
    { stage: "Breach Detected", value: activeBreaches, fill: "#B23A2E" },
    { stage: "Notification Sent", value: 0, fill: "#B4650F" },
    { stage: "In Remediation", value: 0, fill: "#7C3AED" },
    { stage: "Resolved", value: 0, fill: "#2E2A85" },
    { stage: "Claim Recovered", value: 0, fill: "#1E7A4C" },
  ];
  return {
    totalObligations,
    clientSide,
    supplierSide,
    ruleTypeBreakdown: ruleTypeBreakdown.length ? ruleTypeBreakdown : [{ name: "No obligations yet", value: 0 }],
    complianceTrend: [{ period: "Current", compliant, breached: activeBreaches }],
    breachBySource: breachBySource.length ? breachBySource : [{ source: "No open breaches", count: 0 }],
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
    right.forEach((item) => {
      const source = displaySourceName(item.source);
      counts.set(source, (counts.get(source) || 0) + item.count);
    });
    return Array.from(counts.entries())
      .map(([source, count]) => ({ source, count }))
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
      { period: "Live project", compliant: livePoint.compliant, breached: livePoint.breached },
    ],
    breachBySource: mergeSourceCounts(base.breachBySource, live.breachBySource),
    // Keep the existing dollar-denominated portfolio chart separate from the
    // live SEK project exposure shown in the summary card.
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
// Deterministic pseudo-random so numbers are stable across re-renders, still vary by range/index.
// Swap this whole function for a real API call later — just keep the DashboardDataset shape.
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

  const breachBySource: SourceBreach[] = SOURCES.map((source, i) => ({
    source,
    count: Math.max(1, Math.round(BASE_VOLUMES.breachesPerSource * scale * (0.5 + seeded(i + 7)))),
  })).sort((a, b) => b.count - a.count);

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
      { stage: "Breach Detected", value: detected, fill: "#B23A2E" },
      { stage: "Notification Sent", value: notified, fill: "#B4650F" },
      { stage: "In Remediation", value: inRemediation, fill: "#7C3AED" },
      { stage: "Resolved", value: resolved, fill: "#2E2A85" },
      { stage: "Claim Recovered", value: recoveredCount, fill: "#1E7A4C" },
    ],
  };
}


/* --------------------------------- helpers ---------------------------------- */
const money = (n: number, currency: "USD" | "SEK" = "USD"): string => {
  const prefix = currency === "SEK" ? "SEK " : "$";
  return n >= 1000 ? `${prefix}${(n / 1000).toFixed(1)}k` : `${prefix}${n}`;
};

/** Count-up animation for stat card headline numbers. Accepts either a raw
 * number (animates the digits) or a pre-formatted string (fades/settles). */
function useCountUp(target: number, durationMs = 900) {
  const [value, setValue] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out-cubic
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);
  return value;
}

function CardShell({
  children, className = "", accent, delay = 0,
}: { children: React.ReactNode; className?: string; accent?: string; delay?: number }) {
  return (
    <div
      className={`kx-card relative overflow-hidden rounded-xl ${className}`}
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
        animationDelay: `${delay}ms`,
      }}
    >
      {accent && (
        <div
          className="absolute top-0 left-0 right-0 h-[3px]"
          style={{ background: `linear-gradient(90deg, ${accent}, transparent 130%)` }}
        />
      )}
      <div className="p-5">{children}</div>
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
    <CardShell delay={delay} className="kx-stat flex flex-col gap-4">
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

function SectionTitle({ eyebrow, title, accent = C.primary }: { eyebrow: string; title: string; accent?: string }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <div className="mt-1.5 h-6 w-[3px] rounded-full flex-shrink-0" style={{ background: accent }} />
      <div>
        <div
          className="text-[10.5px] font-semibold tracking-[0.14em] uppercase mb-1"
          style={{ color: accent, fontFamily: FONT_BODY }}
        >
          {eyebrow}
        </div>
        <div className="text-[15px]" style={{ color: C.ink, fontFamily: FONT_DISPLAY, fontWeight: 600 }}>
          {title}
        </div>
      </div>
    </div>
  );
}

/** Rich shared tooltip: dark card, colored dot per series, mono numerals. */
function RichTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div
      className="rounded-lg px-4 py-3.5 min-w-[160px]"
      style={{
        background: "#FFFFFF",
        boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
        border: "1px solid #E5E7EB",
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
      <div className="flex flex-col gap-1.5">
        {payload.map((entry: any, i: number) => (
          <div key={i} className="flex items-center justify-between gap-4 text-[12.5px]">
            <span className="flex items-center gap-1.5" style={{ color: C.inkMuted, fontFamily: FONT_BODY }}>
              <span className="inline-block rounded-full" style={{ width: 7, height: 7, background: entry.color || entry.fill }} />
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

const axisTick = { fontSize: 11.5, fill: C.inkMuted, fontFamily: FONT_BODY };

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
          { stage: "Breach Detected", value: 0, fill: "#B23A2E" },
          { stage: "Notification Sent", value: 0, fill: "#B4650F" },
          { stage: "In Remediation", value: 0, fill: "#7C3AED" },
          { stage: "Resolved", value: 0, fill: "#2E2A85" },
          { stage: "Claim Recovered", value: 0, fill: "#1E7A4C" },
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

  // Keep the existing dashboard portfolio exposure and add the live contract
  // exposure. Use the month baseline for this summary card so a year-range
  // chart total is not mistaken for current open risk.
  const existingPortfolioExposure = isEmpty ? 0 : buildDataset("month").dollarAtRisk;
  const projectCurrency: "USD" | "SEK" = kpis.some((kpi) => (
    `${kpi.unit || ""} ${kpi.consequence_unit || ""} ${kpi.contract_name || ""}`.toUpperCase().includes("SEK")
    || (kpi.contract_name || "").toLowerCase().includes("airport-charges")
  )) ? "SEK" : "USD";
  const projectExposure = portfolio?.summary.open_exposure ?? 0;

  // Notice we removed the hardcoded background and padding from the outer div
  // to better blend with the hosting page. The padding can be adjusted there.
  return (
    <div className="w-full kx-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');

        .kx-root { font-family: ${FONT_BODY}; }

        @keyframes kxRise {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .kx-card {
          animation: kxRise 560ms ${EASE} both;
          transition: box-shadow 220ms ${EASE}, transform 220ms ${EASE}, border-color 220ms ${EASE};
        }
        .kx-card:hover {
          transform: translateY(-2px);
          border-color: ${C.borderStrong};
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }
        .kx-stat:hover { transform: translateY(-3px) scale(1.005); }

        .kx-tabs button { transition: background 200ms ${EASE}, color 200ms ${EASE}, box-shadow 200ms ${EASE}; }
        .kx-tabs button:hover:not(.kx-tab-active) { background: ${C.surfaceSunken}; color: ${C.ink}; }

        .recharts-cartesian-grid line { stroke-dasharray: 2 6; }
        .recharts-default-legend { margin-top: 6px !important; }
      `}</style>

      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <div
            className="text-[10.5px] font-semibold tracking-[0.14em] uppercase mb-1.5"
            style={{ color: C.primary, fontFamily: FONT_BODY }}
          >
            Governance &amp; Risk
          </div>
          <h2
            className="text-[30px] leading-tight"
            style={{ color: C.ink, fontFamily: FONT_DISPLAY, fontWeight: 700, letterSpacing: "-0.015em" }}
          >
            Obligation &amp; Breach Overview
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <div
            className="kx-tabs flex gap-1 p-1 rounded-xl"
            style={{ background: C.surfaceSunken, border: `1px solid ${C.border}` }}
          >
            {(Object.entries(RANGE_META) as [RangeKey, { label: string; buckets: string[] }][]).map(([key, meta]) => {
              const activeTab = range === key;
              return (
                <button
                  key={key}
                  onClick={() => setRange(key)}
                  className={`px-3.5 py-1.5 rounded-lg text-sm ${activeTab ? "kx-tab-active" : ""}`}
                  style={{
                    fontFamily: FONT_BODY,
                    fontWeight: 500,
                    background: activeTab ? C.primary : "transparent",
                    color: activeTab ? "#fff" : C.inkMuted,
                    boxShadow: activeTab ? "0 6px 16px -6px rgba(46,42,133,0.55)" : "none",
                  }}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* stat row */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        <StatCard delay={0} icon={FileCheck2} label="Total Obligations" value={data.totalObligations} sub={`${data.clientSide} client · ${data.supplierSide} supplier`} tone={C.primary} chip={C.primarySoft} />
        <StatCard delay={40} icon={ShieldCheck} label="Compliance Rate" value={`${data.complianceRate}%`} sub={RANGE_META[range].label} tone={C.green} chip={C.greenSoft} />
        <StatCard delay={80} icon={AlertTriangle} label="Active Breaches" value={data.activeBreaches} sub={RANGE_META[range].label} tone={C.red} chip={C.redSoft} />
        <StatCard delay={120} icon={DollarSign} label="$ At Risk" value={money(existingPortfolioExposure, "USD")} sub="Existing portfolio exposure" tone={C.amber} chip={C.amberSoft} />
        <StatCard delay={160} icon={DollarSign} label={`${projectCurrency} At Risk`} value={money(projectExposure, projectCurrency)} sub="Current project exposure" tone={C.amber} chip={C.amberSoft} />
        <StatCard delay={200} icon={Users2} label="Client / Supplier" value={data.totalObligations > 0 ? `${Math.round((data.clientSide / data.totalObligations) * 100)}% / ${Math.round((data.supplierSide / data.totalObligations) * 100)}%` : "0% / 0%"} sub="Obligation split" tone={C.violet} chip={C.violetSoft} />
      </div>

      {isEmpty ? (
        <div
          className="flex flex-col items-center justify-center p-14 text-center border border-dashed rounded-2xl"
          style={{ borderColor: C.borderStrong, background: C.surfaceSunken }}
        >
          <div
            className="flex items-center justify-center rounded-full mb-4"
            style={{ width: 52, height: 52, background: C.primarySoft, color: C.primary }}
          >
            <FileCheck2 size={22} strokeWidth={2} />
          </div>
          <h3 style={{ color: C.ink, fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 17 }}>No Data Yet</h3>
          <p className="text-sm mt-1.5 max-w-md" style={{ color: C.inkMuted, fontFamily: FONT_BODY }}>
            Upload contracts and configure KPIs to start seeing compliance trends and financial exposure charts.
          </p>
        </div>
      ) : (
        <>
          {/* compliance trend - hero */}
          <CardShell accent={C.primary} delay={240} className="mb-6">
            <SectionTitle eyebrow="Continuous Monitoring" title="Compliance Health Trend" accent={C.primary} />
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data.complianceTrend} margin={{ left: -12, right: 12, top: 8 }}>
                <defs>
                  <linearGradient id="compliantFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.green} stopOpacity={0.7} />
                    <stop offset="60%" stopColor={C.green} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={C.green} stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="breachedFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.red} stopOpacity={0.8} />
                    <stop offset="60%" stopColor={C.red} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={C.red} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={C.border} vertical={false} />
                <XAxis dataKey="period" tick={axisTick} axisLine={{ stroke: C.border }} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} width={40} />
                <Tooltip content={<RichTooltip />} cursor={{ stroke: C.borderStrong, strokeWidth: 1, strokeDasharray: "3 5" }} />
                <Area type="monotone" dataKey="compliant" stackId="1" stroke={C.green} strokeWidth={6} fill="url(#compliantFill)" name="Compliant" dot={false} activeDot={{ r: 7, strokeWidth: 4, stroke: "#fff" }} animationDuration={1500} animationEasing="ease-in-out" />
                <Area type="monotone" dataKey="breached" stackId="1" stroke={C.red} strokeWidth={6} fill="url(#breachedFill)" name="Breached" dot={false} activeDot={{ r: 7, strokeWidth: 4, stroke: "#fff" }} animationDuration={1500} animationEasing="ease-in-out" />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: FONT_BODY }} iconType="circle" iconSize={10} />
              </AreaChart>
            </ResponsiveContainer>
          </CardShell>

          {/* coverage + breach source */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <CardShell accent={C.violet} delay={280}>
              <SectionTitle eyebrow="Extraction Engine" title="Obligation Coverage by Rule Type" accent={C.violet} />
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={data.ruleTypeBreakdown}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={68}
                    outerRadius={120}
                    paddingAngle={4}
                    cornerRadius={8}
                    animationDuration={1200}
                    animationEasing="ease-in-out"
                  >
                    {data.ruleTypeBreakdown.map((_, i) => (
                      <Cell key={i} fill={RULE_TYPE_COLORS[i % RULE_TYPE_COLORS.length]} stroke={C.surface} strokeWidth={4} />
                    ))}
                  </Pie>
                  <Tooltip content={<RichTooltip />} />
                  <Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 12, fontFamily: FONT_BODY }} />
                </PieChart>
              </ResponsiveContainer>
            </CardShell>

            <CardShell accent={C.primary} delay={320}>
              <SectionTitle eyebrow="Real-World Data" title="Breaches detected via Sources" accent={C.primary} />
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data.breachBySource} layout="vertical" margin={{ left: 16, top: 4 }} barCategoryGap={14}>
                  <defs>
                    <linearGradient id="sourceBarFill" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor={C.primary} stopOpacity={0.85} />
                      <stop offset="100%" stopColor={C.primary} stopOpacity={1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={C.border} horizontal={false} />
                  <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="source" tick={{ ...axisTick, fill: C.ink }} axisLine={false} tickLine={false} width={104} />
                  <Tooltip content={<RichTooltip />} cursor={{ fill: C.primarySoft }} />
                  <Bar dataKey="count" fill="url(#sourceBarFill)" radius={[0, 24, 24, 0]} barSize={48} background={{ fill: C.surfaceSunken, radius: [0, 24, 24, 0] }} animationDuration={1200} animationEasing="ease-in-out" />
                </BarChart>
              </ResponsiveContainer>
            </CardShell>
          </div>

          {/* financial exposure */}
          <CardShell accent={C.primary} delay={360} className="mb-6">
            <SectionTitle eyebrow="Business Impact" title="Financial Exposure vs. Recovered" accent={C.primary} />
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={data.financialExposure} margin={{ left: -8, right: 12, top: 8 }} barCategoryGap={24}>
                <defs>
                  <linearGradient id="atRiskFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.primary} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={C.primary} stopOpacity={0.55} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={C.border} vertical={false} />
                <XAxis dataKey="period" tick={axisTick} axisLine={{ stroke: C.border }} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(value: number) => money(value, "USD")} width={54} />
                <Tooltip content={<RichTooltip formatter={(v: number) => money(v, "USD")} />} cursor={{ fill: C.primarySoft }} />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: FONT_BODY }} iconType="circle" iconSize={10} />
                <Bar dataKey="atRisk" name="$ At Risk" fill="url(#atRiskFill)" radius={[16, 16, 0, 0]} barSize={56} background={{ fill: C.surfaceSunken, radius: [16, 16, 0, 0] }} animationDuration={1200} animationEasing="ease-in-out" />
                <Line type="monotone" dataKey="recovered" name="$ Recovered" stroke={C.amber} strokeWidth={6} dot={{ r: 7, strokeWidth: 3, stroke: "#fff", fill: C.amber }} activeDot={{ r: 9, strokeWidth: 4, stroke: "#fff" }} animationDuration={1500} animationEasing="ease-in-out" />
              </ComposedChart>
            </ResponsiveContainer>
          </CardShell>

          {/* lifecycle funnel */}
          <CardShell accent={C.primary} delay={400}>
            <SectionTitle eyebrow="Closing the Loop" title="Breach → Remediation → Recovery Lifecycle" accent={C.primary} />
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={data.lifecycle} layout="vertical" margin={{ left: 16, top: 4 }} barCategoryGap={16}>
                <CartesianGrid stroke={C.border} horizontal={false} />
                <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="stage" tick={{ ...axisTick, fill: C.ink }} axisLine={false} tickLine={false} width={136} />
                <Tooltip content={<RichTooltip />} cursor={{ fill: C.surfaceSunken }} />
                <Bar dataKey="value" radius={[0, 24, 24, 0]} barSize={48} background={{ fill: C.surfaceSunken, radius: [0, 24, 24, 0] }} animationDuration={1200} animationEasing="ease-in-out">
                  {data.lifecycle.map((d, i) => (
                    <Cell key={i} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardShell>
        </>
      )}
    </div>
  );
}