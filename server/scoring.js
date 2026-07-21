// ─────────────────────────────────────────────────────────────
// Viral Score engine — produces a 0–100 score per item from five
// components, weighted:
//   velocity    30%  how fast the primary metric is moving
//   growth      25%  % growth between recent observations
//   scale       20%  absolute size (viewers / views / players…)
//   engagement  15%  likes/comments/mentions relative to reach
//   freshness   10%  exponential decay with item age
// Each component is normalized with a saturating curve v/(v+scale)
// so outliers don't dominate. Scales are tuned per content kind.
// ─────────────────────────────────────────────────────────────

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const sat = (v, scale) => clamp(v / (Math.abs(v) + scale));

export function scoreBreakdown(item) {
  const m = item.metrics || {};
  const ageH = (item.ageMs || 0) / 3.6e6;
  let velocity = 0, growth = 0, scale = 0, engagement = 0;
  let freshness = Math.exp(-ageH / 36);

  switch (item.kind) {
    case 'stream':
      scale = sat(m.viewers || 0, 25000);
      velocity = sat(m.velocity || 0, 1200);           // viewers/min
      growth = sat((m.growth || 0) / 100, 0.35);
      engagement = sat(m.viewers || 0, 60000);
      freshness = Math.exp(-ageH / 72);
      break;
    case 'game':
      if (m.weeklyRank) {
        // Weekly chart item: position in Steam's rolling top-sellers chart.
        scale = sat(Math.max(1, 26 - m.weeklyRank), 7);
        velocity = sat(m.players || 0, 500000);
        engagement = sat(m.players || 0, 250000);
        growth = sat((m.growth || 0) / 100, 0.3);
        freshness = 0.85;
      } else {
        scale = sat(m.viewers || 0, 80000) * 0.6 + sat(m.players || 0, 400000) * 0.4;
        velocity = sat(m.velocity || 0, 2500);
        growth = sat((m.growth || 0) / 100, 0.3);
        engagement = sat(m.clips || 0, 400);
        freshness = 0.8;
      }
      break;
    case 'video':
      scale = sat(m.views || 0, 1_500_000);
      velocity = sat(m.velocity || 0, 25000);          // views/hour
      growth = sat((m.growth || 0) / 100, 0.5);
      {
        const er = m.views ? ((m.likes || 0) + (m.comments || 0) * 4) / m.views : 0;
        engagement = sat(er, 0.08);
      }
      break;
    case 'topic':
      scale = sat(m.searches || 0, 15000);
      velocity = sat(m.velocity || 0, 1500);
      growth = sat((m.growth || 0) / 100, 0.5);
      engagement = sat(m.mentions || 0, 40000);
      freshness = Math.exp(-ageH / 14);
      break;
    case 'post':
      scale = sat(m.ups || 0, 20000);
      velocity = sat(m.velocity || 0, 700);            // upvotes/hour
      growth = sat((m.growth || 0) / 100, 0.5);
      engagement = sat(m.comments || 0, 2500);
      break;
    case 'moment':
      scale = sat(m.views || 0, 250_000);
      velocity = sat((m.views || 0) / Math.max(1, ageH), 15_000);
      growth = sat((m.growth || 0) / 100, 0.5);
      engagement = sat(m.views || 0, 500_000);
      freshness = Math.exp(-ageH / 168); // week-scale half-life for clip material
      break;
    case 'creator':
      scale = sat(m.latestViews || 0, 800_000);        // reach of newest upload
      velocity = sat(m.velocity || 0, 150_000);        // views/hr on newest upload
      growth = sat((m.growth || 0) / 100, 0.5);
      engagement = sat(m.videos7d || 0, 4);            // posting frequency
      freshness = sat(m.videos7d || 0, 1.5);
      break;
    case 'podcast':
      scale = sat(m.popularity || 0, 100);
      engagement = sat(m.popularity || 0, 30);
      velocity = 0.4 + 0.6 * freshness;
      growth = sat((m.growth || 0) / 100, 0.3);
      freshness = Math.exp(-ageH / 168);
      break;
    case 'news':
      scale = sat(m.mentions || 0, 40);
      velocity = freshness;
      growth = freshness;
      engagement = sat(m.mentions || 0, 15);
      freshness = Math.exp(-ageH / 10);
      break;
    default:
      break;
  }

  return {
    velocity: Math.round(velocity * 100),
    growth: Math.round(clamp(growth) * 100),
    scale: Math.round(scale * 100),
    engagement: Math.round(engagement * 100),
    freshness: Math.round(freshness * 100),
  };
}

export const WEIGHTS = { velocity: 0.3, growth: 0.25, scale: 0.2, engagement: 0.15, freshness: 0.1 };

export function applyScores(items) {
  for (const it of items) {
    it.metrics = it.metrics || {};
    const b = scoreBreakdown(it);
    it.breakdown = b;
    it.metrics.score = Math.round(
      clamp(Object.entries(WEIGHTS).reduce((s, [k, w]) => s + b[k] * w, 0), 0, 100)
    );
  }
  return items;
}

export function byScoreDesc(items) {
  return [...items].sort((a, b) => (b.metrics?.score || 0) - (a.metrics?.score || 0));
}
