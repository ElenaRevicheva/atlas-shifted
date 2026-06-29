/**
 * performance-hub.ts — read-only client for CTO AIPA Atlas performance ledger.
 */
import { config, hasPerformanceHub } from './config.js';

export interface PerformanceTotals {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  sessions: number;
  leads: number;
  roas: number | null;
  cpa: number | null;
  event_count: number;
}

export interface PerformanceSummary {
  ok: boolean;
  concepts: Record<
    string,
    {
      vertical: string;
      angle_id: string | null;
      totals: PerformanceTotals;
      events: Array<{ source: string; created_at: string; metrics: Record<string, number> }>;
    }
  >;
}

export async function fetchPerformanceSummary(vertical?: string): Promise<PerformanceSummary | null> {
  if (!hasPerformanceHub()) return null;
  const base = config.performanceHubUrl!.replace(/\/$/, '');
  const url = vertical ? `${base}?vertical=${encodeURIComponent(vertical)}` : base;
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${config.performanceHubSecret}`, accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return null;
    return (await r.json()) as PerformanceSummary;
  } catch {
    return null;
  }
}
