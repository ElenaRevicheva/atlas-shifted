/**
 * radar-to-crm.ts — Gap-1 bridge (July 9 2026): detected ENTER windows become
 * source-tagged [ATLAS-RADAR] deals in HubSpot, via the fleet CRM hub that every
 * other AIdeazz agent already uses (POST /cto/api/crm-event, Bearer OUTREACH_SECRET).
 *
 * Honesty rules baked in:
 *  - Only ENTER windows are pushed (a real detected signal, not daily noise).
 *  - Server side dedups by dealname → one deal per vertical+angle window, ever,
 *    no matter how many daily cron runs re-see the same window.
 *  - The concept_id/landing URL ride along as TEXT in the deal note; the push
 *    carries NO utm attribution fields, so radar insights can never inflate the
 *    Atlas conversion ledger (hubspot_deals stays real-conversions-only).
 *
 * Fail-open: any error is logged and swallowed — the brief must always ship
 * (Atlas shrugs), CRM push is a bonus, never a dependency.
 *
 * Disable with ATLAS_CRM_RADAR_PUSH=off.
 */
import { config } from './config.js';
import { buildAtlasTracking } from './tracking.js';

const CRM_EVENT_URL = (process.env.ATLAS_CRM_EVENT_URL || 'https://webhook.aideazz.xyz/cto/api/crm-event').trim();

interface BriefVertical {
  vertical: string;
  move: {
    angle: string;
    state: string;
    score: number;
    why: string;
    basis: string;
    evidence: string | null;
  };
}

export async function pushRadarWindowsToCrm(brief: {
  snapshot_date?: string;
  verticals?: BriefVertical[];
}): Promise<void> {
  if ((process.env.ATLAS_CRM_RADAR_PUSH || '').trim().toLowerCase() === 'off') return;
  const secret = config.performanceHubSecret;
  if (!secret) {
    console.log('[radar-crm] no ATLAS_PERFORMANCE_SECRET/OUTREACH_SECRET in env — skipping CRM push');
    return;
  }
  const snapshot = String(brief?.snapshot_date || '').trim();
  const verticals = Array.isArray(brief?.verticals) ? brief.verticals : [];
  const enters = verticals.filter((v) => v?.move?.state === 'ENTER');
  if (!enters.length) {
    console.log('[radar-crm] no ENTER windows today — nothing to push (honest quiet)');
    return;
  }
  for (const v of enters) {
    const t = buildAtlasTracking(v.vertical, snapshot, v.move.angle);
    try {
      const r = await fetch(CRM_EVENT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
        body: JSON.stringify({
          source: 'atlas_radar',
          type: 'insight',
          pipeline: 'client',
          vertical: v.vertical,
          angle: v.move.angle,
          state: v.move.state,
          score: v.move.score,
          why: v.move.why,
          ...(v.move.evidence ? { evidence: v.move.evidence } : {}),
          atlas_concept_id: t.concept_id,
          landing_url: t.landing_url,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const j = (await r.json().catch(() => null)) as { hubspot?: { dealId?: string | null } } | null;
      console.log(
        `[radar-crm] ${v.vertical}/${v.move.angle} → HTTP ${r.status} deal=${j?.hubspot?.dealId ?? 'none'}`,
      );
    } catch (e) {
      console.warn('[radar-crm] non-fatal:', (e as Error).message);
    }
  }
}
