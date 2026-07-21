// Key-less real sources: Google Trends RSS, Apple Podcasts charts,
// Steam most-played games, and gaming/creator news RSS/Atom feeds.
import { fetchJSON, fetchText } from '../lib/http.js';
import { entries, tag, attr } from '../lib/xml.js';
import { mkItem, footballTags } from '../items.js';

// ── Google Trends (daily trending searches RSS) ───────────────
export async function fetchGoogleTrends(env) {
  const geo = env.GEO || 'US';
  const xml = await fetchText(`https://trends.google.com/trending/rss?geo=${geo}`);
  const now = Date.now();
  return entries(xml)
    .map((b, i) => {
      const title = tag(b, 'title');
      if (!title) return null;
      const trafficRaw = tag(b, 'ht:approx_traffic') || '1000+';
      const searches = parseInt(trafficRaw.replace(/[^0-9]/g, ''), 10) || 1000;
      const newsTitle = tag(b, 'ht:news_item_title') || '';
      const newsSource = tag(b, 'ht:news_item_source') || '';
      const newsUrl = tag(b, 'ht:news_item_url') || '';
      return mkItem({
        id: `gt-${encodeURIComponent(title).slice(0, 48)}`,
        section: 'trends', source: 'google-trends', platform: 'Google Trends', kind: 'topic',
        title,
        subtitle: newsTitle ? `${newsTitle} — ${newsSource}` : `Trending in ${geo}`,
        category: `Searches: ${searches.toLocaleString()}+`,
        url: newsUrl || `https://www.google.com/search?q=${encodeURIComponent(title)}`,
        thumbnail: tag(b, 'ht:picture') || null,
        ageMs: i * 12 * 60 * 1000, // RSS has no timestamps; approximate by position
        timeless: true,
        metrics: {
          searches,
          mentions: 0,
          velocity: Math.round(searches / 4),
          growth: Math.min(400, 15 + Math.round(searches / 800)),
        },
        history: [],
      });
    })
    .filter(Boolean)
    .slice(0, 25);
}

// ── Apple Podcasts top charts ─────────────────────────────────
const BROWSER_UA = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

export async function fetchPodcasts(env) {
  const j = await fetchJSON(
    'https://rss.marketingtools.apple.com/api/v2/us/podcasts/top/40/podcasts.json',
    { headers: BROWSER_UA }
  );
  return (j?.feed?.results || []).map((r, i) =>
    mkItem({
      id: `pod-${r.id}`,
      section: 'podcasts', source: 'apple-podcasts', platform: 'Apple Podcasts', kind: 'podcast',
      title: r.name,
      subtitle: r.artistName,
      author: r.artistName,
      category: (r.genres || []).map((g) => g.name).slice(0, 2).join(' · ') || 'Podcast',
      url: r.url || `https://podcasts.apple.com/us/podcast/${r.id}`,
      thumbnail: (r.artworkUrl100 || '').replace('100x100', '600x600') || null,
      ageMs: i * 5 * 3.6e6,
      timeless: true,
      metrics: {
        popularity: Math.max(5, Math.round(100 - i * 2.2)),
        growth: i < 5 ? 12 - i * 2 : -i * 0.5,
      },
      history: [],
      tags: [`#${i + 1} in ${env.GEO || 'US'}`],
    })
  );
}

// ── Steam most-played (public Steam Charts service) ───────────
const KNOWN_GAMES = {
  730: 'Counter-Strike 2', 570: 'Dota 2', 578080: 'PUBG: Battlegrounds',
  1172470: 'Apex Legends', 271590: 'Grand Theft Auto V', 431960: 'Wallpaper Engine',
  1091500: 'Cyberpunk 2077', 1085660: 'Fallout 4', 1086940: "Baldur's Gate 3",
  1174180: 'Red Dead Redemption 2', 1245620: 'ELDEN RING', 1599340: 'Lost Ark',
  236390: 'War Thunder', 304930: 'Unturned', 346110: 'ARK: Survival Evolved',
  381210: 'Dead by Daylight', 4000: "Garry's Mod", 413150: 'Stardew Valley',
  444200: 'World of Tanks Blitz', 550: 'Left 4 Dead 2', 620: 'Portal 2',
  105600: 'Terraria', 1222670: 'The Sims 4', 1517290: 'Battlefield 2042',
  1938090: 'Call of Duty', 2138710: 'Once Human', 2139460: 'Marvel Rivals',
  1966720: 'Lethal Company', 204360: 'Castle Crashers', 252490: 'Rust',
  1551360: 'Forza Horizon 5', 945360: 'Among Us', 1144200: 'Ready or Not',
  230410: 'Warframe', 322330: "Don't Starve Together", 359550: "Tom Clancy's Rainbow Six Siege X",
  108600: 'Project Zomboid', 2183900: 'Warhammer 40,000: Space Marine 2',
  244850: 'Space Engineers', 582660: 'Black Desert', 739630: 'Phasmophobia',
  1203220: 'NARAKA: BLADEPOINT', 1466860: 'Age of Empires IV', 1940340: 'Darkest Dungeon II',
};
const nameCache = new Map();

async function steamName(appid) {
  if (KNOWN_GAMES[appid]) return KNOWN_GAMES[appid];
  if (nameCache.has(appid)) return nameCache.get(appid);
  try {
    const j = await fetchJSON(`https://store.steampowered.com/api/appdetails?appids=${appid}`, {}, 6000);
    const name = j?.[appid]?.data?.name || `Steam App ${appid}`;
    nameCache.set(appid, name);
    return name;
  } catch {
    nameCache.set(appid, `Steam App ${appid}`);
    return nameCache.get(appid);
  }
}

/** Real-time concurrent players — official endpoint, one light call per game. */
async function currentPlayers(appid) {
  try {
    const j = await fetchJSON(
      `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`,
      {}, 6000
    );
    return j?.response?.player_count || 0;
  } catch {
    return 0;
  }
}

const fmtPeak = (n) => {
  n = +n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(n);
};

export async function fetchSteam() {
  // Official weekly most-played rollup: rank, last week's rank, peak players.
  const j = await fetchJSON('https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/?top=30');
  const top = (j?.response?.ranks || []).slice(0, 18);
  const names = await Promise.all(top.map((r) => steamName(r.appid)));
  const players = await Promise.all(top.map((r) => currentPlayers(r.appid)));
  return top.map((r, i) => {
    const name = names[i];
    const cur = players[i];
    const rankMove = r.last_week_rank ? r.last_week_rank - r.rank : 0; // >0 = climbing
    return mkItem({
      id: `steam-${r.appid}`,
      section: 'games', source: 'steam', platform: 'Steam', kind: 'game',
      title: name,
      subtitle: `#${r.rank} most played this week · peak ${fmtPeak(r.peak_in_game)}`,
      category: 'Steam',
      url: `https://store.steampowered.com/app/${r.appid}`,
      thumbnail: `https://cdn.cloudflare.steamstatic.com/steam/apps/${r.appid}/capsule_231x87.jpg`,
      meta: { window: 'day', mostPlayedRank: r.rank, lastWeekRank: r.last_week_rank || null, rankMove },
      tags: footballTags(name),
      metrics: {
        players: cur,
        peak: r.peak_in_game || 0,
        viewers: 0,
        clips: 0,
        growth: r.last_week_rank ? +((rankMove / Math.max(1, r.last_week_rank)) * 100).toFixed(1) : 0,
        velocity: Math.round(cur * 0.003),
      },
      history: [],
    });
  });
}

// ── Steam WEEKLY chart — real rolling top-sellers + hot new releases ──
export async function fetchSteamTopSellers(env) {
  const cc = (env.GEO || 'US').toLowerCase();
  const j = await fetchJSON(`https://store.steampowered.com/api/featuredcategories/?cc=${cc}&l=en`, { headers: BROWSER_UA });
  const sellers = (j?.top_sellers?.items || []);
  const fresh = (j?.new_releases?.items || []);
  const seen = new Set();
  const out = [];
  let rank = 0;
  for (const g of sellers) {
    if (!g?.id || seen.has(g.id)) continue;
    seen.add(g.id);
    rank++;
    out.push(mkItem({
      id: `steamweek-${g.id}`,
      section: 'games', source: 'steam-week', platform: 'Steam', kind: 'game',
      title: g.name, subtitle: `#${rank} top seller this week`, category: 'Steam weekly chart',
      url: `https://store.steampowered.com/app/${g.id}`,
      thumbnail: `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.id}/capsule_231x87.jpg`,
      meta: { window: 'week', weeklyRank: rank, chart: 'top-sellers' },
      tags: footballTags(g.name),
      metrics: { weeklyRank: rank, players: 0, viewers: 0, growth: 0, velocity: 0 },
      history: [],
    }));
  }
  for (const g of fresh) {
    if (!g?.id || seen.has(g.id) || out.length >= 24) continue;
    seen.add(g.id);
    out.push(mkItem({
      id: `steamweek-${g.id}`,
      section: 'games', source: 'steam-week', platform: 'Steam', kind: 'game',
      title: g.name, subtitle: 'Hot new release this week', category: 'Steam weekly chart',
      url: `https://store.steampowered.com/app/${g.id}`,
      thumbnail: `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.id}/capsule_231x87.jpg`,
      meta: { window: 'week', chart: 'new-releases' },
      tags: footballTags(g.name),
      metrics: { weeklyRank: 0, players: 0, viewers: 0, growth: 0, velocity: 0 },
      history: [],
    }));
  }
  if (!out.length) throw new Error('Steam weekly chart unavailable');
  return out;
}

// ── Gaming news (RSS + Atom) ──────────────────────────────────
const FEEDS = [
  { name: 'DEXERTO', url: 'https://www.dexerto.com/feed/' },
  { name: 'PC Gamer', url: 'https://www.pcgamer.com/rss/' },
  { name: 'Eurogamer', url: 'https://www.eurogamer.net/feed' },
  { name: 'The Verge · Gaming', url: 'https://www.theverge.com/rss/gaming/index.xml' },
  { name: 'IGN', url: 'https://feeds.ign.com/ign/games-all' },
];

function stripHtml(s) {
  return (s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

export async function fetchNews() {
  const settled = await Promise.allSettled(
    FEEDS.map(async (f) => {
      const xml = await fetchText(f.url, {}, 7000);
      return entries(xml)
        .slice(0, 8)
        .map((b) => {
          const title = tag(b, 'title');
          const link = tag(b, 'link') || attr(b, 'link', 'href') || '';
          const dateRaw = tag(b, 'pubDate') || tag(b, 'dc:date') || tag(b, 'published') || tag(b, 'updated');
          const date = dateRaw ? new Date(dateRaw).getTime() : Date.now();
          const desc = stripHtml(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content') || '');
          if (!title) return null;
          return mkItem({
            id: `news-${Buffer.from(f.name + title).toString('base64').slice(0, 28)}`,
            section: 'news', source: 'news-rss', platform: f.name, kind: 'news',
            title: decodeHtml(title),
            subtitle: desc.slice(0, 140),
            category: f.name,
            url: link,
            ageMs: Math.max(0, Date.now() - (Number.isFinite(date) ? date : Date.now())),
            metrics: { mentions: 1, growth: 0, velocity: 0 },
            history: [],
          });
        })
        .filter(Boolean);
    })
  );
  const items = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
  items.sort((a, b) => a.ageMs - b.ageMs);
  return items.filter((i) => i.ageMs <= 7 * 864e5).slice(0, 30);
}

function decodeHtml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
