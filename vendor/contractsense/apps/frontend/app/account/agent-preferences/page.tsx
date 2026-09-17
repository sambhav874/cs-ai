"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, Save, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/apiClient";
import { useBreadcrumbs } from "@/app/context/BreadcrumbContext";

const API = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;

interface AgentPreferences {
  practice_area?: string;
  jurisdiction?: string;
  citation_style?: string;
  verbosity?: string;
}

const EMPTY: AgentPreferences = {
  practice_area: "",
  jurisdiction: "",
  citation_style: "",
  verbosity: "",
};

export default function AgentPreferencesPage() {
  const [preferences, setPreferences] = useState<AgentPreferences>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Account Settings", href: "/account" },
      { label: "Agent Preferences" },
    ]);
  }, [setBreadcrumbs]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`${API}/preferences`);
      if (!res.ok) throw new Error("Could not load your agent preferences.");
      const data = await res.json();
      setPreferences({ ...EMPTY, ...(data.preferences || {}) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong loading preferences.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await apiFetch(`${API}/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });
      if (!res.ok) throw new Error("Save failed.");
      const data = await res.json();
      // Render what the server stored — it drops blank/unknown fields, so
      // echoing the response keeps the form honest about what will be sent.
      setPreferences({ ...EMPTY, ...(data.preferences || {}) });
      toast({
        title: "Preferences saved",
        description: "The agent will use these to shape its answers on your next question.",
      });
    } catch (err) {
      toast({
        title: "Could not save",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6 md:p-8">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6 md:p-8">
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="h-4 w-4 text-destructive" />
              Couldn&apos;t load agent preferences
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" onClick={load}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6 md:p-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
          <SlidersHorizontal className="h-5 w-5 text-muted-foreground" />
          Agent preferences
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Personal to you — the contract agent reads these on every question to shape how it
          answers. Leave a field empty to skip it.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How you work</CardTitle>
          <CardDescription>
            Sent to the agent as context, never as contract evidence.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="practice-area" className="text-xs">
              Practice area
            </Label>
            <Input
              id="practice-area"
              value={preferences.practice_area ?? ""}
              placeholder="e.g. M&A, real estate, litigation"
              onChange={(e) => setPreferences((prev) => ({ ...prev, practice_area: e.target.value }))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="jurisdiction" className="text-xs">
              Jurisdiction focus
            </Label>
            <Input
              id="jurisdiction"
              value={preferences.jurisdiction ?? ""}
              placeholder="e.g. Delaware, England & Wales"
              onChange={(e) => setPreferences((prev) => ({ ...prev, jurisdiction: e.target.value }))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="citation-style" className="text-xs">
              Citation style
            </Label>
            <Input
              id="citation-style"
              value={preferences.citation_style ?? ""}
              placeholder="e.g. Bluebook, section references"
              onChange={(e) => setPreferences((prev) => ({ ...prev, citation_style: e.target.value }))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="verbosity" className="text-xs">
              Answer verbosity
            </Label>
            <Input
              id="verbosity"
              value={preferences.verbosity ?? ""}
              placeholder="e.g. concise, detailed with caveats"
              onChange={(e) => setPreferences((prev) => ({ ...prev, verbosity: e.target.value }))}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end">
        <Button size="sm" onClick={handleSave} disabled={isSaving} className="gap-1.5">
          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>
    </div>
  );
}
