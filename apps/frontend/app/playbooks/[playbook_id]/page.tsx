"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Save,
  Scale,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";

import LoadingScreen from "@/components/animation/LoadingScreen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import dynamic from "next/dynamic";

const PDFViewerDynamic = dynamic(() => import("@/components/PDFViewer/Sample"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-gray-50">
      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
    </div>
  ),
});
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useAccountContext } from "@/app/context/AccountContext";
import { useAuth } from "@/hooks/useAuth";
import { downloadCsv } from "@/lib/exportCsv";
import { apiDownload } from "@/lib/apiClient";
import {
  createPlaybookRedlines,
  emptyPlaybookRule,
  getPlaybook,
  getPlaybookRun,
  listPlaybookRuns,
  runPlaybook,
  updatePlaybook,
  updatePlaybookFinding,
  type Playbook,
  type PlaybookFinding,
  type PlaybookRedlineArtifact,
  type PlaybookRule,
  type PlaybookRun,
  type PlaybookRunDetail,
  type PlaybookSeverity,
  type PlaybookStatus,
} from "@/lib/playbooks";
import { listDocuments, type DocumentSummary } from "@/lib/tabularReviews";

type RuleDraft = {
  rule_id?: string;
  name: string;
  clause_type: string;
  description: string;
  standard_position: string;
  fallback_positions: string;
  unacceptable_deviations: string;
  guidance: string;
  required_clause: boolean;
  suggested_language: string;
  severity: PlaybookSeverity;
  tags: string;
};

type FindingDraft = {
  finding: PlaybookFinding;
  reviewer_status: PlaybookStatus;
  reviewer_notes: string;
  suggested_revision: string;
};

type FindingView = "all" | "redlines" | "unreviewed";

const STATUS_META: Record<PlaybookStatus, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  acceptable: {
    label: "Acceptable",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: CheckCircle2,
  },
  needs_review: {
    label: "Needs review",
    className: "border-amber-200 bg-amber-50 text-amber-700",
    icon: AlertTriangle,
  },
  not_acceptable: {
    label: "Not acceptable",
    className: "border-red-200 bg-red-50 text-red-700",
    icon: XCircle,
  },
  not_applicable: {
    label: "Not applicable",
    className: "border-gray-200 bg-gray-50 text-gray-600",
    icon: Scale,
  },
};

const SEVERITY_CLASS: Record<PlaybookSeverity, string> = {
  low: "border-gray-200 bg-gray-50 text-gray-600",
  medium: "border-blue-200 bg-blue-50 text-blue-700",
  high: "border-orange-200 bg-orange-50 text-orange-700",
  critical: "border-red-200 bg-red-50 text-red-700",
};

const FINDING_STATUS_ORDER: PlaybookStatus[] = ["needs_review", "not_acceptable", "acceptable", "not_applicable"];

function isIndexedDocument(document: DocumentSummary) {
  return document.index?.status === "success" || ["Indexed", "Completed", "Ready to Edit"].includes(document.status);
}

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function joinLines(values?: string[]) {
  return (values || []).join("\n");
}

function sanitizeFilename(value: string) {
  return (value || "playbook-findings").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 90);
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ruleToDraft(rule?: PlaybookRule): RuleDraft {
  const empty = emptyPlaybookRule();
  const source = rule || empty;
  return {
    rule_id: source.rule_id,
    name: source.name || "",
    clause_type: source.clause_type || "",
    description: source.description || "",
    standard_position: source.standard_position || "",
    fallback_positions: joinLines(source.fallback_positions),
    unacceptable_deviations: joinLines(source.unacceptable_deviations),
    guidance: source.guidance || "",
    required_clause: Boolean(source.required_clause),
    suggested_language: source.suggested_language || "",
    severity: source.severity || "medium",
    tags: joinLines(source.tags),
  };
}

function draftToRule(draft: RuleDraft, index: number): PlaybookRule {
  return {
    rule_id: draft.rule_id || `rule-${Math.random().toString(36).slice(2, 12)}`,
    index,
    name: draft.name.trim(),
    clause_type: draft.clause_type.trim(),
    description: draft.description.trim() || null,
    standard_position: draft.standard_position.trim() || null,
    fallback_positions: splitLines(draft.fallback_positions),
    unacceptable_deviations: splitLines(draft.unacceptable_deviations),
    guidance: draft.guidance.trim() || null,
    required_clause: draft.required_clause,
    suggested_language: draft.suggested_language.trim() || null,
    severity: draft.severity,
    tags: splitLines(draft.tags),
  };
}

function findingStatus(finding: PlaybookFinding) {
  return (finding.reviewer_status || finding.status) as PlaybookStatus;
}

function statusCounts(findings: PlaybookFinding[]) {
  return findings.reduce<Record<PlaybookStatus, number>>(
    (counts, finding) => {
      counts[findingStatus(finding)] += 1;
      return counts;
    },
    { acceptable: 0, needs_review: 0, not_acceptable: 0, not_applicable: 0 },
  );
}

function confidenceLabel(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const normalized = value > 1 ? value : value * 100;
  return `${Math.round(normalized)}%`;
}

function PlaybookDetailContent() {
  const params = useParams<{ playbook_id: string }>();
  const searchParams = useSearchParams();
  const playbookId = params.playbook_id;
  const initialContractId = searchParams.get("contract_id") || "";
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL ?? "";
  const { isAuthenticated, authenticatedFetch, token } = useAuth();
  const { selectedAccountId } = useAccountContext();

  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [runs, setRuns] = useState<PlaybookRun[]>([]);
  const [runDetail, setRunDetail] = useState<PlaybookRunDetail | null>(null);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [redlining, setRedlining] = useState(false);
  const [redlineArtifacts, setRedlineArtifacts] = useState<PlaybookRedlineArtifact[]>([]);
  const [findingsExpandedMap, setFindingsExpandedMap] = useState<Record<string, boolean>>({});
  const [activeViewContractId, setActiveViewContractId] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [contractType, setContractType] = useState("");
  const [visibility, setVisibility] = useState<"private" | "project">("private");
  const [rules, setRules] = useState<PlaybookRule[]>([]);
  const [ruleSearch, setRuleSearch] = useState("");
  const [findingFilter, setFindingFilter] = useState<"all" | PlaybookStatus>("all");
  const [findingView, setFindingView] = useState<FindingView>("all");
  const [findingSearch, setFindingSearch] = useState("");
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null);

  const [selectedContractIds, setSelectedContractIds] = useState<string[]>(initialContractId ? [initialContractId] : []);
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([]);
  const [representingParty, setRepresentingParty] = useState("");
  const [paperType, setPaperType] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");

  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editingRuleIndex, setEditingRuleIndex] = useState<number | null>(null);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft>(ruleToDraft());
  const [findingDraft, setFindingDraft] = useState<FindingDraft | null>(null);

  const loadDocuments = useCallback(
    async (nextPlaybook?: Playbook | null) => {
      if (!apiUrl || !isAuthenticated) return;
      try {
        const nextDocuments = await listDocuments(apiUrl, authenticatedFetch, {
          contextId: nextPlaybook?.project_id ? selectedAccountId : null,
          projectId: nextPlaybook?.project_id || null,
        });
        setDocuments(nextDocuments.filter(isIndexedDocument));
      } catch (error) {
        console.error("Failed to load playbook documents", error);
        setDocuments([]);
      }
    },
    [apiUrl, authenticatedFetch, isAuthenticated, selectedAccountId],
  );

  const loadRun = useCallback(
    async (runId: string) => {
      if (!apiUrl || !isAuthenticated || !playbookId) return;
      const detail = await getPlaybookRun(apiUrl, authenticatedFetch, playbookId, runId);
      setRunDetail(detail);
    },
    [apiUrl, authenticatedFetch, isAuthenticated, playbookId],
  );

  const loadPage = useCallback(async () => {
    if (!apiUrl || !isAuthenticated || !playbookId) return;
    setLoading(true);
    try {
      const [detail, nextRuns] = await Promise.all([
        getPlaybook(apiUrl, authenticatedFetch, playbookId),
        listPlaybookRuns(apiUrl, authenticatedFetch, playbookId),
      ]);
      setPlaybook(detail.playbook);
      setRuns(nextRuns);
      setTitle(detail.playbook.title || "Untitled Playbook");
      setDescription(detail.playbook.description || "");
      setContractType(detail.playbook.contract_type || "");
      setVisibility(detail.playbook.visibility || "private");
      setRules(detail.playbook.rules || []);
      setSelectedRuleIds((detail.playbook.rules || []).map((rule) => rule.rule_id).filter(Boolean) as string[]);
      setActiveRuleId((current) => current || detail.playbook.rules?.[0]?.rule_id || null);
      await loadDocuments(detail.playbook);
      const firstRun = detail.latest_run || nextRuns[0];
      if (firstRun?.id) {
        await loadRun(firstRun.id);
      } else {
        setRunDetail(null);
      }
    } catch (error) {
      toast({
        title: "Could not load playbook",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [apiUrl, authenticatedFetch, isAuthenticated, loadDocuments, loadRun, playbookId]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const documentsById = useMemo(() => new Map(documents.map((document) => [document._id, document])), [documents]);
  const referenceDocument = playbook?.reference_document_id ? documentsById.get(playbook.reference_document_id) : null;
  const referenceDocumentName = playbook?.reference_document_name || referenceDocument?.contract_name || "No reference document selected";
  const filteredRules = useMemo(() => {
    const q = ruleSearch.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter((rule) =>
      [rule.name, rule.clause_type, rule.standard_position || "", rule.guidance || ""].some((value) =>
        value.toLowerCase().includes(q),
      ),
    );
  }, [ruleSearch, rules]);
  const activeRuleIndex = useMemo(() => {
    const index = rules.findIndex((rule) => rule.rule_id === activeRuleId);
    return index >= 0 ? index : rules.length ? 0 : -1;
  }, [activeRuleId, rules]);
  const activeRule = activeRuleIndex >= 0 ? rules[activeRuleIndex] : null;
  const findings = runDetail?.findings || [];
  const redlineableFindings = useMemo(
    () => findings.filter((finding) => (
      findingStatus(finding) !== "not_applicable" &&
      Boolean(finding.matched_text?.trim()) &&
      Boolean(finding.suggested_revision?.trim())
    )),
    [findings],
  );
  const filteredFindings = useMemo(() => {
    const q = findingSearch.trim().toLowerCase();
    return findings.filter((finding) => {
      const status = findingStatus(finding);
      if (findingFilter !== "all" && status !== findingFilter) return false;
      if (findingView === "redlines" && !finding.suggested_revision && status !== "not_acceptable") return false;
      if (findingView === "unreviewed" && finding.reviewer_status) return false;
      if (!q) return true;
      return [
        finding.rule_name,
        finding.clause_type,
        finding.document_name || "",
        finding.clause_summary || "",
        finding.reasoning || "",
        finding.suggested_revision || "",
      ].some((value) => value.toLowerCase().includes(q));
    });
  }, [findingFilter, findingSearch, findingView, findings]);
  const groupedFindings = useMemo(
    () => FINDING_STATUS_ORDER
      .map((status) => ({
        status,
        findings: filteredFindings.filter((finding) => findingStatus(finding) === status),
      }))
      .filter((group) => group.findings.length),
    [filteredFindings],
  );
  const counts = useMemo(() => statusCounts(findings), [findings]);
  const completeRuleCount = useMemo(
    () => rules.filter((rule) => (
      Boolean(rule.name?.trim()) &&
      Boolean(rule.clause_type?.trim()) &&
      (Boolean(rule.standard_position?.trim()) || Boolean(rule.required_clause)) &&
      (Boolean(rule.guidance?.trim()) || Boolean(rule.suggested_language?.trim()) || (rule.unacceptable_deviations || []).length > 0)
    )).length,
    [rules],
  );
  const actionableRuleCount = useMemo(
    () => rules.filter((rule) => (
      (rule.unacceptable_deviations || []).length > 0 ||
      (rule.fallback_positions || []).length > 0 ||
      Boolean(rule.suggested_language?.trim()) ||
      Boolean(rule.guidance?.trim())
    )).length,
    [rules],
  );
  const dirty = Boolean(
    playbook &&
      (title.trim() !== playbook.title ||
        description.trim() !== (playbook.description || "") ||
        contractType.trim() !== (playbook.contract_type || "") ||
        visibility !== playbook.visibility ||
        JSON.stringify(rules) !== JSON.stringify(playbook.rules || [])),
  );
  const allRulesSelected = rules.length > 0 && rules.every((rule) => rule.rule_id && selectedRuleIds.includes(rule.rule_id));
  const selectedContracts = useMemo(
    () => selectedContractIds
      .map((documentId) => documentsById.get(documentId))
      .filter(Boolean) as DocumentSummary[],
    [documentsById, selectedContractIds],
  );
  const runReady = Boolean(selectedContractIds.length && selectedRuleIds.length && rules.length);
  const availabilityLabel = visibility === "project" ? "Project" : "Private";
  const latestRunTotal = runDetail?.findings.length ?? runDetail?.run.summary?.total ?? 0;

  function toggleDocument(documentId: string) {
    setSelectedContractIds((current) =>
      current.includes(documentId) ? current.filter((id) => id !== documentId) : [...current, documentId],
    );
  }

  function toggleRule(ruleId?: string) {
    if (!ruleId) return;
    setSelectedRuleIds((current) =>
      current.includes(ruleId) ? current.filter((id) => id !== ruleId) : [...current, ruleId],
    );
  }

  async function handleSave() {
    if (!playbook) return;
    const normalizedRules = rules.map((rule, index) => ({ ...rule, index }));
    if (!title.trim()) {
      toast({ title: "Playbook title is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const updated = await updatePlaybook(apiUrl, authenticatedFetch, playbook.id, {
        title: title.trim(),
        description: description.trim() || null,
        contract_type: contractType.trim() || null,
        visibility,
        reference_document_id: playbook.reference_document_id || null,
        reference_document_name: playbook.reference_document_name || null,
        rules: normalizedRules,
      });
      setPlaybook(updated);
      setRules(updated.rules || []);
      setSelectedRuleIds((updated.rules || []).map((rule) => rule.rule_id).filter(Boolean) as string[]);
      toast({ title: "Playbook saved" });
    } catch (error) {
      toast({
        title: "Could not save playbook",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleRun() {
    if (!playbook) return;
    if (!selectedContractIds.length) {
      toast({ title: "Select at least one indexed contract", variant: "destructive" });
      return;
    }
    if (!selectedRuleIds.length) {
      toast({ title: "Select at least one rule", variant: "destructive" });
      return;
    }

    if (dirty) {
      const saved = await handleSaveBeforeRun();
      if (!saved) return;
    }

    setRunning(true);
    try {
      const detail = await runPlaybook(apiUrl, authenticatedFetch, playbook.id, {
        contract_ids: selectedContractIds,
        rule_ids: selectedRuleIds,
        representing_party: representingParty.trim() || null,
        paper_type: paperType.trim() || null,
        additional_context: additionalContext.trim() || null,
      });
      setRunDetail(detail);
      const nextRuns = await listPlaybookRuns(apiUrl, authenticatedFetch, playbook.id);
      setRuns(nextRuns);
      toast({ title: "Playbook run complete", description: `${detail.findings.length} findings created.` });
      await loadPage();
    } catch (error) {
      toast({
        title: "Could not run playbook",
        description: error instanceof Error ? error.message : "Please check provider keys and selected contracts.",
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  }

  async function handleSaveBeforeRun() {
    if (!playbook) return false;
    setSaving(true);
    try {
      const updated = await updatePlaybook(apiUrl, authenticatedFetch, playbook.id, {
        title: title.trim(),
        description: description.trim() || null,
        contract_type: contractType.trim() || null,
        visibility,
        reference_document_id: playbook.reference_document_id || null,
        reference_document_name: playbook.reference_document_name || null,
        rules: rules.map((rule, index) => ({ ...rule, index })),
      });
      setPlaybook(updated);
      setRules(updated.rules || []);
      return true;
    } catch (error) {
      toast({
        title: "Save before run failed",
        description: error instanceof Error ? error.message : "Please fix the playbook rules first.",
        variant: "destructive",
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  function openRuleDialog(rule?: PlaybookRule) {
    setEditingRuleIndex(rule ? rules.findIndex((item) => item.rule_id === rule.rule_id) : null);
    setRuleDraft(ruleToDraft(rule));
    setRuleDialogOpen(true);
  }

  function updateRuleAt(index: number, patch: Partial<PlaybookRule>) {
    if (index < 0) return;
    setRules((current) => current.map((rule, ruleIndex) => (
      ruleIndex === index ? { ...rule, ...patch, index: ruleIndex } : rule
    )));
  }

  function appendRuleLine(index: number, field: "fallback_positions" | "unacceptable_deviations") {
    if (index < 0) return;
    setRules((current) => current.map((rule, ruleIndex) => {
      if (ruleIndex !== index) return rule;
      return { ...rule, [field]: [...(rule[field] || []), ""] };
    }));
  }

  function saveRuleDraft() {
    const name = ruleDraft.name.trim();
    const clauseType = ruleDraft.clause_type.trim();
    if (!name || !clauseType) {
      toast({ title: "Rule name and clause type are required", variant: "destructive" });
      return;
    }
    const nextRule = draftToRule(ruleDraft, editingRuleIndex ?? rules.length);
    if (
      !nextRule.standard_position &&
      !nextRule.fallback_positions.length &&
      !nextRule.unacceptable_deviations.length &&
      !nextRule.guidance &&
      !nextRule.required_clause
    ) {
      toast({ title: "Add a standard, fallback, red flag, guidance, or required-clause flag", variant: "destructive" });
      return;
    }
    setRules((current) => {
      if (editingRuleIndex === null || editingRuleIndex < 0) {
        return [...current, nextRule].map((rule, index) => ({ ...rule, index }));
      }
      return current.map((rule, index) => (index === editingRuleIndex ? nextRule : { ...rule, index }));
    });
    if (nextRule.rule_id) {
      setSelectedRuleIds((current) => current.includes(nextRule.rule_id as string) ? current : [...current, nextRule.rule_id as string]);
      setActiveRuleId(nextRule.rule_id);
    }
    setRuleDialogOpen(false);
  }

  function deleteRule(rule: PlaybookRule) {
    const nextRules = rules.filter((item) => item.rule_id !== rule.rule_id).map((item, index) => ({ ...item, index }));
    setRules(nextRules);
    if (activeRuleId === rule.rule_id) {
      setActiveRuleId(nextRules[0]?.rule_id || null);
    }
    if (rule.rule_id) {
      setSelectedRuleIds((current) => current.filter((id) => id !== rule.rule_id));
    }
  }

  async function saveFindingDraft() {
    if (!playbook || !findingDraft) return;
    try {
      const updated = await updatePlaybookFinding(apiUrl, authenticatedFetch, playbook.id, findingDraft.finding.id, {
        reviewer_status: findingDraft.reviewer_status,
        reviewer_notes: findingDraft.reviewer_notes.trim() || null,
        suggested_revision: findingDraft.suggested_revision.trim() || null,
      });
      setRunDetail((current) => {
        if (!current) return current;
        return {
          ...current,
          findings: current.findings.map((finding) => (finding.id === updated.id ? updated : finding)),
        };
      });
      setFindingDraft(null);
      toast({ title: "Finding updated" });
    } catch (error) {
      toast({
        title: "Could not update finding",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  async function handleFindingAction(finding: PlaybookFinding, action: "apply" | "dismiss") {
    if (!playbook) return;
    try {
      const updated = await updatePlaybookFinding(apiUrl, authenticatedFetch, playbook.id, finding.id, {
        reviewer_status: action === "apply" ? "acceptable" : "not_applicable",
        reviewer_notes: action === "apply" ? "Suggestion marked as applied." : "Suggestion dismissed.",
        suggested_revision: finding.suggested_revision || null,
      });
      setRunDetail((current) => {
        if (!current) return current;
        return {
          ...current,
          findings: current.findings.map((item) => (item.id === updated.id ? updated : item)),
        };
      });
      toast({ title: action === "apply" ? "Suggestion marked applied" : "Suggestion dismissed" });
    } catch (error) {
      toast({
        title: "Could not update suggestion",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  async function exportPlaybookRules() {
    if (!playbook) return;
    setExporting(true);
    try {
      const rows = rules.map((rule, index) => ({
        Index: index + 1,
        "Rule Name": rule.name,
        "Clause Type": rule.clause_type,
        "Standard Position": rule.standard_position || "",
        "Fallback Positions": (rule.fallback_positions || []).join("\n"),
        "Unacceptable Position": (rule.unacceptable_deviations || []).join("\n"),
        Guidance: rule.guidance || "",
        "Required Clause": rule.required_clause ? "Yes" : "No",
        "Sample Standard Language": rule.suggested_language || "",
        Severity: rule.severity,
      }));
      downloadCsv(`${sanitizeFilename(playbook.title)}-rules.csv`, rows);
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  }

  async function exportFindings() {
    if (!playbook || !findings.length) return;
    setExporting(true);
    try {
      const rows = findings.map((finding) => ({
        Document: finding.document_name || finding.document_id,
        Rule: finding.rule_name,
        "Clause type": finding.clause_type,
        Status: STATUS_META[findingStatus(finding)].label,
        "Model status": STATUS_META[finding.status].label,
        Severity: finding.severity,
        Confidence: confidenceLabel(finding.confidence),
        "Matched position": finding.matched_position || "",
        Summary: finding.clause_summary || "",
        "Matched text": finding.matched_text || "",
        Reasoning: finding.reasoning || "",
        Guidance: finding.guidance || "",
        "Suggested revision": finding.suggested_revision || "",
        "Reviewer notes": finding.reviewer_notes || "",
      }));
      downloadCsv(`${sanitizeFilename(playbook.title)}-findings.csv`, rows);
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  }

  async function downloadRedlineArtifact(artifact: PlaybookRedlineArtifact) {
    if (!apiUrl || !token || !artifact.download_url) return;
    let blob: Blob;
    try {
      blob = await apiDownload(`${apiUrl}${artifact.download_url}`);
    } catch {
      toast({
        title: "Redline download failed",
        description: "The redline was created, but the file could not be downloaded.",
        variant: "destructive",
      });
      return;
    }
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = artifact.filename || "Playbook Redline.docx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(objectUrl);
  }

  async function handleCreateRedline() {
    if (!playbook || !runDetail?.run) return;
    if (!redlineableFindings.length) {
      toast({ title: "No redlineable findings", description: "Findings need matched text and suggested revision before a redline can be created." });
      return;
    }
    setRedlining(true);
    try {
      const artifacts = await createPlaybookRedlines(apiUrl, authenticatedFetch, playbook.id, runDetail.run.id);
      setRedlineArtifacts(artifacts);
      const applied = artifacts.reduce((total, artifact) => total + artifact.applied_count, 0);
      const unmatched = artifacts.reduce((total, artifact) => total + artifact.unmatched_count, 0);
      toast({
        title: "Redline created",
        description: `${applied} tracked edits applied${unmatched ? `, ${unmatched} unmatched` : ""}.`,
      });
      if (artifacts.length === 1) {
        await downloadRedlineArtifact(artifacts[0]);
      }
    } catch (error) {
      toast({
        title: "Could not create redline",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRedlining(false);
    }
  }

  if (!isAuthenticated || loading) {
    return <LoadingScreen message="Loading playbook..." />;
  }

  if (!playbook) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white px-6 pt-16 text-gray-950">
        <div className="max-w-sm text-center">
          <BookOpen className="mx-auto mb-4 h-8 w-8 text-gray-300" />
          <h1 className="font-serif text-2xl font-medium">Playbook not found</h1>
          <Link href="/playbooks" className="mt-4 inline-flex text-sm font-medium text-gray-700 hover:text-gray-950">
            Back to Playbooks
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#fafafa] pt-14">
      <header className="sticky top-14 z-20 flex h-14 items-center gap-3 border-b border-gray-100 bg-white/80 px-6 backdrop-blur-md">
        <Link href="/playbooks" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <BookOpen className="h-4 w-4 shrink-0 text-gray-300" />
            <h1 className="truncate text-sm font-semibold text-gray-900">{playbook.title}</h1>
            <span className={`inline-flex items-center rounded-full px-2 py-0 text-[10px] font-medium ${
              visibility === "project" ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500"
            }`}>
              {availabilityLabel}
            </span>
            <span className={`inline-flex items-center rounded-full px-2 py-0 text-[10px] font-medium ${
              dirty ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"
            }`}>
              {dirty ? "Unsaved" : "Saved"}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-gray-400">
            {playbook.contract_type || "General contract"} · {completeRuleCount}/{rules.length} rules complete · {selectedContractIds.length} contracts
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="hidden h-8 gap-1.5 rounded-lg text-xs text-gray-500 transition-colors hover:text-gray-900 md:inline-flex"
          onClick={() => void loadPage()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="hidden h-8 gap-1.5 rounded-lg text-xs text-gray-500 transition-colors hover:text-gray-900 lg:inline-flex"
          disabled={!rules.length || exporting}
          onClick={() => void exportPlaybookRules()}
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Export rules
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 rounded-lg text-xs"
          disabled={!dirty || saving}
          onClick={() => void handleSave()}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5 rounded-lg bg-gray-900 text-xs text-white transition-colors hover:bg-gray-800"
          disabled={running || saving || !runReady}
          onClick={() => void handleRun()}
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Run
        </Button>
      </header>



        <section className="min-w-0 px-6 py-5" style={{ height: "calc(100vh - 112px)" }}>
          <div className="grid grid-cols-[1fr_1fr] gap-5" style={{ height: "100%" }}>
            <div className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-900/5">
              <div className="shrink-0 border-b border-gray-100 px-5 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-gray-400" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Rules</span>
                    <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">{rules.length}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={activeViewContractId}
                      onChange={(event) => setActiveViewContractId(event.target.value || "")}
                      className="h-7 rounded-lg border border-gray-200 bg-gray-50 px-2 text-[11px] text-gray-600 outline-none transition-colors hover:bg-gray-100 focus:border-gray-300"
                    >
                      <option value="">View PDF…</option>
                      {documents.map((d) => (
                        <option key={d._id} value={d._id}>{d.contract_name}</option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 rounded-lg text-[11px]"
                      disabled={!dirty || saving}
                      onClick={() => void handleSave()}
                    >
                      {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 gap-1 rounded-lg bg-gray-900 text-[11px] text-white transition-colors hover:bg-gray-800"
                      disabled={running || saving || !runReady}
                      onClick={() => void handleRun()}
                    >
                      {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      Run
                    </Button>
                  </div>
                </div>
                {selectedContractIds.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selectedContractIds.map((id) => {
                      const doc = documentsById.get(id);
                      return doc ? (
                        <span key={id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">
                          <FileText className="h-3 w-3 text-gray-400" />
                          {doc.contract_name}
                        </span>
                      ) : null;
                    })}
                  </div>
                ) : null}
              </div>
              <div className="flex-1 overflow-auto">
                <table className="min-w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-gray-50/80 backdrop-blur">
                    <tr className="text-[10px] font-medium uppercase tracking-wider text-gray-400 [&>th]:border-b [&>th]:border-gray-100 [&>th]:px-4 [&>th]:py-2">
                      <th className="w-8"></th>
                      <th>Rule</th>
                      <th>Standard Position</th>
                      <th>Fallback</th>
                      <th>Guidance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rules.length ? rules.map((rule) => {
                      const selected = Boolean(rule.rule_id && selectedRuleIds.includes(rule.rule_id));
                      const hasStandard = Boolean(rule.standard_position || rule.required_clause);
                      const hasFallback = Boolean((rule.fallback_positions || []).length || (rule.unacceptable_deviations || []).length || rule.guidance);
                      const completeness = hasStandard && hasFallback ? "green" : hasStandard || hasFallback ? "amber" : "red";
                      return (
                        <tr
                          key={rule.rule_id || `${rule.name}-${rule.index}`}
                          className="cursor-pointer align-top transition-colors hover:bg-gray-50/50"
                        >
                          <td className="px-4 py-2.5">
                            <button
                              type="button"
                              onClick={() => toggleRule(rule.rule_id)}
                              className={`flex h-4 w-4 items-center justify-center rounded transition-colors ${
                                selected ? "bg-gray-900 text-white ring-1 ring-gray-900" : "bg-white text-transparent ring-1 ring-gray-200 hover:ring-gray-300"
                              }`}
                              aria-label={`Select ${rule.name}`}
                            >
                              {selected ? <Check className="h-2.5 w-2.5" /> : null}
                            </button>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex h-1.5 w-1.5 shrink-0 rounded-full ${
                                completeness === "green" ? "bg-emerald-400" : completeness === "amber" ? "bg-amber-400" : "bg-red-400"
                              }`} />
                              <div>
                                <span className="block text-xs font-medium text-gray-900">{rule.name}</span>
                                <span className="text-[10px] text-gray-400">{rule.clause_type} · {rule.severity}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 leading-5 text-gray-600">{rule.standard_position || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-2.5 leading-5 text-gray-600">{(rule.fallback_positions || []).join("; ") || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <span className="line-clamp-2 leading-5 text-gray-600">{rule.guidance || <span className="text-gray-300">—</span>}</span>
                              <button
                                type="button"
                                className="ml-auto shrink-0 rounded-md p-1 text-gray-300 opacity-0 transition-all group-hover:opacity-100 hover:bg-gray-100 hover:text-gray-600"
                                onClick={() => openRuleDialog(rule)}
                                aria-label={`Edit ${rule.name}`}
                              >
                                <Edit3 className="h-3 w-3" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={5}>
                          <div className="flex flex-col items-center justify-center py-20">
                            <BookOpen className="mb-3 h-8 w-8 text-gray-200" />
                            <p className="text-sm text-gray-400">No rules created</p>
                            <p className="mt-1 text-xs text-gray-300">Add rules to begin reviewing contracts</p>
                            <Button type="button" size="sm" className="mt-4 h-8 gap-1.5 rounded-lg bg-gray-900 text-xs text-white transition-colors hover:bg-gray-800" onClick={() => openRuleDialog()}>
                              <Plus className="h-3.5 w-3.5" />
                              Add rule
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-900/5">
              <div className="shrink-0 border-b border-gray-100 px-5 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs font-semibold text-gray-700">{playbook.title}</h2>
                    {runDetail ? (
                      <span className="rounded-full bg-gray-100 px-2 py-0 text-[10px] font-medium text-gray-500">
                        {runDetail.findings.length}f
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {runs.length > 1 ? (
                      <select
                        value={runDetail?.run.id || ""}
                        onChange={(event) => void loadRun(event.target.value)}
                        className="h-7 rounded-lg border border-gray-200 bg-gray-50 px-2 text-[10px] text-gray-600 outline-none transition-colors hover:bg-gray-100"
                      >
                        {runs.map((run) => (
                          <option key={run.id} value={run.id}>
                            {formatDate(run.completed_at || run.created_at)}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <Button type="button" variant="outline" size="sm" className="h-7 gap-1 rounded-lg px-2 text-[10px]" disabled={!redlineableFindings.length || redlining} onClick={() => void handleCreateRedline()}>
                      {redlining ? <Loader2 className="h-3 w-3 animate-spin" /> : <Edit3 className="h-3 w-3" />}
                      Redline
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-7 gap-1 rounded-lg px-2 text-[10px]" disabled={!findings.length || exporting} onClick={() => void exportFindings()}>
                      {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                      Export
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {([
                    ["all", "All"],
                    ["needs_review", "Needs review"],
                    ["not_acceptable", "Unacceptable"],
                    ["acceptable", "Acceptable"],
                    ["not_applicable", "N/A"],
                  ] as Array<[string, string]>).map(([status, label]) => {
                    const count = status === "all" ? findings.length : counts[status as PlaybookStatus] || 0;
                    const active = findingFilter === status;
                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setFindingFilter(findingFilter === status ? "all" : status as PlaybookStatus | "all")}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-all ${
                          active
                            ? "bg-gray-900 text-white shadow-sm"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                        }`}
                      >
                        {label} <span className={active ? "text-white/60" : "text-gray-400"}>{count}</span>
                      </button>
                    );
                  })}
                  <div className="relative ml-auto">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
                    <input
                      value={findingSearch}
                      onChange={(event) => setFindingSearch(event.target.value)}
                      placeholder="Search findings…"
                      className="h-7 w-40 rounded-lg border border-gray-200 bg-gray-50 pl-7 pr-2.5 text-[10px] text-gray-600 outline-none transition-colors placeholder:text-gray-400 hover:bg-gray-100 focus:border-gray-300"
                    />
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-hidden">
                {activeViewContractId ? (
                  <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between bg-gray-50/80 px-4 py-1.5 shrink-0 backdrop-blur">
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-gray-600">
                        <FileText className="h-3.5 w-3.5 text-gray-400" />
                        {documentsById.get(activeViewContractId)?.contract_name || "Contract PDF"}
                      </span>
                      <button
                        type="button"
                        className="rounded-md px-2 py-0.5 text-[10px] text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
                        onClick={() => setActiveViewContractId("")}
                      >
                        Close
                      </button>
                    </div>
                    <div className="flex-1 overflow-auto">
                      <PDFViewerDynamic
                        key={activeViewContractId}
                        contractId={activeViewContractId}
                        searchKey=""
                        searchValue=""
                        token={token ?? ""}
                      />
                    </div>
                    {runDetail ? (
                      <div className="shrink-0 border-t border-gray-100 bg-gray-50/50 px-4 py-2">
                        <div className="flex items-center gap-4 text-[10px]">
                          <span className="font-medium text-gray-500">Risk summary</span>
                          {([
                            ["acceptable", counts.acceptable, "text-emerald-600"],
                            ["needs_review", counts.needs_review, "text-amber-600"],
                            ["not_acceptable", counts.not_acceptable, "text-red-600"],
                            ["not_applicable", counts.not_applicable, "text-gray-400"],
                          ] as Array<[PlaybookStatus, number, string]>).map(([s, c, color]) => (
                            <span key={s} className={`flex items-center gap-1 ${color}`}>
                              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-current" />
                              {STATUS_META[s].label} <span className="font-medium tabular-nums">{c}</span>
                            </span>
                          ))}
                          <span className="ml-auto text-gray-400">{findings.length} total</span>
                        </div>
                      </div>
                    ) : null}
                    {groupedFindings.length > 0 ? (
                      <div className="max-h-[45%] shrink-0 overflow-auto border-t border-gray-100">
                        {groupedFindings.map((group) => {
                          const meta = STATUS_META[group.status];
                          const StatusIcon = meta.icon;
                          return (
                            <section key={group.status} className="border-b border-gray-50 last:border-0">
                              <div className="sticky top-0 z-10 flex items-center gap-2 bg-gray-50/80 px-4 py-1.5 backdrop-blur">
                                <StatusIcon className="h-3 w-3 text-gray-500" />
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{meta.label}</span>
                                <span className="text-[10px] text-gray-400">{group.findings.length}</span>
                              </div>
                              {group.findings.map((finding) => {
                                const status = findingStatus(finding);
                                const expanded = findingsExpandedMap[finding.id] ?? false;
                                return (
                                  <article key={finding.id} className="cursor-pointer px-4 py-2 transition-colors hover:bg-gray-50" onClick={() => setFindingsExpandedMap((c) => ({ ...c, [finding.id]: !c[finding.id] }))}>
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                          <span className={`inline-flex h-1.5 w-1.5 shrink-0 rounded-full ${status === "not_acceptable" ? "bg-red-500" : status === "needs_review" ? "bg-amber-500" : status === "acceptable" ? "bg-emerald-500" : "bg-gray-300"}`} />
                                          <span className="text-xs font-medium text-gray-900">{finding.rule_name}</span>
                                          <span className="text-[10px] text-gray-400">{finding.document_name || finding.document_id}</span>
                                          {finding.reviewer_status ? <Badge className="border-gray-150 border bg-white px-1 py-0 text-[9px] text-gray-400">Done</Badge> : null}
                                        </div>
                                        <p className="mt-0.5 line-clamp-1 text-[11px] leading-5 text-gray-500">{finding.clause_summary || finding.reasoning || "No summary"}</p>
                                      </div>
                                      <Button type="button" variant="outline" size="sm" className="h-6 gap-1 rounded-md px-1.5 text-[10px]" onClick={(e) => { e.stopPropagation(); setFindingDraft({ finding, reviewer_status: status, reviewer_notes: finding.reviewer_notes || "", suggested_revision: finding.suggested_revision || "" }); }}>
                                        <Edit3 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                    {expanded ? (
                                      <div className="mt-2 space-y-2 border-t border-gray-50 pt-2">
                                        <p className="text-xs leading-5 text-gray-600">{finding.clause_summary || finding.reasoning}</p>
                                        {finding.guidance ? <p className="text-[10px] text-gray-500">{finding.guidance}</p> : null}
                                        {finding.suggested_revision ? (
                                          <div className="rounded-md border border-amber-100 bg-amber-50/50 px-3 py-2">
                                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Suggestion</p>
                                            <p className="text-xs leading-5 text-gray-800">{finding.suggested_revision}</p>
                                            <div className="mt-2 flex justify-end gap-1.5">
                                              <Button type="button" variant="outline" size="sm" className="h-6 rounded-md px-2 text-[10px]" onClick={(e) => { e.stopPropagation(); void handleFindingAction(finding, "dismiss"); }}>Dismiss</Button>
                                              <Button type="button" size="sm" className="h-6 rounded-md bg-gray-900 px-2 text-[10px] text-white hover:bg-gray-800" onClick={(e) => { e.stopPropagation(); void handleFindingAction(finding, "apply"); }}>Apply</Button>
                                            </div>
                                          </div>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </article>
                                );
                              })}
                            </section>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex h-full flex-col">
                    {!findings.length && !runDetail ? (
                      <div className="flex min-h-full flex-col items-center justify-center px-8 text-center">
                        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100">
                          <Scale className="h-6 w-6 text-gray-400" />
                        </div>
                        <p className="text-sm font-medium text-gray-600">No findings yet</p>
                        <p className="mt-1 text-xs text-gray-400">
                          Select contracts below and rules on the left, then press Run.
                        </p>
                        <div className="mt-6 w-full max-w-xs rounded-xl bg-gray-50 p-4 text-left">
                          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Contracts to review</p>
                          <div className="max-h-36 space-y-0.5 overflow-y-auto">
                            {documents.length ? documents.map((doc) => {
                              const selected = selectedContractIds.includes(doc._id);
                              return (
                                <label key={doc._id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-100">
                                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded transition-colors ${
                                    selected ? "bg-gray-900 text-white" : "bg-white text-transparent ring-1 ring-gray-200"
                                  }`}>
                                    {selected ? <Check className="h-2.5 w-2.5" /> : null}
                                  </span>
                                  <span className="truncate text-xs text-gray-700">{doc.contract_name}</span>
                                  <input type="checkbox" checked={selected} onChange={() => toggleDocument(doc._id)} className="sr-only" />
                                </label>
                              );
                            }) : (
                              <p className="py-3 text-center text-xs text-gray-400">No indexed contracts</p>
                            )}
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="mt-5 h-8 gap-1.5 rounded-lg bg-gray-900 text-xs text-white transition-colors hover:bg-gray-800"
                          disabled={!runReady}
                          onClick={() => void handleRun()}
                        >
                          <Play className="h-3.5 w-3.5" />
                          {runReady ? "Run playbook" : "Select inputs to run"}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex-1 overflow-auto">
                        {groupedFindings.map((group) => {
                          const meta = STATUS_META[group.status];
                          const StatusIcon = meta.icon;
                          return (
                            <section key={group.status} className="border-b border-gray-50 last:border-0">
                              <div className="sticky top-0 z-10 flex items-center gap-2 bg-gray-50/80 px-4 py-1.5 backdrop-blur">
                                <StatusIcon className="h-3 w-3 text-gray-500" />
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{meta.label}</span>
                                <span className="text-[10px] text-gray-400">{group.findings.length}</span>
                              </div>
                              {group.findings.map((finding) => {
                                const status = findingStatus(finding);
                                const expanded = findingsExpandedMap[finding.id] ?? false;
                                return (
                                  <article key={finding.id} className="cursor-pointer px-4 py-2 transition-colors hover:bg-gray-50" onClick={() => setFindingsExpandedMap((c) => ({ ...c, [finding.id]: !c[finding.id] }))}>
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                          <span className={`inline-flex h-1.5 w-1.5 shrink-0 rounded-full ${status === "not_acceptable" ? "bg-red-500" : status === "needs_review" ? "bg-amber-500" : status === "acceptable" ? "bg-emerald-500" : "bg-gray-300"}`} />
                                          <span className="text-xs font-medium text-gray-900">{finding.rule_name}</span>
                                          <span className="text-[10px] text-gray-400">{finding.document_name || finding.document_id}</span>
                                          {finding.reviewer_status ? <Badge className="border-gray-150 border bg-white px-1 py-0 text-[9px] text-gray-400">Done</Badge> : null}
                                        </div>
                                        <p className="mt-0.5 line-clamp-1 text-[11px] leading-5 text-gray-500">{finding.clause_summary || finding.reasoning || "No summary"}</p>
                                      </div>
                                      <Button type="button" variant="outline" size="sm" className="h-6 gap-1 rounded-md px-1.5 text-[10px]" onClick={(e) => { e.stopPropagation(); setFindingDraft({ finding, reviewer_status: status, reviewer_notes: finding.reviewer_notes || "", suggested_revision: finding.suggested_revision || "" }); }}>
                                        <Edit3 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                    {expanded ? (
                                      <div className="mt-2 space-y-2 border-t border-gray-50 pt-2">
                                        <p className="text-xs leading-5 text-gray-600">{finding.clause_summary || finding.reasoning}</p>
                                        {finding.guidance ? <p className="text-[10px] text-gray-500">{finding.guidance}</p> : null}
                                        {finding.suggested_revision ? (
                                          <div className="rounded-md border border-amber-100 bg-amber-50/50 px-3 py-2">
                                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Suggestion</p>
                                            <p className="text-xs leading-5 text-gray-800">{finding.suggested_revision}</p>
                                            <div className="mt-2 flex justify-end gap-1.5">
                                              <Button type="button" variant="outline" size="sm" className="h-6 rounded-md px-2 text-[10px]" onClick={(e) => { e.stopPropagation(); void handleFindingAction(finding, "dismiss"); }}>Dismiss</Button>
                                              <Button type="button" size="sm" className="h-6 rounded-md bg-gray-900 px-2 text-[10px] text-white hover:bg-gray-800" onClick={(e) => { e.stopPropagation(); void handleFindingAction(finding, "apply"); }}>Apply</Button>
                                            </div>
                                          </div>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </article>
                                );
                              })}
                            </section>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

      <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl font-medium">{editingRuleIndex === null ? "Add Rule" : "Edit Rule"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Input value={ruleDraft.name} onChange={(event) => setRuleDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="Rule name" className="h-10 rounded-lg" />
              <Input value={ruleDraft.clause_type} onChange={(event) => setRuleDraft((draft) => ({ ...draft, clause_type: event.target.value }))} placeholder="Clause type" className="h-10 rounded-lg" />
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_150px]">
              <Input value={ruleDraft.tags} onChange={(event) => setRuleDraft((draft) => ({ ...draft, tags: event.target.value }))} placeholder="Tags, one per line or short label" className="h-10 rounded-lg" />
              <select
                value={ruleDraft.severity}
                onChange={(event) => setRuleDraft((draft) => ({ ...draft, severity: event.target.value as PlaybookSeverity }))}
                className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={ruleDraft.required_clause}
                onChange={(event) => setRuleDraft((draft) => ({ ...draft, required_clause: event.target.checked }))}
                className="h-4 w-4 rounded border-gray-300"
              />
              Required clause
            </label>
            <Textarea value={ruleDraft.description} onChange={(event) => setRuleDraft((draft) => ({ ...draft, description: event.target.value }))} placeholder="Rule description" className="min-h-16 rounded-lg" />
            <Textarea value={ruleDraft.standard_position} onChange={(event) => setRuleDraft((draft) => ({ ...draft, standard_position: event.target.value }))} placeholder="Standard position" className="min-h-20 rounded-lg" />
            <Textarea value={ruleDraft.fallback_positions} onChange={(event) => setRuleDraft((draft) => ({ ...draft, fallback_positions: event.target.value }))} placeholder="Fallback positions, one per line" className="min-h-20 rounded-lg" />
            <Textarea value={ruleDraft.unacceptable_deviations} onChange={(event) => setRuleDraft((draft) => ({ ...draft, unacceptable_deviations: event.target.value }))} placeholder="Unacceptable deviations or red flags, one per line" className="min-h-20 rounded-lg" />
            <Textarea value={ruleDraft.guidance} onChange={(event) => setRuleDraft((draft) => ({ ...draft, guidance: event.target.value }))} placeholder="Reviewer guidance" className="min-h-20 rounded-lg" />
            <Textarea value={ruleDraft.suggested_language} onChange={(event) => setRuleDraft((draft) => ({ ...draft, suggested_language: event.target.value }))} placeholder="Suggested language" className="min-h-20 rounded-lg" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-lg" onClick={() => setRuleDialogOpen(false)}>Cancel</Button>
            <Button type="button" className="rounded-lg bg-gray-950 text-white hover:bg-gray-800" onClick={saveRuleDraft}>
              <Save className="h-4 w-4" />
              Save Rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(findingDraft)} onOpenChange={(open) => !open && setFindingDraft(null)}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl font-medium">Review Finding</DialogTitle>
          </DialogHeader>
          {findingDraft ? (
            <div className="grid gap-3">
              <select
                value={findingDraft.reviewer_status}
                onChange={(event) => setFindingDraft((draft) => draft ? { ...draft, reviewer_status: event.target.value as PlaybookStatus } : draft)}
                className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none"
              >
                <option value="acceptable">Acceptable</option>
                <option value="needs_review">Needs review</option>
                <option value="not_acceptable">Not acceptable</option>
                <option value="not_applicable">Not applicable</option>
              </select>
              <Textarea
                value={findingDraft.reviewer_notes}
                onChange={(event) => setFindingDraft((draft) => draft ? { ...draft, reviewer_notes: event.target.value } : draft)}
                placeholder="Reviewer notes"
                className="min-h-24 rounded-lg"
              />
              <Textarea
                value={findingDraft.suggested_revision}
                onChange={(event) => setFindingDraft((draft) => draft ? { ...draft, suggested_revision: event.target.value } : draft)}
                placeholder="Suggested revision"
                className="min-h-32 rounded-lg"
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-lg" onClick={() => setFindingDraft(null)}>Cancel</Button>
            <Button type="button" className="rounded-lg bg-gray-950 text-white hover:bg-gray-800" onClick={() => void saveFindingDraft()}>
              <Save className="h-4 w-4" />
              Save Finding
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {running ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-sm">
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
            <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-gray-950" />
            <p className="text-center font-serif text-lg font-medium text-gray-900">Running playbook</p>
            <p className="mt-2 text-center text-sm text-gray-500">Reviewing rules against selected contracts…</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default function PlaybookDetailPage() {
  return (
    <Suspense fallback={<LoadingScreen message="Loading playbook..." />}>
      <PlaybookDetailContent />
    </Suspense>
  );
}
