/**
 * cli.ts — headless run for testing/CI. Prints progress, then the deliverable.
 *   node dist/cli.js "medicare advantage"                 (media_buyer mode)
 *   node dist/cli.js "ai marketing agency" --content      (AIdeazz content mode)
 *   node dist/cli.js "solar installation" --json
 */
import { runWhitespace } from './agent.js';
import type { RunMode, RunOutput, BattlePlan, ContentBrief } from './types.js';

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const mode: RunMode = args.includes('--content') ? 'content' : 'media_buyer';
  const vertical = args.filter((a) => !a.startsWith('--')).join(' ').trim();
  if (!vertical) {
    console.error('usage: node dist/cli.js "<vertical>" [--content] [--json]');
    process.exit(1);
  }

  let out: RunOutput | null = null;
  await runWhitespace(
    vertical,
    (e) => {
      if (e.stage === 'done') out = e.data as RunOutput;
      else if (!json) console.log(`  [${e.stage}] ${e.message}`);
    },
    mode,
  );

  if (!out) {
    console.error('no deliverable produced');
    process.exit(1);
  }
  const o = out as RunOutput;

  if (json) {
    console.log(JSON.stringify(o, null, 2));
    return;
  }

  const r = o.recommendation;
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  ${o.kind === 'content' ? 'CONTENT BRIEF' : 'CREATIVE BATTLE PLAN'} · ${o.vertical}`);
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`\n  ▸ RECOMMENDED WHITESPACE ANGLE  (confidence ${r.confidence})`);
  console.log(`    ${r.angle}`);
  console.log(`    ${r.rationale}`);
  console.log(`    adjacent to: ${r.adjacentTo.join(', ') || '—'}`);

  if (o.kind === 'media_buyer') {
    const p = o as BattlePlan & { kind: 'media_buyer' };
    console.log(`\n  ▸ AD COPY`);
    for (const c of p.adCopy) console.log(`    • ${c.headline}\n      ${c.primaryText}  [${c.cta}]`);
    console.log(`\n  ▸ LANDING PAGE\n    ${p.landingPage.hook}\n    ${p.landingPage.subhead}`);
  } else {
    const b = o as ContentBrief & { kind: 'content' };
    console.log(`\n  ▸ BLOG\n    ${b.blog.title}  (kw: ${b.blog.targetKeyword})`);
    for (const s of b.blog.outline) console.log(`      - ${s}`);
    console.log(`\n  ▸ SOCIAL`);
    console.log(`    LinkedIn: ${b.social.linkedin.slice(0, 160)}…`);
    console.log(`    X hook:   ${b.social.xThreadHook}`);
    console.log(`\n  ▸ HUBSPOT ANGLE\n    ${b.hubspotCampaignAngle}`);
  }

  console.log(`\n  ▸ CROWDED LANES TO AVOID`);
  for (const l of o.crowdedLanes) console.log(`    • [${l.saturation}] ${l.angle} (${l.creativeCount}) — ${l.dominantEmotion}`);

  console.log(`\n  ▸ EVIDENCE`);
  for (const e of o.evidence) console.log(`    • ${e.advertiser || 'unknown'}: ${e.insight}\n      ${e.sourceUrl}`);

  console.log(
    `\n  meta: ${o.meta.creativesScanned} units · ${o.meta.sources.join('+') || 'knowledge-mode'} · ${o.meta.llmProvider} · ${o.meta.durationMs}ms${o.meta.degraded ? ' · DEGRADED' : ''}`,
  );
  for (const n of o.meta.notes) console.log(`    note: ${n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
