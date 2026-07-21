// ─────────────────────────────────────────────────────────────
// AI Compilation Engine — answers "what compilations can I make
// RIGHT NOW from clips I already have?" by clustering the Vault.
// Every suggestion is backed by real stored moments (zero extra
// searching). Falls back to trend-evidence ideas only when the
// Vault is too sparse to compile from.
// ─────────────────────────────────────────────────────────────
import { buildFacets } from './metadata.js';

const avg = (arr, f) => arr.length ? Math.round(arr.reduce((s, m) => s + f(m), 0) / arr.length) : 0;
const sumDur = (arr) => arr.reduce((s, m) => s + (m.meta?.duration || 0), 0);
const fmtDur = (s) => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
const difficulty = (n, dur) => n <= 5 && dur < 90 ? 'Easy' : n <= 10 && dur < 240 ? 'Medium' : 'Hard';

const LABEL = {
  emotion: { funny: 'Funniest', rage: 'Rage', clutch: 'Clutch', excitement: 'Most Hype', shock: 'Most Shocking', joy: 'Wholesome', anger: 'Angriest', fear: 'Scariest', sadness: 'Most Emotional', suspense: 'Most Suspenseful', humor: 'Funniest' },
  momentType: { reaction: 'Reactions', clutch: 'Clutch Plays', fail: 'Fails', goal: 'Goals', save: 'Saves', penalty: 'Penalties', freekick: 'Free Kicks', celebration: 'Celebrations', redcard: 'Red Cards', speedrun: 'Speedruns', bossfight: 'Boss Fights', pvp: 'PvP Clips', donation: 'Donation Moments', wholesome: 'Wholesome Moments', rage: 'Rage Moments', lucky: 'Luckiest Moments', bug: 'Bugs & Secrets' },
};

function compFromMoments(title, moments, why, kind) {
  if (moments.length < 3) return null;
  const byVirality = [...moments].sort((a, b) => (b.meta?.scores?.virality || 0) - (a.meta?.scores?.virality || 0));
  const clips = byVirality.slice(0, 12);
  const dur = sumDur(clips);
  return {
    id: `comp-${kind}-${title.replace(/[^a-z0-9]+/gi, '-').slice(0, 40).toLowerCase()}`,
    kind, title,
    clipCount: clips.length, totalInGroup: moments.length,
    estDuration: fmtDur(dur), estSeconds: dur,
    difficulty: difficulty(clips.length, dur),
    why,
    trendScore: avg(clips, (m) => m.meta?.scores?.virality || 0),
    evergreenScore: avg(clips, (m) => m.meta?.scores?.evergreen || 0),
    clips: clips.map((m) => m.id),
    ready: true,
  };
}

/** Cluster the Vault into ready-to-make compilations. */
export function buildCompilations(moments) {
  const out = [];
  const f = buildFacets(moments);
  const byId = new Map(moments.map((m) => [m.id, m]));
  const group = (key) => moments.filter((m) => {
    const md = m.meta || {};
    switch (key.split(':')[0]) {
      case 'creator': return md.creator === key.slice(8);
      case 'game': return (md.games || []).includes(key.slice(5)) || md.game === key.slice(5);
      case 'event': return md.event === key.slice(6);
      case 'emotion': return !!(md.emotions || {})[key.slice(8)];
      case 'momentType': return md.momentType === key.slice(11);
      case 'tag': return (md.tags || []).includes(key.slice(4));
      default: return false;
    }
  });

  // Creator × emotion  → "Top 5 Funniest Kai Cenat Reactions"
  for (const [creator] of f.creator.slice(0, 14)) {
    const cm = moments.filter((m) => (m.meta?.creator) === creator);
    const emoFacet = buildFacets(cm).emotion;
    for (const [emo] of emoFacet.slice(0, 3)) {
      const lab = LABEL.emotion[emo] || emo;
      const set = cm.filter((m) => (m.meta?.emotions || {})[emo]);
      const c = compFromMoments(`Top ${Math.min(10, set.length)} ${lab} ${creator} Moments`, set, `You already have ${set.length} ${emo} clips from ${creator} — no searching needed.`, 'creator-emotion');
      if (c) out.push(c);
    }
    // Creator overall series / "reacts"
    if (cm.length >= 4) {
      const reacts = cm.filter((m) => (m.meta?.tags || []).includes('reactions') || m.meta?.momentType === 'reaction');
      if (reacts.length >= 3) {
        const c = compFromMoments(`Top ${Math.min(10, reacts.length)} ${creator} Reactions`, reacts, `${reacts.length} reaction clips stored — a ready "${creator} reacts" compilation.`, 'series');
        if (c) out.push(c);
      }
      const c2 = compFromMoments(`Best of ${creator} (${cm.length} clips)`, cm, `Your ${cm.length} saved ${creator} clips form a complete "best of" reel.`, 'creator');
      if (c2) out.push(c2);
    }
  }
  // Game × momentType → "Top 10 Valorant Aces"
  for (const [game] of f.game.slice(0, 12)) {
    const gm = moments.filter((m) => (m.meta?.games || []).includes(game) || m.meta?.game === game);
    const mtFacet = buildFacets(gm).momentType;
    for (const [mt] of mtFacet.slice(0, 3)) {
      const lab = LABEL.momentType[mt] || mt;
      const set = gm.filter((m) => m.meta?.momentType === mt);
      const c = compFromMoments(`Top ${Math.min(10, set.length)} ${game} ${lab}`, set, `${set.length} ${mt} clips for ${game} already in your Vault.`, 'game-type');
      if (c) out.push(c);
    }
    if (gm.length >= 5) { const c = compFromMoments(`Best of ${game} (${gm.length} clips)`, gm, `${gm.length} ${game} clips ready to compile.`, 'game'); if (c) out.push(c); }
  }
  // Event → "Top 10 World Cup 2026 Goals"
  for (const [event] of f.event.slice(0, 12)) {
    const em = moments.filter((m) => m.meta?.event === event);
    const c = compFromMoments(`Top ${Math.min(10, em.length)} ${event} Moments`, em, `${em.length} clips tagged "${event}" — compile the event recap now.`, 'event');
    if (c) out.push(c);
    const mtFacet = buildFacets(em).momentType;
    for (const [mt] of mtFacet.slice(0, 2)) {
      const set = em.filter((m) => m.meta?.momentType === mt);
      const lab = LABEL.momentType[mt] || mt;
      const c2 = compFromMoments(`Top ${Math.min(10, set.length)} ${event} ${lab}`, set, `${set.length} ${mt} clips from ${event} stored.`, 'event-type');
      if (c2) out.push(c2);
    }
  }
  // Tag-based evergreen reels → "Satisfying Compilation", "Funny Fails"
  for (const [tag] of f.tag.slice(0, 10)) {
    const set = moments.filter((m) => (m.meta?.tags || []).includes(tag));
    if (set.length >= 4) {
      const pretty = tag.charAt(0).toUpperCase() + tag.slice(1);
      const c = compFromMoments(`${pretty} Compilation (${set.length} clips)`, set, `${set.length} "${tag}" clips — a faceless, evergreen reel.`, 'tag');
      if (c) out.push(c);
    }
  }

  // dedupe by id, rank by (ready * trend * log(size))
  const seen = new Set();
  return out
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .map((c) => ({ ...c, rankScore: Math.round(c.trendScore * 0.6 + c.evergreenScore * 0.2 + Math.min(20, c.clipCount * 2)) }))
    .sort((a, b) => b.rankScore - a.rankScore)
    .map((c, i) => ({ ...c, rank: i + 1 }));
}

/** "Trending again" — Vault clusters that match what's live right now. */
export function trendingAgain(moments, trendTitles) {
  const trendText = trendTitles.join(' ').toLowerCase();
  const trendWords = [...new Set(trendText.match(/[a-z0-9]{4,}/g) || [])].filter((w) => !['this', 'that', 'with', 'from', 'your', 'about'].includes(w));
  const out = [];
  const f = buildFacets(moments);
  const check = (label, count, ids) => {
    const lw = label.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const overlap = lw.filter((w) => trendWords.some((tw) => tw.includes(w) || w.includes(tw))).length;
    if (overlap > 0 && count >= 2) out.push({ label, count, overlap, ids });
  };
  for (const [c, n] of f.creator) check(c, n, moments.filter((m) => m.meta?.creator === c).map((m) => m.id));
  for (const [g, n] of f.game) check(g, n, moments.filter((m) => (m.meta?.games || []).includes(g) || m.meta?.game === g).map((m) => m.id));
  for (const [e, n] of f.event) check(e, n, moments.filter((m) => m.meta?.event === e).map((m) => m.id));
  for (const [t, n] of f.tag) check(t, n, moments.filter((m) => (m.meta?.tags || []).includes(t)).map((m) => m.id));
  return out.sort((a, b) => b.overlap * b.count - a.overlap * a.count).slice(0, 8);
}

/** Series detection — recurring formats like "Kai Reacts ep 1..N". */
export function detectSeries(moments) {
  const series = [];
  const byCreator = {};
  for (const m of moments) { const c = m.meta?.creator; if (c) (byCreator[c] = byCreator[c] || []).push(m); }
  for (const [creator, list] of Object.entries(byCreator)) {
    const reacts = list.filter((m) => (m.meta?.tags || []).includes('reactions') || m.meta?.momentType === 'reaction');
    const eps = list.filter((m) => /(?:part|episode|ep\.?\s*)\s*\d+/i.test(m.title || ''));
    if (reacts.length >= 3) series.push({ creator, type: 'reactions', count: reacts.length, ids: reacts.map((m) => m.id), suggestion: `Top 10 ${creator} Reactions` });
    if (eps.length >= 3) series.push({ creator, type: 'episodes', count: eps.length, ids: eps.map((m) => m.id), suggestion: `${creator} — full series recap` });
  }
  return series;
}
