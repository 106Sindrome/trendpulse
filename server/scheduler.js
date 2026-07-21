// ─────────────────────────────────────────────────────────────
// Scheduler: runs real data-source producers on independent
// intervals, merges items into sections, tracks growth/velocity
// via history windows, recomputes the Top-5 ideas engine and the
// cross-source Viral Radar, and fires alerts on REAL events only
// (new uploads, trend spikes). There is no simulated data.
//
// Adding a new source = add one producer below. That's it.
// ─────────────────────────────────────────────────────────────
import { registerSection, setItems, pushAlert, setSourceStatus, store, getSourceStatus } from './store.js';
import { applyScores, byScoreDesc } from './scoring.js';
import * as youtube from './adapters/youtube.js';
import * as twitch from './adapters/twitch.js';
import * as reddit from './adapters/reddit.js';
import * as feeds from './adapters/feeds.js';
import * as creatorsMod from './creators.js';
import { EVENTS, clipToMoment, ytToMoment, redditPostToMoment, ingestMoments, loadVault, vaultItems, getVault } from './moments.js';
import { buildOpportunities, buildRankings, rankVaultMatches, loadSeen, saveSeen } from './opportunity.js';
import { buildIdeas } from './ideas.js';
import { buildCompilations, trendingAgain, detectSeries } from './compilations.js';

export const SECTIONS = [
  { id: 'now', title: 'Best Right Now', icon: '🔥', kind: 'opportunity' },
  { id: 'creators', title: 'Creator Watchlist', icon: '🎯', kind: 'creator',
    meta: { requires: { vars: ['YOUTUBE_API_KEY'], hint: 'Creator uploads, views & velocity come from the YouTube Data API v3.' } } },
  { id: 'ideas', title: 'Top 5 Clip Ideas', icon: '💡', kind: 'idea' },
  { id: 'moments', title: 'Moment Vault', icon: '🏆', kind: 'moment' },
  { id: 'videos', title: 'Trending Videos', icon: '🎥', kind: 'video',
    meta: { requires: { vars: ['YOUTUBE_API_KEY'], hint: 'Trending videos come from the YouTube Data API v3.' } } },
  { id: 'trends', title: 'Trending Topics', icon: '🔎', kind: 'topic' },
  { id: 'reddit', title: 'Reddit', icon: '💬', kind: 'post' },
  { id: 'news', title: 'Creator & Gaming News', icon: '⚡', kind: 'news' },
  { id: 'games', title: 'Trending Games', icon: '🎮', kind: 'game' },
  { id: 'podcasts', title: 'Podcasts', icon: '🎙️', kind: 'podcast' },
  { id: 'viral', title: 'Viral Radar', icon: '📈', kind: 'viral' },
];

const SOURCE_INTERVAL = {
  youtube: 12 * 60_000, 'youtube-trending': 25 * 60_000, twitch: 120_000,
  steam: 120_000, 'steam-week': 3_600_000, 'google-trends': 300_000, reddit: 180_000,
  'apple-podcasts': 600_000, 'news-rss': 300_000, moments: 600_000,
};

function primaryValue(it) {
  const m = it.metrics || {};
  switch (it.kind) {
    case 'creator': return m.latestViews || 0;
    case 'video': return m.views || 0;
    case 'game': return (m.viewers || 0) + (m.players || 0);
    case 'topic': return m.searches || m.mentions || 0;
    case 'post': return m.ups || 0;
    case 'podcast': return m.popularity || 0;
    case 'idea': return m.score || 0;
    default: return 0;
  }
}

function deriveMetrics(it) {
  if (it.kind === 'creator' || it.kind === 'idea' || it.kind === 'podcast' || it.kind === 'news') return;
  const h = it.history || [];
  if (h.length < 2) return;
  const first = h[0];
  const last = h[h.length - 1];
  it.metrics.growth = +(((last - first) / Math.max(1, first)) * 100).toFixed(1);
  const interval = SOURCE_INTERVAL[it.source] || 120_000;
  const spanMin = Math.max(1, ((h.length - 1) * interval) / 60_000);
  const delta = last - first;
  const v = it.kind === 'video' || it.kind === 'post' ? delta / (spanMin / 60) : delta / spanMin;
  it.metrics.velocity = Math.round(Math.max(it.metrics.velocity || 0, v));
}

const cache = new Map();           // producerId -> items[]
const producerSection = new Map(); // producerId -> sectionId
const sectionProducers = new Map();// sectionId -> [producer]
let producers = [];
let seenUploads = new Map();       // channelId -> Set(videoIds) for new-upload alerts
const alertedTrends = new Set();
const alertedVideos = new Set();
const alertedMoments = new Set();
let eventCursor = 0;
let lastAlertTs = 0;

function canAlert() {
  const now = Date.now();
  if (now - lastAlertTs < 25_000) return false;
  lastAlertTs = now;
  return true;
}

function buildProducers(env) {
  const P = (id, label, section, intervalMs, run) => ({ id, label, section, intervalMs, run });
  return [
    // ── Creator watchlist (YouTube API) ──
    P('creators', 'YouTube · Creator watchlist', 'creators', 12 * 60_000, async () => {
      if (!youtube.youtubeConfigured(env)) return { items: [], mode: 'needs YOUTUBE_API_KEY' };
      const { items, newUploadAlerts, seenNow } = await creatorsMod.buildCreatorsSnapshot(env, seenUploads);
      seenUploads = seenNow;
      for (const a of newUploadAlerts) if (canAlert()) pushAlert({ ...a, score: 90 });
      // Velocity alerts: a fresh video exploding out of the gate.
      for (const cr of items) {
        for (const v of cr.meta?.videos || []) {
          if (v.ageMs < 6 * 3.6e6 && v.velocity > 250_000 && !alertedVideos.has(v.videoId) && canAlert()) {
            alertedVideos.add(v.videoId);
            pushAlert({
              icon: '🚀', title: `${cr.title} is exploding`,
              body: `“${v.title.slice(0, 60)}” — ${v.velocity.toLocaleString()} views/hr after ${(v.ageMs / 3.6e6).toFixed(1)}h`,
              section: 'creators', itemId: cr.id, score: 95,
            });
          }
        }
      }
      return { items, mode: 'live' };
    }),

    // ── Trending videos: search refresh (rare, expensive) ──
    P('youtube-trending', 'YouTube · Trending videos (search)', 'videos', 25 * 60_000, async () => {
      if (!youtube.youtubeConfigured(env)) return { items: [], mode: 'needs YOUTUBE_API_KEY' };
      return { items: await youtube.searchTrendingVideos(env), mode: 'live' };
    }),
    // ── Trending videos: cheap stats refresh (keeps velocity fresh) ──
    P('youtube-stats', 'YouTube · Trending stats refresh', 'videos', 3 * 60_000, async () => {
      const current = cache.get('youtube-trending') || [];
      if (!current.length) return { items: current, mode: 'live' };
      const stats = await youtube.refreshStats(env, current.map((i) => i.id.replace('yt-', '')));
      const now = Date.now();
      for (const it of current) {
        const st = stats.get(it.id.replace('yt-', ''));
        if (st) {
          it.metrics.views = st.views;
          it.metrics.likes = st.likes;
          it.metrics.comments = st.comments;
          const publishedTs = it.meta?.publishedTs || now - it.ageMs;
          it.ageMs = Math.max(0, now - publishedTs);
          const ageH = Math.max(0.5, it.ageMs / 3.6e6);
          it.metrics.velocity = Math.round(st.views / ageH);
        }
      }
      return { items: current, mode: 'live' };
    }),

    // ── Games: Twitch categories (key) + Steam (always) ──
    P('twitch-games', 'Twitch · Top categories', 'games', 120_000, async () => {
      if (!twitch.twitchConfigured(env)) return { items: [], mode: 'needs TWITCH_CLIENT_ID/SECRET' };
      return { items: await twitch.fetchTopGames(env), mode: 'live' };
    }),
    P('steam', 'Steam · Most played today', 'games', 120_000, async () => ({ items: await feeds.fetchSteam(), mode: 'live' })),
    P('steam-week', 'Steam · Weekly top sellers chart', 'games', 3_600_000, async () => ({ items: await feeds.fetchSteamTopSellers(env), mode: 'live' })),

    // ── Trends / Reddit / Podcasts / News (always live, no keys) ──
    P('google-trends', 'Google Trends', 'trends', 300_000, async () => {
      const items = await feeds.fetchGoogleTrends(env);
      for (const t of items) {
        if ((t.metrics?.searches || 0) >= 10_000 && !alertedTrends.has(t.id) && canAlert()) {
          alertedTrends.add(t.id);
          pushAlert({
            icon: '📊', title: `Trend spike: ${t.title}`,
            body: `${t.metrics.searches.toLocaleString()}+ searches and climbing`,
            section: 'trends', itemId: t.id, score: 80,
          });
        }
      }
      return { items, mode: 'live' };
    }),
    P('reddit', 'Reddit · Hot + top of the week', 'reddit', 180_000, async () => ({
      items: await reddit.fetchReddit(env),
      mode: reddit.redditConfigured(env) ? 'live (OAuth)' : 'live (public JSON)',
    })),
    P('apple-podcasts', 'Apple Podcasts · Top charts', 'podcasts', 600_000, async () => ({
      items: await feeds.fetchPodcasts(env), mode: 'live',
    })),
    P('news-rss', 'News · DEXERTO, PC Gamer, Eurogamer, Verge, IGN', 'news', 300_000, async () => ({
      items: await feeds.fetchNews(), mode: 'live',
    })),

    // ── Moment Vault: collect trending moments, guard them forever ──
    P('moments', 'Moment Vault · Twitch clips + r/soccer + event highlights', 'moments', 600_000, async () => {
      const collected = [];
      const sourcesUsed = [];
      // 1) Real Twitch clips: top games + watchlist creators (last 30 days).
      if (twitch.twitchConfigured(env)) {
        const startedAt = new Date(Date.now() - 30 * 864e5).toISOString();
        const gameIds = (cache.get('twitch-games') || []).slice(0, 5).map((i) => i.id.replace('twg-', ''));
        const clipSets = await Promise.allSettled(gameIds.map((gid) => twitch.fetchGameClips(env, gid, startedAt, 20)));
        for (const r of clipSets) if (r.status === 'fulfilled') for (const c of r.value) collected.push(clipToMoment(c));
        const logins = creatorsMod.getWatchlist().map((c) => c.twitch).filter(Boolean);
        try {
          for (const c of await twitch.fetchCreatorClips(env, logins, startedAt)) collected.push(clipToMoment(c));
        } catch { /* best effort */ }
        sourcesUsed.push('twitch-clips');
      }
      // 2) Real goal/highlight clips from r/soccer + r/footballhighlights.
      try {
        const posts = await reddit.fetchSoccerPosts(env);
        for (const d of posts) collected.push(redditPostToMoment(d));
        sourcesUsed.push('reddit-soccer');
      } catch { /* public JSON may be rate-limited */ }
      // 3) Event highlights on YouTube — one event per cycle, round-robin.
      if (youtube.youtubeConfigured(env)) {
        const ev = EVENTS[eventCursor % EVENTS.length];
        eventCursor++;
        try {
          for (const v of await youtube.searchEventVideos(env, ev.queries[0])) collected.push(ytToMoment(v, ev));
          sourcesUsed.push('youtube-events');
        } catch { /* quota or network */ }
      }
      const added = await ingestMoments(collected);
      // Alert when a freshly vaulted moment is already huge.
      for (const m of collected) {
        if ((m.metrics?.views || 0) > 150_000 && m.ageMs < 48 * 3.6e6 && !alertedMoments.has(m.id) && canAlert()) {
          alertedMoments.add(m.id);
          pushAlert({
            icon: '🎬', title: `Viral moment: ${m.title.slice(0, 60)}`,
            body: `${m.metrics.views.toLocaleString()} views · vaulted under ${m.meta?.eventName || m.meta?.categoryName || 'highlights'}`,
            section: 'moments', itemId: m.id, score: 88,
          });
        }
      }
      return {
        items: vaultItems(),
        mode: sourcesUsed.length ? `live (${sourcesUsed.join(' + ')}) · +${added} new · vault ${getVault().length}` : 'needs TWITCH/YOUTUBE keys or Reddit access',
      };
    }),
  ];
}

/** Merge producer caches for a section, keep history, score, rank, broadcast. */
function rebuildSection(sectionId) {
  const prods = sectionProducers.get(sectionId) || [];
  let items = prods.flatMap((p) => cache.get(p.id) || []);

  // Games: build two real charts — TODAY (live players + Twitch viewers) and
  // THIS WEEK (Steam rolling top-sellers chart, enriched with live players).
  if (sectionId === 'games') {
    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const dayItems = items.filter((i) => i.meta?.window === 'day');
    const weekItems = items.filter((i) => i.meta?.window === 'week');
    const twByName = new Map(items.filter((i) => i.source === 'twitch').map((i) => [norm(i.title), i]));
    for (const it of dayItems) {
      if (it.source === 'twitch') continue;
      const match = twByName.get(norm(it.title));
      if (match?.metrics.viewers) {
        it.metrics.viewers = match.metrics.viewers;
        if (!it.platform.includes('Twitch')) it.platform += ' · Twitch';
      }
    }
    const dayByName = new Map(dayItems.map((i) => [norm(i.title), i]));
    for (const it of weekItems) {
      const match = dayByName.get(norm(it.title));
      if (match?.metrics.players) it.metrics.players = match.metrics.players;
    }
    items = [...dayItems, ...weekItems];
  }

  const prev = new Map((store.sections.get(sectionId)?.items || []).map((i) => [i.id, i]));
  for (const it of items) {
    const old = prev.get(it.id);
    const pv = primaryValue(it);
    if (old?.history?.length) it.history = [...old.history, pv].slice(-40);
    else if (!it.history?.length) it.history = [pv];
    deriveMetrics(it);
  }

  if (sectionId === 'games') {
    // Two independent charts: today ranked by live activity, week by Steam chart position.
    applyScores(items);
    const day = byScoreDesc(items.filter((i) => i.meta?.window === 'day'));
    const week = items
      .filter((i) => i.meta?.window === 'week')
      .sort((a, b) => ((a.metrics.weeklyRank || 999) - (b.metrics.weeklyRank || 999)) || (b.metrics.score - a.metrics.score));
    day.forEach((it, i) => (it.rank = i + 1));
    week.forEach((it, i) => (it.rank = i + 1));
    items = [...day, ...week];
  } else if (sectionId !== 'ideas') {
    applyScores(items);
    items = byScoreDesc(items);
    items.forEach((it, i) => (it.rank = i + 1));
  } else {
    items.forEach((it, i) => (it.rank = i + 1));
  }

  // Attach per-source health so the UI can show honest statuses.
  const sec = store.sections.get(sectionId);
  if (sec) sec.meta.sources = prods.map((p) =>
    getSourceStatus(p.id) || { id: p.id, label: p.label, mode: 'pending…', ok: false }
  );

  setItems(sectionId, items);
  if (['creators', 'trends', 'news', 'games', 'reddit', 'moments', 'videos'].includes(sectionId)) rebuildIdeas();
  if (['creators', 'trends', 'reddit', 'moments', 'videos'].includes(sectionId)) rebuildNow();
  if (sectionId !== 'viral' && sectionId !== 'ideas') rebuildViral();
}

/** Opportunity engine — "what should I clip RIGHT NOW?" */
function rebuildNow() {
  const get = (id) => store.sections.get(id)?.items || [];
  const opps = buildOpportunities({
    creators: get('creators'),
    moments: vaultItems(),
    topics: get('trends'),
    posts: get('reddit'),
    videos: get('videos'),
  });
  const rankings = buildRankings(opps);
  rankings.vault = rankVaultMatches(vaultItems(), get('trends').map((t) => t.title), get('news').map((n) => n.title));
  const sec = store.sections.get('now');
  if (sec) sec.meta.rankings = rankings;
  setItems('now', opps);
  saveSeen().catch(() => {});
}

/** Top-5 ideas engine — regenerated whenever its real inputs change. */
function rebuildIdeas() {
  const get = (id) => store.sections.get(id)?.items || [];
  const vault = vaultItems();
  const trends = get('trends').map((t) => t.title);
  const ideas = buildIdeas({
    creators: get('creators'),
    topics: get('trends'),
    news: get('news'),
    games: get('games'),
    posts: get('reddit'),
    moments: vault,
    compilations: buildCompilations(vault),
    trendingAgainList: trendingAgain(vault, trends),
  });
  setItems('ideas', ideas);
}

/** Cross-section ranking of the strongest real opportunities. */
function rebuildViral() {
  const all = [];
  for (const s of store.sections.values()) {
    if (s.id === 'viral' || s.id === 'ideas' || s.id === 'now') continue;
    for (const it of s.items.slice(0, 6)) all.push({ ...it, originSection: s.id, metrics: { ...it.metrics } });
  }
  applyScores(all);
  const top = byScoreDesc(all).slice(0, 18);
  top.forEach((it, i) => (it.rank = i + 1));
  setItems('viral', top);
}

async function runProducer(p) {
  try {
    const { items, mode } = await p.run();
    cache.set(p.id, items);
    const status = { id: p.id, label: p.label, section: p.section, mode, ok: true, count: items.length, ts: Date.now() };
    setSourceStatus(p.id, status);
    rebuildSection(p.section);
  } catch (e) {
    const status = { id: p.id, label: p.label, section: p.section, mode: 'error', ok: false, error: String(e?.message || e), ts: Date.now() };
    setSourceStatus(p.id, status);
    // Keep last cache if any; otherwise the section stays empty and shows the error. Never fake data.
    rebuildSection(p.section);
  }
}

export async function startScheduler(env) {
  for (const s of SECTIONS) registerSection(s);
  await creatorsMod.loadCustomCreators();
  await loadVault();
  await loadSeen();
  producers = buildProducers(env);
  for (const p of producers) {
    producerSection.set(p.id, p.section);
    if (!sectionProducers.has(p.section)) sectionProducers.set(p.section, []);
    sectionProducers.get(p.section).push(p);
  }
  await Promise.allSettled(producers.map((p) => runProducer(p)));
  rebuildIdeas();
  rebuildNow();
  rebuildViral();
  for (const p of producers) setInterval(() => runProducer(p), p.intervalMs);
}

/** Force-refresh a producer (used after adding/removing a creator). */
export async function refreshProducer(id) {
  const p = producers.find((x) => x.id === id);
  if (p) await runProducer(p);
}

/** Global search: dashboard items + live API searches where keys exist. */
export async function globalSearch(env, q) {
  const ql = q.trim().toLowerCase();
  if (!ql) return { q, local: [], sources: [] };
  const local = [];
  for (const s of store.sections.values()) {
    if (s.id === 'viral' || s.id === 'ideas' || s.id === 'now') continue;
    for (const it of s.items) {
      const hay = `${it.title} ${it.subtitle} ${it.author} ${it.category} ${it.platform}`.toLowerCase();
      if (hay.includes(ql)) local.push({ ...it, originSection: s.id });
      if (local.length >= 12) break;
    }
    if (local.length >= 12) break;
  }
  const jobs = [];
  if (twitch.twitchConfigured(env)) jobs.push(twitch.searchChannels(env, q).then((items) => ({ source: 'Twitch', items })).catch(() => null));
  if (youtube.youtubeConfigured(env)) jobs.push(youtube.searchVideos(env, q).then((items) => ({ source: 'YouTube', items })).catch(() => null));
  jobs.push(reddit.searchReddit(env, q).then((items) => ({ source: 'Reddit', items })).catch(() => null));
  const done = await Promise.all(jobs);
  return { q, local, sources: done.filter((r) => r && r.items && r.items.length) };
}
