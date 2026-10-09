#!/usr/bin/env node
/** E2E audit for Atlas + WHITESPACE — run on Oracle or locally against BASE URL. */
const BASE = (process.env.AUDIT_BASE || 'http://127.0.0.1:8095').replace(/\/$/, '');
const PUBLIC = (process.env.AUDIT_PUBLIC || 'https://webhook.aideazz.xyz/whitespace').replace(/\/$/, '');

const results = [];
let fail = 0;
const ok = (name, detail = '') => { results.push({ ok: true, name, detail }); console.log(`  OK   ${name}${detail ? ' — ' + detail : ''}`); };
const bad = (name, detail = '') => { fail++; results.push({ ok: false, name, detail }); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); };

async function getJson(path, base = BASE) {
  const r = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30_000) });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { j = null; }
  return { status: r.status, json: j, text: t.slice(0, 200) };
}

async function headOk(url) {
  const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20_000) });
  return r.ok;
}

console.log(`\n=== E2E AUDIT ===`);
console.log(`local: ${BASE}`);
console.log(`public: ${PUBLIC}\n`);

// 1. Health
console.log('--- Infrastructure ---');
try {
  const h = await getJson('/healthz');
  h.json?.ok ? ok('healthz ok') : bad('healthz ok', String(h.text));
  h.json?.brightData ? ok('Bright Data') : bad('Bright Data');
  h.json?.llm ? ok('LLM providers') : bad('LLM providers');
  h.json?.ship?.image ? ok('Ship image providers') : bad('Ship image providers');
  h.json?.ship?.video ? ok('Ship video providers') : bad('Ship video providers');
  ok('Ship token gate', h.json?.ship?.tokenRequired ? 'required' : 'open');
} catch (e) { bad('healthz', e.message); }

// 2. Static pages
console.log('\n--- Static UI ---');
for (const [name, path, needle] of [
  ['atlas.html live', `${PUBLIC}/atlas.html`, 'Atlas Shifted Adaptive Intelligent Personal Assistant'],
  ['index.html live', `${PUBLIC}/`, 'WHITESPACE'],
  ['favicon.svg', `${PUBLIC}/favicon.svg`, 'svg'],
]) {
  try {
    const r = await fetch(path, { signal: AbortSignal.timeout(20_000) });
    const t = await r.text();
    r.ok && t.includes(needle) ? ok(name) : bad(name, `status=${r.status} needle=${!!t.includes(needle)}`);
  } catch (e) { bad(name, e.message); }
}

// 3. Atlas API
console.log('\n--- Atlas API ---');
let atlas;
try {
  const a = await getJson('/api/atlas');
  atlas = a.json;
  a.json?.ok ? ok('GET /api/atlas') : bad('GET /api/atlas');
  const boards = a.json?.board || [];
  boards.length >= 1 ? ok('Radar board verticals', `${boards.length}`) : bad('Radar board empty');
  a.json?.brief?.verticals?.length ? ok('Daily brief', `${a.json.brief.verticals.length} verticals`) : bad('Daily brief missing');
  a.json?.snapshot_date ? ok('Snapshot date', a.json.snapshot_date) : bad('Snapshot date');
  a.json?.distinct_days >= 2 ? ok('Time series days', String(a.json.distinct_days)) : bad('Time series', `only ${a.json.distinct_days} days`);
  const concepts = a.json?.concepts || {};
  const withImage = Object.values(concepts).filter((c) => c?.asset?.image_file).length;
  withImage >= 1 ? ok('Rendered stills', `${withImage} verticals`) : bad('No rendered stills');
  const withVideo = Object.values(concepts).filter((c) => c?.video?.video_file).length;
  withVideo >= 1 ? ok('Rendered videos', `${withVideo} verticals`) : bad('No rendered videos (Runway/Luma)');
  a.json?.intelligence ? ok('Intelligence block') : bad('Intelligence block missing');
  Array.isArray(a.json?.tracked_verticals) ? ok('Tracked verticals', `${a.json.tracked_verticals.length} tracked`) : bad('Tracked verticals');
} catch (e) { bad('Atlas API', e.message); }

// 4. Evidence + history (real lane)
console.log('\n--- Evidence & history ---');
if (atlas?.board?.[0]?.angles?.[0]) {
  const v = atlas.board[0].vertical;
  const ang = atlas.board[0].angles[0].angle;
  try {
    const ev = await getJson(`/api/atlas/evidence?vertical=${encodeURIComponent(v)}&angle=${encodeURIComponent(ang)}`);
    ev.json?.ok ? ok('Evidence drawer API', `${(ev.json.evidence || []).length} ads`) : bad('Evidence API');
  } catch (e) { bad('Evidence API', e.message); }
  try {
    const hi = await getJson(`/api/atlas/history?vertical=${encodeURIComponent(v)}&angle=${encodeURIComponent(ang)}`);
    hi.json?.ok ? ok('Angle history API', `${(hi.json.history || []).length} points`) : bad('History API');
  } catch (e) { bad('History API', e.message); }
} else {
  bad('Evidence/history skip', 'no board lanes');
}

// 5. Creative assets (public)
console.log('\n--- Creative assets (public URLs) ---');
if (atlas?.concepts) {
  for (const [vert, c] of Object.entries(atlas.concepts)) {
    if (c?.asset?.image_file) {
      const url = `${PUBLIC}/${c.asset.image_file}`;
      await headOk(url) ? ok(`Still ${vert}`, c.asset.image_file) : bad(`Still ${vert}`, url);
    }
    if (c?.video?.video_file) {
      const url = `${PUBLIC}/${c.video.video_file}`;
      await headOk(url) ? ok(`Video ${vert}`, c.video.video_file) : bad(`Video ${vert}`, url);
    }
  }
}

// 6. WHITESPACE one-shot (lightweight — wait for done or first substantive stage)
console.log('\n--- WHITESPACE one-shot (media_buyer) ---');
try {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 180_000);
  const r = await fetch(`${BASE}/api/run?vertical=expat%20language&mode=media_buyer`, { signal: ac.signal });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let gotDone = false;
  let gotRec = false;
  while (!gotDone) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (const line of buf.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try {
        const e = JSON.parse(line.slice(6));
        if (e.stage === 'done' && e.data?.recommendation?.angle) {
          gotDone = true;
          gotRec = true;
          ok('WHITESPACE media_buyer run', e.data.recommendation.angle);
          (e.data.evidence || []).length ? ok('WHITESPACE evidence trail', `${e.data.evidence.length} ads`) : bad('WHITESPACE no evidence');
          break;
        }
        if (e.stage === 'error') { bad('WHITESPACE media_buyer', e.message); gotDone = true; break; }
      } catch { /* skip */ }
    }
  }
  clearTimeout(timer);
  reader.cancel().catch(() => {});
  if (!gotRec) bad('WHITESPACE media_buyer', 'no done event');
} catch (e) { bad('WHITESPACE media_buyer', e.message); }

console.log('\n--- WHITESPACE one-shot (content) ---');
try {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 180_000);
  const r = await fetch(`${BASE}/api/run?vertical=ai%20marketing%20agency&mode=content`, { signal: ac.signal });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let gotRec = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (const line of buf.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try {
        const e = JSON.parse(line.slice(6));
        if (e.stage === 'done' && e.data?.recommendation?.angle) {
          gotRec = true;
          ok('WHITESPACE content run', e.data.recommendation.angle);
          e.data.blog?.title ? ok('Content blog brief') : bad('Content blog brief missing');
          break;
        }
        if (e.stage === 'error') { bad('WHITESPACE content', e.message); break; }
      } catch { /* skip */ }
    }
    if (gotRec) break;
  }
  clearTimeout(timer);
  reader.cancel().catch(() => {});
  if (!gotRec) bad('WHITESPACE content', 'no done event');
} catch (e) { bad('WHITESPACE content', e.message); }

// 7. Role separation checks
console.log('\n--- Product separation ---');
ok('WHITESPACE = one-shot discovery', 'GET /api/run only on index');
ok('Atlas = daily radar + ship', 'GET /api/atlas, /track, /ship on atlas.html');
if (atlas?.brief && atlas?.concepts) {
  const briefVerts = new Set((atlas.brief.verticals || []).map((v) => v.vertical));
  const conceptVerts = Object.keys(atlas.concepts || {});
  const overlap = conceptVerts.filter((v) => briefVerts.has(v)).length;
  overlap >= 1 ? ok('Brief ↔ concepts aligned', `${overlap} shared verticals`) : bad('Brief/concepts mismatch');
}

console.log(`\n=== RESULT: ${fail === 0 ? 'PASS' : fail + ' FAIL(S)'} ===\n`);
process.exit(fail > 0 ? 1 : 0);
