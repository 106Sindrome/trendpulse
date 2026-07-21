// ─────────────────────────────────────────────────────────────
// Moment Vault — automatically collects trending moments from
// REAL sources (Twitch clips, r/soccer goal clips, YouTube event
// highlights) and GUARDS them in data/moments.json so they can be
// browsed by week / month / year, by event (World Cup 2026, VCT,
// Worlds…) and by category (goals, god-level plays, fails…) to
// plan compilations like "Top 5 goals of the Mundial 2026".
// ─────────────────────────────────────────────────────────────
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkItem } from './items.js';
import { buildSource, buildSourceChain, buildDetectedSignals, verificationStatus, ensureProvenance } from './metadata.js';

const VAULT_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'moments.json');
const MAX_VAULT = 600;

export const EVENTS = [
  { id: 'wc2026', name: 'World Cup 2026', icon: '🏆', category: 'goals',
    queries: ['World Cup 2026 best goals', 'World Cup 2026 best moments'],
    keywords: ['world cup', 'mundial', 'fifa world cup', 'wc 2026', 'worldcup', 'copa del mundo'] },
  { id: 'ucl', name: 'Champions League', icon: '🌟', category: 'goals',
    queries: ['Champions League best goals this week'],
    keywords: ['champions league', 'ucl'] },
  { id: 'vct', name: 'Valorant Champions', icon: '🎯', category: 'godlike',
    queries: ['VCT highlights ace clutch'],
    keywords: ['vct', 'valorant champions'] },
  { id: 'worlds', name: 'LoL Worlds', icon: '⚔️', category: 'godlike',
    queries: ['LoL Worlds best plays highlights'],
    keywords: ['lol worlds', 'worlds 2026', 'league worlds'] },
  { id: 'speed', name: 'Speed', icon: '⚡', category: 'reactions',
    queries: ['IShowSpeed best moments'],
    keywords: ['ishowspeed'] },
  { id: 'kai', name: 'Kai Cenat', icon: '🎪', category: 'reactions',
    queries: ['Kai Cenat funniest moments'],
    keywords: ['kai cenat'] },
  { id: 'rogan', name: 'Joe Rogan', icon: '🎙️', category: 'reactions',
    queries: ['Joe Rogan best moments JRE'],
    keywords: ['joe rogan', 'jre '] },
];

export const CATEGORIES = {
  goals: { name: 'Goals', icon: '⚽' },
  godlike: { name: 'God-level plays', icon: '😇' },
  fails: { name: 'Fails', icon: '😂' },
  reactions: { name: 'Reactions', icon: '🔥' },
  highlights: { name: 'Highlights', icon: '🎬' },
};

export function detectEvent(text) {
  const t = (text || '').toLowerCase();
  for (const e of EVENTS) if (e.keywords.some((k) => t.includes(k))) return e;
  return null;
}
export function detectCategory(text, forced) {
  const t = (text || '').toLowerCase();
  if (/\bgoals?|goalazo|free kick|penalt|hat[ -]?trick|bicycle|volley|striker|keeper|goalkeeper/.test(t)) return 'goals';
  if (/\bace\b|1v[0-9]|clutch|god|unreal|insane|outplay|mechanics|play of the (game|match)/.test(t)) return 'godlike';
  if (/\bfail|funny|lmao|worst|miss(ed)?|blunder|bloopers|own goal/.test(t)) return 'fails';
  if (/\breaction|reacts|rage|celebrat|meltdown/.test(t)) return 'reactions';
  return forced || 'highlights';
}

function momentMeta(text, forced, extra = {}) {
  const ev = detectEvent(text);
  const cat = detectCategory(text, forced);
  return {
    event: ev?.id || '',
    eventName: ev?.name || '',
    eventIcon: ev?.icon || '',
    category: cat,
    categoryName: CATEGORIES[cat].name,
    categoryIcon: CATEGORIES[cat].icon,
    ...extra,
  };
}
function momentTags(meta) {
  return [
    meta.eventName ? `${meta.eventIcon} ${meta.eventName}` : null,
    `${meta.categoryIcon} ${meta.categoryName}`,
  ].filter(Boolean);
}

// ── Converters from raw source data → vault items ────────────
export function clipToMoment(c) {
  const created = new Date(c.created_at).getTime();
  const title = c.title || `${c.broadcaster_name} clip`;
  const text = `${title} ${c.game_name || ''} ${c.broadcaster_name || ''}`;
  const meta = momentMeta(text, null, {
    publishedTs: created, creator: c.broadcaster_name || '', game: c.game_name || '',
    vodOffset: c.vod_offset ?? null,   // real timestamp into the source VOD
    duration: c.duration ?? null,      // real clip length in seconds
  });
  const slug = (c.url || '').split('/').pop();
  return mkItem({
    id: 'clip-' + c.id,
    section: 'moments', source: 'twitch-clips', platform: 'Twitch', kind: 'moment',
    title,
    subtitle: `${c.broadcaster_name || ''}${c.game_name ? ' · ' + c.game_name : ''}`,
    author: c.broadcaster_name || '',
    category: meta.categoryName,
    url: c.url,
    thumbnail: c.thumbnail_url || null,
    embed: { type: 'twitch-clip', src: c.embed_url || `https://clips.twitch.tv/embed?clip=${encodeURIComponent(slug)}` },
    ageMs: Math.max(0, Date.now() - created),
    timeless: true, // windowed by the vault's own Week/Month/Year chips
    metrics: { views: c.view_count || 0, growth: 0, velocity: 0 },
    meta,
    tags: momentTags(meta),
  });
}

export function ytToMoment(v, ev) {
  const published = v.publishedAt ? new Date(v.publishedAt).getTime() : Date.now();
  const meta = {
    event: ev?.id || '', eventName: ev?.name || '', eventIcon: ev?.icon || '',
    category: detectCategory(v.title, ev?.category),
    publishedTs: published, creator: v.channel || '',
  };
  meta.categoryName = CATEGORIES[meta.category].name;
  meta.categoryIcon = CATEGORIES[meta.category].icon;
  return mkItem({
    id: 'ytm-' + v.videoId,
    section: 'moments', source: 'youtube-events', platform: 'YouTube', kind: 'moment',
    title: v.title,
    subtitle: v.channel || '',
    author: v.channel || '',
    category: meta.categoryName,
    url: `https://www.youtube.com/watch?v=${v.videoId}`,
    thumbnail: v.thumb || null,
    embed: { type: 'youtube', id: v.videoId },
    ageMs: Math.max(0, Date.now() - published),
    timeless: true,
    metrics: { views: v.views || 0, growth: 0, velocity: 0 },
    meta,
    tags: momentTags(meta),
  });
}

export function redditPostToMoment(d) {
  const created = (d.created_utc || Date.now() / 1000) * 1000;
  const text = `${d.title} ${d.link_flair_text || ''}`;
  const meta = momentMeta(text, 'goals', { publishedTs: created, creator: 'u/' + (d.author || ''), viewsLabel: 'upvotes' });
  const thumb = typeof d.thumbnail === 'string' && d.thumbnail.startsWith('http')
    ? d.thumbnail
    : d.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, '&') || null;
  const isExternal = /^(https?:\/\/(?!www\.reddit\.com))/.test(d.url || '');
  return mkItem({
    id: 'rdm-' + d.id,
    section: 'moments', source: 'reddit-soccer', platform: 'Reddit', kind: 'moment',
    title: d.title,
    subtitle: `r/${d.subreddit} · ▲ ${d.ups ?? d.score ?? 0}`,
    author: 'u/' + (d.author || ''),
    category: meta.categoryName,
    url: isExternal ? d.url : `https://www.reddit.com${d.permalink || ''}`,
    thumbnail: thumb,
    embed: /youtu\.be|youtube\.com/.test(d.url || '') ? { type: 'youtube', id: (d.url.match(/(?:v=|youtu\.be\/)([\w-]{11})/) || [])[1] || '' } : null,
    ageMs: Math.max(0, Date.now() - created),
    timeless: true,
    metrics: { views: d.ups ?? d.score ?? 0, growth: 0, velocity: 0 },
    meta,
    tags: momentTags(meta),
  });
}

/** Save an analyzed YouTube moment into the vault. */
export function analyzedToMoment(video, m) {
  const text = `${m.title} ${video.title} ${video.author}`;
  const meta = momentMeta(text, null, {
    publishedTs: Date.now() - (m.start * 1000), // approx: treated as captured now
    creator: video.author || '',
    vodOffset: m.start,
    duration: m.length,
    analyzed: true,
    score: m.score,
    detectedTs: Date.now(),
  });
  meta.source = buildSource({ platform: 'YouTube', url: `https://www.youtube.com/watch?v=${video.id}&t=${m.start}`, author: video.author, title: m.title, meta, thumbnail: video.thumbnail, metrics: { views: m.views || 0, velocity: m.velocity || 0 } });
  meta.detectedSignals = buildDetectedSignals({ platform: 'YouTube', title: m.title, meta, metrics: { views: m.views || 0, velocity: m.velocity || 0 } });
  meta.sourceChain = buildSourceChain({ platform: 'YouTube', meta });
  meta.verification = 'verified';
  return mkItem({
    id: `yta-${video.id}-${m.start}`,
    section: 'moments', source: 'analyzer', platform: 'YouTube', kind: 'moment',
    title: `${m.title} \u2014 ${video.title}`.slice(0, 140),
    subtitle: `${video.author} \u00b7 \u23f1 ${fmtT(m.start)}\u2013${fmtT(m.end)} \u00b7 score ${m.score}`,
    author: video.author || '',
    category: meta.categoryName,
    url: `https://www.youtube.com/watch?v=${video.id}&t=${m.start}`,
    thumbnail: video.thumbnail,
    embed: { type: 'youtube', id: video.id, start: m.start },
    ageMs: 0,
    timeless: true,
    metrics: { views: m.score, growth: 0, velocity: 0 },
    meta,
    tags: [...momentTags(meta), `\u23f1 ${fmtT(m.start)}`],
  });
}
const fmtT = (s) => {
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(ss).padStart(2, '0');
};

// ── Vault persistence ────────────────────────────────────────
let vault = [];
const knownIds = new Set();

export async function loadVault() {
  try {
    vault = JSON.parse(await readFile(VAULT_FILE, 'utf8'));
    if (!Array.isArray(vault)) vault = [];
  } catch {
    vault = [];
  }
  for (const m of vault) { knownIds.add(m.id); ensureProvenance(m); }
  return vault.length;
}

async function saveVault() {
  await mkdir(dirname(VAULT_FILE), { recursive: true });
  await writeFile(VAULT_FILE, JSON.stringify(vault));
}

/** Append new moments (deduped), prune to MAX_VAULT, persist. Returns added count. */
export async function ingestMoments(items) {
  let added = 0;
  for (const it of items) {
    if (!it?.id || knownIds.has(it.id)) continue;
    knownIds.add(it.id);
    vault.push(it);
    added++;
  }
  if (added) {
    if (vault.length > MAX_VAULT) {
      const now = Date.now();
      const recent = vault.filter((m) => now - (m.meta?.publishedTs || 0) <= 30 * 864e5);
      const older = vault
        .filter((m) => now - (m.meta?.publishedTs || 0) > 30 * 864e5)
        .sort((a, b) => (b.metrics?.views || 0) - (a.metrics?.views || 0));
      vault = [...recent, ...older].slice(0, MAX_VAULT);
      knownIds.clear();
      for (const m of vault) knownIds.add(m.id);
    }
    await saveVault();
  }
  return added;
}

export function getVault() {
  return vault;
}

/** Vault items with fresh ageMs for broadcast. */
export function vaultItems() {
  const now = Date.now();
  return vault
    .map((m) => ({ ...m, ageMs: Math.max(0, now - (m.meta?.publishedTs || now - m.ageMs)) }))
    .filter((m) => m.ageMs <= 365 * 864e5);
}
