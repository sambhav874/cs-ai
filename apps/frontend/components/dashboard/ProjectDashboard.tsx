import React, { useMemo, useState } from "react";
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
const C = {
  bg: "#F5F6F8",
  surface: "#FFFFFF",
  border: "#E4E7EC",
  ink: "#171B26",
  inkMuted: "#5B6472",
  inkFaint: "#9AA2B1",
  primary: "#2A3B8F",
  primarySoft: "#EEF0FB",
  violet: "#7C6FE0",
  teal: "#0F9B8E",
  amber: "#D97706",
  red: "#C2410C",
  green: "#15803D",
  slate: "#64748B",
};

const RULE_TYPE_COLORS = [C.primary, C.violet, C.teal, C.amber, C.red, C.slate];

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
  const classifiedTotal = clientSide + supplierSide;
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
    { stage: "Breach Detected", value: activeBreaches, fill: C.red },
    { stage: "Notification Sent", value: 0, fill: C.amber },
    { stage: "In Remediation", value: 0, fill: C.violet },
    { stage: "Resolved", value: 0, fill: C.primary },
    { stage: "Claim Recovered", value: 0, fill: C.green },
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
      { stage: "Breach Detected", value: detected, fill: C.red },
      { stage: "Notification Sent", value: notified, fill: C.amber },
      { stage: "In Remediation", value: inRemediation, fill: C.violet },
      { stage: "Resolved", value: resolved, fill: C.primary },
      { stage: "Claim Recovered", value: recoveredCount, fill: C.green },
    ],
  };
}

/* --------------------------------- helpers ---------------------------------- */
const money = (n: number, currency: "USD" | "SEK" = "USD"): string => {
  const prefix = currency === "SEK" ? "SEK " : "$";
  return n >= 1000 ? `${prefix}${(n / 1000).toFixed(1)}k` : `${prefix}${n}`;
};

function CardShell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg p-5 ${className}`} style={{ background: C.surface, border: `1px solid ${C.border}` }}>
      {children}
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, sub, tone = C.ink,
}: { icon: LucideIcon; label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <CardShell className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide uppercase" style={{ color: C.inkMuted, fontFamily: "'Inter', sans-serif" }}>
          {label}
        </span>
        <Icon size={16} style={{ color: C.inkFaint }} />
      </div>
      <div className="text-2xl" style={{ color: tone, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>
        {value}
      </div>
      {sub && <div className="text-xs" style={{ color: C.inkFaint }}>{sub}</div>}
    </CardShell>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-4">
      <div className="text-[11px] font-semibold tracking-widest uppercase mb-1" style={{ color: C.primary, fontFamily: "'Inter', sans-serif" }}>
        {eyebrow}
      </div>
      <div className="text-base" style={{ color: C.ink, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>
        {title}
      </div>
    </div>
  );
}

const tooltipStyle = {
  background: C.ink,
  border: "none",
  borderRadius: 8,
  color: "#fff",
  fontFamily: "'Inter', sans-serif",
  fontSize: 12,
};

/* --------------------------------- component --------------------------------- */
export default function ProjectDashboard({
  portfolio,
  kpis,
}: {
  portfolio: ProjectKpiPortfolio | null;
  kpis: ContractKPI[];
}) {
  const [range, setRange] = useState<RangeKey>("month");
  const data = useMemo(
    () => portfolio
      ? mergeDashboardDatasets(buildDataset(range), buildLiveDataset(portfolio, kpis))
      : buildDataset(range),
    [portfolio, kpis, range],
  );
  // Keep the existing dashboard portfolio exposure and add the live contract
  // exposure. Use the month baseline for this summary card so a year-range
  // chart total is not mistaken for current open risk.
  const existingPortfolioExposure = buildDataset("month").dollarAtRisk;
  const projectCurrency: "USD" | "SEK" = kpis.some((kpi) => (
    `${kpi.unit || ""} ${kpi.consequence_unit || ""} ${kpi.contract_name || ""}`.toUpperCase().includes("SEK")
    || (kpi.contract_name || "").toLowerCase().includes("airport-charges")
  )) ? "SEK" : "USD";
  const projectExposure = portfolio?.summary.open_exposure ?? 0;

  // Notice we removed the hardcoded background and padding from the outer div 
  // to better blend with the hosting page. The padding can be adjusted there.
  return (
    <div className="w-full">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');
      `}</style>

      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="text-3xl font-bold text-foreground">
            Obligation &amp; Breach Overview
          </h2>
        </div>

        <div className="flex gap-1 p-1 rounded-lg" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
          {(Object.entries(RANGE_META) as [RangeKey, { label: string; buckets: string[] }][]).map(([key, meta]) => (
            <button
              key={key}
              onClick={() => setRange(key)}
              className="px-3 py-1.5 rounded-md text-sm transition-colors"
              style={{
                fontFamily: "'Inter', sans-serif",
                fontWeight: 500,
                background: range === key ? C.primary : "transparent",
                color: range === key ? "#fff" : C.inkMuted,
              }}
            >
              {meta.label}
            </button>
          ))}
        </div>
      </div>

      {/* stat row */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        <StatCard icon={FileCheck2} label="Total Obligations" value={data.totalObligations} sub={`${data.clientSide} client · ${data.supplierSide} supplier`} />
        <StatCard icon={ShieldCheck} label="Compliance Rate" value={`${data.complianceRate}%`} sub={RANGE_META[range].label} tone={C.green} />
        <StatCard icon={AlertTriangle} label="Active Breaches" value={data.activeBreaches} sub={RANGE_META[range].label} tone={C.red} />
        <StatCard icon={DollarSign} label="$ At Risk" value={money(existingPortfolioExposure, "USD")} sub="Existing portfolio exposure" tone={C.amber} />
        <StatCard icon={DollarSign} label={`${projectCurrency} At Risk`} value={money(projectExposure, projectCurrency)} sub="Current project exposure" tone={C.amber} />
        <StatCard icon={Users2} label="Client / Supplier" value={`${Math.round((data.clientSide / data.totalObligations) * 100)}% / ${Math.round((data.supplierSide / data.totalObligations) * 100)}%`} sub="Obligation split" />
      </div>

      {/* compliance trend - hero */}
      <CardShell className="mb-6">
        <SectionTitle eyebrow="Continuous Monitoring" title="Compliance Health Trend" />
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data.complianceTrend} margin={{ left: -12, right: 12 }}>
            <defs>
              <linearGradient id="compliantFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.green} stopOpacity={0.35} />
                <stop offset="100%" stopColor={C.green} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="breachedFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.red} stopOpacity={0.45} />
                <stop offset="100%" stopColor={C.red} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={C.border} vertical={false} />
            <XAxis dataKey="period" tick={{ fontSize: 12, fill: C.inkMuted, fontFamily: "Inter" }} axisLine={{ stroke: C.border }} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: C.inkMuted, fontFamily: "Inter" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="compliant" stackId="1" stroke={C.green} strokeWidth={2} fill="url(#compliantFill)" name="Compliant" />
            <Area type="monotone" dataKey="breached" stackId="1" stroke={C.red} strokeWidth={2} fill="url(#breachedFill)" name="Breached" />
            <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Inter" }} />
          </AreaChart>
        </ResponsiveContainer>
      </CardShell>

      {/* coverage + breach source */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <CardShell>
          <SectionTitle eyebrow="Extraction Engine" title="Obligation Coverage by Rule Type" />
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={data.ruleTypeBreakdown} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {data.ruleTypeBreakdown.map((_, i) => (
                  <Cell key={i} fill={RULE_TYPE_COLORS[i % RULE_TYPE_COLORS.length]} stroke={C.surface} strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#fff' }} />
              <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 12, fontFamily: "Inter" }} />
            </PieChart>
          </ResponsiveContainer>
        </CardShell>

        <CardShell>
          <SectionTitle eyebrow="Real-World Data" title="Breaches detected via Sources" />
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.breachBySource} layout="vertical" margin={{ left: 16 }}>
              <CartesianGrid stroke={C.border} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 12, fill: C.inkMuted, fontFamily: "Inter" }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="source" tick={{ fontSize: 12, fill: C.ink, fontFamily: "Inter" }} axisLine={false} tickLine={false} width={100} />
              <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#fff' }} cursor={{ fill: C.primarySoft }} />
              <Bar dataKey="count" fill={C.primary} radius={[0, 4, 4, 0]} barSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </CardShell>
      </div>

      {/* financial exposure */}
      <CardShell className="mb-6">
        <SectionTitle eyebrow="Business Impact" title="Financial Exposure vs. Recovered" />
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data.financialExposure} margin={{ left: -8, right: 12 }}>
            <CartesianGrid stroke={C.border} vertical={false} />
            <XAxis dataKey="period" tick={{ fontSize: 12, fill: C.inkMuted, fontFamily: "Inter" }} axisLine={{ stroke: C.border }} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: C.inkMuted, fontFamily: "Inter" }} axisLine={false} tickLine={false} tickFormatter={(value: number) => money(value, "USD")} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => money(v, "USD")} />
            <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Inter" }} />
            <Bar dataKey="atRisk" name="$ At Risk" fill={C.amber} radius={[4, 4, 0, 0]} barSize={28} />
            <Line type="monotone" dataKey="recovered" name="$ Recovered" stroke={C.green} strokeWidth={2.5} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </CardShell>

      {/* lifecycle funnel */}
      <CardShell>
        <SectionTitle eyebrow="Closing the Loop" title="Breach → Remediation → Recovery Lifecycle" />
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data.lifecycle} layout="vertical" margin={{ left: 16 }}>
            <CartesianGrid stroke={C.border} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 12, fill: C.inkMuted, fontFamily: "Inter" }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="stage" tick={{ fontSize: 12, fill: C.ink, fontFamily: "Inter" }} axisLine={false} tickLine={false} width={130} />
            <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#fff' }} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={22}>
              {data.lifecycle.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardShell>
    </div>
  );
}
