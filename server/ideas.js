// ─────────────────────────────────────────────────────────────
// "Top 5" Clip Ideas engine.
// Generates concrete short-form content ideas (Shorts / Reels /
// TikTok) grounded 100% in the live data TrendPulse already has:
// creator uploads + velocities, Google Trends traffic, news
// headlines, trending games, Reddit posts.
// The IDEAS are generated; every number underneath them is real.
// ─────────────────────────────────────────────────────────────
import { mkItem } from './items.js';
import { CATEGORIES } from './moments.js';

const fmtN = (n) => {
  n = +n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K';
  return String(Math.round(n));
};
const ageLabel = (ms) => {
  const h = ms / 3.6e6;
  if (h < 1) return Math.max(1, Math.round(h * 60)) + 'm';
  if (h < 48) return h.toFixed(h < 10 ? 1 : 0) + 'h';
  return Math.round(h / 24) + 'd';
};

let ideaCounter = 0;
function idea({ title, hook, formats, difficulty, evidence, sources, strength }) {
  return mkItem({
    id: 'idea-' + ideaCounter++,
    section: 'ideas', source: 'ideas-engine', platform: 'Idea engine', kind: 'idea',
    title,
    subtitle: hook,
    timeless: true,
    tags: formats,
    metrics: { score: Math.min(98, Math.round(35 + strength)), growth: 0, velocity: 0 },
    meta: { difficulty, evidence: (evidence || []).slice(0, 4), sources: (sources || []).slice(0, 4), hook },
  });
}

const SOCCER_RE = /world cup|mundial|fifa|\bsoccer\b|football|premier league|champions league|la liga|messi|ronaldo|mbapp| goalkeeper|goalkeeper/i;

/**
 * @param inputs { creators: [creatorItems], topics: [trendItems], news: [newsItems], games: [gameItems], posts: [redditItems] }
 */
export function buildIdeas({ creators = [], topics = [], news = [], games = [], posts = [], moments = [], compilations = [], trendingAgainList = [] }) {
  ideaCounter = 0;
  const ideas = [];

  // ── VAULT-FIRST: compilations already buildable from stored clips ──
  for (const c of (compilations || []).slice(0, 8)) {
    ideas.push(idea({
      title: c.title + '  \u2014  ready to make',
      hook: `${c.clipCount} clips already in your Vault (${c.estDuration}). Zero searching required.`,
      difficulty: c.difficulty === 'Easy' ? 'Easy' : c.difficulty === 'Medium' ? 'Medium' : 'Hard',
      strength: Math.min(60, 28 + c.clipCount * 2 + (c.trendScore || 0) * 0.3 + (c.evergreenScore || 0) * 0.2),
      evidence: [
        `\u2705 ${c.totalInGroup} matching clips saved \u2014 ${c.clipCount} used in this cut`,
        `\u23F1 estimated runtime ${c.estDuration} \u00b7 difficulty ${c.difficulty}`,
        `trend ${c.trendScore} \u00b7 evergreen ${c.evergreenScore}`,
        c.why,
      ],
    }));
  }
  // ── TRENDING AGAIN: old clips resurfacing because the trend returned ──
  for (const t of (trendingAgainList || []).slice(0, 4)) {
    ideas.push(idea({
      title: `\u21BB "${t.label}" is trending again \u2014 you have ${t.count} clips`,
      hook: `A live trend just matched ${t.count} moments already in your Vault. Re-cut them while the wave is up.`,
      difficulty: 'Easy',
      strength: Math.min(55, 24 + t.count * 3 + t.overlap * 6),
      evidence: [`${t.count} vault clips match the live trend "${t.label}"`, 're-upload / re-cut now for the trend spike'],
    }));
  }


  // ── 1. Creator moments (grounded in their REAL recent uploads) ──
  for (const cr of creators) {
    const recent = (cr.meta?.videos || []).filter((v) => v.ageMs <= 7 * 864e5);
    const name = cr.title;
    if (recent.length >= 2) {
      const total = recent.reduce((a, v) => a + v.views, 0);
      ideas.push(idea({
        title: `Top 5 ${name} moments this week`,
        hook: `Fast-cut the 5 biggest reactions/plays from ${recent.length} uploads this week — ${fmtN(total)} combined views already prove demand.`,
        formats: ['Shorts', 'Reels', 'TikTok'],
        difficulty: 'Easy',
        strength: Math.min(55, 12 * recent.length + Math.log10(total + 1) * 6),
        evidence: [
          `${recent.length} uploads in the last 7 days · ${fmtN(total)} combined views`,
          ...recent.slice(0, 3).map((v) => `“${v.title.slice(0, 60)}” — ${fmtN(v.views)} views in ${ageLabel(v.ageMs)}`),
        ],
        sources: recent.slice(0, 3).map((v) => v.url),
      }));
    }
    const rocket = recent.find((v) => v.ageMs <= 48 * 3.6e6 && v.velocity > 150_000);
    if (rocket) {
      ideas.push(idea({
        title: `Clip ${name}’s “${rocket.title.slice(0, 45)}” NOW`,
        hook: `${fmtN(rocket.velocity)} views/hour in its first ${ageLabel(rocket.ageMs)} — YouTube is pushing it. Take the best 15–45s segment and post immediately.`,
        formats: ['Shorts', 'TikTok'],
        difficulty: 'Easy',
        strength: Math.min(60, 25 + Math.log10(rocket.velocity + 1) * 6),
        evidence: [
          `${fmtN(rocket.views)} views · ${fmtN(rocket.velocity)}/hr velocity`,
          `${fmtN(rocket.likes)} likes · ${fmtN(rocket.comments)} comments in ${ageLabel(rocket.ageMs)}`,
        ],
        sources: [rocket.url],
      }));
    }
  }

  // ── 2. Google Trends → event topics get "Top 5 … moments", others get a fast explainer ──
  const EVENT_RE = /game|match|final|world cup|mundial|super bowl|fight|episode|season|tour|race|election|debate|storm|ban|death|wedding|arrest|trial|release|update|scandal| breakup|\bseries\b/i;
  for (const t of topics.slice(0, 8)) {
    const searches = t.metrics?.searches || 0;
    if (searches < 1000) continue;
    const name = t.title.charAt(0).toUpperCase() + t.title.slice(1);
    const eventLike = EVENT_RE.test(name);
    ideas.push(idea({
      title: eventLike ? `Top 5 ${name} moments` : `${name}: 5 things you need to know in 60 seconds`,
      hook: eventLike
        ? `People are searching “${name}” right now. A ranked top-5 compilation rides the search wave with zero original footage needed.`
        : `“${name}” is trending — a rapid 60-second “5 things” explainer captures the search spike while it's still hot.`,
      formats: ['Shorts', 'Reels', 'TikTok'],
      difficulty: 'Easy',
      strength: Math.min(50, 10 + Math.log10(searches + 1) * 9),
      evidence: [
        `Google Trends: ${searches.toLocaleString()}+ searches (live now)`,
        t.subtitle,
      ].filter(Boolean),
      sources: [t.url],
    }));
  }

  // ── 3. Football is trending → creative crossover formats ──
  const soccerSignals = [
    ...topics.filter((t) => SOCCER_RE.test(`${t.title} ${t.subtitle}`)),
    ...news.filter((n) => SOCCER_RE.test(`${n.title} ${n.subtitle}`)).slice(0, 3),
  ];
  if (soccerSignals.length) {
    const ev = soccerSignals.slice(0, 3).map((s) =>
      s.kind === 'topic' ? `Trending search: “${s.title}” (${(s.metrics?.searches || 0).toLocaleString()}+)` : `News: ${s.title.slice(0, 70)}`
    );
    ideas.push(idea({
      title: 'Top 5 outfield players as goalkeepers',
      hook: 'Evergreen viral format + football is hot right now. Ranked takes on attackers who could keep goal always ignite comments.',
      formats: ['Shorts', 'Reels', 'TikTok'],
      difficulty: 'Easy',
      strength: 42,
      evidence: ev,
      sources: soccerSignals.map((s) => s.url),
    }));
    ideas.push(idea({
      title: 'Top 5 moments of the 2026 World Cup so far',
      hook: 'The 2026 World Cup dominates the conversation — a running countdown is searchable for months, not days.',
      formats: ['Shorts', 'Reels'],
      difficulty: 'Medium',
      strength: 46,
      evidence: ev,
      sources: soccerSignals.map((s) => s.url),
    }));
  }

  // ── 4. Trending games → clip-farming lists ──
  for (const g of games.slice(0, 3)) {
    const m = g.metrics || {};
    if (!(m.players || m.viewers)) continue;
    ideas.push(idea({
      title: `Top 5 ${g.title} clips to post this week`,
      hook: `${g.title} is spiking — compile the week's 5 sickest community clips (with credit) and ride the game's search volume.`,
      formats: ['Shorts', 'TikTok'],
      difficulty: 'Easy',
      strength: Math.min(45, 8 + Math.log10((m.players || 0) + (m.viewers || 0) + 1) * 6),
      evidence: [
        m.players ? `${fmtN(m.players)} playing right now (Steam)` : null,
        m.viewers ? `${fmtN(m.viewers)} watching on Twitch` : null,
      ].filter(Boolean),
      sources: [g.url],
    }));
  }

  // ── 5. Creator-culture news → "5 things you missed" ──
  for (const n of news.slice(0, 4)) {
    if (n.ageMs > 48 * 3.6e6) continue;
    ideas.push(idea({
      title: `5 things you missed: ${n.title.slice(0, 55)}`,
      hook: `Breaking in ${n.platform} — a rapid "5 things" recap video captures the search spike before bigger channels move.`,
      formats: ['Shorts', 'Reels'],
      difficulty: 'Medium',
      strength: 30,
      evidence: [`Published ${ageLabel(n.ageMs)} ago · ${n.platform}`],
      sources: [n.url],
    }));
  }

  // ── 6. Reddit heat → debate bait ──
  for (const p of posts.slice(0, 2)) {
    if ((p.metrics?.ups || 0) < 3000) continue;
    ideas.push(idea({
      title: `Ranking the internet's hottest take: “${p.title.slice(0, 45)}”`,
      hook: `${fmtN(p.metrics.ups)} upvotes and ${fmtN(p.metrics.comments)} comments already — stitch it with your own top-5 counter-ranking for engagement bait.`,
      formats: ['TikTok', 'Shorts'],
      difficulty: 'Easy',
      strength: Math.min(40, 10 + Math.log10(p.metrics.ups + 1) * 6),
      evidence: [`r/${p.category?.replace('r/', '') || 'reddit'} · ▲ ${fmtN(p.metrics.ups)} · ${fmtN(p.metrics.comments)} comments`],
      sources: [p.url],
    }));
  }

  // ── 7. Vault-backed compilations — events with enough REAL saved clips ──
  const byEvent = new Map();
  for (const m of moments.filter((x) => x.meta?.event && x.ageMs <= 7 * 864e5)) {
    if (!byEvent.has(m.meta.event)) byEvent.set(m.meta.event, []);
    byEvent.get(m.meta.event).push(m);
  }
  for (const [, list] of byEvent) {
    if (list.length < 3) continue;
    list.sort((a, b) => (b.metrics?.views || 0) - (a.metrics?.views || 0));
    const total = list.reduce((a, m) => a + (m.metrics?.views || 0), 0);
    const first = list[0];
    const catName = (CATEGORIES[first.meta.category]?.name || 'moments').toLowerCase();
    const title = first.meta.event === 'wc2026' && first.meta.category === 'goals'
      ? 'Top 5 goals of the 2026 Mundial — the clips are already in your vault'
      : `Top 5 ${first.meta.eventName} moments — ${list.length} clips already vaulted`;
    ideas.push(idea({
      title,
      hook: `You already have ${list.length} real ${catName} clips saved from the last 7 days (${fmtN(total)} combined views). Pick your 5, cut, post — zero hunting required.`,
      formats: ['Shorts', 'Reels', 'TikTok'],
      difficulty: 'Easy',
      strength: Math.min(58, 20 + list.length * 4 + Math.log10(total + 1) * 4),
      evidence: [
        `${list.length} clips in your Moment Vault this week · ${fmtN(total)} combined views`,
        ...list.slice(0, 3).map((m) => `“${m.title.slice(0, 55)}” — ${fmtN(m.metrics.views)} views`),
      ],
      sources: list.slice(0, 4).map((m) => m.url),
    }));
  }

  const seen = new Set();
  return ideas
    .filter((i) => (seen.has(i.title) ? false : (seen.add(i.title), true)))
    .sort((a, b) => b.metrics.score - a.metrics.score)
    .map((it, i) => ((it.rank = i + 1), it))
    .slice(0, 14);
}
