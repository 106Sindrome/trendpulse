// YouTube Data API v3 adapter.
// Powers three real features:
//   1. Trending videos (search by recency+views, then live statistics).
//   2. Creator watchlist: resolve handles → channel IDs → latest uploads → real
//      view/like/comment counts + velocity (the core clip-hunting signal).
//   3. Global search.
// Quota-aware: search.list (100 units) runs rarely; statistics refreshes are
// cheap videos.list calls (1 unit per batched call of up to 50 ids).
import { fetchJSON } from '../lib/http.js';
import { mkItem } from '../items.js';

export function youtubeConfigured(env) {
  return !!env.YOUTUBE_API_KEY;
}

async function yt(path, env) {
  const sep = path.includes('?') ? '&' : '?';
  return fetchJSON(`https://www.googleapis.com/youtube/v3/${path}${sep}key=${env.YOUTUBE_API_KEY}`);
}

// ── Trending videos (last 7 days; client tab filters the 24h subset) ──
export async function searchTrendingVideos(env) {
  const after = new Date(Date.now() - 7 * 864e5).toISOString();
  const geo = env.GEO || 'US';
  let search = await yt(
    `search?part=snippet&type=video&order=viewCount&publishedAfter=${after}&maxResults=24&regionCode=${geo}&videoCategoryId=20`,
    env
  );
  if ((search.items || []).length < 6) {
    search = await yt(
      `search?part=snippet&type=video&order=viewCount&publishedAfter=${after}&maxResults=24&regionCode=${geo}`,
      env
    );
  }
  const ids = (search.items || []).map((i) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const stats = await fetchVideoStats(env, ids);
  return (search.items || []).filter((r) => r.id?.videoId).map((r) => toVideoItem(r, stats.get(r.id.videoId), env));
}

/** Cheap stats-only refresh for an existing trending set (1 API unit). */
export async function refreshStats(env, videoIds) {
  if (!videoIds.length) return new Map();
  return fetchVideoStats(env, videoIds.slice(0, 50));
}

function toVideoItem(r, st = {}, env) {
  const now = Date.now();
  const published = r.snippet.publishedAt ? new Date(r.snippet.publishedAt).getTime() : now;
  const ageH = Math.max(0.5, (now - published) / 3.6e6);
  const views = +st.viewCount || 0;
  return mkItem({
    id: `yt-${r.id.videoId || r.id}`,
    section: 'videos', source: 'youtube', platform: 'YouTube', kind: 'video',
    title: r.snippet.title,
    subtitle: r.snippet.channelTitle,
    author: r.snippet.channelTitle,
    category: 'Gaming',
    url: `https://www.youtube.com/watch?v=${r.id.videoId || r.id}`,
    thumbnail: r.snippet.thumbnails?.medium?.url || r.snippet.thumbnails?.default?.url || null,
    embed: { type: 'youtube', id: r.id.videoId || r.id },
    ageMs: now - published,
    metrics: {
      views,
      likes: +st.likeCount || 0,
      comments: +st.commentCount || 0,
      velocity: Math.round(views / ageH),
      growth: 0,
    },
    meta: { publishedTs: published },
  });
}

// ── Creator watchlist ────────────────────────────────────────
const channelCache = new Map(); // handle(lower) -> { channelId, title, avatar, subs, ts }

export async function resolveChannel(env, handle) {
  const key = String(handle).toLowerCase().replace(/^@/, '').trim();
  const cached = channelCache.get(key);
  if (cached && Date.now() - cached.ts < 24 * 3.6e6) return cached;

  let ch = null;
  try {
    const j = await yt(`channels?part=snippet,statistics&forHandle=${encodeURIComponent('@' + key)}`, env);
    ch = j.items?.[0];
  } catch { /* fall through to search */ }
  if (!ch) {
    const s = await yt(`search?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(key)}`, env);
    const id = s.items?.[0]?.id?.channelId;
    if (id) {
      const cj = await yt(`channels?part=snippet,statistics&id=${id}`, env);
      ch = cj.items?.[0];
    }
  }
  if (!ch) throw new Error(`channel not found for "${handle}"`);

  const info = {
    handle: key,
    channelId: ch.id,
    title: ch.snippet.title,
    avatar: ch.snippet.thumbnails?.medium?.url || ch.snippet.thumbnails?.default?.url || null,
    subs: +ch.statistics?.subscriberCount || 0,
    ts: Date.now(),
  };
  channelCache.set(key, info);
  return info;
}

/** Latest uploads of a channel (newest first). */
export async function fetchUploads(env, channelId, max = 10) {
  const uploadsId = 'UU' + channelId.slice(2);
  const j = await yt(`playlistItems?part=snippet,contentDetails&playlistId=${uploadsId}&maxResults=${max}`, env);
  return (j.items || [])
    .filter((i) => i.contentDetails?.videoId)
    .map((i) => ({
      videoId: i.contentDetails.videoId,
      title: i.snippet.title,
      publishedAt: i.contentDetails.videoPublishedAt || i.snippet.publishedAt,
      thumb: i.snippet.thumbnails?.medium?.url || i.snippet.thumbnails?.default?.url || null,
    }));
}

/** Batched statistics for up to 50 video ids — 1 API unit total. */
export async function fetchVideoStats(env, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const j = await yt(`videos?part=statistics&id=${chunk.join(',')}`, env);
    for (const v of j.items || []) {
      out.set(v.id, {
        views: +v.statistics?.viewCount || 0,
        likes: +v.statistics?.likeCount || 0,
        comments: +v.statistics?.commentCount || 0,
      });
    }
  }
  return out;
}

/** Highlight/compilation videos for an event query (last 14 days, by views). */
export async function searchEventVideos(env, q) {
  const after = new Date(Date.now() - 14 * 864e5).toISOString();
  const j = await yt(
    `search?part=snippet&type=video&order=viewCount&publishedAfter=${after}&maxResults=8&q=${encodeURIComponent(q)}`,
    env
  );
  const ids = (j.items || []).map((i) => i.id?.videoId).filter(Boolean);
  const stats = ids.length ? await fetchVideoStats(env, ids) : new Map();
  return (j.items || []).filter((i) => i.id?.videoId).map((i) => ({
    videoId: i.id.videoId,
    title: i.snippet.title,
    channel: i.snippet.channelTitle,
    publishedAt: i.snippet.publishedAt,
    thumb: i.snippet.thumbnails?.medium?.url || i.snippet.thumbnails?.default?.url || null,
    ...(stats.get(i.id.videoId) || {}),
  }));
}

/** Top videos about a topic, all-time by views (AI Top Lists input). */
export async function searchTopicVideos(env, topic) {
  const j = await yt(
    `search?part=snippet&type=video&order=viewCount&maxResults=12&q=${encodeURIComponent(topic)}`,
    env
  );
  const ids = (j.items || []).map((i) => i.id?.videoId).filter(Boolean);
  const stats = ids.length ? await fetchVideoStats(env, ids) : new Map();
  return (j.items || []).filter((i) => i.id?.videoId).map((i) => {
    const st = stats.get(i.id.videoId) || {};
    const published = i.snippet.publishedAt ? new Date(i.snippet.publishedAt).getTime() : Date.now();
    return {
      videoId: i.id.videoId,
      title: i.snippet.title,
      channel: i.snippet.channelTitle,
      publishedAt: i.snippet.publishedAt,
      ageMs: Math.max(0, Date.now() - published),
      thumb: i.snippet.thumbnails?.medium?.url || null,
      views: +st.viewCount || 0,
      likes: +st.likeCount || 0,
      comments: +st.commentCount || 0,
      url: `https://www.youtube.com/watch?v=${i.id.videoId}`,
    };
  });
}

/** Deep scan for one opportunity (on-demand, quota-guarded by the caller):
 *  competition = how many short-form videos already cover this,
 *  similar = biggest existing Shorts-style videos (format validation). */
export async function deepScan(env, query) {
  const comp = await yt(
    `search?part=snippet&type=video&videoDuration=short&maxResults=25&q=${encodeURIComponent('"' + query.replace(/"/g, '') + '"')}`,
    env
  );
  const count = (comp.items || []).length;
  const level = count <= 3 ? 'LOW' : count <= 10 ? 'MEDIUM' : 'HIGH';
  const sim = await yt(
    `search?part=snippet&type=video&videoDuration=short&order=viewCount&maxResults=6&q=${encodeURIComponent(query)}`,
    env
  );
  const ids = (sim.items || []).map((i) => i.id?.videoId).filter(Boolean);
  const stats = ids.length ? await fetchVideoStats(env, ids) : new Map();
  const similar = (sim.items || []).filter((i) => i.id?.videoId).map((i) => ({
    title: i.snippet.title,
    channel: i.snippet.channelTitle,
    url: `https://www.youtube.com/watch?v=${i.id.videoId}`,
    thumb: i.snippet.thumbnails?.medium?.url || null,
    views: stats.get(i.id.videoId)?.views || 0,
  }));
  return { competition: { count, level }, similar };
}

export async function searchVideos(env, q) {
  const j = await yt(`search?part=snippet&type=video&order=relevance&maxResults=6&q=${encodeURIComponent(q)}`, env);
  return (j.items || []).map((r) => ({
    platform: 'YouTube',
    title: r.snippet?.title || '',
    subtitle: r.snippet?.channelTitle || '',
    url: `https://www.youtube.com/watch?v=${r.id?.videoId}`,
    thumbnail: r.snippet?.thumbnails?.medium?.url || null,
    kind: 'video',
  }));
}
