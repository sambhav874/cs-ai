"use client";

import { use, useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { 
  ChevronLeft, 
  Loader2, 
  ShieldCheck, 
  ShieldAlert, 
  Zap, 
  BookOpen, 
  ClipboardList, 
  Bug, 
  Wrench, 
  CheckCircle2, 
  XCircle,
  HelpCircle,
  FileText,
  Clock,
  Coins,
  Search,
  ChevronRight,
  Database,
  ExternalLink,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useBreadcrumbs } from "@/app/context/BreadcrumbContext";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { 
  PieChart, 
  Pie, 
  Cell, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as ChartTooltip, 
  Legend, 
  ResponsiveContainer 
} from "recharts";
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

const PARAMETER_TRANSLATIONS: Record<string, { label: string; tooltip: string; description: string }> = {
  "overall_score": {
    label: "Overall Accuracy",
    tooltip: "The final average performance accuracy score across all executed queries.",
    description: "Average percentage of correct answers, extractions, and pipeline calculations."
  },
  "pass_k": {
    label: "Core Task Success",
    tooltip: "The probability that the agent produces a correct response within a given number of attempts.",
    description: "Percentage of queries where at least one model attempt returned a fully correct result."
  },
  "hard_gate_passed": {
    label: "Safety & Boundaries Pass Rate",
    tooltip: "The percentage of test cases that fully respected safety guidelines, tool access restrictions, and contract immutability.",
    description: "Validation success rate for strict system boundary enforcement."
  },
  "api_error_rate": {
    label: "API Error Frequency",
    tooltip: "The frequency of external request failures, connection timeouts, or service exceptions.",
    description: "Ratio of failed API transactions to total attempted operations."
  },
  "timeout_rate": {
    label: "Operation Timeout Rate",
    tooltip: "Percentage of test runs that exceeded the maximum allowed execution time limits.",
    description: "Frequency of queries that failed to respond within the designated timeout window."
  },
  "latency_p50_ms": {
    label: "Typical Response Time (p50)",
    tooltip: "The median processing time per query. 50% of requests were completed faster than this time.",
    description: "Average/typical delay in milliseconds for the agent to return a response."
  },
  "latency_p95_ms": {
    label: "Tail Response Time (p95)",
    tooltip: "The 95th percentile response speed. Only 5% of operations took longer than this duration.",
    description: "Delay ceiling in milliseconds for the slowest 5% of executed cases."
  },
  "latency_max_ms": {
    label: "Worst-Case Delay (Max)",
    tooltip: "The absolute maximum response time recorded for any single case during the run.",
    description: "Maximum transaction duration in milliseconds observed in this benchmark."
  },
  "citation_precision": {
    label: "Citation Precision Rate",
    tooltip: "The accuracy of extracted source citations. Measures the proportion of cited pages/paragraphs that were actually correct.",
    description: "Percentage of generated document references that accurately match the source text."
  },
  "gold_span_recall": {
    label: "Source Text Recall (Span)",
    tooltip: "The percentage of correct source lines or query target spans successfully identified by the agent.",
    description: "Proportion of target text segments accurately extracted from the contracts."
  },
  "kpi_field_f1": {
    label: "Metric Field Accuracy (F1)",
    tooltip: "The F1-score for extracted KPI key-value data fields. Harmonizes precision and recall.",
    description: "Accuracy score reflecting successful retrieval of structured contract metrics."
  },
  "table_cell_accuracy": {
    label: "Table Cell Accuracy",
    tooltip: "The cell-level correctness rate for parsed multi-dimensional data tables in documents.",
    description: "Percentage of accurately populated rows and cells in structured financial tables."
  },
  "forbidden_tool_block_rate": {
    label: "Forbidden Tools Blocking Success",
    tooltip: "The rate at which the agent successfully refused to execute unsafe or forbidden actions.",
    description: "Proportion of restricted tool requests correctly blocked by the safety layer."
  },
  "source_contract_immutability": {
    label: "Document Immutability Success",
    tooltip: "Guarantees that the agent never attempted to overwrite or mutate source files.",
    description: "Failure-free rate of protecting source contracts from modification attempts."
  },
  "negative_case_hallucination_rate_max": {
    label: "Max Hallucination Rate (Negative)",
    tooltip: "The rate of hallucinated answers generated for queries where the source text contains no relevant details.",
    description: "Proportion of out-of-scope queries where the agent fabricated false details."
  },
  "citation_required_claim_rate": {
    label: "Citation Requirement Compliance",
    tooltip: "The percentage of claims and extractions that properly included required page/paragraph citations.",
    description: "Proportion of statements backed by verifiable page references."
  },
  "boundary_enforcement_rate": {
    label: "Security Boundary Compliance",
    tooltip: "The rate at which the model adhered to project file boundaries and scope restrictions.",
    description: "Frequency of successfully blocking cross-project file access attempts."
  },
  "approval_gate_correctness": {
    label: "Approval Gate Action Verification",
    tooltip: "Verify that write tools were only executed after a formal approval request payload was generated.",
    description: "Adherence rate of agent tools to user-in-the-loop validation flow."
  },
  "prompt_injection_resistance": {
    label: "Adversarial Injection Resistance",
    tooltip: "The agent's success rate in ignoring adversarial prompts or instruction overrides.",
    description: "Resistance rate to prompt injections and hijack queries."
  },
  "clause_presence_accuracy": {
    label: "Clause Presence Detection Accuracy",
    tooltip: "The accuracy of detecting the presence or absence of target contract terms and clauses.",
    description: "Accuracy of identifying search terms within the clause repository."
  }
};

interface PageProps {
  params: Promise<{ run_id: string }>;
}

export default function EvaluationRunDetailPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const run_id = resolvedParams.run_id;

  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL ?? "";
  const { isAuthenticated, authenticatedFetch } = useAuth();
  const { setBreadcrumbs } = useBreadcrumbs();

  const [runData, setRunData] = useState<any>(null);
  const [toolCoverage, setToolCoverage] = useState<any[]>([]);
  const [failureTaxonomy, setFailureTaxonomy] = useState<any[]>([]);
  const [parameterScorecard, setParameterScorecard] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Pagination for case results
  const [layerFilter, setLayerFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const limit = 20;

  // Selected test case for inspect drawer
  const [selectedCase, setSelectedCase] = useState<any>(null);
  const [isPromptExpanded, setIsPromptExpanded] = useState(false);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Evaluations", href: "/evaluations" },
      { label: run_id }
    ]);
  }, [setBreadcrumbs, run_id]);

  // Debounce search query to prevent excessive backend fetches
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1); // reset to page 1 on search
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [layerFilter, statusFilter]);

  // Fetch paginated cases and metadata
  const fetchRunDetails = useCallback(async () => {
    if (!isAuthenticated || !apiUrl) return;
    try {
      let queryUrl = `${apiUrl}/evaluations/${run_id}?page=${page}&limit=${limit}`;
      if (layerFilter !== "all") queryUrl += `&layer=${layerFilter}`;
      if (statusFilter !== "all") queryUrl += `&status=${statusFilter}`;
      if (debouncedSearch) queryUrl += `&search=${encodeURIComponent(debouncedSearch)}`;

      const res = await authenticatedFetch(queryUrl);
      if (res.error) throw new Error(res.error);
      setRunData(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to fetch evaluation details.");
    }
  }, [isAuthenticated, apiUrl, run_id, page, layerFilter, statusFilter, debouncedSearch, authenticatedFetch]);

  // Load static run details and auxiliary data once
  useEffect(() => {
    async function fetchAuxiliaryData() {
      if (!isAuthenticated || !apiUrl) return;
      try {
        setLoading(true);
        const [toolRes, failRes, scoreRes] = await Promise.all([
          authenticatedFetch(`${apiUrl}/evaluations/${run_id}/csv/tool_coverage`),
          authenticatedFetch(`${apiUrl}/evaluations/${run_id}/csv/failure_taxonomy`),
          authenticatedFetch(`${apiUrl}/evaluations/${run_id}/csv/parameter_scorecard`)
        ]);

        setToolCoverage(toolRes.data || []);
        setFailureTaxonomy(failRes.data || []);
        setParameterScorecard(scoreRes.data || []);
      } catch (err) {
        console.warn("Failed to load auxiliary telemetry data:", err);
      } finally {
        setLoading(false);
      }
    }

    if (isAuthenticated) {
      fetchAuxiliaryData();
    }
  }, [isAuthenticated, apiUrl, run_id, authenticatedFetch]);

  // Trigger paginated cases fetch when page or filters update
  useEffect(() => {
    if (isAuthenticated) {
      fetchRunDetails();
    }
  }, [isAuthenticated, fetchRunDetails]);

  // Render variables
  const summary = runData?.summary || {};
  const methodology = runData?.methodology || {};
  const pagination = runData?.results_summary || { page: 1, total_pages: 1, total_filtered: 0 };
  const cases = runData?.results || [];

  const thresholdConfig = methodology?.thresholds || {};

  // Formatted date string
  const formattedDate = useMemo(() => {
    const datePattern = /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/;
    const match = run_id.match(datePattern);
    if (match) {
      const [_, year, month, day, hour, min] = match;
      return `${day} ${new Date(0, parseInt(month) - 1).toLocaleString("default", { month: "short" })} ${year} at ${hour}:${min}`;
    }
    return run_id;
  }, [run_id]);

  // Failure modes charting data
  const failureChartData = useMemo(() => {
    if (!failureTaxonomy.length) return [];
    
    // Check if the CSV columns exist (usually failure_mode, count)
    // If not, map whatever columns are returned
    return failureTaxonomy
      .map((row: any) => ({
        name: row.failure_mode || row.FailureMode || row.category || "Unclassified",
        value: parseInt(row.count || row.Count || row.occurrences || "0")
      }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [failureTaxonomy]);

  const COLORS = ["#ff4d00", "#f59e0b", "#0078d4", "#a855f7", "#ec4899", "#10b981", "#6b7280"];

  const toolGroups = useMemo(() => {
    const groups: Record<string, any[]> = { read_only: [], approval_required: [], forbidden: [] };
    toolCoverage.forEach(tool => {
      const group = tool.group || "read_only";
      if (groups[group]) {
        groups[group].push(tool);
      } else {
        groups.read_only.push(tool);
      }
    });
    return groups;
  }, [toolCoverage]);

  if (loading && !runData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground animate-pulse">Parsing telemetry files...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 max-w-2xl mx-auto mt-12 border border-destructive/20 rounded-xl bg-destructive/5 text-center">
        <h3 className="text-lg font-semibold text-destructive mb-2">Error Accessing Run</h3>
        <p className="text-sm text-muted-foreground mb-6">{error}</p>
        <Link href="/evaluations" passHref>
          <Button>Back to Evaluations List</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-8 max-w-7xl relative">
      {/* Back navigation & Run header */}
      <div className="flex flex-col gap-2 border-b border-border pb-6">
        <Link href="/evaluations" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors w-fit">
          <ChevronLeft className="h-4 w-4" />
          Back to Evaluations Hub
        </Link>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mt-2">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
              Run: <span className="font-mono text-xl text-primary">{methodology?.provider?.toUpperCase()} - {formattedDate}</span>
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">
              Folder: {run_id} | Internal Run ID: {runData?.internal_run_id}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {summary?.hard_gate_passed ? (
              <Badge className="bg-green-600 hover:bg-green-600 text-white flex items-center gap-1.5 py-1 px-3">
                <ShieldCheck className="h-4 w-4" />
                Hard Gates Passed
              </Badge>
            ) : (
              <Badge variant="destructive" className="flex items-center gap-1.5 py-1 px-3">
                <ShieldAlert className="h-4 w-4" />
                Gates Failed
              </Badge>
            )}
            
            {summary?.pitch_ready ? (
              <Badge className="bg-primary/20 text-primary border border-primary/30 flex items-center gap-1.5 py-1 px-3">
                <CheckCircle2 className="h-4 w-4" />
                Pitch Safe Ready
              </Badge>
            ) : (
              <Badge variant="outline" className="border-border text-muted-foreground flex items-center gap-1.5 py-1 px-3">
                <XCircle className="h-4 w-4" />
                Not Pitch Ready
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Overview stats metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border shadow-sm bg-card/25">
          <CardContent className="p-4 flex flex-col justify-between h-24">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Overall Score</span>
            <div className="flex items-baseline gap-1.5">
              <h2 className="text-2xl font-black text-foreground">{Math.round((summary?.overall_score || 0) * 1000) / 10}%</h2>
              {summary?.overall_score_ci95 && (
                <span className="text-[10px] text-muted-foreground">
                  CI ({Math.round(summary.overall_score_ci95[0] * 100)}% - {Math.round(summary.overall_score_ci95[1] * 100)}%)
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm bg-card/25">
          <CardContent className="p-4 flex flex-col justify-between h-24">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Attempt Success</span>
            <div className="flex items-baseline gap-1.5">
              <h2 className="text-2xl font-black text-foreground">{summary?.passed_attempts} / {summary?.attempts}</h2>
              <span className="text-[10px] text-muted-foreground">attempts passed</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm bg-card/25">
          <CardContent className="p-4 flex flex-col justify-between h-24">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tail Latency (p95)</span>
            <div className="flex items-baseline gap-1.5">
              <h2 className="text-2xl font-black text-foreground">{summary?.latency?.p95_ms || "-"}ms</h2>
              <span className="text-[10px] text-muted-foreground">Median: {summary?.latency?.p50_ms || "-"}ms</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm bg-card/25">
          <CardContent className="p-4 flex flex-col justify-between h-24">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contract Count</span>
            <div className="flex items-baseline gap-1.5">
              <h2 className="text-2xl font-black text-foreground">{runData?.contract_count}</h2>
              <span className="text-[10px] text-muted-foreground">cases total: {summary?.cases}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs list layout */}
      <Tabs defaultValue="breakdown" className="w-full space-y-6">
        <TabsList className="border border-border bg-muted/30 p-1 w-full md:w-auto overflow-x-auto h-auto flex gap-1">
          <TabsTrigger value="breakdown" className="py-2 px-4 text-xs font-bold">Performance Breakdown</TabsTrigger>
          <TabsTrigger value="coverage" className="py-2 px-4 text-xs font-bold">Tool Coverage</TabsTrigger>
          <TabsTrigger value="failures" className="py-2 px-4 text-xs font-bold">Failure Modes</TabsTrigger>
          <TabsTrigger value="cases" className="py-2 px-4 text-xs font-bold">Test Case Logs</TabsTrigger>
          <TabsTrigger value="config" className="py-2 px-4 text-xs font-bold">Run Metadata</TabsTrigger>
        </TabsList>

        {/* 1. Performance Breakdown Content */}
        <TabsContent value="breakdown" className="space-y-6 outline-none">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Layer-wise sub cards */}
            {["pac1", "rag", "tools"].map(layer => {
              const layerData = summary?.by_layer?.[layer] || {};
              const title = layer === "pac1" ? "PAC1 Layer" : layer === "rag" ? "RAG Layer" : "Tools Layer";
              const desc = layer === "pac1" 
                ? "Security, prompt injection, and guardrails" 
                : layer === "rag" 
                ? "Clause extraction precision & citation grounding" 
                : "Tool usage validation & calculations";

              const passThreshold = thresholdConfig[layer]?.score || 0.90;
              const hasPassed = layerData.score >= passThreshold;

              return (
                <Card key={layer} className="border-border shadow-sm">
                  <CardHeader className="pb-3 border-b border-border bg-muted/15">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-extrabold uppercase tracking-wider">{title}</CardTitle>
                      {hasPassed ? (
                        <Badge className="bg-green-600 hover:bg-green-600 text-[10px] py-0.5">Passed</Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[10px] py-0.5">Failed</Badge>
                      )}
                    </div>
                    <CardDescription className="text-xs mt-1">{desc}</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-5 space-y-4">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs text-muted-foreground font-semibold">Layer Score:</span>
                      <span className="text-base font-extrabold text-foreground">
                        {layerData.score ? `${Math.round(layerData.score * 1000) / 10}%` : "0%"}
                      </span>
                    </div>
                    <Progress value={(layerData.score || 0) * 100} className={`h-1.5 ${hasPassed ? "bg-muted" : "bg-destructive/10"}`} />
                    
                    <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-border/60">
                      <div>
                        <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider">Pass Ratio</span>
                        <span className="font-bold text-foreground">{layerData.cases} cases</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider">Attempts</span>
                        <span className="font-bold text-foreground">{layerData.attempts} runs</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Metric details scorecard table */}
          <Card className="border-border shadow-sm">
            <CardHeader className="border-b border-border">
              <CardTitle className="text-base font-bold">Custom Telemetry Scorecard</CardTitle>
              <CardDescription>Granular parameters parsed from evaluation script scorecard.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>Metric Parameter</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Actual Value</TableHead>
                    <TableHead>Target Gate</TableHead>
                    <TableHead className="text-right pr-6">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parameterScorecard.length > 0 ? (
                    parameterScorecard.map((row: any, idx: number) => {
                      const actual = parseFloat(row.actual || "0.0");
                      const threshold = parseFloat(row.threshold || "0.0");
                      const passed = row.passed?.toLowerCase() === "true" || row.status?.toLowerCase() === "passed" || actual >= threshold;
                      
                      const paramKey = row.parameter || row.metric;
                      const translation = PARAMETER_TRANSLATIONS[paramKey] || {
                        label: paramKey,
                        tooltip: "Scoring parameter verification metric.",
                        description: row.description || "Layer scoring component verification"
                      };

                      return (
                        <TableRow key={idx} className="hover:bg-muted/10 transition-colors">
                          <TableCell className="font-bold text-sm text-foreground">
                            <InfoTooltip content={translation.tooltip}>
                              {translation.label}
                            </InfoTooltip>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{translation.description}</TableCell>
                          <TableCell className="font-mono text-sm font-bold text-foreground">{row.actual || row.value}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{row.threshold || row.target || "-"}</TableCell>
                          <TableCell className="text-right pr-6">
                            {passed ? (
                              <Badge className="bg-green-600 hover:bg-green-600 text-[10px]">Pass</Badge>
                            ) : (
                              <Badge variant="destructive" className="text-[10px]">Fail</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center h-20 text-sm text-muted-foreground">
                        Detailed parameter metrics scorecard not available for this run.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 2. Tool Coverage Tab Content */}
        <TabsContent value="coverage" className="space-y-6 outline-none">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {["read_only", "approval_required", "forbidden"].map(group => {
              const tools = toolGroups[group] || [];
              const title = group === "read_only" 
                ? "Read-Only Core Tools" 
                : group === "approval_required" 
                ? "Approval-Required Tools" 
                : "Forbidden Network Tools";
              const desc = group === "read_only" 
                ? "Information gathering and context retrievers" 
                : group === "approval_required" 
                ? "Write actions requiring user signature/validation" 
                : "Actions blocked for data safety and immutability";

              return (
                <Card key={group} className="border-border shadow-sm">
                  <CardHeader className="pb-3 border-b border-border bg-muted/15">
                    <CardTitle className="text-sm font-extrabold uppercase tracking-wider flex items-center gap-2">
                      <Wrench className="h-4 w-4 text-primary" />
                      {title}
                    </CardTitle>
                    <CardDescription className="text-xs mt-1">{desc}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y divide-border">
                      {tools.length > 0 ? (
                        tools.map((t: any, idx: number) => {
                          const isCovered = t.covered?.toLowerCase() === "true" || t.covered === true;
                          const wasObserved = t.observed_in_run?.toLowerCase() === "true" || t.observed_in_run === true || t.observed_executed?.toLowerCase() === "true" || t.observed_executed === true;
                          const expected = t.expected_by_suite?.toLowerCase() === "true" || t.expected_by_suite === true;

                          return (
                            <div key={idx} className="p-4 space-y-2 hover:bg-muted/10 transition-colors">
                              <div className="flex items-center justify-between">
                                <span className="font-mono text-xs font-bold text-foreground">{t.tool}</span>
                                {isCovered ? (
                                  <Badge className="bg-green-600 hover:bg-green-600 text-[9px] py-0 px-1.5">Covered</Badge>
                                ) : expected ? (
                                  <Badge variant="destructive" className="text-[9px] py-0 px-1.5">Uncovered</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[9px] py-0 px-1.5 text-muted-foreground border-border">Optional</Badge>
                                )}
                              </div>
                              
                              <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                                <div className="flex items-center gap-1 border border-border/40 rounded px-1 py-0.5 bg-muted/15">
                                  <span className={`h-1.5 w-1.5 rounded-full ${expected ? "bg-blue-500" : "bg-muted"}`} />
                                  Expected: {expected ? "Yes" : "No"}
                                </div>
                                <div className="flex items-center gap-1 border border-border/40 rounded px-1 py-0.5 bg-muted/15">
                                  <span className={`h-1.5 w-1.5 rounded-full ${wasObserved ? "bg-green-500" : "bg-muted"}`} />
                                  Observed: {wasObserved ? "Yes" : "No"}
                                </div>
                                {t.observed_executed && (
                                  <div className="flex items-center gap-1 border border-border/40 rounded px-1 py-0.5 bg-muted/15">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                    Executed: True
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="p-6 text-center text-xs text-muted-foreground">No tools defined under this layer.</div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* 3. Failure Modes Tab Content */}
        <TabsContent value="failures" className="space-y-6 outline-none">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Chart */}
            <Card className="lg:col-span-5 border-border shadow-sm flex flex-col justify-between">
              <CardHeader>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Bug className="h-4 w-4 text-destructive" />
                  Taxonomy Distribution
                </CardTitle>
                <CardDescription>Breakdown of observed error categories.</CardDescription>
              </CardHeader>
              <CardContent className="h-[280px] flex items-center justify-center pt-0">
                {failureChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={failureChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {failureChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <ChartTooltip 
                        contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} 
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center text-sm text-muted-foreground">No failures observed in this evaluation run.</div>
                )}
              </CardContent>
            </Card>

            {/* List details */}
            <Card className="lg:col-span-7 border-border shadow-sm">
              <CardHeader className="border-b border-border">
                <CardTitle className="text-base font-bold">Observed Failure Modes Log</CardTitle>
                <CardDescription>Counted instances of failure categories from results parser.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="w-[40px]"></TableHead>
                      <TableHead>Failure Mode Category</TableHead>
                      <TableHead>Occurrences</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {failureChartData.length > 0 ? (
                      failureChartData.map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="py-3">
                            <span className="h-3 w-3 rounded-full block" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                          </TableCell>
                          <TableCell className="font-bold text-sm text-foreground">{item.name}</TableCell>
                          <TableCell className="font-semibold font-mono text-sm">{item.value}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {/* Fetch additional description if matched */}
                            {failureTaxonomy.find((r: any) => (r.failure_mode || r.FailureMode) === item.name)?.description || "Pipeline processing issue"}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center h-24 text-sm text-muted-foreground">
                          Zero failures logged. Excellent pipeline accuracy!
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* 4. Test Case Logs Content */}
        <TabsContent value="cases" className="space-y-6 outline-none">
          <Card className="border-border shadow-sm">
            <CardHeader className="border-b border-border pb-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-base font-bold">Case Execution Logs</CardTitle>
                  <CardDescription>Inspect details, traces, and metrics for each validation attempt.</CardDescription>
                </div>
                
                {/* Search & Filters */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search prompts/contracts..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 h-9 w-[200px]"
                    />
                  </div>

                  <Select value={layerFilter} onValueChange={(val) => { setLayerFilter(val); setPage(1); }}>
                    <SelectTrigger className="w-[110px] h-9">
                      <SelectValue placeholder="All Layers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Layers</SelectItem>
                      <SelectItem value="pac1">PAC1</SelectItem>
                      <SelectItem value="rag">RAG</SelectItem>
                      <SelectItem value="tools">Tools</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={statusFilter} onValueChange={(val) => { setStatusFilter(val); setPage(1); }}>
                    <SelectTrigger className="w-[110px] h-9">
                      <SelectValue placeholder="All Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="passed">Passed</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="w-[180px]">Case ID</TableHead>
                    <TableHead>Layer</TableHead>
                    <TableHead>Task Type</TableHead>
                    <TableHead>Contract Document</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Latency</TableHead>
                    <TableHead className="text-right pr-6">Inspect</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cases.length > 0 ? (
                    cases.map((item: any, idx: number) => {
                      const caseDetails = item.case || {};
                      const obs = item.observation || {};
                      const passed = item.passed;
                      
                      return (
                        <TableRow key={idx} className="hover:bg-muted/10 transition-colors">
                          <TableCell className="font-mono text-[10px] font-semibold text-muted-foreground">
                            {caseDetails.case_id?.substring(0, 24)}...
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px] uppercase font-bold">
                              {caseDetails.layer}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-foreground/80 font-medium">{caseDetails.task_type}</TableCell>
                          <TableCell className="text-sm font-semibold max-w-[200px] truncate" title={caseDetails.contract_title}>
                            {caseDetails.contract_title}
                          </TableCell>
                          <TableCell>
                            {passed ? (
                              <Badge className="bg-green-600 hover:bg-green-600 text-[10px] py-0 px-2 flex items-center gap-1 w-fit">
                                Passed
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="text-[10px] py-0 px-2 flex items-center gap-1 w-fit">
                                Failed
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-sm font-bold">
                            {Math.round((item.score || 0) * 100)}%
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{obs.latency_ms || "-"}ms</TableCell>
                          <TableCell className="text-right pr-6">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => { setSelectedCase(item); setIsPromptExpanded(false); }}
                              className="h-8 hover:bg-primary/10 hover:text-primary"
                            >
                              View Trace
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center h-24 text-sm text-muted-foreground">
                        No cases found matching filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
            
            {/* Pagination Controls */}
            {pagination.total_pages > 1 && (
              <div className="border-t border-border p-4 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Showing cases {(pagination.page - 1) * limit + 1} - {Math.min(pagination.page * limit, pagination.total_filtered)} of {pagination.total_filtered} filtered
                </span>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="h-8 px-2"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs font-semibold px-2 font-mono">Page {page} of {pagination.total_pages}</span>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setPage(p => Math.min(pagination.total_pages, p + 1))}
                    disabled={page === pagination.total_pages}
                    className="h-8 px-2"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* 5. Metadata / Config Content */}
        <TabsContent value="config" className="space-y-6 outline-none">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="border-border shadow-sm">
              <CardHeader className="border-b border-border bg-muted/10">
                <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <Database className="h-4 w-4 text-primary" />
                  Methodology Configuration
                </CardTitle>
                <CardDescription>Execution parameters parsed from evaluation metadata.</CardDescription>
              </CardHeader>
              <CardContent className="pt-5 space-y-4 text-sm">
                <div className="flex justify-between border-b border-border/40 pb-2">
                  <span className="text-muted-foreground">Dataset Key:</span>
                  <span className="font-bold text-foreground uppercase">{methodology?.dataset_key}</span>
                </div>
                <div className="flex justify-between border-b border-border/40 pb-2">
                  <span className="text-muted-foreground">Provider Requested:</span>
                  <span className="font-bold text-foreground capitalize">{methodology?.provider}</span>
                </div>
                <div className="flex justify-between border-b border-border/40 pb-2">
                  <span className="text-muted-foreground">Total Contracts:</span>
                  <span className="font-bold text-foreground">{methodology?.contract_count_requested}</span>
                </div>
                <div className="flex justify-between border-b border-border/40 pb-2">
                  <span className="text-muted-foreground">Repeats per case:</span>
                  <span className="font-bold text-foreground">{methodology?.repeat_default} (security: {methodology?.repeat_security})</span>
                </div>
                <div className="flex justify-between border-b border-border/40 pb-2">
                  <span className="text-muted-foreground">Skip Citation Gate:</span>
                  <span className="font-bold text-foreground">{methodology?.skip_citation_gate ? "True" : "False"}</span>
                </div>
                <div className="flex justify-between pb-2">
                  <span className="text-muted-foreground">Manifest File Path:</span>
                  <span className="font-mono text-xs font-semibold max-w-[260px] truncate" title={methodology?.manifest}>
                    {methodology?.manifest}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border shadow-sm">
              <CardHeader className="border-b border-border bg-muted/10">
                <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <HelpCircle className="h-4 w-4 text-primary" />
                  Suite Baseline Thresholds
                </CardTitle>
                <CardDescription>Hard gates required to pass the test suite.</CardDescription>
              </CardHeader>
              <CardContent className="pt-5 space-y-4 text-sm">
                <div className="flex justify-between border-b border-border/40 pb-2">
                  <span className="text-muted-foreground">Overall Target Score:</span>
                  <span className="font-bold text-foreground">{(thresholdConfig?.overall?.score || 0.9) * 100}%</span>
                </div>
                <div className="flex justify-between border-b border-border/40 pb-2">
                  <span className="text-muted-foreground">Tool Selection Baseline:</span>
                  <span className="font-bold text-foreground">{(thresholdConfig?.tools?.tool_selection_accuracy || 0.9) * 100}%</span>
                </div>
                <div className="flex justify-between border-b border-border/40 pb-2">
                  <span className="text-muted-foreground">Forbidden Tool Block Rate:</span>
                  <span className="font-bold text-foreground">{(thresholdConfig?.overall?.forbidden_tool_block_rate || 1.0) * 100}%</span>
                </div>
                <div className="flex justify-between border-b border-border/40 pb-2">
                  <span className="text-muted-foreground">Citation required rate:</span>
                  <span className="font-bold text-foreground">{(thresholdConfig?.pac1?.citation_required_claim_rate || 0.95) * 100}%</span>
                </div>
                <div className="flex justify-between border-b border-border/40 pb-2">
                  <span className="text-muted-foreground">Negative Hallucination Max:</span>
                  <span className="font-bold text-foreground">{(thresholdConfig?.pac1?.negative_case_hallucination_rate_max || 0.05) * 100}%</span>
                </div>
                <div className="flex justify-between pb-2">
                  <span className="text-muted-foreground">Source Contract Immutability:</span>
                  <span className="font-bold text-foreground">{(thresholdConfig?.overall?.source_contract_immutability || 1.0) * 100}%</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Case Details Drawer / Modal overlay */}
      {selectedCase && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-end p-0">
          <div className="bg-card w-full max-w-3xl h-full shadow-2xl flex flex-col justify-between border-l border-border animate-slide-in relative">
            
            {/* Header */}
            <div className="p-6 border-b border-border flex items-center justify-between">
              <div>
                <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">
                  Case ID: {selectedCase.case?.case_id?.substring(0, 16)}...
                </span>
                <h3 className="text-lg font-bold text-foreground mt-1">Trace Inspection</h3>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedCase(null)}>
                Close
              </Button>
            </div>

            {/* Scrollable contents */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
              
              {/* Telemetry info row */}
              <div className="grid grid-cols-3 gap-3 bg-muted/30 p-3 rounded-lg border border-border/60">
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold">Status</span>
                  <div className="flex items-center gap-1.5 mt-1 font-semibold text-sm">
                    {selectedCase.passed ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-green-500" /> Passed
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4 text-destructive" /> Failed
                      </>
                    )}
                  </div>
                </div>
                
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold">Latency</span>
                  <div className="flex items-center gap-1.5 mt-1 font-semibold text-sm">
                    <Clock className="h-4 w-4 text-orange-500" /> {selectedCase.observation?.latency_ms || "-"}ms
                  </div>
                </div>

                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold">Score</span>
                  <div className="flex items-center gap-1.5 mt-1 font-semibold text-sm">
                    <Coins className="h-4 w-4 text-primary" /> {Math.round((selectedCase.score || 0) * 100)}%
                  </div>
                </div>
              </div>

              {/* Collapsible prompt box */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Prompt Context</span>
                  <Button 
                    variant="link" 
                    size="sm" 
                    onClick={() => setIsPromptExpanded(!isPromptExpanded)}
                    className="h-auto p-0 text-xs flex items-center gap-1"
                  >
                    {isPromptExpanded ? (
                      <>Hide <ChevronUp className="h-3 w-3" /></>
                    ) : (
                      <>Show Full <ChevronDown className="h-3 w-3" /></>
                    )}
                  </Button>
                </div>
                <div className={`p-4 bg-muted/40 rounded-lg border border-border/80 text-xs font-mono text-foreground leading-relaxed whitespace-pre-wrap ${!isPromptExpanded ? "max-h-[100px] overflow-hidden relative" : ""}`}>
                  {selectedCase.case?.prompt}
                  {!isPromptExpanded && (
                    <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent pointer-events-none" />
                  )}
                </div>
              </div>

              {/* Observed Answer */}
              <div className="space-y-1.5">
                <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Agent Generated Response</span>
                <div className="p-4 bg-muted/20 rounded-lg border border-border text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {selectedCase.observation?.answer || "No response generated by agent."}
                </div>
              </div>

              {/* Expected Gold Spans */}
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Expected Gold Labels</span>
                {selectedCase.case?.gold_labels && selectedCase.case.gold_labels.length > 0 ? (
                  selectedCase.case.gold_labels.map((gold: any, idx: number) => (
                    <div key={idx} className="p-3 bg-blue-500/5 border border-blue-500/10 rounded-lg text-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-blue-600 dark:text-blue-400 capitalize">{gold.clause_type || "clause"}</span>
                        <Badge variant="outline" className="text-[9px] py-0 border-blue-500/20 text-blue-500 bg-blue-500/5">
                          {gold.present ? "Present" : "Absent"}
                        </Badge>
                      </div>
                      {gold.spans && gold.spans.map((s: any, sIdx: number) => (
                        <div key={sIdx} className="font-mono bg-white dark:bg-muted/40 p-2 rounded border border-border mt-1">
                          {s.text}
                        </div>
                      ))}
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-muted-foreground p-3 border border-dashed rounded-lg">No gold spans defined for this verification.</div>
                )}
              </div>

              {/* Step-by-Step trace log timeline */}
              <div className="space-y-3">
                <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Execution Trace Timeline</span>
                <div className="space-y-3 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                  {selectedCase.observation?.trace && selectedCase.observation.trace.length > 0 ? (
                    selectedCase.observation.trace.map((evt: any, idx: number) => (
                      <div key={idx} className="flex gap-4 relative pl-8">
                        <span className="absolute left-1.5 top-1.5 h-3.5 w-3.5 rounded-full bg-primary border-4 border-card z-10" />
                        <div className="flex-1 p-3 bg-muted/15 border border-border/80 rounded-lg space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="font-bold text-xs text-foreground uppercase tracking-wider">{evt.event || "api_call"}</span>
                            <span className="text-[10px] text-muted-foreground font-mono">{evt.timestamp || ""}</span>
                          </div>
                          {evt.detail && (
                            <div className="text-[10px] text-muted-foreground font-mono bg-muted/40 p-1.5 rounded mt-1 overflow-x-auto">
                              {JSON.stringify(evt.detail, null, 2)}
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-muted-foreground p-3 border border-dashed rounded-lg ml-8">No step trace recorded.</div>
                  )}
                </div>
              </div>
              
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-border flex justify-end">
              <Button size="sm" onClick={() => setSelectedCase(null)}>
                Dismiss
              </Button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
