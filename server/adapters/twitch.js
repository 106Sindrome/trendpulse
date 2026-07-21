// Twitch Helix adapter — repurposed for a creator-focused dashboard:
//   • live status for the creator watchlist (are they live right now?)
//   • top game categories (what games are popping off → clip opportunities)
// There is no "top live streams" ranking — TrendPulse tracks creators, not streams.
// Auth: client_credentials app token (Client ID + Secret only).
import { fetchJSON, formPost } from '../lib/http.js';
import { mkItem, footballTags } from '../items.js';

let token = null;
let tokenExp = 0;

export function twitchConfigured(env) {
  return !!(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET);
}

async function appToken(env) {
  if (token && Date.now() < tokenExp) return token;
  const r = await formPost('https://id.twitch.tv/oauth2/token', {
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });
  token = r.access_token;
  tokenExp = Date.now() + ((r.expires_in || 3600) - 120) * 1000;
  return token;
}

async function helix(path, env) {
  const t = await appToken(env);
  return fetchJSON(`https://api.twitch.tv/helix/${path}`, {
    headers: { 'Client-Id': env.TWITCH_CLIENT_ID, Authorization: `Bearer ${t}` },
  });
}

/** Live status for up to 100 logins in one call → Map(login → {viewers, game, title}). */
export async function fetchLiveStatus(env, logins) {
  const clean = [...new Set(logins.filter(Boolean).map((l) => l.toLowerCase()))];
  if (!clean.length) return new Map();
  const qs = clean.slice(0, 100).map((l) => `user_login=${encodeURIComponent(l)}`).join('&');
  const j = await helix(`streams?${qs}&first=100`, env);
  return new Map(
    (j.data || []).map((s) => [
      s.user_login.toLowerCase(),
      { live: true, viewers: s.viewer_count, game: s.game_name || '', title: s.title || '', startedAt: s.started_at },
    ])
  );
}

/** Top Twitch game categories (real viewer-driven signal for clip hunters). */
export async function fetchTopGames(env) {
  const [games, streams] = await Promise.all([
    helix('games/top?first=24', env),
    helix('streams?first=100', env),
  ]);
  // Approximate per-game viewers by summing the top-100 live streams.
  const viewersByGame = new Map();
  for (const s of streams.data || []) {
    viewersByGame.set(s.game_name, (viewersByGame.get(s.game_name) || 0) + s.viewer_count);
  }
  return (games.data || []).map((g) =>
    mkItem({
      id: `twg-${g.id}`,
      section: 'games', source: 'twitch', platform: 'Twitch', kind: 'game',
      title: g.name, subtitle: 'Twitch category', category: g.name,
      url: `https://www.twitch.tv/directory/category/${encodeURIComponent(g.name)}`,
      thumbnail: (g.box_art_url || '').replace('{width}', '188').replace('{height}', '250'),
      meta: { window: 'day' },
      tags: footballTags(g.name),
      metrics: { viewers: viewersByGame.get(g.name) || 0, players: 0, clips: 0, growth: 0, velocity: 0 },
    })
  );
}

/** Community-clipped moments for a game, since `startedAt` (ISO). */
export async function fetchGameClips(env, gameId, startedAt, first = 20) {
  const j = await helix(`clips?game_id=${gameId}&first=${first}&started_at=${startedAt}`, env);
  return j.data || [];
}

/** Clips from watchlist creators (resolves logins → ids in one call). */
export async function fetchCreatorClips(env, logins, startedAt) {
  const clean = [...new Set(logins.filter(Boolean))].slice(0, 8);
  if (!clean.length) return [];
  const qs = clean.map((l) => `login=${encodeURIComponent(l)}`).join('&');
  const users = await helix(`users?${qs}`, env);
  const out = [];
  for (const u of (users.data || []).slice(0, 6)) {
    try {
      const j = await helix(`clips?broadcaster_id=${u.id}&first=8&started_at=${startedAt}`, env);
      out.push(...(j.data || []));
    } catch { /* best effort per creator */ }
  }
  return out;
}

export async function searchChannels(env, q) {
  const j = await helix(`search/channels?query=${encodeURIComponent(q)}&first=6`, env);
  return (j.data || []).map((c) => ({
    platform: 'Twitch',
    title: c.display_name,
    subtitle: c.is_live ? `LIVE · ${c.game_name}` : 'Offline',
    url: `https://www.twitch.tv/${c.broadcaster_login}`,
    thumbnail: c.thumbnail_url || null,
    live: c.is_live,
    kind: 'stream',
  }));
}
