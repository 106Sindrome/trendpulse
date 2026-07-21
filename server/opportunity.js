// ─────────────────────────────────────────────────────────────
// Opportunity Engine — answers the only question Shorts creators
// care about: "What should I clip NEXT, and is it worth posting
// RIGHT NOW?"
// Turns live items (creator uploads, vaulted moments, trends,
// reddit, videos) into ranked opportunities with:
//   • Clip Confidence (0–99, derived from real signals)
//   • Trend stage: detected → growing → exploding → peak → declining
//   • First Seen timestamp (persisted to data/seen.json — "be first")
//   • Estimated lifetime + "post within" window (model-based, labelled)
//   • Momentum arrows, hook suggestions, hashtags, clip-length rules
// Every input number is real; model outputs are clearly estimates.
// ─────────────────────────────────────────────────────────────
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkItem } from './items.js';

const SEEN_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'seen.json');

// ── First-seen memory (so "first detected 11 min ago" is real) ──
let seen = new Map();
export async function loadSeen() {
  try {
    const j = JSON.parse(await readFile(SEEN_FILE, 'utf8'));
    seen = new Map(Object.entries(j));
  } catch { seen = new Map(); }
}
let seenDirty = false;
function touchSeen(id) {
  if (!seen.has(id)) { seen.set(id, Date.now()); seenDirty = true; }
  return seen.get(id);
}
export async function saveSeen() {
  if (!seenDirty) return;
  seenDirty = false;
  try {
    await mkdir(dirname(SEEN_FILE), { recursive: true });
    const obj = Object.fromEntries([...seen.entries()].slice(-4000));
    await writeFile(SEEN_FILE, JSON.stringify(obj));
  } catch { /* best effort */ }
}

// ── Model tables (heuristics, clearly labelled as estimates) ──
export const STAGES = [
  { id: 'detected', label: 'Detected', icon: '🔍' },
  { id: 'growing', label: 'Growing', icon: '📈' },
  { id: 'exploding', label: 'Exploding', icon: '🚀' },
  { id: 'peak', label: 'Peak', icon: '⛰️' },
  { id: 'declining', label: 'Declining', icon: '📉' },
];
const LIFETIME_H = {          // [min, max] hours per content kind
  video: [12, 36], moment: [24, 72], topic: [12, 40],
  post: [6, 24], news: [4, 14], podcast: [24, 96],
};
const CLIP_LEN = {            // rules of thumb per category
  goals: '20–35s', godlike: '15–30s', fails: '8–18s',
  reactions: '12–25s', highlights: '25–45s',
};

function stageOf(m, ageH, firstAgeH) {
  const g = m.growth || 0;
  const vel = m.velocity || 0;
  if (g >= 60 || (firstAgeH < 4 && g >= 25 && vel > 0)) return 'exploding';
  if (ageH < 2 && vel > 300_000) return 'exploding'; // brand-new video going ballistic
  if (firstAgeH < 0.75 && vel > 0) return 'detected';
  if (g >= 15) return 'growing';
  if (g <= -15) return 'declining';
  if (ageH > 18 && vel <= 0) return 'declining';
  return 'peak';
}

function momentumArrows(history) {
  if (!history || history.length < 3) return '—';
  const h = history.slice(-6);
  let s = '';
  for (let i = 1; i < h.length; i++) {
    const rel = (h[i] - h[i - 1]) / Math.max(1, Math.abs(h[i - 1]));
    s += rel > 0.04 ? '▲' : rel < -0.04 ? '▼' : '△';
  }
  return s.slice(-5);
}

const slug = (s) => '#' + String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);

function makeHooks(o) {
  const who = o.author || o.subtitle || '';
  const ev = o.meta?.eventName;
  const cat = o.meta?.category;
  if (!who) {
    // trend/topic with no creator attached
    return [
      'Everyone is searching for this right now 📈',
      'This is blowing up — here\u2019s what happened 👀',
      '5 things to know before it peaks ⏳',
    ];
  }
  const by = {
    goals: ['This goal broke the internet ⚽🔥', 'You have to see this finish…', 'POV: the keeper had no chance 💀'],
    godlike: ['This shouldn\u2019t be humanly possible 😇', 'Frame by frame, this is insane', 'Nobody believed this play happened'],
    fails: ['Try not to laugh: impossible mode 😂', 'It was going SO well…', 'The fail of the year? Watch till the end'],
    reactions: ['His reaction says everything 💀', 'He actually said this on stream…', 'Chat completely lost it — here\u2019s why'],
  }[cat];
  if (by) return by;
  const base = [
    `${who} wasn\u2019t expecting this… 😳`,
    'The moment everyone is about to talk about 👀',
    'Wait for it… (sound ON) 🔊',
  ];
  if (ev) base[1] = `${ev} just delivered THIS 🏆`;
  return base;
}

function makeHashtags(o) {
  const tags = ['#shorts', '#viral'];
  if (o.author) tags.push(slug(o.author));
  if (o.meta?.eventName) tags.push(slug(o.meta.eventName));
  if (o.meta?.category === 'goals') tags.push('#football', '#soccer');
  if (o.meta?.game) tags.push(slug(o.meta.game));
  return [...new Set(tags)].slice(0, 6);
}

const sat = (v, scale) => Math.min(1, Math.abs(v) / (Math.abs(v) + scale));

/** Flatten all clipable candidates from live sections. */
function gatherCandidates(inputs) {
  const out = [];
  for (const cr of inputs.creators || []) {
    for (const v of (cr.meta?.videos || []).filter((x) => x.ageMs <= 7 * 864e5)) {
      out.push({
        id: 'opp-yt-' + v.videoId, srcId: 'yt-' + v.videoId, kind: 'video',
        platform: 'YouTube', title: v.title, author: cr.title, subtitle: cr.title,
        url: v.url, thumbnail: v.thumb, embed: v.embed, ageMs: v.ageMs,
        metrics: { views: v.views, likes: v.likes, comments: v.comments, velocity: v.velocity, growth: 0, score: 0 },
        history: [], extra: { creator: cr.title, category: '', sourceSection: 'creators' },
      });
    }
  }
  for (const m of inputs.moments || []) {
    if (m.ageMs > 7 * 864e5) continue;
    out.push({
      id: 'opp-' + m.id, srcId: m.id, kind: 'moment',
      platform: m.platform, title: m.title, author: m.author, subtitle: m.subtitle,
      url: m.url, thumbnail: m.thumbnail, embed: m.embed, ageMs: m.ageMs,
      metrics: { ...m.metrics }, history: m.history || [],
      extra: { category: m.meta?.category || '', eventName: m.meta?.eventName, eventIcon: m.meta?.eventIcon,
        game: m.meta?.game, vodOffset: m.meta?.vodOffset, duration: m.meta?.duration,
        viewsLabel: m.meta?.viewsLabel, sourceSection: 'moments' },
    });
  }
  for (const t of (inputs.topics || []).slice(0, 8)) {
    out.push({
      id: 'opp-' + t.id, srcId: t.id, kind: 'topic',
      platform: t.platform, title: t.title, author: '', subtitle: t.subtitle,
      url: t.url, thumbnail: t.thumbnail, embed: null, ageMs: t.ageMs,
      metrics: { views: t.metrics.searches || t.metrics.mentions || 0, velocity: t.metrics.velocity || 0, growth: t.metrics.growth || 0, score: t.metrics.score || 0 },
      history: t.history || [], extra: { category: '', sourceSection: 'trends' },
    });
  }
  for (const p of (inputs.posts || []).filter((x) => (x.metrics?.ups || 0) > 2000).slice(0, 6)) {
    out.push({
      id: 'opp-' + p.id, srcId: p.id, kind: 'post',
      platform: 'Reddit', title: p.title, author: p.subtitle, subtitle: p.subtitle,
      url: p.url, thumbnail: p.thumbnail, embed: null, ageMs: p.ageMs,
      metrics: { views: p.metrics.ups, velocity: p.metrics.velocity || 0, growth: p.metrics.growth || 0, score: p.metrics.score || 0 },
      history: p.history || [], extra: { category: '', sourceSection: 'reddit', subredditSize: p.meta?.subredditSize || 0 },
    });
  }
  for (const v of (inputs.videos || []).filter((x) => x.ageMs <= 2 * 864e5).slice(0, 10)) {
    out.push({
      id: 'opp-' + v.id, srcId: v.id, kind: 'video',
      platform: 'YouTube', title: v.title, author: v.author, subtitle: v.subtitle,
      url: v.url, thumbnail: v.thumbnail, embed: v.embed, ageMs: v.ageMs,
      metrics: { views: v.metrics.views, likes: v.metrics.likes, comments: v.metrics.comments, velocity: v.metrics.velocity || 0, growth: v.metrics.growth || 0, score: v.metrics.score || 0 },
      history: v.history || [], extra: { creator: v.author, category: '', sourceSection: 'videos' },
    });
  }
  return out;
}

/** Build the ranked opportunities list (top 10). */
export function buildOpportunities(inputs) {
  const now = Date.now();
  const scored = gatherCandidates(inputs).map((c) => {
    const firstSeenTs = touchSeen(c.srcId);
    const firstAgeH = (now - firstSeenTs) / 3.6e6;
    const ageH = Math.max(0.1, c.ageMs / 3.6e6);
    const m = c.metrics;
    const stage = stageOf(m, ageH, firstAgeH);

    const velNorm = sat(m.velocity || 0, c.kind === 'topic' ? 1500 : 150_000);
    const scaleNorm = sat(m.views || 0, c.kind === 'topic' ? 15000 : 1_500_000);
    const freshness = Math.exp(-ageH / (c.kind === 'moment' ? 48 : 24));
    const stageBonus = { exploding: 15, detected: 12, growing: 10, peak: 3, declining: 0 }[stage];
    const confidence = Math.max(5, Math.min(99,
      Math.round(scaleNorm * 34 + velNorm * 30 + freshness * 21 + stageBonus)
    ));
    const urgency = { exploding: 30, detected: 26, growing: 22, peak: 8, declining: 0 }[stage];
    // Relevance boost: this is a tool for gaming/streaming/football clip creators,
    // so niche topics outrank unrelated trends (like stock tickers) at equal signals.
    const NICHE_RE = /game|gaming|fortnite|valorant|minecraft|roblox|world cup|mundial|football|soccer|streamer|twitch|youtube|clip|esports|nba|nfl|ufc|ronaldo|messi|speed|kai|beast|rogan/i;
    const niche = NICHE_RE.test(`${c.title} ${c.author} ${c.extra?.category || ''} ${c.extra?.eventName || ''}`) ? 10 : -8;
    const oppScore = Math.round(confidence * 0.6 + velNorm * 25 + urgency * 0.5 + niche);

    const [ltMin, ltMax] = LIFETIME_H[c.kind] || [12, 36];
    const expiresMs = firstSeenTs + ltMax * 3.6e6;
    const postWithinMs = Math.max(15 * 60e3, (expiresMs - now) * 0.4);

    return mkItem({
      id: c.id,
      section: 'now', source: 'opportunity', platform: c.platform, kind: 'opportunity',
      title: c.title, subtitle: c.subtitle, author: c.author, category: c.extra.category,
      url: c.url, thumbnail: c.thumbnail, embed: c.embed, ageMs: c.ageMs, timeless: true,
      metrics: { score: oppScore, confidence, views: m.views, velocity: m.velocity, growth: m.growth },
      meta: {
        kind: c.kind,
        stage, momentum: momentumArrows(c.history),
        firstSeenTs, trendAgeMs: now - firstSeenTs,
        lifetimeH: [ltMin, ltMax], expiresMs, postWithinMs,
        clipLen: CLIP_LEN[c.extra.category] || (c.kind === 'topic' ? '30–60s explainer' : '15–30s'),
        hooks: makeHooks({ author: c.author || c.extra.creator, meta: c.extra }),
        hashtags: makeHashtags({ author: c.author || c.extra.creator, meta: c.extra }),
        category: c.extra.category, categoryName: c.extra.category,
        eventName: c.extra.eventName || '', eventIcon: c.extra.eventIcon || '',
        game: c.extra.game || '', vodOffset: c.extra.vodOffset ?? null, duration: c.extra.duration ?? null,
        subredditSize: c.extra.subredditSize || 0,
        viewsLabel: c.extra.viewsLabel || '', sourceSection: c.extra.sourceSection,
        creator: c.extra.creator || c.author || '',
        scan: null,
      },
      history: c.history || [],
    });
  });

  scored.sort((a, b) => b.metrics.score - a.metrics.score);
  scored.slice(0, 10).forEach((it, i) => (it.rank = i + 1));
  return scored.slice(0, 10);
}


// ════════════════════════════════════════════════════════════
// Opportunity Rankings — five Top-5 lists over the live pool.
// ════════════════════════════════════════════════════════════
const CAT_RULES = [
  ['anime', /\banime\b|\bnaruto\b|one piece|jujutsu|demon slayer|dragon ball|attack on titan|\bffa\b|my hero/i],
  ['manga', /\bmanga\b|one piece chapter|boruto|\bch\.\s?\d+/i],
  ['manhwa', /\bmanhwa\b|solo leveling|tower of god|omniscient reader|beginning after the end/i],
  ['manhua', /\bmanhua\b|cultivation|soul land|martial peak/i],
  ['webnovels', /web ?novel|webtoon novel|royalroad|scribblehub/i],
  ['lightnovels', /light ?novel|\bln\b|re:zero|overlord novel|mushoku/i],
  ['sports', /world cup|mundial|football|soccer|\bgoal\b|premier league|champions league|\bnba\b|\bnfl\b|\bufc\b|ronaldo|messi|mbapp|tennis|f1\b/i],
  ['gaming', /game|gaming|fortnite|valorant|minecraft|roblox|gta|call of duty|apex|league of legends|dota|counter-strike|elden ring|nintendo|playstation|xbox|steam deck/i],
  ['ai', /\bai\b|gpt|chatgpt|openai|claude|gemini|artificial intelligence|machine learning|neural|llm/i],
  ['tech', /apple|iphone|android|tesla|spacex|crypto|bitcoin|chip|semiconductor|startup|gadget|samsung|google pixel/i],
  ['news', /breaking|election|president|law|court|police|war|attack|storm|recall|lawsuit|congress|minister/i],
];
export function classifyCategory(o) {
  const hay = `${o.title} ${o.author} ${o.meta?.category || ''} ${o.meta?.eventName || ''} ${o.meta?.game || ''}`;
  for (const [cat, re] of CAT_RULES) if (re.test(hay)) return cat;
  if (o.meta?.creator || o.kind === 'video' || o.kind === 'moment') return 'creators';
  return 'other';
}

function sigWords(text) {
  const STOP = new Set(['the','and','for','with','this','that','from','you','your','are','was','his','her','him','she','they','them','not','but','get','got','just','what','when','how','top','best','new']);
  return [...new Set(String(text || '').toLowerCase().match(/[a-z0-9]{4,}/g) || [])].filter((w) => !STOP.has(w));
}

/** Real competition estimate — no extra API calls: cross-source saturation on your own
 *  live dashboard + trend volume + subreddit size + niche category. Verify with Deep Scan. */
export function estimateCompetition(o, pool) {
  let score = 0;
  const why = [];
  const keys = sigWords(`${o.title} ${o.author}`).slice(0, 6);
  let overlapN = 0;
  if (keys.length) {
    for (const it of pool) {
      if (it.id === o.id) continue;
      const hay = `${it.title} ${it.author}`.toLowerCase();
      if (keys.some((k) => hay.includes(k))) overlapN++;
    }
  }
  if (overlapN >= 4) { score += 2; why.push(`covered by ${overlapN} other live signals on your dashboard already`); }
  else if (overlapN <= 1) { score -= 1; why.push('little cross-platform coverage yet'); }
  if (o.kind === 'topic') {
    const s = o.metrics.views || 0;
    if (s >= 50000) { score += 2; why.push(`massive search volume (${s.toLocaleString()}+) — crowded`); }
    else if (s <= 5000 && s > 0) { score -= 1; why.push(`search volume still modest (${s.toLocaleString()}+) — fewer creators chasing`); }
  }
  const subs = o.meta?.subredditSize;
  if (subs) {
    if (subs > 2_000_000) { score += 1; why.push(`huge community (${(subs / 1e6).toFixed(1)}M members)`); }
    else if (subs < 150_000) { score -= 1; why.push(`niche community (${subs.toLocaleString()} members) — low saturation`); }
  }
  if (['anime', 'manga', 'manhwa', 'manhua', 'webnovels', 'lightnovels'].includes(o.meta?.category)) {
    score -= 1; why.push('niche category — lower creator saturation');
  }
  const level = score >= 3 ? 'HIGH' : score >= 1 ? 'MEDIUM' : 'LOW';
  return { level, score, why };
}

/** Acceleration % — recent slope of the observation history (or velocity proxy). */
function acceleration(o) {
  const h = o.history || [];
  if (h.length >= 6) {
    const a = (h[h.length - 3] + h[h.length - 2] + h[h.length - 1]) / 3;
    const b = (h[h.length - 6] + h[h.length - 5] + h[h.length - 4]) / 3;
    if (b > 0) return Math.round(((a - b) / b) * 100);
  }
  const ageH = Math.max(0.3, o.ageMs / 3.6e6);
  return Math.min(400, Math.round(((o.metrics.velocity || 0) / Math.max(1, o.metrics.views || 1)) * 100 / ageH));
}

function formatAffinity(o) {
  const cat = o.meta?.category;
  const f = { shorts: 0.75, reels: 0.6, tiktok: 0.7, faceless: 0.35 };
  if (o.kind === 'topic' || o.kind === 'news') { f.faceless = 0.95; f.reels = 0.75; }
  if (['anime', 'manga', 'manhwa', 'manhua', 'webnovels', 'lightnovels'].includes(cat)) { f.faceless = 0.9; f.tiktok = 0.9; }
  if (cat === 'sports' || cat === 'gaming') { f.shorts = 0.95; f.tiktok = 0.85; }
  if (o.meta?.creator || (o.kind === 'video' && o.author)) f.faceless = Math.min(f.faceless, 0.2);
  return f;
}

function bestFormats(f) {
  return Object.entries(f).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
}

/** Enrich every pooled opportunity with the fields all rankings need. */
function enrich(pool) {
  return pool.map((o) => {
    o.meta.category = o.meta.category || classifyCategory(o);
    if (!o.meta.category || o.meta.category === 'other') o.meta.category = classifyCategory(o);
    o.meta.acceleration = acceleration(o);
    o.meta.competition = estimateCompetition(o, pool);
    o.meta.formats = formatAffinity(o);
    o.meta.bestFormats = bestFormats(o.meta.formats);
    o.meta.remainingMs = Math.max(0, (o.meta.expiresMs || Date.now()) - Date.now());
    o.meta.discussion = (o.metrics.views || 0) > 0 && o.kind === 'post' ? o.metrics.views : (o.metrics.comments || 0);
    return o;
  });
}

export function buildRankings(pool) {
  const items = enrich(pool.map((o) => ({ ...o, metrics: { ...o.metrics }, meta: { ...o.meta } })));
  const take = (arr, n = 12) => arr.slice(0, n);

  // 🏆 Right Now — overall strongest
  const now = take([...items].sort((a, b) => b.metrics.score - a.metrics.score));

  // 📈 Rising — fastest acceleration, pre-peak only
  const rising = take([...items]
    .filter((o) => ['detected', 'growing', 'exploding'].includes(o.meta.stage) && o.meta.acceleration > 0)
    .sort((a, b) => (b.meta.acceleration - a.meta.acceleration) || (b.metrics.score - a.metrics.score)));

  // 💎 Hidden Gems — potential ÷ competition
  const gems = take([...items]
    .filter((o) => o.meta.competition.level !== 'HIGH' && o.metrics.score >= 30 && o.meta.acceleration >= 0)
    .sort((a, b) => ((b.metrics.score / (1.6 + b.meta.competition.score)) - (a.metrics.score / (1.6 + a.meta.competition.score))) || (a.meta.competition.score - b.meta.competition.score)));

  // ⏰ About To Peak — high momentum, short remaining window
  const peak = take([...items]
    .filter((o) => ['growing', 'exploding'].includes(o.meta.stage) && o.meta.remainingMs < 24 * 3.6e6)
    .sort((a, b) => {
      const ua = (b.metrics.velocity || 1) / Math.max(0.5, b.meta.remainingMs / 3.6e6);
      const ub = (a.metrics.velocity || 1) / Math.max(0.5, a.meta.remainingMs / 3.6e6);
      return ua - ub;
    }));

  return { now, rising, gems, peak };
}

/** 📦 From Your Vault — vaulted moments re-matched against what's trending right now. */
export function rankVaultMatches(vaultItems, trendTitles, newsTitles) {
  const signals = [...trendTitles, ...newsTitles].map((t) => ({ t, w: sigWords(t) }));
  const scored = [];
  for (const m of vaultItems) {
    const hay = `${m.title} ${m.author} ${m.meta?.eventName || ''} ${m.meta?.game || ''}`.toLowerCase();
    let best = null;
    for (const s of signals) {
      const hit = s.w.filter((w) => hay.includes(w)).length;
      const strength = hit / Math.max(1, s.w.length);
      if (strength >= 0.5 && (!best || strength > best.strength)) best = { title: s.t, strength };
    }
    if (!best) continue;
    scored.push({
      moment: m,
      trend: best.title,
      match: Math.round(best.strength * 100),
      score: Math.min(99, Math.round(best.strength * 55 + Math.min(40, (m.metrics.views || 0) / 50000))),
    });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 12);
}
