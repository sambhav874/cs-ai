"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { 
  HistoryIcon, 
  Settings, 
  ShieldCheck, 
  Zap, 
  TrendingUp, 
  Activity, 
  Loader2, 
  ArrowRight,
  Database,
  Terminal,
  Clock,
  Sparkles,
  Play,
  Coins,
  Printer
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useBreadcrumbs } from "@/app/context/BreadcrumbContext";
import { useAccountContext } from "@/app/context/AccountContext";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  LineChart, 
  Line, 
  BarChart,
  Bar,
  ReferenceLine,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Legend, 
  ResponsiveContainer 
} from "recharts";

// Simple custom tooltip for recharts since ChartTooltip might be import-conflict
import { Tooltip } from "recharts";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const InfoTooltip = ({ content, children }: { content: string; children: React.ReactNode }) => {
  return (
    <TooltipProvider>
      <UITooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help border-b border-dashed border-muted-foreground/45 hover:border-foreground/85 transition-colors">
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent align="start" className="max-w-xs bg-slate-900 text-slate-100 border border-slate-800 p-3 rounded-lg shadow-xl text-xs leading-relaxed font-sans z-50">
          {content}
        </TooltipContent>
      </UITooltip>
    </TooltipProvider>
  );
};

interface EvalRunSummary {
  run_id: string;
  internal_run_id: string;
  provider: string;
  dataset: string;
  contract_count: number;
  overall_score: number;
  passed_attempts: number;
  total_attempts: number;
  hard_gate_passed: boolean;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  latency_p99_ms?: number | null;
  is_dry_run: boolean;
  status: string;
  celery_task_id: string | null;
  total_tokens?: number;
  measured_cost_usd?: number;
  daily_internal_benchmark?: boolean;
  family_counts?: Record<string, number>;
}

export default function EvaluationsOverviewPage() {
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL ?? "";
  const { isAuthenticated, authenticatedFetch } = useAuth();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedAccountId, setSelectedAccount } = useAccountContext();

  const [runs, setRuns] = useState<EvalRunSummary[]>([]);
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [datasetFilter, setDatasetFilter] = useState<string>("all");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [benchmarkFilter, setBenchmarkFilter] = useState<string>("all");

  // Tab View state
  const [activeTab, setActiveTab] = useState<string>("runs");

  // Modal Run Config state
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [runParams, setRunParams] = useState({
    provider: "groq",
    dataset: "cuad",
    contract_count: 5,
    repeat_default: "",
    repeat_security: "",
    smoke_profile: "none",
    dry_run: true,
    keep_fixtures: false,
    skip_citation_gate: false,
    model_name: "",
    max_cases_per_layer: "",
    threshold_profile: "default",
    no_checkpoint: false,
    allow_short_token: false
  });
  const [triggering, setTriggering] = useState(false);

  // Task progress logs monitoring state
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<string>("pending");
  const [logs, setLogs] = useState<string>("");
  const [logOffset, setLogOffset] = useState<number>(0);
  const [aborting, setAborting] = useState(false);

  // Local Manifest Cases Explorer state
  const [localDataset, setLocalDataset] = useState<string>("cuad");
  const [localSearch, setLocalSearch] = useState<string>("");
  const [localCases, setLocalCases] = useState<any[]>([]);
  const [localTotal, setLocalTotal] = useState(0);
  const [localPage, setLocalPage] = useState(1);
  const [localLoading, setLocalLoading] = useState(false);
  const [expandedCases, setExpandedCases] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setBreadcrumbs([{ label: "Evaluations" }]);
  }, [setBreadcrumbs]);

  // Main fetch: Historical runs and configuration baseline
  useEffect(() => {
    async function fetchData() {
      if (!isAuthenticated || !apiUrl) return;
      try {
        setLoading(true);
        const contextParam = selectedAccountId ? `?context_id=${selectedAccountId}` : "";
        const [runsRes, configRes] = await Promise.all([
          authenticatedFetch(`${apiUrl}/evaluations${contextParam}`),
          authenticatedFetch(`${apiUrl}/evaluations/config`)
        ]);

        if (runsRes.error) {
          throw new Error(runsRes.error);
        }

        setRuns(runsRes.data || []);
        setConfig(configRes.data || null);
      } catch (err: any) {
        setError(err.message || "Failed to load evaluation runs data.");
      } finally {
        setLoading(false);
      }
    }

    if (isAuthenticated) {
      fetchData();
    }
  }, [isAuthenticated, apiUrl, authenticatedFetch, selectedAccountId]);

  // Fetch local manifest cases when the Test Cases tab is open
  useEffect(() => {
    async function fetchLocalCases() {
      if (!isAuthenticated || !apiUrl || activeTab !== "cases") return;
      try {
        setLocalLoading(true);
        const searchParam = localSearch ? `&search=${encodeURIComponent(localSearch)}` : "";
        const res = await authenticatedFetch(
          `${apiUrl}/evaluations/datasets/${localDataset}/cases?page=${localPage}&limit=25${searchParam}`
        );
        if (res.error) {
          throw new Error(res.error);
        }
        setLocalCases(res.data?.cases || []);
        setLocalTotal(res.data?.total || 0);
      } catch (err: any) {
        console.error("Failed to load local cases:", err);
      } finally {
        setLocalLoading(false);
      }
    }
    fetchLocalCases();
  }, [activeTab, localDataset, localSearch, localPage, isAuthenticated, apiUrl, authenticatedFetch]);

  // Active task monitoring (retrieve task ID from local storage on mount)
  useEffect(() => {
    const savedTaskId = localStorage.getItem("active_eval_task_id");
    if (savedTaskId) {
      setActiveTaskId(savedTaskId);
      setLogs("");
      setLogOffset(0);
      setTaskStatus("running");
    }
  }, []);

  // Poll progress log updates from FastAPI backend
  useEffect(() => {
    if (!activeTaskId || !isAuthenticated || !apiUrl) return;

    let intervalId: any = null;
    let currentOffset = logOffset;

    async function checkStatus() {
      try {
        const res = await authenticatedFetch(
          `${apiUrl}/evaluations/run/${activeTaskId}/status?offset=${currentOffset}`
        );
        if (res.error) {
          throw new Error(res.error);
        }

        const data = res.data;
        if (data) {
          setTaskStatus(data.status);
          if (data.logs) {
            setLogs((prev) => prev + data.logs);
            currentOffset = data.offset;
            setLogOffset(data.offset);
          }

          if (data.status !== "running" && data.status !== "pending") {
            // Task completed, failed, or aborted!
            localStorage.removeItem("active_eval_task_id");
            clearInterval(intervalId);
            // Refresh runs database
            const contextParam = selectedAccountId ? `?context_id=${selectedAccountId}` : "";
            const runsRes = await authenticatedFetch(`${apiUrl}/evaluations${contextParam}`);
            if (!runsRes.error) {
              setRuns(runsRes.data || []);
            }
          }
        }
      } catch (err) {
        console.error("Error fetching task status:", err);
      }
    }

    checkStatus();
    intervalId = setInterval(checkStatus, 1500);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [activeTaskId, isAuthenticated, apiUrl, authenticatedFetch, selectedAccountId]);

  // Trigger evaluation
  const handleTriggerRun = async () => {
    if (!isAuthenticated || !apiUrl) return;
    try {
      setTriggering(true);
      
      const payload = {
        provider: runParams.provider,
        dataset: runParams.dataset,
        contract_count: runParams.contract_count,
        repeat_default: runParams.repeat_default ? parseInt(runParams.repeat_default) : null,
        repeat_security: runParams.repeat_security ? parseInt(runParams.repeat_security) : null,
        smoke_profile: runParams.smoke_profile,
        dry_run: runParams.dry_run,
        keep_fixtures: runParams.keep_fixtures,
        skip_citation_gate: runParams.skip_citation_gate,
        model_name: runParams.model_name || null,
        max_cases_per_layer: runParams.max_cases_per_layer ? parseInt(runParams.max_cases_per_layer) : null,
        threshold_profile: runParams.threshold_profile,
        no_checkpoint: runParams.no_checkpoint,
        allow_short_token: runParams.allow_short_token,
        context_id: selectedAccountId
      };

      const res = await authenticatedFetch(`${apiUrl}/evaluations/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.error) {
        throw new Error(res.error);
      }

      const taskId = res.data?.task_id;
      if (taskId) {
        setActiveTaskId(taskId);
        setLogs("");
        setLogOffset(0);
        setTaskStatus("running");
        localStorage.setItem("active_eval_task_id", taskId);
        setRunModalOpen(false);
      }
    } catch (err: any) {
      alert("Failed to start evaluation run: " + (err.message || err));
    } finally {
      setTriggering(false);
    }
  };

  // Abort execution
  const handleAbortRun = async () => {
    if (!activeTaskId || !isAuthenticated || !apiUrl) return;
    try {
      setAborting(true);
      const res = await authenticatedFetch(`${apiUrl}/evaluations/run/${activeTaskId}/abort`, {
        method: "POST"
      });
      if (res.error) {
        throw new Error(res.error);
      }
      setTaskStatus("aborted");
      localStorage.removeItem("active_eval_task_id");
      
      // Refresh runs database
      const contextParam = selectedAccountId ? `?context_id=${selectedAccountId}` : "";
      const runsRes = await authenticatedFetch(`${apiUrl}/evaluations${contextParam}`);
      if (!runsRes.error) {
        setRuns(runsRes.data || []);
      }
    } catch (err: any) {
      alert("Failed to abort evaluation: " + (err.message || err));
    } finally {
      setAborting(false);
    }
  };

  // Clean data for displaying charts (reverse list to show chronological order)
  const chartData = useMemo(() => {
    const formatDateLabel = (runId: string) => {
      const match = runId.match(/202[4-9](\d{2})(\d{2})/);
      if (match) {
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const month = monthNames[parseInt(match[1]) - 1] || "Jul";
        const day = parseInt(match[2]);
        return `${day} ${month}`;
      }
      return runId.substring(0, 12);
    };

    return [...runs]
      .reverse()
      .filter(r => {
        if (datasetFilter !== "all" && r.dataset.toLowerCase() !== datasetFilter.toLowerCase()) return false;
        if (providerFilter !== "all" && r.provider.toLowerCase() !== providerFilter.toLowerCase()) return false;
        if (benchmarkFilter === "benchmark" && (!r.daily_internal_benchmark || r.is_dry_run)) return false;
        if (benchmarkFilter === "dry_run" && !r.is_dry_run) return false;
        return true;
      })
      .map(r => {
        const scorePct = Math.round((r.overall_score > 1.0 ? r.overall_score / 100 : r.overall_score) * 1000) / 10;
        return {
          name: formatDateLabel(r.run_id),
          folderName: r.run_id,
          Accuracy: scorePct,
          p50: r.latency_p50_ms ? Math.round((r.latency_p50_ms / 1000) * 10) / 10 : 0,
          p95: r.latency_p95_ms ? Math.round((r.latency_p95_ms / 1000) * 10) / 10 : 0,
          Cost: r.measured_cost_usd ?? 0
        };
      });
  }, [runs, datasetFilter, providerFilter, benchmarkFilter]);

  // Daily tracking data breakdown per regular test suite (CUAD, ACORD, KPI, Security)
  const suiteChartData = useMemo(() => {
    const mapByDate: Record<string, { dateLabel: string; cuad: number[]; acord: number[]; kpi: number[]; safety: number[] }> = {};

    [...runs].reverse().forEach(r => {
      if (benchmarkFilter === "benchmark" && (!r.daily_internal_benchmark || r.is_dry_run)) return;
      if (benchmarkFilter === "dry_run" && !r.is_dry_run) return;

      const match = r.run_id.match(/202[4-9](\d{2})(\d{2})/);
      let dateLabel = r.run_id.substring(0, 12);
      if (match) {
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const month = monthNames[parseInt(match[1]) - 1] || "Jul";
        const day = parseInt(match[2]);
        dateLabel = `${day} ${month}`;
      }

      if (!mapByDate[dateLabel]) {
        mapByDate[dateLabel] = { dateLabel, cuad: [], acord: [], kpi: [], safety: [] };
      }

      const scorePct = Math.round((r.overall_score > 1.0 ? r.overall_score / 100 : r.overall_score) * 1000) / 10;
      const ds = r.dataset?.toLowerCase() || "";
      if (ds === "cuad") mapByDate[dateLabel].cuad.push(scorePct);
      if (ds === "acord") mapByDate[dateLabel].acord.push(scorePct);
      if (ds === "kpi") mapByDate[dateLabel].kpi.push(scorePct);
      mapByDate[dateLabel].safety.push(r.hard_gate_passed ? 100 : 0);
    });

    return Object.values(mapByDate).map(entry => ({
      name: entry.dateLabel,
      CUAD: entry.cuad.length > 0 ? Math.round(entry.cuad.reduce((a, b) => a + b, 0) / entry.cuad.length) : null,
      ACORD: entry.acord.length > 0 ? Math.round(entry.acord.reduce((a, b) => a + b, 0) / entry.acord.length) : null,
      KPI: entry.kpi.length > 0 ? Math.round(entry.kpi.reduce((a, b) => a + b, 0) / entry.kpi.length) : null,
      Security: entry.safety.length > 0 ? Math.round(entry.safety.reduce((a, b) => a + b, 0) / entry.safety.length) : null,
    }));
  }, [runs, benchmarkFilter]);

  const filteredRuns = useMemo(() => {
    return runs.filter(r => {
      if (datasetFilter !== "all" && r.dataset.toLowerCase() !== datasetFilter.toLowerCase()) return false;
      if (providerFilter !== "all" && r.provider.toLowerCase() !== providerFilter.toLowerCase()) return false;
      if (benchmarkFilter === "benchmark" && (!r.daily_internal_benchmark || r.is_dry_run)) return false;
      if (benchmarkFilter === "dry_run" && !r.is_dry_run) return false;
      return true;
    });
  }, [runs, datasetFilter, providerFilter, benchmarkFilter]);

  const stats = useMemo(() => {
    if (runs.length === 0) return { avgScore: 0, passRate: 0, total: 0, avgLatency: 0, totalCost: 0, totalTokens: 0 };
    const total = runs.length;
    const avgScore = runs.reduce((acc, r) => acc + r.overall_score, 0) / total;
    const passes = runs.filter(r => r.hard_gate_passed).length;
    const latencies = runs.filter(r => r.latency_p95_ms !== null) as EvalRunSummary[];
    const avgLatency = latencies.length > 0 
      ? latencies.reduce((acc, r) => acc + (r.latency_p95_ms || 0), 0) / latencies.length 
      : 0;
    const totalCost = runs.reduce((acc, r) => acc + (r.measured_cost_usd || 0), 0);
    const totalTokens = runs.reduce((acc, r) => acc + (r.total_tokens || 0), 0);

    return {
      avgScore: Math.round(avgScore * 1000) / 10,
      passRate: Math.round((passes / total) * 100),
      total,
      avgLatency: Math.round(avgLatency),
      totalCost: Math.round(totalCost * 1000) / 1000,
      totalTokens
    };
  }, [runs]);

  const providers = useMemo(() => {
    const list = new Set(runs.map(r => r.provider));
    return Array.from(list);
  }, [runs]);

  const datasets = useMemo(() => {
    const list = new Set(runs.map(r => r.dataset));
    return Array.from(list);
  }, [runs]);

  const formatDateLabel = (runId: string) => {
    const datePattern = /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/;
    const match = runId.match(datePattern);
    if (match) {
      const [_, year, month, day, hour, min] = match;
      return `${day} ${new Date(0, parseInt(month) - 1).toLocaleString("default", { month: "short" })} ${year} at ${hour}:${min}`;
    }
    return runId;
  };

  if (selectedAccountId !== "600c00000000000000000001") {
    return (
      <div className="container mx-auto p-6 max-w-7xl h-[80vh] flex items-center justify-center">
        <div className="relative w-full max-w-2xl p-8 rounded-3xl border border-white/10 bg-slate-900/50 backdrop-blur-xl shadow-2xl text-center space-y-6 overflow-hidden">
          {/* Animated radial gradient glows */}
          <div className="absolute -top-40 -left-40 w-96 h-96 bg-primary/20 rounded-full filter blur-[80px] pointer-events-none animate-pulse" />
          <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-indigo-500/20 rounded-full filter blur-[80px] pointer-events-none animate-pulse" />

          <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-tr from-rose-500 to-amber-500 flex items-center justify-center shadow-lg transform rotate-3 hover:rotate-12 transition-transform duration-300">
            <ShieldCheck className="h-10 w-10 text-white" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-extrabold tracking-tight text-foreground">
              Evaluation Environment Restricted
            </h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
              To guarantee data consistency, benchmarking runs and metrics monitoring are restricted strictly to the dedicated 
              <span className="text-primary font-bold"> Evaluation Team</span> workspace account.
            </p>
          </div>

          <div className="pt-4 flex flex-col items-center justify-center gap-3">
            <Button 
              onClick={() => setSelectedAccount("600c00000000000000000001")}
              className="gap-2 text-xs font-bold px-6 py-5 shadow-lg bg-gradient-to-r from-primary to-indigo-600 hover:from-primary/90 hover:to-indigo-600/90 text-white rounded-xl transform active:scale-95 transition-all duration-200"
            >
              <Zap className="h-4 w-4 fill-current" />
              Switch to Evaluation Team
            </Button>
            <Link href="/dashboard" passHref>
              <Button variant="ghost" className="text-xs text-muted-foreground hover:text-foreground">
                Back to Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-8 max-w-7xl">
      {/* Header Banner & Executive Readiness Readout */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-3">
              <HistoryIcon className="h-8 w-8 text-primary" />
              Executive Evaluation Command Center
            </h1>
            <Badge className={`text-xs font-extrabold py-1 px-3 uppercase tracking-wide ${
              stats.avgScore >= 90 
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30" 
                : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30"
            }`}>
              {stats.avgScore >= 90 ? "🟢 Benchmark health (≥ 90%)" : "🟡 Benchmark attention needed (< 90%)"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Audited AI Agent Governance Suite evaluating live agent <strong>Performance</strong>, <strong>Speed</strong>, <strong>Reliability</strong>, and <strong>Cost</strong>.
          </p>
        </div>
        
        <div className="flex items-center gap-3 self-start md:self-center">
          <Button variant="outline" onClick={() => window.print()} className="gap-1.5 text-xs font-semibold px-3 py-2 border-border">
            <Printer className="h-3.5 w-3.5" />
            Export Executive Report
          </Button>
          <Button onClick={() => setRunModalOpen(true)} className="gap-1.5 text-xs font-bold px-4 py-2 shadow-md">
            <Play className="h-3.5 w-3.5 fill-current text-white" />
            Execute Agent Benchmark
          </Button>
        </div>
      </div>

      {/* Active Evaluation Logs Console card */}
      {activeTaskId && (
        <Card className="border-slate-800 bg-slate-950 text-slate-100 font-mono shadow-2xl relative overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <Terminal className="h-4 w-4 text-emerald-400 animate-pulse" />
              <span className="text-xs font-bold text-slate-300">
                Evaluation Console Log &mdash; Task ID: <span className="text-primary font-mono">{activeTaskId.substring(0, 8)}...</span>
              </span>
              <Badge variant="outline" className={`text-[10px] py-0.5 px-2 font-mono uppercase ${
                taskStatus === "running" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 animate-pulse" :
                taskStatus === "pending" ? "bg-amber-500/10 text-amber-400 border-amber-500/30" :
                taskStatus === "completed" ? "bg-blue-500/10 text-blue-400 border-blue-500/30" :
                "bg-rose-500/10 text-rose-400 border-rose-500/30"
              }`}>
                {taskStatus}
              </Badge>
            </div>
            
            <div className="flex items-center gap-2">
              {(taskStatus === "running" || taskStatus === "pending") && (
                <Button 
                  variant="destructive" 
                  size="sm" 
                  onClick={handleAbortRun} 
                  disabled={aborting}
                  className="h-7 text-[10px] px-2.5 font-bold uppercase tracking-wider"
                >
                  {aborting ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : "Abort Run"}
                </Button>
              )}
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => {
                  setActiveTaskId(null);
                  localStorage.removeItem("active_eval_task_id");
                }}
                className="h-7 text-slate-400 hover:text-white text-[10px]"
              >
                Dismiss Console
              </Button>
            </div>
          </div>
          <CardContent className="p-4">
            <pre className="h-[200px] overflow-y-auto text-[11px] text-slate-300 space-y-1 font-mono whitespace-pre-wrap leading-relaxed select-text"
                 ref={(el) => {
                   if (el) el.scrollTop = el.scrollHeight;
                 }}>
              {logs || "Waiting for evaluation agent runner process to stream console logs..."}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-muted/60 p-1 border border-border">
          <TabsTrigger value="runs" className="gap-2 text-xs font-semibold py-1.5 px-3">
            <HistoryIcon className="h-3.5 w-3.5" />
            Benchmark Runs
          </TabsTrigger>
          <TabsTrigger value="cases" className="gap-2 text-xs font-semibold py-1.5 px-3">
            <Database className="h-3.5 w-3.5" />
            Local Test Cases
          </TabsTrigger>
        </TabsList>

        <TabsContent value="runs" className="space-y-6 outline-none">
          {loading ? (
            <div className="space-y-6">
              {/* Quick Filters Skeleton */}
              <div className="flex justify-end gap-3">
                <div className="h-9 w-[140px] animate-pulse bg-muted rounded-md" />
                <div className="h-9 w-[140px] animate-pulse bg-muted rounded-md" />
              </div>

              {/* Aggregate Metric Tiles Skeleton */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {[...Array(4)].map((_, i) => (
                  <Card key={i} className="shadow-sm border-border bg-card/40">
                    <CardContent className="pt-6 flex items-center gap-4">
                      <div className="p-3 rounded-lg w-12 h-12 animate-pulse bg-muted" />
                      <div className="space-y-2 flex-1">
                        <div className="h-3 w-20 animate-pulse bg-muted rounded" />
                        <div className="h-6 w-16 animate-pulse bg-muted rounded" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Main Charts Section Skeleton */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {[...Array(2)].map((_, i) => (
                  <Card key={i} className="border-border">
                    <CardHeader className="pb-2">
                      <div className="h-4 w-40 animate-pulse bg-muted rounded mb-2" />
                      <div className="h-3 w-60 animate-pulse bg-muted rounded" />
                    </CardHeader>
                    <CardContent className="pt-4 h-[300px] flex items-center justify-center bg-card/10">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/40" />
                        <span className="text-xs text-muted-foreground/50 font-mono">Loading chart telemetry...</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Historical List Table Skeleton */}
              <Card className="border-border">
                <CardHeader className="border-b border-border pb-4">
                  <div className="h-4 w-48 animate-pulse bg-muted rounded mb-2" />
                  <div className="h-3 w-72 animate-pulse bg-muted rounded" />
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="w-[280px]">Run Date / ID</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Dataset</TableHead>
                        <TableHead>Contracts</TableHead>
                        <TableHead>Overall Score</TableHead>
                        <TableHead>Latency (p50 / p95)</TableHead>
                        <TableHead>Hard Gates</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead className="text-right pr-6">Inspect</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...Array(5)].map((_, i) => (
                        <TableRow key={i} className="animate-pulse">
                          <TableCell className="py-4">
                            <div className="space-y-1.5">
                              <div className="h-3.5 w-40 bg-muted rounded" />
                              <div className="h-2.5 w-24 bg-muted rounded" />
                            </div>
                          </TableCell>
                          <TableCell><div className="h-3 w-16 bg-muted rounded" /></TableCell>
                          <TableCell><div className="h-3 w-12 bg-muted rounded" /></TableCell>
                          <TableCell><div className="h-3 w-8 bg-muted rounded" /></TableCell>
                          <TableCell><div className="h-4 w-12 bg-muted rounded font-bold" /></TableCell>
                          <TableCell><div className="h-3 w-20 bg-muted rounded" /></TableCell>
                          <TableCell><div className="h-4 w-16 bg-muted rounded-full" /></TableCell>
                          <TableCell><div className="h-4 w-12 bg-muted rounded-full" /></TableCell>
                          <TableCell className="text-right pr-6"><div className="h-8 w-16 ml-auto bg-muted rounded" /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          ) : (
            <>
              {/* Quick Filters: Tier, Dataset, Provider */}
              <div className="flex flex-wrap justify-end items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-medium">Run type:</span>
                  <Select value={benchmarkFilter} onValueChange={setBenchmarkFilter}>
                    <SelectTrigger className="w-[150px] h-9">
                      <SelectValue placeholder="All Tiers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All runs</SelectItem>
                      <SelectItem value="benchmark">Daily Internal Benchmark (live only)</SelectItem>
                      <SelectItem value="dry_run">Dry-run validation</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-medium">Split/Dataset:</span>
                  <Select value={datasetFilter} onValueChange={setDatasetFilter}>
                    <SelectTrigger className="w-[140px] h-9">
                      <SelectValue placeholder="All Datasets" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Splits</SelectItem>
                      {datasets.map(d => (
                        <SelectItem key={d} value={d}>{d.toUpperCase()}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-medium">Provider:</span>
                  <Select value={providerFilter} onValueChange={setProviderFilter}>
                    <SelectTrigger className="w-[140px] h-9">
                      <SelectValue placeholder="All Providers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Providers</SelectItem>
                      {providers.map(p => (
                        <SelectItem key={p} value={p}>{p.toUpperCase()}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* 4 Governance Pillar Aggregate Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                <Card className="shadow-sm border-border bg-card/40 backdrop-blur-md">
                  <CardContent className="pt-6 flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-primary/10 text-primary">
                      <TrendingUp className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <InfoTooltip content="Pillar 1: Performance & Accuracy. Measures legal clause extraction precision, gold span recall, reasoning accuracy, and anti-hallucination.">
                          🎯 Performance Accuracy
                        </InfoTooltip>
                      </p>
                      <h3 className="text-2xl font-bold">{stats.avgScore}%</h3>
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-sm border-border bg-card/40 backdrop-blur-md">
                  <CardContent className="pt-6 flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-500">
                      <ShieldCheck className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <InfoTooltip content="Pillar 3: Reliability & Security. Measures prompt injection defense, document poisoning protection, human approval gates, and scope isolation.">
                          🛡️ Reliability & Security
                        </InfoTooltip>
                      </p>
                      <h3 className="text-2xl font-bold">{stats.passRate}%</h3>
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-sm border-border bg-card/40 backdrop-blur-md">
                  <CardContent className="pt-6 flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-amber-500/10 text-amber-500">
                      <Clock className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <InfoTooltip content="Pillar 2: Speed & Latency. Measures tail processing delay (p95 ceiling) across vector search, security screening, and model synthesis.">
                          ⚡ Response Speed (p95)
                        </InfoTooltip>
                      </p>
                      <h3 className="text-2xl font-bold">{(stats.avgLatency / 1000).toFixed(1)}s</h3>
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-sm border-border bg-card/40 backdrop-blur-md">
                  <CardContent className="pt-6 flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-blue-500/10 text-blue-500">
                      <Coins className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <InfoTooltip content="Pillar 4: Cost & Token Efficiency. Evaluates API cost expenditure ($) and token consumption across model providers.">
                          💰 Cost & Tokens ($ / 1k)
                        </InfoTooltip>
                      </p>
                      <h3 className="text-2xl font-bold">${stats.totalCost}</h3>
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{(stats.totalTokens / 1000).toFixed(1)}k tokens used</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Main Daily Tracking Charts Section */}
              {chartData.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Chart 1: Daily Accuracy Progression */}
                  <Card className="border-border shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-bold flex items-center gap-2 text-primary">
                        <TrendingUp className="h-4 w-4" />
                        Daily Accuracy Trend (%)
                      </CardTitle>
                      <CardDescription className="text-xs">Daily agent accuracy progression vs 90% target baseline.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-4 h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                          <XAxis dataKey="name" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} />
                          <YAxis stroke="#888888" fontSize={10} tickLine={false} axisLine={false} domain={[40, 100]} />
                          <Tooltip 
                            contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} 
                            labelFormatter={(label) => `Date: ${label}`}
                          />
                          <ReferenceLine y={90} stroke="#10b981" strokeDasharray="3 3" label={{ value: "Target: 90%", fill: "#10b981", fontSize: 10 }} />
                          <Line 
                            type="monotone" 
                            dataKey="Accuracy" 
                            name="Accuracy %"
                            stroke="hsl(var(--primary))" 
                            strokeWidth={2.5} 
                            activeDot={{ r: 6 }} 
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  {/* Chart 2: Daily Latency Ceiling */}
                  <Card className="border-border shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-bold flex items-center gap-2 text-amber-500">
                        <Zap className="h-4 w-4" />
                        Daily Latency Ceiling (s)
                      </CardTitle>
                      <CardDescription className="text-xs">Monitors daily p50 median vs p95 tail transaction delay in seconds.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-4 h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                          <XAxis dataKey="name" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} />
                          <YAxis stroke="#888888" fontSize={10} tickLine={false} axisLine={false} unit="s" />
                          <Tooltip 
                            contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} 
                            formatter={(val: any) => [`${val}s`, "Delay"]}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Line type="monotone" dataKey="p50" name="Median (p50)" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                          <Line type="monotone" dataKey="p95" name="Tail (p95)" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  {/* Chart 3: Daily API Cost Expenditure */}
                  <Card className="border-border shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-bold flex items-center gap-2 text-blue-500">
                        <Coins className="h-4 w-4" />
                        Daily API Cost ($)
                      </CardTitle>
                      <CardDescription className="text-xs">Tracks daily LLM provider cost expenditure ($) across benchmark runs.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-4 h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                          <XAxis dataKey="name" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} />
                          <YAxis stroke="#888888" fontSize={10} tickLine={false} axisLine={false} />
                          <Tooltip 
                            contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} 
                            formatter={(value: any) => [`$${value}`, "Est. Cost"]}
                          />
                          <Bar dataKey="Cost" name="Daily Cost ($)" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <div className="border border-dashed border-border rounded-xl p-12 text-center text-muted-foreground bg-card/20">
                  No runs match the selected filter combination.
                </div>
              )}

              {/* Dedicated Trend Graphs for Every Regular Test Suite */}
              {suiteChartData.length > 0 && (
                <div className="space-y-4 pt-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-extrabold text-foreground flex items-center gap-2">
                        <Activity className="h-4 w-4 text-primary" />
                        Individual Performance Trend Graphs per Regular Test Suite
                      </h3>
                      <p className="text-xs text-muted-foreground">Monitors separate accuracy and pass-rate progression curves for each benchmark task.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                    {/* Suite 1: CUAD */}
                    <Card className="border-border shadow-sm bg-card/30">
                      <CardHeader className="pb-2 border-b border-border/40">
                        <CardTitle className="text-xs font-extrabold flex items-center gap-1.5 text-primary">
                          📄 CUAD Legal Clauses (29 Tests)
                        </CardTitle>
                        <CardDescription className="text-[11px]">Extraction accuracy trend.</CardDescription>
                      </CardHeader>
                      <CardContent className="pt-3 h-[210px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={suiteChartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                            <XAxis dataKey="name" stroke="#888888" fontSize={9} tickLine={false} axisLine={false} />
                            <YAxis stroke="#888888" fontSize={9} tickLine={false} axisLine={false} domain={[40, 100]} />
                            <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11 }} />
                            <ReferenceLine y={90} stroke="#10b981" strokeDasharray="3 3" />
                            <Line type="monotone" dataKey="CUAD" name="CUAD Accuracy %" stroke="hsl(var(--primary))" strokeWidth={2.5} connectNulls dot={{ r: 3 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>

                    {/* Suite 2: ACORD */}
                    <Card className="border-border shadow-sm bg-card/30">
                      <CardHeader className="pb-2 border-b border-border/40">
                        <CardTitle className="text-xs font-extrabold flex items-center gap-1.5 text-indigo-500">
                          🔍 ACORD Retrieval (10 Tests)
                        </CardTitle>
                        <CardDescription className="text-[11px]">Precedent search precision.</CardDescription>
                      </CardHeader>
                      <CardContent className="pt-3 h-[210px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={suiteChartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                            <XAxis dataKey="name" stroke="#888888" fontSize={9} tickLine={false} axisLine={false} />
                            <YAxis stroke="#888888" fontSize={9} tickLine={false} axisLine={false} domain={[40, 100]} />
                            <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11 }} />
                            <ReferenceLine y={90} stroke="#10b981" strokeDasharray="3 3" />
                            <Line type="monotone" dataKey="ACORD" name="ACORD Accuracy %" stroke="#6366f1" strokeWidth={2.5} connectNulls dot={{ r: 3 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>

                    {/* Suite 3: KPI */}
                    <Card className="border-border shadow-sm bg-card/30">
                      <CardHeader className="pb-2 border-b border-border/40">
                        <CardTitle className="text-xs font-extrabold flex items-center gap-1.5 text-emerald-500">
                          📊 KPI Obligations (6 Tests)
                        </CardTitle>
                        <CardDescription className="text-[11px]">Financial calculation accuracy.</CardDescription>
                      </CardHeader>
                      <CardContent className="pt-3 h-[210px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={suiteChartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                            <XAxis dataKey="name" stroke="#888888" fontSize={9} tickLine={false} axisLine={false} />
                            <YAxis stroke="#888888" fontSize={9} tickLine={false} axisLine={false} domain={[40, 100]} />
                            <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11 }} />
                            <ReferenceLine y={90} stroke="#10b981" strokeDasharray="3 3" />
                            <Line type="monotone" dataKey="KPI" name="KPI Accuracy %" stroke="#10b981" strokeWidth={2.5} connectNulls dot={{ r: 3 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>

                    {/* Suite 4: Security */}
                    <Card className="border-border shadow-sm bg-card/30">
                      <CardHeader className="pb-2 border-b border-border/40">
                        <CardTitle className="text-xs font-extrabold flex items-center gap-1.5 text-rose-500">
                          🛡️ Security & Guardrails (16 Tests)
                        </CardTitle>
                        <CardDescription className="text-[11px]">Prompt injection pass rate.</CardDescription>
                      </CardHeader>
                      <CardContent className="pt-3 h-[210px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={suiteChartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                            <XAxis dataKey="name" stroke="#888888" fontSize={9} tickLine={false} axisLine={false} />
                            <YAxis stroke="#888888" fontSize={9} tickLine={false} axisLine={false} domain={[40, 100]} />
                            <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11 }} />
                            <ReferenceLine y={100} stroke="#f43f5e" strokeDasharray="3 3" />
                            <Line type="monotone" dataKey="Security" name="Security Pass %" stroke="#f43f5e" strokeWidth={2.5} connectNulls dot={{ r: 3 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}

              {/* Historical List Table */}
              <Card className="border-border">
                <CardHeader className="border-b border-border pb-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <CardTitle className="text-base font-bold">Historical Evaluation Runs</CardTitle>
                      <CardDescription>Browse internal benchmark runs and their functional prerequisite evidence.</CardDescription>
                    </div>
                    {config && (
                      <Badge variant="outline" className="flex items-center gap-1.5 py-1 px-2.5">
                        <Settings className="h-3 w-3" />
                        Target Baseline: {Math.round(config.overall_pass_threshold * 100)}%
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="w-[280px]">
                          <InfoTooltip content="The timestamp of when the benchmark suite ran, and its unique run ID.">
                            Execution Date & ID
                          </InfoTooltip>
                        </TableHead>
                        <TableHead>
                          <InfoTooltip content="The provider of the underlying AI model (e.g. OpenAI, Google Gemini, Anthropic, Groq) being tested.">
                            AI Model Provider
                          </InfoTooltip>
                        </TableHead>
                        <TableHead>
                          <InfoTooltip content="The benchmark task suite: CUAD (contract analysis), ACORD (clause search and matching), or KPI (data calculation).">
                            Evaluation Tasks
                          </InfoTooltip>
                        </TableHead>
                        <TableHead>
                          <InfoTooltip content="The total number of contract documents analyzed during the test run.">
                            Test Files Processed
                          </InfoTooltip>
                        </TableHead>
                        <TableHead>
                          <InfoTooltip content="The final average performance accuracy score achieved during the test run.">
                            Extraction Accuracy
                          </InfoTooltip>
                        </TableHead>
                        <TableHead>
                          <InfoTooltip content="The typical/median response time (p50) versus the worst-case tail latency (p95) per document.">
                            Processing Delay (Typical vs. Slowest)
                          </InfoTooltip>
                        </TableHead>
                        <TableHead>
                          <InfoTooltip content="The percentage of test cases that successfully abided by all safety guidelines and security policies.">
                            Safety Pass Rate
                          </InfoTooltip>
                        </TableHead>
                        <TableHead>
                          <InfoTooltip content="Indicates if the run was 'Live' (hitting active APIs and database) or 'Dry' (locally simulated mock run).">
                            Execution Environment
                          </InfoTooltip>
                        </TableHead>
                        <TableHead className="text-right pr-6">Inspect</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRuns.length > 0 ? (
                        filteredRuns.map((run) => (
                          <TableRow key={run.run_id} className="hover:bg-muted/15 transition-colors">
                            <TableCell className="font-semibold align-middle py-4">
                              <div className="flex flex-col">
                                <span className="text-sm font-bold text-foreground">{formatDateLabel(run.run_id)}</span>
                                <span className="text-xs text-muted-foreground font-mono mt-0.5">{run.internal_run_id || run.run_id}</span>
                              </div>
                            </TableCell>
                            <TableCell className="align-middle">
                              <Badge variant="secondary" className="capitalize text-xs font-semibold px-2 py-0.5 bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                {run.provider}
                              </Badge>
                            </TableCell>
                            <TableCell className="align-middle">
                              <span className="text-xs font-bold uppercase tracking-wider border border-border rounded px-1.5 py-0.5 bg-muted">
                                {run.dataset}
                              </span>
                            </TableCell>
                            <TableCell className="align-middle font-medium text-sm text-foreground/80">{run.contract_count}</TableCell>
                            <TableCell className="align-middle">
                              <span className={`text-sm font-extrabold ${run.overall_score >= (config?.overall_pass_threshold || 0.90) ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                                {Math.round(run.overall_score * 1000) / 10}%
                              </span>
                              <div className="text-[10px] text-muted-foreground mt-0.5">{run.passed_attempts} / {run.total_attempts} attempts</div>
                            </TableCell>
                            <TableCell className="align-middle text-xs font-mono font-medium text-foreground">
                              {run.latency_p50_ms ? `${(run.latency_p50_ms / 1000).toFixed(1)}s` : "-"} / {run.latency_p95_ms ? `${(run.latency_p95_ms / 1000).toFixed(1)}s` : "-"}
                            </TableCell>
                            <TableCell className="align-middle">
                              {run.hard_gate_passed ? (
                                <Badge className="bg-green-600 hover:bg-green-600 text-white flex items-center gap-1 w-fit text-[10px] font-semibold py-0.5 px-2">
                                  Passed
                                </Badge>
                              ) : (
                                <Badge variant="destructive" className="flex items-center gap-1 w-fit text-[10px] font-semibold py-0.5 px-2">
                                  Failed
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="align-middle">
                              <div className="flex flex-col gap-1">
                                <Badge variant="outline" className="text-[10px] font-bold py-0.5 px-2 border-border text-muted-foreground w-fit">
                                  {run.is_dry_run ? "Dry-run validation" : run.daily_internal_benchmark ? "Daily Internal Benchmark" : "Internal evaluation"}
                                </Badge>
                                <span className="text-[10px] text-muted-foreground font-medium">
                                  {run.dataset?.toLowerCase() === "acord" 
                                    ? "Functional + non-functional" 
                                    : run.dataset?.toLowerCase() === "kpi" 
                                    ? "Read-only KPI evaluation" 
                                    : "Functional + non-functional"}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right pr-6 align-middle">
                              <Link href={`/evaluations/${run.run_id}`} passHref>
                                <Button variant="ghost" size="sm" className="h-8 gap-1.5 hover:bg-primary/10 hover:text-primary transition-all">
                                  Details
                                  <ArrowRight className="h-3 w-3" />
                                </Button>
                              </Link>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={9} className="h-24 text-center text-sm text-muted-foreground">
                            No evaluations located in standard reports folder.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Local Manifest Test Cases tab */}
        <TabsContent value="cases" className="space-y-6 outline-none">
          <Card className="border-border">
            <CardHeader className="border-b border-border pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base font-bold">Local Test Cases Explorer</CardTitle>
                <CardDescription>Browse, search, and inspect client-side test manifests present in the local Git repository.</CardDescription>
              </div>
              
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-medium">Manifest:</span>
                  <Select value={localDataset} onValueChange={(val) => { setLocalDataset(val); setLocalPage(1); }}>
                    <SelectTrigger className="w-[140px] h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cuad">CUAD Manifest</SelectItem>
                      <SelectItem value="acord">ACORD Manifest</SelectItem>
                      <SelectItem value="kpi">KPI Manifest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="relative">
                  <Input
                    placeholder="Search local cases..."
                    value={localSearch}
                    onChange={(e) => { setLocalSearch(e.target.value); setLocalPage(1); }}
                    className="w-[200px] h-9 text-xs"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {localLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-xs animate-pulse">Parsing local manifest data...</p>
                </div>
              ) : localCases.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="w-[60px]"></TableHead>
                        <TableHead className="w-[160px]">Case ID</TableHead>
                        <TableHead className="w-[90px]">Layer</TableHead>
                        <TableHead className="w-[120px]">Task Type</TableHead>
                        <TableHead className="w-[240px]">Target Contract</TableHead>
                        <TableHead>Prompt</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {localCases.map((c) => {
                        const isExpanded = !!expandedCases[c.case_id];
                        return (
                          <>
                            <TableRow key={c.case_id} className="hover:bg-muted/10 cursor-pointer transition-colors" onClick={() => {
                              setExpandedCases(prev => ({ ...prev, [c.case_id]: !isExpanded }));
                            }}>
                              <TableCell className="text-center align-middle py-3">
                                <span className="text-[10px] text-muted-foreground select-none">
                                  {isExpanded ? "▼" : "▶"}
                                </span>
                              </TableCell>
                              <TableCell className="align-middle font-mono text-[10px] text-muted-foreground truncate max-w-[160px]">
                                {c.case_id.split(":").pop() || c.case_id}
                              </TableCell>
                              <TableCell className="align-middle">
                                <Badge variant="outline" className={`text-[9px] py-0.5 px-1.5 uppercase font-bold tracking-wider ${
                                  c.layer === "pac1" ? "border-amber-500/30 text-amber-500 bg-amber-500/5" :
                                  c.layer === "rag" ? "border-blue-500/30 text-blue-500 bg-blue-500/5" :
                                  "border-purple-500/30 text-purple-500 bg-purple-500/5"
                                }`}>
                                  {c.layer}
                                </Badge>
                              </TableCell>
                              <TableCell className="align-middle text-xs font-semibold text-foreground/80 capitalize">{c.task_type.replace("_", " ")}</TableCell>
                              <TableCell className="align-middle text-xs font-medium text-muted-foreground truncate max-w-[240px]" title={c.contract_title}>
                                {c.contract_title}
                              </TableCell>
                              <TableCell className="align-middle text-xs font-medium text-foreground truncate max-w-[300px]" title={c.prompt}>
                                {c.prompt}
                              </TableCell>
                            </TableRow>
                            {isExpanded && (
                              <TableRow className="bg-muted/10 hover:bg-muted/10">
                                <TableCell colSpan={6} className="p-4 select-text">
                                  <div className="space-y-4 text-xs">
                                    <div>
                                      <h4 className="font-bold text-foreground mb-1">User Question Prompt</h4>
                                      <p className="text-muted-foreground bg-background p-3 border border-border rounded-md italic font-mono text-[11px] leading-relaxed">
                                        "{c.prompt}"
                                      </p>
                                    </div>
                                    
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                      {c.expected_tools?.length > 0 && (
                                        <div>
                                          <h4 className="font-bold text-foreground mb-1">Required Agent Tools</h4>
                                          <div className="flex flex-wrap gap-1.5 mt-1">
                                            {c.expected_tools.map((t: string) => (
                                              <Badge key={t} variant="secondary" className="font-mono text-[10px]">{t}</Badge>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      {c.forbidden_tools?.length > 0 && (
                                        <div>
                                          <h4 className="font-bold text-foreground mb-1">Forbidden Agent Tools</h4>
                                          <div className="flex flex-wrap gap-1.5 mt-1">
                                            {c.forbidden_tools.map((t: string) => (
                                              <Badge key={t} variant="destructive" className="font-mono text-[10px] bg-red-500/10 text-red-500 hover:bg-red-500/10 border-red-500/20">{t}</Badge>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                    
                                    {c.gold_labels?.length > 0 && (
                                      <div>
                                        <h4 className="font-bold text-foreground mb-1">Expected Gold Answers & Annotation Spans</h4>
                                        <div className="space-y-2 mt-1.5 bg-background border border-border rounded-md p-3">
                                          {c.gold_labels.map((gl: any, idx: number) => (
                                            <div key={idx} className="pb-2 border-b border-border/40 last:border-b-0 last:pb-0">
                                              <div className="flex items-center justify-between">
                                                <span className="font-semibold text-foreground">{gl.clause_type}</span>
                                                <Badge className={gl.present ? "bg-green-600/10 text-green-600 border-green-600/20" : "bg-red-600/10 text-red-600 border-red-600/20"} variant="outline">
                                                  {gl.present ? "Present" : "Absent"}
                                                </Badge>
                                              </div>
                                              <p className="text-[10px] text-muted-foreground mt-0.5">Question: {gl.question}</p>
                                              {gl.spans?.length > 0 && (
                                                <div className="mt-1 space-y-1 pl-3 border-l-2 border-primary/30">
                                                  {gl.spans.map((sp: any, sIdx: number) => (
                                                    <p key={sIdx} className="text-[11px] text-foreground italic font-mono bg-muted/30 p-1.5 rounded">
                                                      "{sp.text}"
                                                    </p>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  No cases found in this manifest file.
                </div>
              )}
            </CardContent>
            {localTotal > 25 && (
              <div className="flex items-center justify-between border-t border-border px-6 py-4">
                <p className="text-xs text-muted-foreground">
                  Showing <span className="font-semibold">{Math.min(localTotal, (localPage - 1) * 25 + 1)}</span> to{" "}
                  <span className="font-semibold">{Math.min(localTotal, localPage * 25)}</span> of{" "}
                  <span className="font-semibold">{localTotal}</span> local cases
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={localPage === 1}
                    onClick={() => setLocalPage(prev => prev - 1)}
                    className="h-8 text-xs"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={localPage * 25 >= localTotal}
                    onClick={() => setLocalPage(prev => prev + 1)}
                    className="h-8 text-xs"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Run Evaluation Dialog Modal */}
      <Dialog open={runModalOpen} onOpenChange={setRunModalOpen}>
        <DialogContent className="sm:max-w-[500px] border border-border bg-card shadow-2xl overflow-hidden backdrop-blur-md select-none">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Play className="h-5 w-5 text-primary fill-current" />
              Configure Evaluation Suite
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Configure an internal, read-only benchmark run. Live non-functional results are the benchmark evidence.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="modal-provider" className="text-xs font-semibold text-muted-foreground">
                  <InfoTooltip content="Select which AI model provider (e.g. Google Gemini, OpenAI GPT) to test the agent on.">
                    AI Foundation Model
                  </InfoTooltip>
                </Label>
                <Select 
                  value={runParams.provider} 
                  onValueChange={(val) => setRunParams(prev => ({ ...prev, provider: val }))}
                >
                  <SelectTrigger id="modal-provider" className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="groq">Groq</SelectItem>
                    <SelectItem value="gemini">Gemini (Google 2.0 Flash)</SelectItem>
                    <SelectItem value="openai">OpenAI (GPT-4o)</SelectItem>
                    <SelectItem value="claude">Claude (Anthropic 3.5 Sonnet)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="modal-dataset" className="text-xs font-semibold text-muted-foreground">
                  <InfoTooltip content="Choose the type of test case suite: Legal clauses matching, key metrics extraction, or overall calculations.">
                    Dataset selection
                  </InfoTooltip>
                </Label>
                <Select 
                  value={runParams.dataset} 
                  onValueChange={(val) => setRunParams(prev => ({ ...prev, dataset: val }))}
                >
                  <SelectTrigger id="modal-dataset" className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cuad">CUAD (10 documents)</SelectItem>
                    <SelectItem value="acord">ACORD (10 documents)</SelectItem>
                    <SelectItem value="kpi">KPI (5 documents)</SelectItem>
                    <SelectItem value="all">Daily group: CUAD → ACORD → KPI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="modal-contract-count" className="text-xs font-semibold text-muted-foreground">
                  <InfoTooltip content="Drag to choose how many contracts will be evaluated in this test run (larger samples give more precise scores but cost more).">
                    Document Sample Size
                  </InfoTooltip>
                </Label>
                <span className="text-xs font-mono font-bold text-primary">{runParams.contract_count} contracts</span>
              </div>
              <input
                id="modal-contract-count"
                type="range"
                min="1"
                max="100"
                value={runParams.contract_count}
                onChange={(e) => setRunParams(prev => ({ ...prev, contract_count: parseInt(e.target.value) }))}
                className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>

            {/* Live Dataset & Category Breakdown Card */}
            <div className="bg-muted/30 border border-border/80 rounded-lg p-3 space-y-2">
              <span className="text-[11px] font-extrabold text-foreground uppercase tracking-wider block flex justify-between items-center">
                <span>Dataset Scope Breakdown</span>
                <span className="font-mono text-primary font-bold text-xs">
                  {runParams.dataset === 'all' ? `${runParams.contract_count * 3} files total` : `${runParams.contract_count} files`}
                </span>
              </span>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className={`p-2 rounded border transition-colors ${runParams.dataset === 'cuad' || runParams.dataset === 'all' ? 'border-primary/50 bg-primary/10' : 'border-border/60 opacity-40'}`}>
                  <div className="font-bold flex items-center justify-between">
                    <span>CUAD</span>
                    <Badge variant="secondary" className="text-[9px] px-1 py-0 font-mono">{runParams.contract_count} files</Badge>
                  </div>
                  <span className="text-[10px] text-muted-foreground block mt-0.5">29 Func + 16 Non-Func</span>
                </div>
                <div className={`p-2 rounded border transition-colors ${runParams.dataset === 'acord' || runParams.dataset === 'all' ? 'border-primary/50 bg-primary/10' : 'border-border/60 opacity-40'}`}>
                  <div className="font-bold flex items-center justify-between">
                    <span>ACORD</span>
                    <Badge variant="secondary" className="text-[9px] px-1 py-0 font-mono">{runParams.contract_count} files</Badge>
                  </div>
                  <span className="text-[10px] text-muted-foreground block mt-0.5">10 Func + 6 Security</span>
                </div>
                <div className={`p-2 rounded border transition-colors ${runParams.dataset === 'kpi' || runParams.dataset === 'all' ? 'border-primary/50 bg-primary/10' : 'border-border/60 opacity-40'}`}>
                  <div className="font-bold flex items-center justify-between">
                    <span>KPI</span>
                    <Badge variant="secondary" className="text-[9px] px-1 py-0 font-mono">{runParams.contract_count} files</Badge>
                  </div>
                  <span className="text-[10px] text-muted-foreground block mt-0.5">6 Financial & KPI</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="modal-repeat-default" className="text-xs font-semibold text-muted-foreground">
                  <InfoTooltip content="Number of times to run each query case. Higher repeats measure output consistency and stability.">
                    Default Runs per Case
                  </InfoTooltip>
                </Label>
                <Input
                   id="modal-repeat-default"
                   type="number"
                   placeholder="e.g. 3"
                   value={runParams.repeat_default}
                   onChange={(e) => setRunParams(prev => ({ ...prev, repeat_default: e.target.value }))}
                   className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="modal-repeat-security" className="text-xs font-semibold text-muted-foreground">
                  <InfoTooltip content="Number of runs for safety/security queries to test the model's resilience against adversarial input.">
                    Security Checks per Case
                  </InfoTooltip>
                </Label>
                <Input
                  id="modal-repeat-security"
                  type="number"
                  placeholder="e.g. 5"
                  value={runParams.repeat_security}
                  onChange={(e) => setRunParams(prev => ({ ...prev, repeat_security: e.target.value }))}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="modal-model-name" className="text-xs font-semibold text-muted-foreground">
                  <InfoTooltip content="Enter a specific model version string (e.g. gpt-4o-2024-05-13) if you want to override the default foundation model.">
                    Custom Model Identifier (Optional)
                  </InfoTooltip>
                </Label>
                <Input
                  id="modal-model-name"
                  type="text"
                  placeholder="e.g. custom-llama-3"
                  value={runParams.model_name}
                  onChange={(e) => setRunParams(prev => ({ ...prev, model_name: e.target.value }))}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="modal-max-cases" className="text-xs font-semibold text-muted-foreground">
                  <InfoTooltip content="Limits the maximum number of documents evaluated per test category to speed up testing.">
                    Max Documents per Test Layer
                  </InfoTooltip>
                </Label>
                <Input
                  id="modal-max-cases"
                  type="number"
                  placeholder="e.g. 10"
                  value={runParams.max_cases_per_layer}
                  onChange={(e) => setRunParams(prev => ({ ...prev, max_cases_per_layer: e.target.value }))}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="modal-smoke" className="text-xs font-semibold text-muted-foreground">
                  <InfoTooltip content="A case selection profile, not an evaluation family. It never turns a dry run into benchmark evidence.">
                  Case selection profile
                </InfoTooltip>
              </Label>
              <Select 
                value={runParams.smoke_profile} 
                onValueChange={(val) => setRunParams(prev => ({ ...prev, smoke_profile: val }))}
              >
                <SelectTrigger id="modal-smoke" className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Full case selection</SelectItem>
                  <SelectItem value="balanced">Balanced smoke selection</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Checkbox fields */}
            <div className="space-y-3 pt-3 border-t border-border">
              <div className="flex items-start space-x-2.5">
                <Checkbox
                  id="modal-dry"
                  checked={runParams.dry_run}
                  onCheckedChange={(checked) => setRunParams(prev => ({ ...prev, dry_run: !!checked }))}
                  className="mt-0.5"
                />
                <div className="grid gap-1 leading-none">
                  <Label htmlFor="modal-dry" className="text-xs font-semibold text-foreground">
                    <InfoTooltip content="Scores queries locally using pre-cached answers to test the metrics pipelines without incurring model costs.">
                      Simulate Run (Free & Fast)
                    </InfoTooltip>
                  </Label>
                  <p className="text-[10px] text-muted-foreground">Score agent queries instantly using pre-cached mocks without cost.</p>
                </div>
              </div>

              <div className="flex items-start space-x-2.5">
                <Checkbox
                  id="modal-citation"
                  checked={runParams.skip_citation_gate}
                  onCheckedChange={(checked) => setRunParams(prev => ({ ...prev, skip_citation_gate: !!checked }))}
                  className="mt-0.5"
                />
                <div className="grid gap-1 leading-none">
                  <Label htmlFor="modal-citation" className="text-xs font-semibold text-foreground">
                    <InfoTooltip content="Allows the test to pass even if the agent fails to cite exact contract page/paragraph numbers.">
                      Ignore Citation Requirements
                    </InfoTooltip>
                  </Label>
                  <p className="text-[10px] text-muted-foreground">Disables strict citations pass/fail check. Answer scores remain unaffected.</p>
                </div>
              </div>

              <div className="flex items-start space-x-2.5">
                <Checkbox
                  id="modal-keep"
                  checked={runParams.keep_fixtures}
                  onCheckedChange={(checked) => setRunParams(prev => ({ ...prev, keep_fixtures: !!checked }))}
                  className="mt-0.5"
                />
                <div className="grid gap-1 leading-none">
                  <Label htmlFor="modal-keep" className="text-xs font-semibold text-foreground">
                    <InfoTooltip content="Keeps temporary database records and projects alive after the run is complete for debugging purposes.">
                      Save Temporary Test Data
                    </InfoTooltip>
                  </Label>
                  <p className="text-[10px] text-muted-foreground">Retain the temporary agent projects in the workspace database for debugging.</p>
                </div>
              </div>


              <div className="flex items-start space-x-2.5">
                <Checkbox
                  id="modal-no-checkpoint"
                  checked={runParams.no_checkpoint}
                  onCheckedChange={(checked) => setRunParams(prev => ({ ...prev, no_checkpoint: !!checked }))}
                  className="mt-0.5"
                />
                <div className="grid gap-1 leading-none">
                  <Label htmlFor="modal-no-checkpoint" className="text-xs font-semibold text-foreground">
                    <InfoTooltip content="Forces the runner to execute every step from scratch without caching any intermediate states.">
                      Disable Intermediate Caching
                    </InfoTooltip>
                  </Label>
                  <p className="text-[10px] text-muted-foreground">Do not write attempt-level raw inputs/responses to raw_responses.jsonl.</p>
                </div>
              </div>

              <div className="flex items-start space-x-2.5">
                <Checkbox
                  id="modal-allow-short"
                  checked={runParams.allow_short_token}
                  onCheckedChange={(checked) => setRunParams(prev => ({ ...prev, allow_short_token: !!checked }))}
                  className="mt-0.5"
                />
                <div className="grid gap-1 leading-none">
                  <Label htmlFor="modal-allow-short" className="text-xs font-semibold text-foreground">
                    <InfoTooltip content="Bypasses strict security checks for short-lived credentials to allow faster development tests.">
                      Ignore Authentication Lifetime Warnings
                    </InfoTooltip>
                  </Label>
                  <p className="text-[10px] text-muted-foreground">Only warn instead of crashing when token lifetime is below standard limits.</p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="border-t border-border pt-4">
            <Button variant="outline" size="sm" onClick={() => setRunModalOpen(false)} className="text-xs">
              Cancel
            </Button>
            <Button 
              onClick={handleTriggerRun} 
              disabled={triggering}
              size="sm"
              className="text-xs gap-1.5"
            >
              {triggering ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 text-white fill-current" />
                  Execute Run
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
