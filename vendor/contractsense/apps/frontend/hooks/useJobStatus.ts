"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type JobStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export interface JobUpdate {
    job_id: string;
    status: JobStatus;
    progress: number;       // 0–100
    current_step: string | null;
    job_type: string | null;
    error: string | null;
    contract_id: string;
}

export interface UseJobStatusResult {
    /** All job updates received so far, keyed by job_id */
    jobs: Record<string, JobUpdate>;
    /** Overall progress 0–100, averaged across all active jobs */
    overallProgress: number;
    /** True when every job is terminal (COMPLETED or FAILED) */
    isComplete: boolean;
    /** True if any job has FAILED */
    hasError: boolean;
    /** Current connection state */
    connectionState: "connecting" | "open" | "closed" | "error";
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function httpToWs(url: string): string {
    return url.replace(/^http/, "ws");
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useJobStatus — opens a WebSocket to the backend and streams live progress
 * events for a contract's processing pipeline.
 *
 * @param contractId  The MongoDB contract _id to watch.
 * @param token       Present only for backwards-compatible caller gating; auth uses HttpOnly cookies.
 * @param enabled     Pass `false` to skip connecting (e.g. before upload).
 *
 * @example
 * const { overallProgress, isComplete, hasError } = useJobStatus(contractId, token);
 */
export function useJobStatus(
    contractId: string | null,
    token: string | null,
    enabled = true
): UseJobStatusResult {
    const [jobs, setJobs] = useState<Record<string, JobUpdate>>({});
    const [connectionState, setConnectionState] = useState<UseJobStatusResult["connectionState"]>("closed");
    const wsRef = useRef<WebSocket | null>(null);
    const retryCountRef = useRef(0);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const MAX_RETRIES = 5;

    const apiBase = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL ?? "http://localhost:8000/api/v1";
    const wsBase = httpToWs(apiBase);

    const connect = useCallback(() => {
        if (!contractId || !token || !enabled) return;
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        const clientId = `${contractId}-${Date.now()}`;
        const url = `${wsBase}/ws/job-status/${clientId}`;

        const ws = new WebSocket(url);
        wsRef.current = ws;
        setConnectionState("connecting");

        ws.onopen = () => {
            retryCountRef.current = 0;
            setConnectionState("open");
            // Tell the server which contract we want updates for
            ws.send(JSON.stringify({ type: "subscribe", contract_id: contractId }));
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data as string);

                if (msg.type === "job_update") {
                    const updates: JobUpdate[] = msg.jobs ?? [];
                    setJobs((prev) => {
                        const next = { ...prev };
                        for (const job of updates) {
                            next[job.job_id] = job;
                        }
                        return next;
                    });
                } else if (msg.type === "complete") {
                    // Server signals all jobs are terminal — nothing more to do
                    ws.close(1000, "complete");
                }
            } catch {
                // Ignore parse errors
            }
        };

        ws.onerror = () => {
            setConnectionState("error");
        };

        ws.onclose = (ev) => {
            wsRef.current = null;
            setConnectionState("closed");

            // Don't retry on normal close or max retries reached
            if (ev.code === 1000 || retryCountRef.current >= MAX_RETRIES) return;

            // Exponential back-off: 1s, 2s, 4s, 8s, 16s
            const delay = Math.min(1000 * 2 ** retryCountRef.current, 16_000);
            retryCountRef.current += 1;
            retryTimerRef.current = setTimeout(connect, delay);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contractId, token, enabled, wsBase]);

    useEffect(() => {
        connect();
        return () => {
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            wsRef.current?.close(1000, "unmount");
            wsRef.current = null;
        };
    }, [connect]);

    // ── Derived state ─────────────────────────────────────────────────
    const jobList = Object.values(jobs);

    const overallProgress =
        jobList.length === 0
            ? 0
            : Math.round(jobList.reduce((sum, j) => sum + (j.progress ?? 0), 0) / jobList.length);

    const isComplete =
        jobList.length > 0 && jobList.every((j) => j.status === "COMPLETED" || j.status === "FAILED");

    const hasError = jobList.some((j) => j.status === "FAILED");

    return { jobs, overallProgress, isComplete, hasError, connectionState };
}
