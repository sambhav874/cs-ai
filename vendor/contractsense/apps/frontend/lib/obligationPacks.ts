"use client";

import { apiFetch } from "@/lib/apiClient";

export interface ObligationPackSummary {
  family_id: string;
  display_name: string;
  version: number;
  fingerprint?: string | null;
  enabled: boolean;
  owner_type: "user" | "team" | "builtin";
  sections: string[];
  context_tokens?: number | null;
  max_context_tokens?: number | null;
  uploaded_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PackValidationResult {
  family_id: string;
  valid: boolean;
  problems: string[];
  fingerprint?: string | null;
  context_tokens?: number | null;
  rendered_preview: string;
}

export interface PackCandidate {
  family_id: string;
  display_name: string;
  origin: "builtin" | "uploaded" | string;
  confidence: number;
  signals: string[];
}

export interface PackResolutionResult {
  title: string;
  characters: number;
  applied: boolean;
  resolved_family: string | null;
  confidence: number;
  reason: string;
  confidence_floor: number;
  candidates: PackCandidate[];
  rendered_preview: string;
}

/** A pack written by hand: the same five files, pasted rather than zipped. */
export interface PackDraft {
  file?: File | null;
  manifest?: string;
  taxonomy?: string;
  conventions?: string;
  sweep?: string;
  examples?: string;
}

export interface PackListResult {
  uploaded: ObligationPackSummary[];
  builtin: ObligationPackSummary[];
}

/**
 * Pack errors are a *list* of problems, not one message: an author fixing a pack
 * needs the whole list, so these calls read the response body themselves rather
 * than collapsing it to a single `detail` string.
 */
export class PackRejected extends Error {
  problems: string[];

  constructor(problems: string[]) {
    super(problems[0] || "Pack rejected");
    this.name = "PackRejected";
    this.problems = problems;
  }
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (response.ok) return body as T;

  const detail = body?.detail;
  if (detail && typeof detail === "object" && Array.isArray(detail.problems)) {
    throw new PackRejected(detail.problems);
  }
  throw new Error(typeof detail === "string" ? detail : `Request failed (${response.status})`);
}

export async function listObligationPacks(apiUrl: string): Promise<PackListResult> {
  return parse<PackListResult>(await apiFetch(`${apiUrl}/obligation-packs`));
}



export async function setObligationPackEnabled(
  apiUrl: string,
  familyId: string,
  enabled: boolean,
): Promise<ObligationPackSummary> {
  return parse<ObligationPackSummary>(
    await apiFetch(`${apiUrl}/obligation-packs/${familyId}?enabled=${enabled}`, { method: "PATCH" }),
  );
}

export async function deleteObligationPack(apiUrl: string, familyId: string): Promise<void> {
  await parse(await apiFetch(`${apiUrl}/obligation-packs/${familyId}`, { method: "DELETE" }));
}

/**
 * Which pack a contract would get, and why. No model call, nothing stored —
 * this is the check to run before trusting a pack on real contracts.
 */
export async function resolveObligationPack(
  apiUrl: string,
  input: { file?: File; text?: string; title?: string },
): Promise<PackResolutionResult> {
  const form = new FormData();
  if (input.file) form.append("file", input.file);
  if (input.text) form.append("text", input.text);
  if (input.title) form.append("title", input.title);
  return parse<PackResolutionResult>(
    await apiFetch(`${apiUrl}/obligation-packs/resolve`, { method: "POST", body: form }),
  );
}

/** Save a pack, whether it arrived as a .zip or as pasted text. */
export async function saveObligationPack(
  apiUrl: string,
  familyId: string,
  draft: PackDraft,
): Promise<ObligationPackSummary> {
  const form = new FormData();
  form.append("family_id", familyId);
  if (draft.file) {
    form.append("file", draft.file);
  } else {
    for (const key of ["manifest", "taxonomy", "conventions", "sweep", "examples"] as const) {
      if (draft[key]) form.append(key, draft[key] as string);
    }
  }
  return parse<ObligationPackSummary>(
    await apiFetch(`${apiUrl}/obligation-packs`, { method: "POST", body: form }),
  );
}
