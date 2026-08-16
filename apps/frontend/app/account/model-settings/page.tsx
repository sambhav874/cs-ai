"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, RotateCcw, Save, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/apiClient";

const API = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;

interface CatalogModel {
  id: string;
  label: string;
}

interface CatalogProvider {
  id: string;
  label: string;
  models: CatalogModel[];
  /** Whether the server has an API key for this provider. Never a key value. */
  configured: boolean;
}

interface Catalog {
  providers: CatalogProvider[];
  reasoning_efforts: string[];
  temperature_range: [number, number];
  max_tokens_range: [number, number];
}

interface ModelSettings {
  provider?: string;
  models?: Record<string, string>;
  temperature?: number;
  max_tokens?: number;
  reasoning_effort?: string;
}

export default function ModelSettingsPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [settings, setSettings] = useState<ModelSettings>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Writes are admin-only server-side; a 403 on save flips this so the form
  // renders read-only instead of letting a member keep hitting a wall.
  const [isReadOnly, setIsReadOnly] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [catalogRes, settingsRes] = await Promise.all([
        apiFetch(`${API}/api/v1/model-settings/catalog`),
        apiFetch(`${API}/api/v1/model-settings`),
      ]);
      if (!catalogRes.ok) throw new Error("Could not load the model catalog.");
      if (!settingsRes.ok) throw new Error("Could not load your account's model settings.");

      const catalogData: Catalog = await catalogRes.json();
      const settingsData = await settingsRes.json();
      setCatalog(catalogData);
      setSettings(settingsData.settings || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong loading settings.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeProvider = useMemo(
    () => catalog?.providers.find((p) => p.id === settings.provider) ?? null,
    [catalog, settings.provider],
  );

  const selectedModel = settings.provider ? settings.models?.[settings.provider] ?? "" : "";

  const setModelForActiveProvider = (modelId: string) => {
    if (!settings.provider) return;
    setSettings((prev) => ({
      ...prev,
      models: { ...(prev.models || {}), [settings.provider!]: modelId },
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await apiFetch(`${API}/api/v1/model-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.status === 403) {
        setIsReadOnly(true);
        toast({
          title: "Admins only",
          description: "Model settings apply to everyone in the account, so only admins can change them.",
          variant: "destructive",
        });
        return;
      }
      if (!res.ok) throw new Error("Save failed.");
      const data = await res.json();
      // Render what the server stored, not what was typed — it clamps values
      // and drops unknown fields, so echoing the response keeps the form honest.
      setSettings(data.settings || {});
      toast({ title: "Model settings saved", description: "New agent runs will use these settings." });
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

  const handleReset = async () => {
    setSettings({});
    toast({
      title: "Reset to server defaults",
      description: "Save to apply — the account will use whatever the server is configured with.",
    });
  };

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 md:p-8">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6 md:p-8">
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="h-4 w-4 text-destructive" />
              Couldn&apos;t load model settings
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 md:p-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
          <Sparkles className="h-5 w-5 text-muted-foreground" />
          Model settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Applies to everyone in this account. API keys are configured on the server and are never
          entered or shown here.
        </p>
      </div>

      {isReadOnly && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          You have read-only access — only account admins can change model settings.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provider</CardTitle>
          <CardDescription>
            Providers without a key configured on the server can&apos;t be selected.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {catalog?.providers.map((provider) => {
            const isActive = settings.provider === provider.id;
            const disabled = !provider.configured || isReadOnly;
            return (
              <button
                key={provider.id}
                type="button"
                disabled={disabled}
                onClick={() => setSettings((prev) => ({ ...prev, provider: provider.id }))}
                className={[
                  "flex items-center justify-between rounded-lg border p-3 text-left text-sm transition-colors",
                  isActive ? "border-primary bg-primary/5" : "border-border",
                  disabled ? "cursor-not-allowed opacity-50" : "hover:border-primary/60",
                ].join(" ")}
              >
                <span className="font-medium text-foreground">{provider.label}</span>
                {!provider.configured && (
                  <Badge variant="outline" className="text-[10px] font-normal">
                    No key
                  </Badge>
                )}
              </button>
            );
          })}
        </CardContent>
      </Card>

      {activeProvider && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Model</CardTitle>
            <CardDescription>
              Suggestions for {activeProvider.label}. Any model name the provider accepts works —
              type one in if it isn&apos;t listed.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {activeProvider.models.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  disabled={isReadOnly}
                  onClick={() => setModelForActiveProvider(model.id)}
                  className={[
                    "rounded-lg border p-3 text-left text-sm transition-colors",
                    selectedModel === model.id ? "border-primary bg-primary/5" : "border-border",
                    isReadOnly ? "cursor-not-allowed opacity-50" : "hover:border-primary/60",
                  ].join(" ")}
                >
                  <div className="font-medium text-foreground">{model.label}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{model.id}</div>
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="custom-model" className="text-xs">
                Model name
              </Label>
              <Input
                id="custom-model"
                value={selectedModel}
                disabled={isReadOnly}
                placeholder="Leave empty to use the server default"
                onChange={(e) => setModelForActiveProvider(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generation</CardTitle>
          <CardDescription>Leave a field empty to inherit the server default.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="temperature" className="text-xs">
              Temperature ({catalog?.temperature_range[0]}–{catalog?.temperature_range[1]})
            </Label>
            <Input
              id="temperature"
              type="number"
              step="0.1"
              min={catalog?.temperature_range[0]}
              max={catalog?.temperature_range[1]}
              disabled={isReadOnly}
              value={settings.temperature ?? ""}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  temperature: e.target.value === "" ? undefined : Number(e.target.value),
                }))
              }
            />
            <p className="text-[11px] text-muted-foreground">
              Ignored by newer Claude models, which don&apos;t accept a temperature.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="max-tokens" className="text-xs">
              Max output tokens
            </Label>
            <Input
              id="max-tokens"
              type="number"
              min={catalog?.max_tokens_range[0]}
              max={catalog?.max_tokens_range[1]}
              disabled={isReadOnly}
              value={settings.max_tokens ?? ""}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  max_tokens: e.target.value === "" ? undefined : Number(e.target.value),
                }))
              }
            />
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label className="text-xs">Reasoning effort</Label>
            <div className="flex flex-wrap gap-2">
              {catalog?.reasoning_efforts.map((effort) => {
                const isActive = (settings.reasoning_effort ?? "auto") === effort;
                return (
                  <button
                    key={effort}
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => setSettings((prev) => ({ ...prev, reasoning_effort: effort }))}
                    className={[
                      "rounded-md border px-3 py-1.5 text-xs capitalize transition-colors",
                      isActive ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground",
                      isReadOnly ? "cursor-not-allowed opacity-50" : "hover:border-primary/60",
                    ].join(" ")}
                  >
                    {effort}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              &quot;Auto&quot; leaves the decision to the server configuration. Higher effort costs more
              tokens and takes longer.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={handleReset} disabled={isReadOnly || isSaving} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" />
          Reset to defaults
        </Button>
        <Button size="sm" onClick={handleSave} disabled={isReadOnly || isSaving} className="gap-1.5">
          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>
    </div>
  );
}
