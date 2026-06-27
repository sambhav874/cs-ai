"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookOpen,
  Check,
  ClipboardList,
  FileText,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";

import LoadingScreen from "@/components/loader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useAccountContext } from "@/app/context/AccountContext";
import { useBreadcrumbs } from "@/app/context/BreadcrumbContext";
import { useAuth } from "@/hooks/useAuth";
import {
  createPlaybook,
  deletePlaybook,
  generatePlaybookFromContracts,
  listPlaybooks,
  listPlaybookTemplates,
  type Playbook,
  type PlaybookTemplate,
} from "@/lib/playbooks";
import {
  listDocuments,
  listProjects,
  type DocumentSummary,
  type ProjectSummary,
} from "@/lib/tabularReviews";

type CreateMode = "template" | "blank" | "reference";

function isIndexedDocument(document: DocumentSummary) {
  return document.index?.status === "success" || ["Indexed", "Completed", "Ready to Edit"].includes(document.status);
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function sourceLabel(source?: string) {
  if (source === "generated_from_contracts") return "Generated";
  if (source === "manual") return "Manual";
  return source || "Manual";
}

function PlaybooksContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialProjectId = searchParams.get("project_id") || "";
  const initialContractId = searchParams.get("contract_id") || "";
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL ?? "";
  const { isAuthenticated, authenticatedFetch } = useAuth();
  const { selectedAccountId } = useAccountContext();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Playbooks" }]);
  }, [setBreadcrumbs]);

  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [templates, setTemplates] = useState<PlaybookTemplate[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(Boolean(initialContractId));
  const [search, setSearch] = useState("");

  const [mode, setMode] = useState<CreateMode>(initialContractId ? "reference" : "template");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [contractType, setContractType] = useState("Commercial Agreement");
  const [projectId, setProjectId] = useState(initialProjectId);
  const [visibility, setVisibility] = useState<"private" | "project">(initialProjectId ? "project" : "private");
  const [templateId, setTemplateId] = useState("");
  const [standardContractId, setStandardContractId] = useState(initialContractId);
  const [exampleContractIds, setExampleContractIds] = useState<string[]>([]);
  const [riskTolerance, setRiskTolerance] = useState("balanced");

  const loadDocuments = useCallback(
    async (nextProjectId?: string | null) => {
      if (!apiUrl || !isAuthenticated) return;
      try {
        const nextDocuments = await listDocuments(apiUrl, authenticatedFetch, {
          contextId: nextProjectId ? selectedAccountId : null,
          projectId: nextProjectId || null,
        });
        setDocuments(nextDocuments.filter(isIndexedDocument));
      } catch (error) {
        console.error("Failed to load playbook documents", error);
        setDocuments([]);
      }
    },
    [apiUrl, authenticatedFetch, isAuthenticated, selectedAccountId],
  );

  const loadPage = useCallback(async () => {
    if (!apiUrl || !isAuthenticated) return;
    setLoading(true);
    try {
      const [nextPlaybooks, nextTemplates, nextProjects] = await Promise.all([
        listPlaybooks(apiUrl, authenticatedFetch),
        listPlaybookTemplates(apiUrl, authenticatedFetch),
        listProjects(apiUrl, authenticatedFetch, selectedAccountId),
      ]);
      setPlaybooks(nextPlaybooks);
      setTemplates(nextTemplates);
      setProjects(nextProjects);
      if (!templateId && nextTemplates[0]) {
        setTemplateId(nextTemplates[0].id);
        if (!title) {
          setTitle(nextTemplates[0].title);
          setContractType(nextTemplates[0].contract_type || "Commercial Agreement");
          setDescription(nextTemplates[0].description || "");
        }
      }
      await loadDocuments(initialProjectId || null);
    } catch (error) {
      toast({
        title: "Could not load playbooks",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [
    apiUrl,
    authenticatedFetch,
    initialProjectId,
    isAuthenticated,
    loadDocuments,
    selectedAccountId,
    templateId,
    title,
  ]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    if (projectId) {
      setVisibility("project");
      void loadDocuments(projectId);
    } else {
      setVisibility("private");
      void loadDocuments(null);
    }
  }, [projectId, loadDocuments]);

  const filteredPlaybooks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return playbooks.filter((playbook) => {
      if (!q) return true;
      return [
        playbook.title,
        playbook.description || "",
        playbook.contract_type || "",
        sourceLabel(playbook.source),
      ].some((value) => value.toLowerCase().includes(q));
    });
  }, [playbooks, search]);

  const selectedTemplate = templates.find((template) => template.id === templateId);
  const projectById = useMemo(() => new Map(projects.map((project) => [project._id, project])), [projects]);

  function resetCreateForm(nextMode: CreateMode = "template") {
    const template = templates[0];
    setMode(nextMode);
    setTitle(nextMode === "template" && template ? template.title : "");
    setDescription(nextMode === "template" && template ? template.description || "" : "");
    setContractType(nextMode === "template" && template ? template.contract_type || "Commercial Agreement" : "Commercial Agreement");
    setTemplateId(template?.id || "");
    setProjectId(initialProjectId);
    setVisibility(initialProjectId ? "project" : "private");
    setStandardContractId(initialContractId);
    setExampleContractIds([]);
    setRiskTolerance("balanced");
  }

  function toggleExampleDocument(documentId: string) {
    setExampleContractIds((current) =>
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId].slice(0, 10),
    );
  }

  async function handleCreate() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast({ title: "Name the playbook first", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      let playbook: Playbook;
      if (mode === "reference") {
        if (!standardContractId) {
          toast({ title: "Select a reference document", variant: "destructive" });
          return;
        }
        playbook = await generatePlaybookFromContracts(apiUrl, authenticatedFetch, {
          title: trimmedTitle,
          description: description.trim() || null,
          contract_type: contractType.trim() || null,
          project_id: projectId || null,
          standard_contract_id: standardContractId || null,
          example_contract_ids: exampleContractIds.filter((documentId) => documentId !== standardContractId),
          visibility,
          risk_tolerance: riskTolerance,
        });
      } else {
        playbook = await createPlaybook(apiUrl, authenticatedFetch, {
          title: trimmedTitle,
          description: description.trim() || null,
          contract_type: contractType.trim() || null,
          project_id: projectId || null,
          visibility,
          reference_document_id: null,
          reference_document_name: null,
          rules: mode === "template" ? selectedTemplate?.rules || [] : [],
        });
      }

      setCreateOpen(false);
      const query = initialContractId ? `?contract_id=${encodeURIComponent(initialContractId)}` : "";
      router.push(`/playbooks/${playbook.id}${query}`);
    } catch (error) {
      toast({
        title: mode === "reference" ? "Could not create playbook from reference" : "Could not create playbook",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(playbook: Playbook) {
    try {
      await deletePlaybook(apiUrl, authenticatedFetch, playbook.id);
      setPlaybooks((current) => current.filter((item) => item.id !== playbook.id));
      toast({ title: "Playbook deleted" });
    } catch (error) {
      toast({
        title: "Could not delete playbook",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  if (!isAuthenticated || loading) {
    return <LoadingScreen />;
  }

  return (
    <main className="flex min-h-screen flex-col bg-background pt-16 text-foreground">
      <div className="flex flex-col gap-4 md:flex-row md:items-center justify-between p-6 md:p-8 border-b border-border">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-1">
            <span className="truncate">Playbooks</span>
          </div>
          <h1 className="text-3xl font-bold text-foreground">Playbooks</h1>
          {initialContractId ? (
            <p className="mt-1 text-xs text-muted-foreground">Choose or create a playbook to run against the opened contract.</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative hidden sm:block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search playbooks..."
              className="h-9 w-56 rounded-md border border-input bg-transparent pl-8 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
          <Button
            type="button"
            className="h-9 gap-1.5"
            onClick={() => {
              resetCreateForm(initialContractId ? "reference" : "template");
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            New Playbook
          </Button>
        </div>
      </div>

      <div className="border-y border-gray-100 px-4 py-2 sm:hidden">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search playbooks..."
            className="h-8 w-full rounded-lg border border-gray-100 bg-white pl-8 pr-3 text-sm text-gray-700 outline-none placeholder:text-gray-400"
          />
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <div className="min-w-[820px]">
          <div className="grid grid-cols-[1.7fr_150px_120px_120px_150px_80px] border-b border-gray-200 px-4 py-2 text-xs font-medium text-gray-500 md:px-10">
            <div>Name</div>
            <div>Type</div>
            <div>Rules</div>
            <div>Runs</div>
            <div>Updated</div>
            <div />
          </div>

          {filteredPlaybooks.length ? filteredPlaybooks.map((playbook) => {
            const project = playbook.project_id ? projectById.get(playbook.project_id) : null;
            return (
              <div
                key={playbook.id}
                className="grid cursor-pointer grid-cols-[1.7fr_150px_120px_120px_150px_80px] items-center border-b border-gray-50 px-4 py-2 transition-colors hover:bg-gray-50 md:px-10"
                onClick={() => {
                  const query = initialContractId ? `?contract_id=${encodeURIComponent(initialContractId)}` : "";
                  router.push(`/playbooks/${playbook.id}${query}`);
                }}
              >
                <div className="min-w-0 pr-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <BookOpen className="h-4 w-4 shrink-0 text-gray-400" />
                    <span className="truncate text-sm font-medium text-gray-900">{playbook.title}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-400">
                    <span>{sourceLabel(playbook.source)}</span>
                    {playbook.reference_document_name ? <span className="truncate">Reference: {playbook.reference_document_name}</span> : null}
                    {project ? <span className="truncate">Project: {project.name}</span> : <span>Private</span>}
                  </div>
                </div>
                <div className="truncate text-sm text-gray-600">{playbook.contract_type || "-"}</div>
                <div className="text-sm text-gray-600">{playbook.rule_count}</div>
                <div className="text-sm text-gray-600">{playbook.run_count}</div>
                <div className="text-sm text-gray-500">{formatDate(playbook.updated_at)}</div>
                <div className="flex justify-end">
                  {playbook.is_owner !== false ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDelete(playbook);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-gray-300 transition-colors hover:bg-red-50 hover:text-red-600"
                      aria-label={`Delete ${playbook.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          }) : (
            <div className="mx-auto flex max-w-sm flex-col items-start py-24">
              <ClipboardList className="mb-4 h-8 w-8 text-gray-300" />
              <p className="font-serif text-2xl font-medium text-gray-900">No playbooks yet</p>
              <p className="mt-1 text-sm leading-6 text-gray-500">
                Create a reusable rule set to review contracts against your preferred positions, fallbacks, and red flags.
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-4 h-8 gap-1.5 rounded-lg bg-cs-primary text-xs text-white hover:bg-cs-primary/90"
                onClick={() => {
                  resetCreateForm(initialContractId ? "reference" : "template");
                  setCreateOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Create Playbook
              </Button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl font-medium">New Playbook</DialogTitle>
            <p className="mt-1 text-sm text-gray-500">Build a review rule set from a template, a reference document, or from scratch.</p>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-3">
            {[
              { id: "template", label: "Template", description: "Pre-built rule set", icon: ClipboardList },
              { id: "reference", label: "Reference", description: "Generate from contracts", icon: Sparkles },
              { id: "blank", label: "Blank", description: "Start from scratch", icon: BookOpen },
            ].map((item) => {
              const Icon = item.icon;
              const active = mode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMode(item.id as CreateMode)}
                  className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all ${
                    active
                      ? "border-cs-primary bg-gray-50 shadow-sm"
                      : "border-gray-100 bg-white text-gray-500 hover:border-gray-200 hover:text-gray-700"
                  }`}
                >
                  <Icon className={`h-6 w-6 ${active ? "text-gray-950" : ""}`} />
                  <span className={`text-sm font-semibold ${active ? "text-gray-950" : ""}`}>{item.label}</span>
                  <span className="text-xs leading-tight text-gray-400">{item.description}</span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-3">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Playbook name" className="h-10 rounded-lg" />
            <div className="grid gap-3 md:grid-cols-2">
              <Input value={contractType} onChange={(event) => setContractType(event.target.value)} placeholder="Contract type" className="h-10 rounded-lg" />
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none"
              >
                <option value="">Personal playbook</option>
                {projects.map((project) => (
                  <option key={project._id} value={project._id}>{project.name}</option>
                ))}
              </select>
            </div>
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Internal notes (optional)" className="min-h-16 rounded-lg text-sm" />
          </div>

          {mode === "template" ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500">Available templates</p>
              <div className="rounded-lg border border-gray-100">
                {templates.map((template) => {
                  const active = template.id === templateId;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => {
                        setTemplateId(template.id);
                        setTitle(template.title);
                        setDescription(template.description || "");
                        setContractType(template.contract_type || "");
                      }}
                      className={`flex w-full items-start gap-3 border-b border-gray-50 px-4 py-3 text-left last:border-0 transition-colors hover:bg-gray-50 ${
                        active ? "bg-gray-50" : ""
                      }`}
                    >
                      <span className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                        active ? "border-cs-primary bg-cs-primary" : "border-gray-200"
                      }`}>
                        {active ? <Check className="h-2.5 w-2.5 text-white" /> : null}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-gray-900">{template.title}</span>
                        <span className="mt-1 block text-xs leading-5 text-gray-500">{template.description}</span>
                        <span className="mt-1 inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                          {template.rules.length} rules
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {mode === "reference" ? (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-xs font-medium text-gray-500">Reference document</p>
                  <select
                    value={standardContractId}
                    onChange={(event) => setStandardContractId(event.target.value)}
                    className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none"
                  >
                    <option value="">Select reference document…</option>
                    {documents.map((document) => (
                      <option key={document._id} value={document._id}>{document.contract_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-gray-500">Risk tolerance</p>
                  <select
                    value={riskTolerance}
                    onChange={(event) => setRiskTolerance(event.target.value)}
                    className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none"
                  >
                    <option value="balanced">Balanced</option>
                    <option value="conservative">Conservative</option>
                    <option value="commercial">Commercial</option>
                  </select>
                </div>
              </div>
              {documents.length ? (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-gray-500">
                    Example contracts <span className="font-normal text-gray-400">— optional, helps identify fallbacks</span>
                  </p>
                  <div className="max-h-44 overflow-y-auto rounded-lg border border-gray-100">
                    {documents.map((document) => {
                      const isReference = standardContractId === document._id;
                      const checked = isReference || exampleContractIds.includes(document._id);
                      return (
                        <label
                          key={document._id}
                          className={`flex cursor-pointer items-center gap-3 border-b border-gray-50 px-3 py-2.5 text-left last:border-0 hover:bg-gray-50 ${
                            isReference ? "cursor-not-allowed opacity-50" : ""
                          }`}
                        >
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            checked ? "border-cs-primary bg-cs-primary text-white" : "border-gray-200"
                          }`}>
                            {checked ? <Check className="h-3 w-3" /> : null}
                          </span>
                          <div className="min-w-0">
                            <span className="block truncate text-sm text-gray-800">{document.contract_name}</span>
                            <span className="text-xs text-gray-400">
                              {isReference ? "Reference" : exampleContractIds.includes(document._id) ? "Example" : "Click to include"}
                            </span>
                          </div>
                          {!isReference ? (
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleExampleDocument(document._id)}
                              className="sr-only"
                            />
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-6 text-center text-sm text-gray-400">
                  No indexed documents found. Upload contracts first.
                </div>
              )}
            </div>
          ) : null}

          {mode === "blank" ? (
            <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-4 text-sm text-gray-600">
              <p className="font-medium text-gray-900">Start from scratch</p>
              <p className="mt-1">Add rules manually on the next screen. Best when you already know your positions.</p>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} className="rounded-lg">Cancel</Button>
            <Button onClick={() => void handleCreate()} disabled={saving} className="rounded-lg bg-cs-primary text-white hover:bg-cs-primary/90">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {mode === "reference" ? "Generate Rules" : "Create Playbook"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

export default function PlaybooksPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <PlaybooksContent />
    </Suspense>
  );
}
