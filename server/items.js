// Shared normalized item schema. Every real data source produces items
// in this shape; scoring, ranking, SSE push and the UI all consume it.
// There is NO simulated data anywhere in TrendPulse.

export function mkItem(o) {
  return {
    id: o.id,
    section: o.section,
    source: o.source,
    platform: o.platform,
    kind: o.kind, // 'creator' | 'video' | 'game' | 'topic' | 'post' | 'podcast' | 'news' | 'idea'
    title: o.title,
    subtitle: o.subtitle || '',
    author: o.author || '',
    category: o.category || '',
    url: o.url || '',
    thumbnail: o.thumbnail || null,
    embed: o.embed || null,
    ageMs: o.ageMs || 0,
    timeless: !!o.timeless, // not affected by the 24h / 7d window filter
    tags: o.tags || [],
    metrics: o.metrics || {},
    meta: o.meta || {},
    history: o.history || [],
    rank: 0,
    updatedAt: Date.now(),
  };
}

// Flag football (soccer) games & real-football categories with ⚽ so clip
// hunters spot them instantly — EA Sports FC, eFootball, Football Manager,
// Twitch's real-life "Football" category, etc.
const FOOTBALL_RE = /EA Sports FC|EA FC|\bFIFA\b|eFootball|Football Manager|\bUFL\b|Football|Soccer|Blue Lock|Rematch/i;
export function footballTags(name) {
  return FOOTBALL_RE.test(name || '') ? ['⚽ football'] : [];
}
