import { apiFetch } from "@/lib/apiClient";

export type ReviewQueueItem = {
  artifact_type: "contract" | "kpi" | "flagged_extraction";
  artifact_id: string;
  title: string;
  contract_id: string | null;
  project_id: string | null;
  state: string | null;
  assigned_role: "approver" | "editor";
  waiting_since: string | null;
  note: string | null;
};

export type ReviewQueue = {
  awaiting_my_approval: ReviewQueueItem[];
  awaiting_my_edit: ReviewQueueItem[];
  counts: { approvals: number; edits: number; total: number };
};

export const EMPTY_REVIEW_QUEUE: ReviewQueue = {
  awaiting_my_approval: [],
  awaiting_my_edit: [],
  counts: { approvals: 0, edits: 0, total: 0 },
};

export async function fetchReviewQueue(): Promise<ReviewQueue> {
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;
  if (!apiUrl) return EMPTY_REVIEW_QUEUE;

  const response = await apiFetch(`${apiUrl}/me/review-queue`);
  if (!response.ok) {
    throw new Error(`Failed to load the review queue (${response.status})`);
  }
  return (await response.json()) as ReviewQueue;
}

/** How long something has been sitting, in words a reader can act on. */
export function waitingFor(waitingSince: string | null): string {
  if (!waitingSince) return "Waiting";
  const since = new Date(waitingSince).getTime();
  if (Number.isNaN(since)) return "Waiting";

  const days = Math.floor((Date.now() - since) / 86_400_000);
  if (days < 1) return "Today";
  if (days === 1) return "1 day";
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month" : `${months} months`;
}

export type Delegation = {
  id: string;
  role: "editor" | "approver";
  delegateUserId: string;
  delegate_name: string | null;
  until: string | null;
  reason: string | null;
  createdAt: string | null;
  revokedAt: string | null;
  active: boolean;
};

function requireApiUrl(): string {
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;
  if (!apiUrl) throw new Error("The API URL is not configured.");
  return apiUrl;
}

export async function fetchDelegations(): Promise<Delegation[]> {
  const response = await apiFetch(`${requireApiUrl()}/me/delegations`);
  if (!response.ok) throw new Error(`Failed to load delegations (${response.status})`);
  const data = await response.json();
  return (data.delegations || []) as Delegation[];
}

export async function createDelegation(input: {
  role: "editor" | "approver";
  delegateUserId: string;
  until?: string | null;
  reason?: string | null;
}): Promise<void> {
  const response = await apiFetch(`${requireApiUrl()}/me/delegations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: input.role,
      delegateUserId: input.delegateUserId,
      until: input.until || null,
      reason: input.reason || null,
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Could not create the delegation.");
  }
}

export async function revokeDelegation(delegationId: string): Promise<void> {
  const response = await apiFetch(`${requireApiUrl()}/me/delegations/${delegationId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Could not revoke the delegation.");
  }
}
