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
    <main className="flex min-h-screen flex-col bg-white pt-16 text-gray-950">
      <div className="flex min-h-16 items-center gap-3 border-b border-gray-200 px-4 py-3 md:px-8">
        <Link href="/playbooks" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-950">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <BookOpen className="h-4 w-4 shrink-0 text-gray-400" />
            <h1 className="truncate font-serif text-2xl font-medium text-gray-900">{playbook.title}</h1>
            <Badge className={`hidden border px-2 py-0.5 text-xs sm:inline-flex ${
              visibility === "project" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-600"
            }`}>
              {availabilityLabel}
            </Badge>
            <Badge className={`hidden border px-2 py-0.5 text-xs sm:inline-flex ${
              dirty ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}>
              {dirty ? "Unsaved" : "Saved"}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-gray-500">
            {playbook.contract_type || "General contract"} · {completeRuleCount}/{rules.length} complete rules · {selectedContractIds.length} inputs selected
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="hidden h-8 gap-1.5 rounded-lg text-xs md:inline-flex"
          onClick={() => void loadPage()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="hidden h-8 gap-1.5 rounded-lg text-xs lg:inline-flex"
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
          className="h-8 gap-1.5 rounded-lg bg-gray-950 text-xs text-white hover:bg-gray-800"
          disabled={running || saving || !runReady}
          onClick={() => void handleRun()}
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Run
        </Button>
      </div>

      <div className="grid flex-1 gap-0 lg:grid-cols-[380px_1fr]">
        <aside className="border-b border-gray-200 bg-gray-50/60 px-4 py-4 lg:border-b-0 lg:border-r lg:px-5">
          <section className="space-y-3">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} className="h-9 rounded-lg bg-white" />
            <Input value={contractType} onChange={(event) => setContractType(event.target.value)} placeholder="Contract type" className="h-9 rounded-lg bg-white" />
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Description or review posture"
              className="min-h-20 rounded-lg bg-white text-sm"
            />
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Availability</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">{visibility === "project" ? "Project playbook" : "Private playbook"}</p>
                </div>
                <Badge className={`border px-2 py-0.5 text-xs ${
                  visibility === "project" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-gray-200 bg-gray-50 text-gray-600"
                }`}>
                  {visibility === "project" ? "Project" : "Private"}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["private", "Private"],
                  ["project", "Project"],
                ] as Array<["private" | "project", string]>).map(([item, label]) => {
                  const disabled = item === "project" && !playbook.project_id;
                  return (
                    <button
                      key={item}
                      type="button"
                      disabled={disabled}
                      onClick={() => setVisibility(item)}
                      className={`h-9 rounded-lg border text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        visibility === item ? "border-gray-950 bg-gray-950 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Rules</h2>
              <Button type="button" size="sm" variant="outline" className="h-7 gap-1 rounded-lg px-2 text-xs" onClick={() => openRuleDialog()}>
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                value={ruleSearch}
                onChange={(event) => setRuleSearch(event.target.value)}
                placeholder="Search rules..."
                className="h-8 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-gray-300"
              />
            </div>
            <div className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
              {filteredRules.length ? filteredRules.map((rule) => {
                const selected = Boolean(rule.rule_id && selectedRuleIds.includes(rule.rule_id));
                const active = Boolean(rule.rule_id && (rule.rule_id === activeRule?.rule_id));
                return (
                  <div
                    key={rule.rule_id || `${rule.name}-${rule.index}`}
                    className={`rounded-lg border bg-white p-3 transition-colors ${
                      active ? "border-gray-950 shadow-sm" : "border-gray-200 hover:border-gray-300"
                    }`}
                    onClick={() => setActiveRuleId(rule.rule_id || null)}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => toggleRule(rule.rule_id)}
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          selected ? "border-gray-950 bg-gray-950 text-white" : "border-gray-200 bg-white"
                        }`}
                        aria-label={`Select ${rule.name}`}
                      >
                        {selected ? <Check className="h-3 w-3" /> : null}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-gray-900">{rule.name}</span>
                          <Badge className={`shrink-0 border px-1.5 py-0 text-[10px] uppercase ${SEVERITY_CLASS[rule.severity || "medium"]}`}>
                            {rule.severity || "medium"}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">{rule.clause_type}</p>
                        <p className="mt-2 line-clamp-3 text-xs leading-5 text-gray-600">{rule.standard_position || rule.guidance || "No standard position set"}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end gap-1">
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-900"
                        onClick={() => openRuleDialog(rule)}
                        aria-label={`Edit ${rule.name}`}
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-300 hover:bg-red-50 hover:text-red-600"
                        onClick={() => deleteRule(rule)}
                        aria-label={`Delete ${rule.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              }) : (
                <div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-8 text-center text-sm text-gray-400">
                  No rules match this search.
                </div>
              )}
            </div>
          </section>
        </aside>

        <section className="min-w-0 px-4 py-4 md:px-8">
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                <FileText className="h-3.5 w-3.5" />
                Source
              </div>
              <p className="mt-2 truncate text-sm font-semibold text-gray-900">{playbook.reference_document_id ? referenceDocumentName : "Manual rule set"}</p>
              <p className="mt-0.5 text-xs text-gray-500">{playbook.reference_document_id ? "Reference document" : "No source document"}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                <BookOpen className="h-3.5 w-3.5" />
                Rules
              </div>
              <p className="mt-2 text-sm font-semibold text-gray-900">{completeRuleCount}/{rules.length} complete</p>
              <p className="mt-0.5 text-xs text-gray-500">{actionableRuleCount} with fallback, red flag, or guidance</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Inputs
              </div>
              <p className="mt-2 text-sm font-semibold text-gray-900">{selectedContractIds.length}/{documents.length} selected</p>
              <p className="mt-0.5 truncate text-xs text-gray-500">{selectedContracts[0]?.contract_name || "No contract selected"}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                <Scale className="h-3.5 w-3.5" />
                Latest Review
              </div>
              <p className="mt-2 text-sm font-semibold text-gray-900">{runDetail ? `${latestRunTotal} findings` : "Not run"}</p>
              <p className="mt-0.5 text-xs text-gray-500">{runDetail?.run ? formatDate(runDetail.run.completed_at || runDetail.run.updated_at) : runReady ? "Ready" : "Needs input"}</p>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_430px]">
            <div className="min-w-0 rounded-lg border border-gray-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Reference document</p>
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                    <span className="truncate text-sm font-semibold text-gray-900">{referenceDocumentName}</span>
                  </div>
                </div>
                {playbook.reference_document_id ? (
                  <Link
                    href={`/contracts/${playbook.reference_document_id}`}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-950"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open
                  </Link>
                ) : null}
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[980px] border-collapse text-left text-xs">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      {["Rule Name", "Standard Position", "Fall Backs", "Unacceptable Position", "Approval Guide / Guidance", "Sample Standard Language"].map((heading) => (
                        <th key={heading} className="border-b border-gray-100 px-3 py-2 font-medium">{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rules.length ? rules.slice(0, 12).map((rule) => (
                      <tr
                        key={rule.rule_id || `${rule.name}-${rule.index}`}
                        className={`cursor-pointer align-top hover:bg-gray-50 ${rule.rule_id === activeRule?.rule_id ? "bg-gray-50" : ""}`}
                        onClick={() => setActiveRuleId(rule.rule_id || null)}
                      >
                        <td className="w-44 border-b border-gray-50 px-3 py-3 font-medium text-gray-900">{rule.name}</td>
                        <td className="w-56 border-b border-gray-50 px-3 py-3 leading-5 text-gray-700">{rule.standard_position || "-"}</td>
                        <td className="w-52 border-b border-gray-50 px-3 py-3 leading-5 text-gray-700">{(rule.fallback_positions || []).join("; ") || "-"}</td>
                        <td className="w-52 border-b border-gray-50 px-3 py-3 leading-5 text-gray-700">{(rule.unacceptable_deviations || []).join("; ") || "-"}</td>
                        <td className="w-56 border-b border-gray-50 px-3 py-3 leading-5 text-gray-700">{rule.guidance || "-"}</td>
                        <td className="w-56 border-b border-gray-50 px-3 py-3 leading-5 text-gray-700">{rule.suggested_language || "-"}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={6} className="px-3 py-12 text-center text-sm text-gray-400">Add a rule to build the playbook table.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{activeRule ? "Edit rule" : "New rule"}</p>
                  <h2 className="mt-1 text-sm font-semibold text-gray-900">{activeRule?.name || "No rule selected"}</h2>
                </div>
                <Button type="button" size="sm" variant="outline" className="h-8 gap-1 rounded-lg px-2 text-xs" onClick={() => openRuleDialog()}>
                  <Plus className="h-3.5 w-3.5" />
                  New rule
                </Button>
              </div>

              {activeRule ? (
                <div className="max-h-[640px] space-y-3 overflow-y-auto px-4 py-4">
                  <Input
                    value={activeRule.name}
                    onChange={(event) => updateRuleAt(activeRuleIndex, { name: event.target.value })}
                    placeholder="Rule name"
                    className="h-9 rounded-lg"
                  />
                  <Input
                    value={activeRule.clause_type}
                    onChange={(event) => updateRuleAt(activeRuleIndex, { clause_type: event.target.value })}
                    placeholder="Clause type"
                    className="h-9 rounded-lg"
                  />
                  <Textarea
                    value={activeRule.standard_position || ""}
                    onChange={(event) => updateRuleAt(activeRuleIndex, { standard_position: event.target.value })}
                    placeholder="Standard position"
                    className="min-h-20 rounded-lg text-sm"
                  />
                  <div>
                    <Textarea
                      value={joinLines(activeRule.fallback_positions)}
                      onChange={(event) => updateRuleAt(activeRuleIndex, { fallback_positions: splitLines(event.target.value) })}
                      placeholder="Fallback positions"
                      className="min-h-20 rounded-lg text-sm"
                    />
                    <button
                      type="button"
                      className="mt-2 text-xs font-medium text-gray-500 hover:text-gray-950"
                      onClick={() => appendRuleLine(activeRuleIndex, "fallback_positions")}
                    >
                      + Add fallback position
                    </button>
                  </div>
                  <div>
                    <Textarea
                      value={joinLines(activeRule.unacceptable_deviations)}
                      onChange={(event) => updateRuleAt(activeRuleIndex, { unacceptable_deviations: splitLines(event.target.value) })}
                      placeholder="Unacceptable positions"
                      className="min-h-20 rounded-lg text-sm"
                    />
                    <button
                      type="button"
                      className="mt-2 text-xs font-medium text-gray-500 hover:text-gray-950"
                      onClick={() => appendRuleLine(activeRuleIndex, "unacceptable_deviations")}
                    >
                      + Add unacceptable position
                    </button>
                  </div>
                  <Textarea
                    value={activeRule.guidance || ""}
                    onChange={(event) => updateRuleAt(activeRuleIndex, { guidance: event.target.value })}
                    placeholder="Guidance"
                    className="min-h-24 rounded-lg text-sm"
                  />
                  <label className="flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={activeRule.required_clause}
                      onChange={(event) => updateRuleAt(activeRuleIndex, { required_clause: event.target.checked })}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300"
                    />
                    <span>
                      <span className="block font-medium text-gray-800">Required clause</span>
                      <span className="mt-0.5 block text-xs text-gray-500">If the clause does not exist, mark as not acceptable.</span>
                    </span>
                  </label>
                  <Textarea
                    value={activeRule.suggested_language || ""}
                    onChange={(event) => updateRuleAt(activeRuleIndex, { suggested_language: event.target.value })}
                    placeholder="Sample standard language"
                    className="min-h-24 rounded-lg text-sm"
                  />
                  <Button type="button" className="h-9 w-full rounded-lg bg-gray-950 text-white hover:bg-gray-800" disabled={!dirty || saving} onClick={() => void handleSave()}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save
                  </Button>
                </div>
              ) : (
                <div className="flex min-h-80 flex-col items-center justify-center px-6 text-center">
                  <BookOpen className="mb-4 h-8 w-8 text-gray-300" />
                  <p className="font-serif text-2xl font-medium text-gray-900">No rules yet</p>
                  <Button type="button" size="sm" className="mt-4 h-8 gap-1 rounded-lg bg-gray-950 text-xs text-white hover:bg-gray-800" onClick={() => openRuleDialog()}>
                    <Plus className="h-3.5 w-3.5" />
                    Add rule
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            {([
              ["acceptable", counts.acceptable],
              ["needs_review", counts.needs_review],
              ["not_acceptable", counts.not_acceptable],
              ["not_applicable", counts.not_applicable],
            ] as Array<[PlaybookStatus, number]>).map(([status, count]) => {
              const meta = STATUS_META[status];
              const Icon = meta.icon;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => setFindingFilter(findingFilter === status ? "all" : status)}
                  className={`flex min-h-16 items-center gap-3 rounded-lg border px-3 text-left transition-colors ${
                    findingFilter === status ? meta.className : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>
                    <span className="block text-lg font-semibold leading-none">{count}</span>
                    <span className="mt-1 block text-xs">{meta.label}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[360px_1fr]">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">Run Setup</h2>
                <button
                  type="button"
                  className="text-xs font-medium text-gray-500 hover:text-gray-900"
                  onClick={() => {
                    if (allRulesSelected) setSelectedRuleIds([]);
                    else setSelectedRuleIds(rules.map((rule) => rule.rule_id).filter(Boolean) as string[]);
                  }}
                >
                  {allRulesSelected ? "Clear rules" : "All rules"}
                </button>
              </div>
              <div className="space-y-3">
                <Input
                  value={representingParty}
                  onChange={(event) => setRepresentingParty(event.target.value)}
                  placeholder="Representing party"
                  className="h-9 rounded-lg"
                />
                <Input
                  value={paperType}
                  onChange={(event) => setPaperType(event.target.value)}
                  placeholder="Paper type, e.g. counterparty paper"
                  className="h-9 rounded-lg"
                />
                <Textarea
                  value={additionalContext}
                  onChange={(event) => setAdditionalContext(event.target.value)}
                  placeholder="Deal context, negotiation posture, or special instructions"
                  className="min-h-20 rounded-lg text-sm"
                />
              </div>

              <div className="mt-5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Contracts</h3>
                <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-100">
                  {documents.length ? documents.map((document) => {
                    const selected = selectedContractIds.includes(document._id);
                    return (
                      <button
                        key={document._id}
                        type="button"
                        onClick={() => toggleDocument(document._id)}
                        className="flex w-full items-start gap-3 border-b border-gray-50 px-3 py-2 text-left last:border-0 hover:bg-gray-50"
                      >
                        <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          selected ? "border-gray-950 bg-gray-950 text-white" : "border-gray-200 bg-white"
                        }`}>
                          {selected ? <Check className="h-3 w-3" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-gray-800">{document.contract_name}</span>
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-gray-400">
                            <FileText className="h-3.5 w-3.5" />
                            {document.status}
                          </span>
                        </span>
                      </button>
                    );
                  }) : (
                    <div className="px-3 py-8 text-center text-sm text-gray-400">No indexed contracts found</div>
                  )}
                </div>
              </div>

              <div className="mt-5 border-t border-gray-100 pt-4 text-xs text-gray-500">
                <div className="flex justify-between">
                  <span>Selected contracts</span>
                  <span>{selectedContractIds.length}</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span>Selected rules</span>
                  <span>{selectedRuleIds.length}</span>
                </div>
                {runDetail?.run ? (
                  <div className="mt-1 flex justify-between">
                    <span>Latest run</span>
                    <span>{formatDate(runDetail.run.completed_at || runDetail.run.updated_at)}</span>
                  </div>
                ) : null}
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <div className="flex justify-between">
                    <span>Run status</span>
                    <span className={runReady ? "font-medium text-emerald-700" : "font-medium text-amber-700"}>
                      {runReady ? "Ready" : "Needs input"}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span>Rules</span>
                    <span className={selectedRuleIds.length ? "text-gray-700" : "text-amber-700"}>
                      {selectedRuleIds.length ? `${selectedRuleIds.length} selected` : "Missing"}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span>Contracts</span>
                    <span className={selectedContractIds.length ? "text-gray-700" : "text-amber-700"}>
                      {selectedContractIds.length ? `${selectedContractIds.length} selected` : "Missing"}
                    </span>
                  </div>
                  {dirty ? (
                    <div className="mt-1 flex justify-between">
                      <span>Changes</span>
                      <span className="text-amber-700">Will save before run</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="min-w-0 rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-100 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-gray-900">{playbook.title}</h2>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {runDetail ? `${filteredFindings.length} shown from ${findings.length} total` : "Run a playbook to create findings"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {runs.length ? (
                      <select
                        value={runDetail?.run.id || ""}
                        onChange={(event) => void loadRun(event.target.value)}
                        className="h-8 max-w-56 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none"
                      >
                        {runs.map((run) => (
                          <option key={run.id} value={run.id}>
                            {formatDate(run.completed_at || run.created_at)} · {run.summary?.total || 0} findings
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 rounded-lg px-2 text-xs"
                      disabled={!redlineableFindings.length || redlining}
                      onClick={() => void handleCreateRedline()}
                    >
                      {redlining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Edit3 className="h-3.5 w-3.5" />}
                      Create redline
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 rounded-lg px-2 text-xs"
                      disabled={!findings.length || exporting}
                      onClick={() => void exportFindings()}
                    >
                      {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      Export
                    </Button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {([
                    ["all", "All"],
                    ["redlines", "Redlines only"],
                    ["unreviewed", "Unreviewed rules"],
                  ] as Array<[FindingView, string]>).map(([view, label]) => (
                    <button
                      key={view}
                      type="button"
                      onClick={() => setFindingView(view)}
                      className={`h-8 rounded-lg px-3 text-xs font-medium transition-colors ${
                        findingView === view ? "bg-gray-950 text-white" : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <div className="relative ml-auto min-w-52 flex-1 sm:flex-none">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                    <input
                      value={findingSearch}
                      onChange={(event) => setFindingSearch(event.target.value)}
                      placeholder="Search rules..."
                      className="h-8 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-gray-300"
                    />
                  </div>
                </div>
                {redlineArtifacts.length ? (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                    {redlineArtifacts.map((artifact) => (
                      <button
                        key={artifact.redline_id}
                        type="button"
                        className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                        onClick={() => void downloadRedlineArtifact(artifact)}
                      >
                        <Download className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{artifact.filename}</span>
                        <span className="shrink-0 text-emerald-600">· {artifact.applied_count} edits</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="max-h-[72vh] overflow-y-auto">
                {groupedFindings.length ? groupedFindings.map((group) => {
                  const meta = STATUS_META[group.status];
                  const StatusIcon = meta.icon;
                  const reviewed = group.findings.filter((finding) => finding.reviewer_status).length;
                  const countLabel = group.status === "acceptable" ? `${group.findings.length}` : `${reviewed}/${group.findings.length}`;
                  return (
                    <section key={group.status} className="border-b border-gray-100 last:border-0">
                      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-50 bg-white px-4 py-3">
                        <div className="flex items-center gap-2">
                          <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                          <StatusIcon className="h-3.5 w-3.5 text-gray-500" />
                          <span className="text-sm font-semibold text-gray-900">{meta.label}</span>
                        </div>
                        <span className="text-xs font-medium text-gray-500">{countLabel}</span>
                      </div>

                      <div className="divide-y divide-gray-50">
                        {group.findings.map((finding) => {
                          const status = findingStatus(finding);
                          const effectiveMeta = STATUS_META[status];
                          return (
                            <article key={finding.id} className="px-4 py-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className={`inline-flex h-2 w-2 rounded-full ${status === "not_acceptable" ? "bg-red-500" : status === "needs_review" ? "bg-amber-500" : status === "acceptable" ? "bg-emerald-500" : "bg-gray-400"}`} />
                                    <h3 className="truncate text-sm font-semibold text-gray-900">{finding.rule_name}</h3>
                                    <Badge className={`border px-1.5 py-0 text-[10px] uppercase ${SEVERITY_CLASS[finding.severity || "medium"]}`}>
                                      {finding.severity || "medium"}
                                    </Badge>
                                    {finding.reviewer_status ? <Badge className="border border-gray-200 bg-white px-1.5 py-0 text-[10px] text-gray-500">Reviewed</Badge> : null}
                                  </div>
                                  <p className="mt-1 text-xs text-gray-500">
                                    {finding.document_name || documentsById.get(finding.document_id)?.contract_name || finding.document_id} · {finding.clause_type} · confidence {confidenceLabel(finding.confidence)}
                                  </p>
                                </div>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 gap-1 rounded-lg px-2 text-xs"
                                  onClick={() =>
                                    setFindingDraft({
                                      finding,
                                      reviewer_status: status,
                                      reviewer_notes: finding.reviewer_notes || "",
                                      suggested_revision: finding.suggested_revision || "",
                                    })
                                  }
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                  Review
                                </Button>
                              </div>

                              <p className="mt-3 text-sm leading-6 text-gray-700">{finding.clause_summary || finding.reasoning || "No summary provided."}</p>

                              {finding.guidance ? (
                                <p className="mt-2 text-xs leading-5 text-gray-500">{finding.guidance}</p>
                              ) : null}

                              {finding.suggested_revision ? (
                                <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Suggestion</p>
                                    <Badge className={`border px-2 py-0.5 text-xs ${effectiveMeta.className}`}>{effectiveMeta.label}</Badge>
                                  </div>
                                  <p className="mt-2 text-sm leading-6 text-gray-800">{finding.suggested_revision}</p>
                                  <div className="mt-3 flex justify-end gap-2">
                                    <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg px-3 text-xs" onClick={() => void handleFindingAction(finding, "dismiss")}>
                                      Dismiss
                                    </Button>
                                    <Button type="button" size="sm" className="h-8 rounded-lg bg-gray-950 px-3 text-xs text-white hover:bg-gray-800" onClick={() => void handleFindingAction(finding, "apply")}>
                                      Mark applied
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  );
                }) : (
                  <div className="flex min-h-80 flex-col items-center justify-center px-6 text-center">
                    <Scale className="mb-4 h-8 w-8 text-gray-300" />
                    <p className="font-serif text-2xl font-medium text-gray-900">{runDetail ? "No findings in this filter" : "No run yet"}</p>
                    <p className="mt-1 max-w-sm text-sm leading-6 text-gray-500">
                      Select contracts and rules, then run the playbook to classify each clause against your standards.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

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
