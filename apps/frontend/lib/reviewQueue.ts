import { apiFetch } from "@/lib/apiClient";

export type ReviewQueueItem = {
  artifact_type: "contract" | "kpi";
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
