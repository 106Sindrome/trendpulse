// Reddit adapter — hottest and top-of-week posts across gaming/creator subs.
// The 24h / 7d tabs are handled client-side by item age; the server fetches
// the widest useful window (top of the week + hot + rising).
// Auth modes:
//   1) Full credentials (script app): client id/secret + username/password → OAuth bearer.
//   2) No credentials: public .json endpoints (rate-limited, works server-side).
import { fetchJSON, formPost } from '../lib/http.js';
import { mkItem } from '../items.js';

const SUBS = 'gaming+Games+esports+Twitch+LivestreamFail+pcgaming+leagueoflegends+Valorant+FortNiteBR+NewTubers+youtube';

let token = null;
let tokenExp = 0;

export function redditConfigured(env) {
  return !!(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET && env.REDDIT_USERNAME && env.REDDIT_PASSWORD);
}

async function redditJSON(env, path) {
  if (redditConfigured(env)) {
    if (!token || Date.now() >= tokenExp) {
      const r = await formPost(
        'https://www.reddit.com/api/v1/access_token',
        { grant_type: 'password', username: env.REDDIT_USERNAME, password: env.REDDIT_PASSWORD },
        { Authorization: 'Basic ' + Buffer.from(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`).toString('base64') }
      );
      token = r.access_token;
      tokenExp = Date.now() + 3000 * 1000;
    }
    return fetchJSON(`https://oauth.reddit.com${path}`, { headers: { Authorization: `Bearer ${token}` } });
  }
  return fetchJSON(`https://www.reddit.com${path}${path.includes('?') ? '&' : '?'}raw_json=1`);
}

function toItem(p, tag) {
  const d = p.data || {};
  const now = Date.now();
  const created = (d.created_utc || now / 1000) * 1000;
  const ageH = Math.max(0.25, (now - created) / 3.6e6);
  const ups = d.ups ?? d.score ?? 0;
  const thumb = typeof d.thumbnail === 'string' && d.thumbnail.startsWith('http') ? d.thumbnail : null;
  return mkItem({
    id: `rd-${d.id}`,
    section: 'reddit', source: 'reddit', platform: 'Reddit', kind: 'post',
    title: d.title || '(untitled)',
    subtitle: `r/${d.subreddit} · u/${d.author}`,
    category: `r/${d.subreddit}`,
    url: `https://www.reddit.com${d.permalink || ''}`,
    thumbnail: thumb,
    ageMs: now - created,
    tags: tag ? [tag] : [],
    meta: { subredditSize: d.subreddit_subscribers || 0 },
    metrics: {
      ups,
      comments: d.num_comments || 0,
      velocity: Math.round(ups / ageH),
      growth: 0,
    },
  });
}

export async function fetchReddit(env) {
  const [hot, topWeek, rising] = await Promise.all([
    redditJSON(env, `/r/${SUBS}/hot?limit=20`).catch(() => ({ data: { children: [] } })),
    redditJSON(env, `/r/${SUBS}/top?t=week&limit=20`).catch(() => ({ data: { children: [] } })),
    redditJSON(env, `/r/${SUBS}/rising?limit=8`).catch(() => ({ data: { children: [] } })),
  ]);
  const seen = new Set();
  const out = [];
  const push = (c, tag) => {
    if (c.kind !== 't3' || !c.data?.id || seen.has(c.data.id)) return;
    seen.add(c.data.id);
    out.push(toItem(c, tag));
  };
  for (const c of topWeek?.data?.children || []) push(c, 'top · week');
  for (const c of hot?.data?.children || []) push(c, null);
  for (const c of rising?.data?.children || []) push(c, 'rising');
  if (!out.length) throw new Error('Reddit returned no data (public JSON may be rate-limited from this IP — add Reddit credentials in .env)');
  return out;
}

/** Real goal/highlight clip posts from r/soccer + r/footballhighlights.
 *  Returns raw post data — the moments module converts them. */
export async function fetchSoccerPosts(env) {
  const subs = 'soccer+footballhighlights';
  const [hot, top] = await Promise.all([
    redditJSON(env, `/r/${subs}/hot?limit=20`).catch(() => ({ data: { children: [] } })),
    redditJSON(env, `/r/${subs}/top?t=week&limit=15`).catch(() => ({ data: { children: [] } })),
  ]);
  const seen = new Set();
  const out = [];
  for (const c of [...(hot?.data?.children || []), ...(top?.data?.children || [])]) {
    const d = c?.data || {};
    if (c.kind !== 't3' || !d.id || seen.has(d.id)) continue;
    const url = d.url || '';
    const isClip = /(v\.redd\.it|youtu\.be|youtube\.com|streamable\.com|dailymotion\.com|\.mp4|\.gifv?)/.test(url);
    const flair = (d.link_flair_text || '').toLowerCase();
    if (!isClip && !/goal|highlight|clip|skill|save|assist|wonderkid/.test(`${d.title} ${flair}`.toLowerCase())) continue;
    seen.add(d.id);
    out.push(d);
  }
  return out;
}

/** Top posts about a topic (for AI Top Lists) — real upvotes & discussion. */
export async function searchTopicPosts(env, q) {
  const j = await redditJSON(env, `/search?q=${encodeURIComponent(q)}&restrict_sr=0&sort=top&t=month&limit=12`);
  return (j?.data?.children || []).filter((c) => c.kind === 't3').map((c) => ({
    id: c.data.id,
    title: c.data.title,
    subreddit: c.data.subreddit,
    subredditSize: c.data.subreddit_subscribers || 0,
    ups: c.data.ups ?? c.data.score ?? 0,
    comments: c.data.num_comments || 0,
    created: (c.data.created_utc || 0) * 1000,
    url: `https://www.reddit.com${c.data.permalink || ''}`,
    thumb: typeof c.data.thumbnail === 'string' && c.data.thumbnail.startsWith('http') ? c.data.thumbnail : null,
  }));
}

export async function searchReddit(env, q) {
  const j = await redditJSON(env, `/search?q=${encodeURIComponent(q)}&restrict_sr=0&sort=relevance&t=week&limit=6`);
  return (j?.data?.children || [])
    .filter((c) => c.kind === 't3')
    .map((c) => ({
      platform: 'Reddit',
      title: c.data.title,
      subtitle: `r/${c.data.subreddit} · ▲ ${c.data.ups} · ${c.data.num_comments} comments`,
      url: `https://www.reddit.com${c.data.permalink}`,
      thumbnail: typeof c.data.thumbnail === 'string' && c.data.thumbnail.startsWith('http') ? c.data.thumbnail : null,
      kind: 'post',
    }));
}
