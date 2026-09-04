"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, ClipboardEdit, Inbox, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAccountContext } from "@/app/context/AccountContext";
import { DelegationPanel } from "@/components/new/DelegationPanel";
import {
  EMPTY_REVIEW_QUEUE,
  fetchReviewQueue,
  waitingFor,
  type ReviewQueue,
  type ReviewQueueItem,
} from "@/lib/reviewQueue";

type Tab = "approvals" | "edits";

function ItemRow({ item }: { item: ReviewQueueItem }) {
  const href = item.contract_id ? `/contracts/${item.contract_id}` : "#";

  return (
    <Link
      href={href}
      className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">{item.title}</span>
          {item.artifact_type === "kpi" && (
            <Badge variant="outline" className="shrink-0 text-xs">
              KPI
            </Badge>
          )}
          {item.artifact_type === "flagged_extraction" && (
            <Badge variant="outline" className="shrink-0 border-amber-300 text-xs text-amber-700">
              Flagged
            </Badge>
          )}
        </div>
        {item.state && (
          <p className="mt-1 text-sm text-muted-foreground">{item.state}</p>
        )}
        {item.note && (
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{item.note}</p>
        )}
      </div>
      <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">
        {waitingFor(item.waiting_since)}
      </span>
    </Link>
  );
}

export default function InboxPage() {
  const { isAuthenticated } = useAuth();
  const { selectedAccountId } = useAccountContext();
  const [queue, setQueue] = useState<ReviewQueue>(EMPTY_REVIEW_QUEUE);
  const [tab, setTab] = useState<Tab>("approvals");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setQueue(await fetchReviewQueue());
    } catch (loadError: any) {
      setError(loadError?.message || "Could not load your review queue.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) void load();
  }, [isAuthenticated, load]);

  const items = tab === "approvals" ? queue.awaiting_my_approval : queue.awaiting_my_edit;

  return (
    <div className="mx-auto max-w-4xl p-6 md:p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Waiting on you</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything assigned to you as an approver or an editor, oldest first.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      <div className="mb-4 flex gap-2">
        <Button
          variant={tab === "approvals" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("approvals")}
        >
          <CheckCircle2 className="mr-2 h-4 w-4" />
          To approve
          <Badge variant="secondary" className="ml-2">{queue.counts.approvals}</Badge>
        </Button>
        <Button
          variant={tab === "edits" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("edits")}
        >
          <ClipboardEdit className="mr-2 h-4 w-4" />
          To edit
          <Badge variant="secondary" className="ml-2">{queue.counts.edits}</Badge>
        </Button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="mb-6">
        <DelegationPanel accountId={selectedAccountId} />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
          <Inbox className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {tab === "approvals" ? "Nothing is waiting for your approval." : "Nothing is waiting for your edits."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <ItemRow key={`${item.artifact_type}-${item.artifact_id}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
