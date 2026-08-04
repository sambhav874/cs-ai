import { useEffect, useMemo, useState } from "react";

/**
 * Shape of the real counts endpoint. Keep this dead simple — every field here
 * is just a count() or sum() over existing collections, no new data model needed.
 *
 * Endpoint to build (see instructions doc): 
 *   GET /api/projects/{projectId}/dashboard/live-counts
 */
export interface LiveCounts {
  totalObligations: number;
  clientSide: number;
  supplierSide: number;
  byRuleType: Record<string, number>; // key must match RULE_TYPES names in dashboardMockConfig.ts
  totalBreaches: number;
  breachesBySource: Record<string, number>; // key must match SOURCES names in dashboardMockConfig.ts
  dollarAtRiskOpen: number;
}

const EMPTY: LiveCounts = {
  totalObligations: 0,
  clientSide: 0,
  supplierSide: 0,
  byRuleType: {},
  totalBreaches: 0,
  breachesBySource: {},
  dollarAtRiskOpen: 0,
};

function diff(a: LiveCounts, b: LiveCounts): LiveCounts {
  const ruleTypeKeys = new Set([...Object.keys(a.byRuleType), ...Object.keys(b.byRuleType)]);
  const sourceKeys = new Set([...Object.keys(a.breachesBySource), ...Object.keys(b.breachesBySource)]);
  return {
    totalObligations: b.totalObligations - a.totalObligations,
    clientSide: b.clientSide - a.clientSide,
    supplierSide: b.supplierSide - a.supplierSide,
    byRuleType: Object.fromEntries(
      [...ruleTypeKeys].map((k) => [k, (b.byRuleType[k] || 0) - (a.byRuleType[k] || 0)])
    ),
    totalBreaches: b.totalBreaches - a.totalBreaches,
    breachesBySource: Object.fromEntries(
      [...sourceKeys].map((k) => [k, (b.breachesBySource[k] || 0) - (a.breachesBySource[k] || 0)])
    ),
    dollarAtRiskOpen: b.dollarAtRiskOpen - a.dollarAtRiskOpen,
  };
}

/**
 * Fetches real counts once on mount (the "baseline"), and again whenever
 * `refresh()` is called (e.g. from a button click after extracting a contract
 * live). Returns the delta between baseline and latest — this is what gets
 * added on top of the mock dataset.
 *
 * If the endpoint doesn't exist yet or fails, this fails silently and returns
 * a zero delta — the dashboard just behaves exactly as it did before (pure
 * mock), so this is safe to wire in even before the backend endpoint is ready.
 */
export function useLiveDelta(projectId: string | null) {
  const [baseline, setBaseline] = useState<LiveCounts | null>(null);
  const [current, setCurrent] = useState<LiveCounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);

  async function fetchCounts(): Promise<LiveCounts | null> {
    if (!projectId) return null;
    try {
      const res = await fetch(`/api/projects/${projectId}/dashboard/live-counts`);
      if (!res.ok) return null;
      const json = await res.json();
      return { ...EMPTY, ...json };
    } catch {
      return null;
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetchCounts().then((c) => {
      if (cancelled) return;
      if (c) {
        setBaseline(c);
        setCurrent(c);
        setConnected(true);
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function refresh() {
    setLoading(true);
    const c = await fetchCounts();
    if (c) {
      setCurrent(c);
      setConnected(true);
    }
    setLoading(false);
  }

  const delta = useMemo(() => {
    if (!baseline || !current) return null;
    return diff(baseline, current);
  }, [baseline, current]);

  return { delta, refresh, loading, connected };
}
