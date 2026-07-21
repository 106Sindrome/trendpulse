// Creator watchlist — the heart of TrendPulse.
// Tracks streamers/YouTubers by their REAL latest uploads: views, likes,
// comments, velocity (views/hour since publish) and live status on Twitch.
// The default roster focuses on clip-able creators (Speed, Kai Cenat,
// Joe Rogan…); users can add more from the UI (persisted in data/watchlist.json).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkItem } from './items.js';
import * as youtube from './adapters/youtube.js';
import * as twitch from './adapters/twitch.js';

const DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'watchlist.json');

// name/handle = YouTube handle; twitch = Twitch login for live status (optional)
export const DEFAULT_CREATORS = [
  { name: 'IShowSpeed', handle: 'IShowSpeed', twitch: 'ishowspeed' },
  { name: 'Kai Cenat', handle: 'KaiCenat', twitch: 'kaicenat' },
  { name: 'Joe Rogan', handle: 'joerogan', twitch: null },
  { name: 'MrBeast', handle: 'MrBeast', twitch: null },
  { name: 'xQc', handle: 'xQc', twitch: 'xqc' },
  { name: 'Sidemen', handle: 'Sidemen', twitch: null },
  { name: 'KSI', handle: 'KSI', twitch: null },
  { name: 'Logan Paul', handle: 'LoganPaul', twitch: null },
  { name: 'Pokimane', handle: 'pokimane', twitch: 'pokimane' },
  { name: 'HasanAbi', handle: 'hasanabi', twitch: 'hasanabi' },
];

let custom = [];

export async function loadCustomCreators() {
  try {
    custom = JSON.parse(await readFile(DATA_FILE, 'utf8'));
    if (!Array.isArray(custom)) custom = [];
  } catch {
    custom = [];
  }
}

async function persist() {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(custom, null, 2));
}

export function getWatchlist() {
  const seen = new Set(DEFAULT_CREATORS.map((c) => c.handle.toLowerCase()));
  return [...DEFAULT_CREATORS, ...custom.filter((c) => !seen.has(String(c.handle).toLowerCase()))];
}

export async function addCreator({ name, handle, twitchLogin }) {
  const h = String(handle || '').replace(/^@/, '').trim();
  if (!h) throw new Error('handle required');
  if (getWatchlist().some((c) => c.handle.toLowerCase() === h.toLowerCase())) {
    throw new Error('already on the watchlist');
  }
  const entry = { name: name || h, handle: h, twitch: twitchLogin || null, custom: true };
  custom.push(entry);
  await persist();
  return entry;
}

export async function removeCreator(handle) {
  const h = String(handle || '').replace(/^@/, '').trim().toLowerCase();
  const before = custom.length;
  custom = custom.filter((c) => String(c.handle).toLowerCase() !== h);
  if (custom.length !== before) await persist();
}

/**
 * Build the creators snapshot: resolve channels, pull latest uploads,
 * batch-fetch real statistics, attach Twitch live status.
 * Returns { items, newUploadAlerts } — items are 'creator' kind with
 * their latest videos nested in meta.videos.
 */
export async function buildCreatorsSnapshot(env, prevSeen = new Map()) {
  const list = getWatchlist();

  // Resolve channels + uploads (cached channel resolution keeps quota low).
  const resolved = [];
  for (const c of list) {
    try {
      const ch = await youtube.resolveChannel(env, c.handle);
      const uploads = await youtube.fetchUploads(env, ch.channelId, 8);
      resolved.push({ creator: c, ch, uploads });
    } catch (e) {
      resolved.push({ creator: c, error: String(e?.message || e) });
    }
  }

  // One batched statistics call for every video (1 unit per 50 ids).
  const allIds = resolved.flatMap((r) => (r.uploads || []).map((u) => u.videoId));
  const stats = allIds.length ? await youtube.fetchVideoStats(env, allIds) : new Map();

  // Twitch live status for creators with a linked login.
  let liveMap = new Map();
  const logins = list.map((c) => c.twitch).filter(Boolean);
  if (logins.length && twitch.twitchConfigured(env)) {
    try {
      liveMap = await twitch.fetchLiveStatus(env, logins);
    } catch { /* live badge is best-effort */ }
  }

  const now = Date.now();
  const newUploadAlerts = [];
  const items = resolved
    .filter((r) => r.ch)
    .map(({ creator, ch, uploads }) => {
      const videos = uploads.map((u) => {
        const st = stats.get(u.videoId) || {};
        const published = u.publishedAt ? new Date(u.publishedAt).getTime() : now;
        const ageMs = Math.max(0, now - published);
        const ageH = Math.max(0.4, ageMs / 3.6e6);
        return {
          videoId: u.videoId,
          title: u.title,
          thumb: u.thumb,
          publishedAt: u.publishedAt,
          ageMs,
          views: st.views || 0,
          likes: st.likes || 0,
          comments: st.comments || 0,
          velocity: Math.round((st.views || 0) / ageH),
          url: `https://www.youtube.com/watch?v=${u.videoId}`,
          embed: { type: 'youtube', id: u.videoId },
        };
      });

      // New-upload detection for alerts (videos < 4h old we haven't seen).
      const seen = prevSeen.get(ch.channelId) || new Set();
      const fresh = videos.filter((v) => v.ageMs < 4 * 3.6e6 && !seen.has(v.videoId));
      for (const v of fresh) {
        newUploadAlerts.push({
          icon: '🚨',
          title: `${ch.title} just posted`,
          body: `"${v.title}" — ${v.views.toLocaleString()} views in ${(v.ageMs / 3.6e6).toFixed(1)}h`,
          section: 'creators',
          itemId: `cr-${ch.channelId}`,
          url: v.url,
        });
      }

      const latest = videos[0];
      const live = creator.twitch ? liveMap.get(creator.twitch.toLowerCase()) : null;
      const videos7d = videos.filter((v) => v.ageMs <= 7 * 864e5);

      return mkItem({
        id: `cr-${ch.channelId}`,
        section: 'creators', source: 'youtube', platform: 'YouTube', kind: 'creator',
        title: ch.title,
        subtitle: `@${ch.handle}`,
        author: ch.title,
        category: live ? `LIVE on Twitch · ${live.game}` : 'Creator',
        url: `https://www.youtube.com/channel/${ch.channelId}`,
        thumbnail: ch.avatar,
        embed: latest ? { type: 'youtube', id: latest.videoId } : null,
        ageMs: latest ? latest.ageMs : 0,
        timeless: true,
        metrics: {
          subs: ch.subs,
          latestViews: latest ? latest.views : 0,
          velocity: latest ? latest.velocity : 0,
          videos7d: videos7d.length,
          score: 0,
        },
        meta: {
          handle: ch.handle,
          videos,
          live: live || null,
          twitchLogin: creator.twitch || null,
          custom: !!creator.custom,
        },
      });
    });

  // Track seen videos for next cycle's new-upload detection.
  const seenNow = new Map();
  for (const it of items) seenNow.set(it.id.replace('cr-', ''), new Set(it.meta.videos.map((v) => v.videoId)));

  return { items, newUploadAlerts, seenNow };
}
