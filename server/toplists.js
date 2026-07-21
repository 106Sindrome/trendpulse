// ─────────────────────────────────────────────────────────────
// AI Top Lists — user enters a topic ("Top 5 Joe Rogan quotes")
// and gets a ranking built from REAL cross-platform evidence:
// YouTube (real views/likes/comments), Reddit (real upvotes &
// discussion), live Google Trends and tracked news. Ranking and
// "why this position" are evidence-based; creative assets (titles,
// hooks, scripts) are clearly generated suggestions.
// ─────────────────────────────────────────────────────────────
import * as youtube from './adapters/youtube.js';
import * as reddit from './adapters/reddit.js';

const sat = (v, scale) => Math.min(1, v / (v + scale));
const words = (t) => [...new Set(String(t || '').toLowerCase().match(/[a-z0-9]{4,}/g) || [])];
const STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'your', 'you', 'top', 'best', 'official', 'video', 'full', 'hd', 'new']);

function titleScore(v, topicWords, trends) {
  const hay = `${v.title} ${v.channel}`.toLowerCase();
  const rel = topicWords.length ? topicWords.filter((w) => hay.includes(w)).length / topicWords.length : 0;
  const trendHit = trends.some((t) => words(t).some((w) => hay.includes(w)));
  const ageD = v.ageMs / 864e5;
  return {
    rel,
    trendHit,
    score: Math.round(100 * (0.42 * sat(v.views, 4_000_000) + 0.18 * rel + 0.14 * sat(v.comments, 4000) + 0.12 * (trendHit ? 1 : 0) + 0.14 * Math.exp(-ageD / 180))),
  };
}

function postScore(p, topicWords) {
  const hay = p.title.toLowerCase();
  const rel = topicWords.length ? topicWords.filter((w) => hay.includes(w)).length / topicWords.length : 0;
  return {
    rel,
    score: Math.round(100 * (0.4 * sat(p.ups, 40_000) + 0.25 * sat(p.comments, 3000) + 0.2 * rel + 0.15 * Math.exp(-((Date.now() - p.created) / 864e5) / 60))),
  };
}

function whyFor(item) {
  const why = [];
  if (item.kind === 'video') {
    why.push(`${item.views.toLocaleString()} views · ${item.likes.toLocaleString()} likes`);
    if (item.comments > 500) why.push(`${item.comments.toLocaleString()} comments — active discussion`);
    if (item._rel > 0.5) why.push('strongly matches your topic');
    if (item._trendHit) why.push('overlaps a live Google Trend right now');
    why.push(`published ${Math.max(1, Math.round(item.ageMs / 864e5))}d ago`);
  } else {
    why.push(`▲ ${item.ups.toLocaleString()} upvotes · ${item.comments.toLocaleString()} comments on r/${item.subreddit}`);
    if (item.subredditSize) why.push(`community: ${(item.subredditSize / 1000).toFixed(0)}K members`);
    if (item._rel > 0.5) why.push('strongly matches your topic');
  }
  return why;
}

const hookTemplates = (t) => [
  `The ${t} moment nobody saw coming…`,
  `This is why everyone is talking about ${t}`,
  `You've never seen ${t} like this`,
  `The truth about ${t} in 30 seconds`,
];

export async function buildTopList(env, topic, { trendsTitles = [], newsTitles = [], count = 5 }) {
  const topicWords = words(topic).filter((w) => !STOP.has(w));
  const [videos, posts] = await Promise.all([
    youtube.youtubeConfigured(env) ? youtube.searchTopicVideos(env, topic).catch(() => []) : Promise.resolve([]),
    reddit.searchTopicPosts(env, topic).catch(() => []),
  ]);
  if (!videos.length && !posts.length) {
    throw new Error('No live evidence found — YouTube key missing and Reddit unreachable from this network. Add YOUTUBE_API_KEY to .env.');
  }

  const vScored = videos.map((v) => {
    const { score, rel, trendHit } = titleScore(v, topicWords, trendsTitles);
    return { ...v, kind: 'video', _score: score, _rel: rel, _trendHit: trendHit };
  });
  const pScored = posts.map((p) => {
    const { score, rel } = postScore(p, topicWords);
    return { ...p, kind: 'post', views: p.ups, ageMs: Date.now() - p.created, _score: score, _rel: rel, _trendHit: false };
  });

  // dedupe near-identical titles across sources
  const seen = new Set();
  const merged = [...vScored, ...pScored]
    .sort((a, b) => b._score - a._score)
    .filter((e) => {
      const key = words(e.title).slice(0, 6).join(' ');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const related = vScored.slice(0, 6).map((v) => ({ title: v.title, url: v.url, views: v.views, thumb: v.thumb }));
  const items = merged.slice(0, Math.max(count, 10)).map((e, i) => {
    const mainKw = (words(e.title).filter((w) => !STOP.has(w))[0]) || topic;
    return {
      rank: i + 1,
      kind: e.kind,
      title: e.title,
      url: e.url,
      thumb: e.thumb || null,
      source: e.kind === 'video' ? `YouTube · ${e.channel}` : `Reddit · r/${e.subreddit}`,
      popularity: e.views,
      discussion: e.comments || 0,
      score: e._score,
      why: whyFor(e),
      shortsIdeas: [
        `Why "${e.title.slice(0, 45)}" is going viral`,
        `${topic} — the part everyone missed`,
        `Ranking this ${topic} moment honestly`,
      ],
      hooks: hookTemplates(mainKw).slice(0, 2),
      thumbnailIdea: `Split frame: the moment itself + bold text "${mainKw.toUpperCase()}" in ${e._score >= 70 ? 'red/yellow' : 'white'} — surprised-face crop on the left`,
    };
  });

  const trendMatches = trendsTitles.filter((t) => words(t).some((w) => topicWords.includes(w)));
  const newsMatches = newsTitles.filter((t) => words(t).some((w) => topicWords.includes(w))).slice(0, 3);
  const seo = [...new Set([...topicWords, ...words(items.slice(0, 3).map((i) => i.title).join(' ')).filter((w) => !STOP.has(w))])].slice(0, 12);

  const assets = {
    titles: [
      `Top ${count} ${topic} (Ranked)`,
      `The ${count} Best ${topic} — Nobody Agrees on #1`,
      `${topic}: The Definitive Top ${count}`,
      `I Ranked ${topic} So You Don't Have To`,
      `${count} ${topic} That Broke the Internet`,
    ],
    hooks: hookTemplates(topic),
    intro: `Everyone has an opinion on ${topic} — so we settled it with data. We pulled the most-viewed videos, the most-upvoted discussions and what's trending right now, and ranked the definitive top ${count}. Number ${count} first… and #1 will surprise you.`,
    hashtags: ['#shorts', '#top' + count, '#' + topicWords.join('').slice(0, 24), '#viral', '#ranking'],
    thumbnailText: [`TOP ${count}`, topic.toUpperCase().slice(0, 22), '#1 REVEALED'],
    description: `The definitive Top ${count} ${topic}, ranked by real cross-platform data: YouTube views, Reddit discussion and live search trends.\n\n⏱ Chapters: ${items.slice(0, count).map((it, i) => `\n${i}. ${it.title}`).join('')}\n\n#${topicWords.join(' #').slice(0, 60)}`,
    seo,
  };

  return {
    topic, count,
    sourcesUsed: [videos.length ? `YouTube (${videos.length} videos)` : null, posts.length ? `Reddit (${posts.length} posts)` : null, trendMatches.length ? `Google Trends (${trendMatches.length} live matches)` : null, newsMatches.length ? `News (${newsMatches.length})` : null].filter(Boolean),
    trendMatches, newsMatches,
    items,
    related,
    assets,
    generatedAt: Date.now(),
  };
}
