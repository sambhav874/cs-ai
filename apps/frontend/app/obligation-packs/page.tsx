"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, FileArchive, Loader2, Package, Power, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  PackRejected,
  deleteObligationPack,
  listObligationPacks,
  saveObligationPack,
  setObligationPackEnabled,
  type ObligationPackSummary,
  type PackDraft,
} from "@/lib/obligationPacks";

const FAMILY_ID_PATTERN = /^[a-z][a-z0-9_]{2,48}$/;

const PASTE_FIELDS = [
  {
    key: "taxonomy" as const,
    label: "taxonomy.md",
    required: true,
    hint: "The kinds of duty this family has — especially the ones carrying no number.",
  },
  {
    key: "conventions" as const,
    label: "conventions.md",
    required: true,
    hint: "How this family writes units, rates and party names. Never a currency.",
  },
  {
    key: "sweep" as const,
    label: "sweep.md",
    required: false,
    hint: "Where the parts of one obligation hide in the document.",
  },
  {
    key: "examples" as const,
    label: "examples.md",
    required: false,
    hint: "A few worked clause-to-record shapes.",
  },
];

const MANIFEST_PLACEHOLDER = `display_name: Widget Manufacturing Agreement
match:
  title_patterns: ["widget manufacturing agreement"]
  body_markers: ["widget throughput", "sprocket lane", "first-pass yield"]`;

export default function ObligationPacksPage() {
  const { isAuthenticated, authChecked } = useAuth();
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL || "";

  const [uploaded, setUploaded] = useState<ObligationPackSummary[]>([]);
  const [builtin, setBuiltin] = useState<ObligationPackSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<"upload" | "paste">("upload");
  const [familyId, setFamilyId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<PackDraft>({});
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState<ObligationPackSummary | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!apiUrl) return;
    try {
      const data = await listObligationPacks(apiUrl);
      setUploaded(data.uploaded);
      setBuiltin(data.builtin);
    } catch (error) {
      toast({ title: "Could not load packs", description: String(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    if (authChecked && isAuthenticated) void refresh();
  }, [authChecked, isAuthenticated, refresh]);

  const idError = useMemo(() => {
    if (!familyId) return null;
    if (!FAMILY_ID_PATTERN.test(familyId)) {
      return "Lowercase letters, digits and underscores, 3–49 characters, starting with a letter.";
    }
    if (builtin.some((pack) => pack.family_id === familyId)) {
      return "That is a built-in family and cannot be shadowed — choose another id.";
    }
    return null;
  }, [familyId, builtin]);

  const ready =
    Boolean(familyId) &&
    !idError &&
    !busy &&
    (mode === "upload" ? Boolean(file) : Boolean(draft.taxonomy?.trim() && draft.conventions?.trim()));

  function pickFile(next: File | null) {
    setFile(next);
    setProblems([]);
    setSaved(null);
    if (next && !familyId) {
      const guess = next.name.replace(/\.zip$/i, "").toLowerCase().replace(/[^a-z0-9_]/g, "_");
      if (FAMILY_ID_PATTERN.test(guess)) setFamilyId(guess);
    }
  }

  async function save() {
    setBusy(true);
    setProblems([]);
    setSaved(null);
    try {
      const result = await saveObligationPack(apiUrl, familyId, mode === "upload" ? { file } : draft);
      setSaved(result);
      toast({ title: `Saved ${result.family_id} v${result.version}` });
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      await refresh();
    } catch (error) {
      if (error instanceof PackRejected) {
        setProblems(error.problems);
      } else {
        toast({ title: "Could not save the pack", description: String(error), variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggle(pack: ObligationPackSummary) {
    try {
      await setObligationPackEnabled(apiUrl, pack.family_id, !pack.enabled);
      await refresh();
    } catch (error) {
      toast({ title: "Could not change the pack", description: String(error), variant: "destructive" });
    }
  }

  async function remove(pack: ObligationPackSummary) {
    if (!window.confirm(`Delete ${pack.family_id}? Obligations already extracted keep their stamp.`)) return;
    try {
      await deleteObligationPack(apiUrl, pack.family_id);
      await refresh();
    } catch (error) {
      toast({ title: "Could not delete the pack", description: String(error), variant: "destructive" });
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Package className="h-6 w-6" /> Obligation packs
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          A pack tells the extractor what a kind of contract contains. Packs belong to your account and
          apply automatically: when a contract finishes ingesting, the matching pack is used to extract
          its obligations.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a pack</CardTitle>
          <CardDescription>
            Upload a .zip of the pack files, or paste them. Saving a family id again replaces it and
            bumps the version.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            {(["upload", "paste"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={mode === value ? "default" : "outline"}
                onClick={() => {
                  setMode(value);
                  setProblems([]);
                  setSaved(null);
                }}
              >
                {value === "upload" ? "Upload .zip" : "Paste"}
              </Button>
            ))}
          </div>

          {mode === "upload" ? (
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                pickFile(event.dataTransfer.files?.[0] ?? null);
              }}
              onClick={() => inputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition ${
                dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"
              }`}
            >
              <FileArchive className="h-8 w-8 text-muted-foreground" />
              {file ? (
                <p className="text-sm font-medium">
                  {file.name}{" "}
                  <span className="text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Drop a pack .zip here, or click to choose one
                </p>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="pack-manifest">pack.yaml</Label>
                <textarea
                  id="pack-manifest"
                  className="min-h-24 w-full rounded-md border bg-background p-3 font-mono text-xs"
                  placeholder={MANIFEST_PLACEHOLDER}
                  value={draft.manifest ?? ""}
                  onChange={(event) => setDraft({ ...draft, manifest: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  The <code>match</code> block is how a contract finds this pack. Without it the pack
                  only applies when someone picks it by hand.
                </p>
              </div>
              {PASTE_FIELDS.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={`pack-${field.key}`}>
                    {field.label}
                    {field.required ? null : (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">optional</span>
                    )}
                  </Label>
                  <textarea
                    id={`pack-${field.key}`}
                    className="min-h-28 w-full rounded-md border bg-background p-3 font-mono text-xs"
                    value={draft[field.key] ?? ""}
                    onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">{field.hint}</p>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="family-id">Family id</Label>
            <Input
              id="family-id"
              className="max-w-sm"
              value={familyId}
              placeholder="widget_msa"
              onChange={(event) => setFamilyId(event.target.value.trim())}
            />
            {idError ? <p className="text-xs text-destructive">{idError}</p> : null}
          </div>

          <Button disabled={!ready} onClick={save}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save pack
          </Button>

          {problems.length > 0 ? (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" /> Not saved — {problems.length} problem
                {problems.length === 1 ? "" : "s"}
              </div>
              <ul className="space-y-1 text-xs text-destructive/90">
                {problems.map((problem, index) => (
                  <li key={index} className="whitespace-pre-wrap font-mono leading-relaxed">
                    {problem}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {saved ? (
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400">
              <Check className="h-4 w-4" />
              Saved as {saved.family_id} v{saved.version} — {saved.context_tokens} tokens added to each
              extraction batch for matching contracts.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <PackTable
        title="Your packs"
        description="Shared across your account. Applied automatically to matching contracts."
        packs={uploaded}
        loading={loading}
        emptyText="No packs yet."
        onToggle={toggle}
        onDelete={remove}
      />

      <PackTable
        title="Built-in packs"
        description="Shipped with the product. You can switch one off for your account — turning it back on restores the reviewed version, not a copy."
        packs={builtin}
        loading={loading}
        emptyText="No built-in packs."
        onToggle={toggle}
      />
    </div>
  );
}

function PackTable({
  title,
  description,
  packs,
  loading,
  emptyText,
  onToggle,
  onDelete,
}: {
  title: string;
  description: string;
  packs: ObligationPackSummary[];
  loading: boolean;
  emptyText: string;
  onToggle?: (pack: ObligationPackSummary) => void;
  onDelete?: (pack: ObligationPackSummary) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : packs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="divide-y">
            {packs.map((pack) => (
              <li key={pack.family_id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {pack.display_name}
                    <Badge variant="outline">v{pack.version}</Badge>
                    {pack.enabled ? null : <Badge variant="secondary">off</Badge>}
                  </div>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {pack.family_id}
                    {pack.context_tokens ? ` · ${pack.context_tokens} tokens` : ""}
                    {pack.sections.length ? ` · ${pack.sections.join(", ")}` : ""}
                  </p>
                </div>
                {onToggle ? (
                  <Button variant="ghost" size="sm" onClick={() => onToggle(pack)}>
                    <Power className="mr-1.5 h-4 w-4" />
                    {pack.enabled ? "Disable" : "Enable"}
                  </Button>
                ) : null}
                {onDelete ? (
                  <Button variant="ghost" size="sm" onClick={() => onDelete(pack)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
