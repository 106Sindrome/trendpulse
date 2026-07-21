// ════════════════════════════════════════════════════════════
// TrendPulse client — SSE-driven realtime dashboard (v0.2)
// Creator-first · Last 24h / Last 7 days windows · 100% real data
// ════════════════════════════════════════════════════════════

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── Formatting ─────────────────────────────────────────────
function fmtNum(n) {
  n = +n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K';
  return String(Math.round(n));
}
function fmtAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 8) return 'just now';
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
function fmtDur(ms) {
  const m = Math.floor((ms || 0) / 60000);
  if (m < 60) return m + 'm';
  if (m < 1440) return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  return Math.floor(m / 1440) + 'd ' + Math.floor((m % 1440) / 60) + 'h';
}

// ── Platform styling ───────────────────────────────────────
const PLATFORM_COLORS = {
  YouTube: '#ff5c6e', Twitch: '#a970ff', Reddit: '#ff6a33', 'Google Trends': '#8ab4ff',
  Steam: '#66c0f4', 'Apple Podcasts': '#fa57c1', 'Idea engine': '#c084fc',
};
const SECTION_TITLES = {
  now: 'Best Right Now', creators: 'Creator Watchlist', ideas: 'Top 5 Clip Ideas', moments: 'Moment Vault', videos: 'Trending Videos',
  trends: 'Trending Topics', reddit: 'Reddit', news: 'News',
  games: 'Trending Games', podcasts: 'Podcasts', viral: 'Viral Radar',
};
function platformBadge(p) {
  const base = (p || '').split(' · ')[0];
  const color = PLATFORM_COLORS[base] || '#8d94a8';
  return `<span class="badge" style="color:${color};border-color:${color}59;background:${color}14">${esc(base)}</span>`;
}

// ── State ──────────────────────────────────────────────────
const SECTION_ORDER = ['now', 'creators', 'ideas', 'moments', 'videos', 'trends', 'reddit', 'news', 'games', 'podcasts', 'viral'];
const SORTS = {
  creators: [['velocity', 'Latest video velocity'], ['latestViews', 'Latest views'], ['subs', 'Subscribers'], ['recency', 'Latest upload']],
  ideas: [['score', 'Best first']],
  moments: [['score', 'Viral score'], ['views', 'Views'], ['recency', 'Newest']],
  videos: [['score', 'Viral score'], ['views', 'Views'], ['velocity', 'Velocity'], ['likes', 'Likes'], ['comments', 'Comments'], ['recency', 'Newest']],
  trends: [['score', 'Viral score'], ['searches', 'Search volume'], ['growth', 'Growth %']],
  reddit: [['score', 'Viral score'], ['ups', 'Upvotes'], ['comments', 'Comments'], ['velocity', 'Velocity'], ['recency', 'Newest']],
  news: [['score', 'Viral score'], ['recency', 'Newest']],
  games: [['score', 'Viral score'], ['players', 'Players'], ['viewers', 'Viewers'], ['weeklyRank', 'Weekly chart #'], ['growth', 'Growth %']],
  podcasts: [['score', 'Viral score'], ['popularity', 'Chart rank']],
  viral: [['score', 'Viral score']],
};

const state = {
  sections: new Map(),
  sources: [],
  alerts: [],
  window: 'day', // 'day' | 'week'
  momentsF: { period: 'week', event: 'all', cat: 'all' },
  scans: {}, // deep-scan cache per opportunity id
  rank: { tab: 'now', cat: 'all', sort: 'score' },
  vault: null,
  vlib: { view: 'all', facetKey: null, facetVal: null, q: '', sort: 'virality' },
  filters: { platform: 'all' },
  sort: {},
  bookmarks: JSON.parse(localStorage.getItem('tp.bookmarks') || '[]'),
  unread: 0,
  connected: false,
};
const lastMetric = new Map();

function prim(it) {
  const m = it.metrics || {};
  return m.latestViews ?? m.views ?? m.ups ?? m.searches ?? m.players ?? m.popularity ?? m.score ?? 0;
}
function windowMs() {
  return state.window === 'day' ? 864e5 : 7 * 864e5;
}

// ── SVG sparklines ─────────────────────────────────────────
let gid = 0;
function sparkSVG(history, cls = 'spark', w = 74, h = 26) {
  if (!history || history.length < 2)
    return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"></svg>`;
  const min = Math.min(...history), max = Math.max(...history), span = max - min || 1;
  const pts = history.map((v, i) => [((i / (history.length - 1)) * w).toFixed(1), (h - 3 - ((v - min) / span) * (h - 9)).toFixed(1)]);
  const line = pts.map((p) => p.join(',')).join(' ');
  const id = 'sg' + gid++;
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8b5cf6" stop-opacity=".32"/>
      <stop offset="1" stop-color="#22d3ee" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="0,${h} ${line} ${w},${h}" fill="url(#${id})"/>
    <polyline points="${line}" fill="none" stroke="#22d3ee" stroke-width="1.6"
      stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

function scoreChip(s) {
  const cls = s >= 70 ? 'hot' : s >= 50 ? 'warm' : '';
  return `<span class="score ${cls}" title="Viral score">${s}</span>`;
}
function deltaHTML(g) {
  if (g == null || Number.isNaN(g)) return '';
  const up = g >= 0;
  return `<span class="delta ${up ? 'up' : 'down'}" title="growth since first observed">${up ? '▲' : '▼'}${Math.abs(g).toFixed(Math.abs(g) < 10 ? 1 : 0)}%</span>`;
}
function initials(t = '') {
  return t.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('') || '??';
}
function phHTML(txt, cls) {
  const h = [...String(txt)].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `<span class="thumb thumb-ph ${cls}" style="background:linear-gradient(135deg,hsl(${h} 60% 40%),hsl(${(h + 70) % 360} 65% 26%))">${esc(initials(txt).toUpperCase())}</span>`;
}
window.tpImgErr = (img) => { img.outerHTML = phHTML(img.dataset.ph || '??', img.dataset.cls || 'wide'); };
function thumbHTML(it, cls) {
  if (it.thumbnail)
    return `<img class="thumb ${cls}" loading="lazy" src="${esc(it.thumbnail)}" data-ph="${esc(initials(it.title))}" data-cls="${cls}" onerror="tpImgErr(this)" alt="">`;
  return phHTML(it.title, cls);
}

// ── Rows (flat sections) ───────────────────────────────────
function starBtn(it) {
  const on = state.bookmarks.some((b) => b.id === it.id);
  return `<button class="star ${on ? 'on' : ''}" data-bm="${esc(it.id)}" title="Bookmark">${on ? '★' : '☆'}</button>`;
}
function rowHTML(it, sectionId) {
  const m = it.metrics || {};
  const open = `class="row" data-rid="${esc(it.id)}" data-sec="${sectionId}"`;
  const rank = `<span class="rank">${it.rank || '·'}</span>`;
  const star = starBtn(it);
  const via = sectionId === 'viral' && it.originSection ? ` · via ${SECTION_TITLES[it.originSection] || it.originSection}` : '';

  switch (it.kind) {
    case 'video':
      return `<div ${open}>${rank}${thumbHTML(it, 'wide')}
        <div class="rmain"><div class="rt">${esc(it.title)}</div>
          <div class="rs">${esc(it.subtitle || it.author)}${via}</div>
          <div class="rmeta">${platformBadge(it.platform)}<span class="rs">♥ ${fmtNum(m.likes)} · 💬 ${fmtNum(m.comments)} · ${fmtAgo(Date.now() - it.ageMs)}</span></div></div>
        ${sparkSVG(it.history)}
        <div class="mv">${fmtNum(m.views)}<small>views</small></div>
        <div class="mv">${fmtNum(m.velocity)}<small>views/hr</small></div>
        ${scoreChip(m.score)}${star}</div>`;
    case 'game':
      return `<div ${open}>${rank}${thumbHTML(it, 'tall')}
        <div class="rmain"><div class="rt">${esc(it.title)}</div>
          <div class="rs">${esc(it.subtitle)}</div>
          <div class="rmeta">${platformBadge(it.platform)}${(it.tags || []).map((t) => `<span class="badge" style="color:#86d98c;border-color:rgba(134,217,140,.4)">${esc(t)}</span>`).join('')}${m.weeklyRank ? `<span class="badge" style="color:var(--accent2);border-color:rgba(34,211,238,.4)">#${m.weeklyRank} this week</span>` : ''}${it.meta?.rankMove > 0 ? `<span class="delta up" style="font-size:9.5px">▲${it.meta.rankMove} vs last wk</span>` : it.meta?.rankMove < 0 ? `<span class="delta down" style="font-size:9.5px">▼${-it.meta.rankMove} vs last wk</span>` : ''}</div></div>
        ${sparkSVG(it.history)}
        <div class="mv">${fmtNum(m.players || m.viewers)}<small>${m.players ? 'players' : 'viewers'}</small></div>
        ${m.viewers && m.players ? `<div class="mv">${fmtNum(m.viewers)}<small>watching</small></div>` : ''}
        ${deltaHTML(m.growth)}${scoreChip(m.score)}${star}</div>`;
    case 'topic':
      return `<div ${open}>${rank}
        <div class="rmain"><div class="rt">${esc(it.title)}</div>
          <div class="rs">${esc(it.subtitle)}</div>
          <div class="rmeta">${platformBadge(it.platform)}<span class="rs">${esc(it.category)}</span></div></div>
        ${sparkSVG(it.history)}
        <div class="mv">${fmtNum(m.searches || m.mentions)}<small>${m.searches ? 'searches' : 'mentions'}</small></div>
        ${deltaHTML(m.growth)}${scoreChip(m.score)}${star}</div>`;
    case 'post':
      return `<div ${open}>${rank}
        <div class="rmain"><div class="rt">${esc(it.title)}</div>
          <div class="rs">${esc(it.subtitle)} · ${fmtAgo(Date.now() - it.ageMs)}</div>
          <div class="rmeta">${platformBadge(it.platform)}${(it.tags || []).map((t) => `<span class="badge" style="color:var(--muted);border-color:var(--border)">${esc(t)}</span>`).join('')}</div></div>
        ${sparkSVG(it.history)}
        <div class="mv">${fmtNum(m.ups)}<small>▲ upvotes</small></div>
        <div class="mv">${fmtNum(m.comments)}<small>comments</small></div>
        ${scoreChip(m.score)}${star}</div>`;
    case 'podcast':
      return `<div ${open}>${rank}${thumbHTML(it, 'sq')}
        <div class="rmain"><div class="rt">${esc(it.title)}</div>
          <div class="rs">${esc(it.subtitle)} · ${esc(it.category)}</div>
          <div class="rmeta">${platformBadge(it.platform)}${(it.tags || []).map((t) => `<span class="rs">${esc(t)}</span>`).join('')}</div></div>
        <div class="mv">${m.popularity}<small>popularity</small></div>
        ${scoreChip(m.score)}${star}</div>`;
    case 'news':
      return `<div ${open}>${rank}
        <div class="rmain"><div class="rt">${esc(it.title)}</div>
          <div class="rs">${esc(it.subtitle)}</div>
          <div class="rmeta">${platformBadge(it.platform)}<span class="rs">${fmtAgo(Date.now() - it.ageMs)}</span></div></div>
        ${scoreChip(m.score)}${star}</div>`;
    default:
      return `<div ${open}>${rank}<div class="rmain"><div class="rt">${esc(it.title)}</div></div>${scoreChip(m.score)}</div>`;
  }
}

// ── Sorting / filtering ────────────────────────────────────
function sortItems(items, key) {
  const a = [...items];
  const M = (x) => x.metrics || {};
  switch (key) {
    case 'viewers': return a.sort((x, y) => (M(y).viewers || 0) - (M(x).viewers || 0));
    case 'players': return a.sort((x, y) => (M(y).players || 0) - (M(x).players || 0));
    case 'views': return a.sort((x, y) => (M(y).views || 0) - (M(x).views || 0));
    case 'latestViews': return a.sort((x, y) => (M(y).latestViews || 0) - (M(x).latestViews || 0));
    case 'subs': return a.sort((x, y) => (M(y).subs || 0) - (M(x).subs || 0));
    case 'likes': return a.sort((x, y) => (M(y).likes || 0) - (M(x).likes || 0));
    case 'comments': return a.sort((x, y) => (M(y).comments || 0) - (M(x).comments || 0));
    case 'ups': return a.sort((x, y) => (M(y).ups || 0) - (M(x).ups || 0));
    case 'searches': return a.sort((x, y) => (M(y).searches || M(y).mentions || 0) - (M(x).searches || M(x).mentions || 0));
    case 'popularity': return a.sort((x, y) => (M(y).popularity || 0) - (M(x).popularity || 0));
    case 'weeklyRank': return a.sort((x, y) => (M(x).weeklyRank || 999) - (M(y).weeklyRank || 999));
    case 'growth': return a.sort((x, y) => (M(y).growth || 0) - (M(x).growth || 0));
    case 'velocity': return a.sort((x, y) => (M(y).velocity || 0) - (M(x).velocity || 0));
    case 'recency': return a.sort((x, y) => (x.ageMs || 0) - (y.ageMs || 0));
    default: return a.sort((x, y) => (M(y).score || 0) - (M(x).score || 0));
  }
}
function filterItems(items) {
  const win = windowMs();
  const { platform } = state.filters;
  return items.filter((it) => {
    if (it.meta?.window && it.meta.window !== state.window) return false;
    if (!it.timeless && (it.ageMs || 0) > win) return false;
    if (platform !== 'all' && !(it.platform || '').includes(platform)) return false;
    return true;
  });
}

// ── Cards ──────────────────────────────────────────────────
function skeleton(n) {
  let s = '';
  for (let i = 0; i < n; i++)
    s += `<div class="skel"><i style="width:22px;height:14px"></i><i style="width:74px;height:42px"></i><i style="flex:1;height:30px"></i><i style="width:38px;height:20px"></i></div>`;
  return s;
}
const CARD_META = {
  creators: ['🎯', 'Creator Watchlist', 'Speed, Kai Cenat, Joe Rogan & more · real uploads, views & velocity'],
  ideas: ['💡', 'Top 5 Clip Ideas', 'generated from 100% live data — every number below is real'],
  moments: ['🏆', 'Moment Vault', 'trending moments auto-saved — Twitch clips · r/soccer goal clips · event highlights · browse Week / Month / Year · event · category'],
  now: ['🔥', 'Opportunity Rankings', 'five ranked Top-5 lists recomputed from live data · transparent evidence on every card'],
  videos: ['🎥', 'Trending Videos', 'YouTube · view velocity · filtered by the window tabs'],
  trends: ['🔎', 'Trending Topics', 'Google Trends · live right now'],
  reddit: ['💬', 'Reddit', 'gaming & creator subs · hot · rising · top of the week'],
  news: ['⚡', 'Creator & Gaming News', 'DEXERTO · PC Gamer · Eurogamer · The Verge · IGN'],
  games: ['🎮', 'Trending Games', '24h tab: live players + Twitch viewers · 7d tab: Steam weekly top-sellers · ⚽ = football (soccer)'],
  podcasts: ['🎙️', 'Podcasts', 'Apple Podcasts top charts'],
  viral: ['📈', 'Viral Radar', 'the strongest real opportunities across every section'],
};
function cardShell(id) {
  const [icon, title, sub] = CARD_META[id];
  const span2 = id === 'creators' || id === 'ideas';
  const sortSel = (id === 'ideas' || id === 'now') ? '' :
    `<select class="sort-sel" id="sort-${id}" title="Sort by">${SORTS[id].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
  const addBox = id === 'creators'
    ? `<span class="add-creator"><input id="add-handle" placeholder="@handle or name"><button id="add-btn">+ Add</button></span>`
    : '';
  const expBtn = (id === 'creators' || id === 'ideas' || id === 'now') ? '' : `<button class="exp-btn" data-exp="${id}" title="Expand">⤢</button>`;
  return `<section class="card ${span2 ? 'span-2' : ''}" id="card-${id}">
    <header class="card-h">
      <span class="ci">${icon}</span>
      <div><h2>${title}</h2><div class="sub" id="upd-${id}">${esc(sub)}</div></div>
      <span class="sp"></span>
      ${addBox}${sortSel}${expBtn}
    </header>
    <div class="card-list" id="list-${id}">${skeleton(id === 'ideas' ? 8 : 6)}</div>
    <footer class="card-foot"><span id="cnt-${id}">—</span><span id="srcs-${id}"></span></footer>
  </section>`;
}

function statusBanner(sec) {
  const req = sec.meta?.requires;
  const errSrc = (sec.meta?.sources || []).find((s) => s.mode === 'error');
  const needsSrc = (sec.meta?.sources || []).find((s) => (s.mode || '').includes('needs'));
  if (!sec.items.length && errSrc) {
    return `<div class="setup err">⚠️ Source failing: <b>${esc(errSrc.label)}</b><br><span class="err-msg">${esc(errSrc.error || 'unknown error')}</span><br><span>This key is set but YouTube rejected the call — run <code>docker compose exec trendpulse sh -c 'wget -qO- "https://www.googleapis.com/youtube/v3/videos?part=snippet&id=dQw4w9WgXcQ&key=$YOUTUBE_API_KEY" | head -c 200'</code> and send the output.</span></div>`;
  }
  if (!sec.items.length && (req || needsSrc)) {
    return `<div class="setup">🔌 This section needs <b>${esc(req.vars.join(' + '))}</b><br>${esc(req.hint || '')}<br>
      <span>Add it to <code>.env</code> then run <code>docker compose up --build</code> — nothing fake is shown in its place.</span></div>`;
  }
  if (!sec.items.length && errSrc) {
    return `<div class="setup err">⚠️ Source failing: <b>${esc(errSrc.label)}</b><br><span class="err-msg">${esc(errSrc.error || 'unknown error')}</span><br>
      <span>TrendPulse shows nothing instead of inventing data. It retries automatically.</span></div>`;
  }
  if (!sec.items.length) return '<div class="sr-empty">Nothing here for the current window yet — real data arrives shortly.</div>';
  return '';
}

function renderSection(id) {
  const sec = state.sections.get(id);
  const list = $('#list-' + id);
  if (!sec || !list) return;

  if (id === 'now') return renderRankings(sec);
  if (id === 'creators') return renderCreators(sec);
  if (id === 'ideas') return renderIdeas(sec);
  if (id === 'moments') return renderMoments(sec);

  const items = sortItems(filterItems(sec.items), state.sort[id] || 'score');
  const banner = statusBanner(sec);
  const keepScroll = list.scrollTop;
  list.innerHTML = (banner && !items.length ? banner : items.map((it) => rowHTML(it, id)).join('')) ||
    '<div class="sr-empty">No items match the current window/filters.</div>';
  list.scrollTop = keepScroll;

  for (const el of list.children) {
    const rid = el.dataset?.rid;
    if (!rid) continue;
    const it = items.find((x) => x.id === rid);
    if (!it) continue;
    const v = prim(it);
    if (lastMetric.has(rid) && lastMetric.get(rid) !== v) el.classList.add('flash');
    lastMetric.set(rid, v);
  }
  finishCard(id, sec, items.length);
}

function finishCard(id, sec, shown) {
  const upd = $('#upd-' + id);
  if (upd) upd.textContent = sec.updatedAt ? 'updated ' + fmtAgo(sec.updatedAt) : CARD_META[id][2];
  const cnt = $('#cnt-' + id);
  if (cnt) cnt.textContent = `${shown} of ${sec.items.length} items`;
  const srcs = $('#srcs-' + id);
  if (srcs) srcs.textContent = [...new Set(sec.items.map((i) => (i.platform || '').split(' · ')[0]))].join(' · ');
}

// ── Creator watchlist rendering ────────────────────────────
function videoItemFrom(v, cr) {
  return {
    id: 'yt-' + v.videoId, kind: 'video', section: 'creators', platform: 'YouTube',
    title: v.title, subtitle: cr.title, author: cr.title, category: 'Creator upload',
    url: v.url, thumbnail: v.thumb, embed: v.embed, ageMs: v.ageMs,
    metrics: { views: v.views, likes: v.likes, comments: v.comments, velocity: v.velocity, score: null },
    history: [],
  };
}
function renderCreators(sec) {
  const list = $('#list-creators');
  const win = windowMs();
  const creators = sortItems(sec.items, state.sort.creators || 'velocity');
  const banner = statusBanner(sec);
  if (!creators.length) {
    list.innerHTML = banner || '<div class="sr-empty">No creators resolved yet.</div>';
    finishCard('creators', sec, 0);
    return;
  }
  const html = creators.map((cr) => {
    const m = cr.metrics || {};
    const live = cr.meta?.live;
    const videos = (cr.meta?.videos || []).filter((v) => v.ageMs <= win).slice(0, 3);
    const on = state.bookmarks.some((b) => b.id === cr.id);
    return `<div class="creator">
      <div class="creator-h" data-rid="${esc(cr.id)}" data-sec="creators">
        ${thumbHTML(cr, 'sq')}
        <div class="rmain">
          <div class="rt">${esc(cr.title)} ${live ? `<span class="live-chip">LIVE · ${fmtNum(live.viewers)} watching</span>` : ''}</div>
          <div class="rs">${esc(cr.subtitle)} · ${fmtNum(m.subs)} subs${m.videos7d ? ` · ${m.videos7d} uploads in 7d` : ''}${live?.game ? ` · ${esc(live.game)}` : ''}</div>
        </div>
        ${sparkSVG(cr.history)}
        <div class="mv">${fmtNum(m.latestViews)}<small>latest video</small></div>
        <div class="mv">${fmtNum(m.velocity)}<small>views/hr</small></div>
        ${scoreChip(m.score)}
        ${cr.meta?.custom ? `<button class="x mini" data-unwatch="${esc(cr.meta.handle)}" title="Remove from watchlist">✕</button>` : ''}
        <button class="star ${on ? 'on' : ''}" data-bm="${esc(cr.id)}">${on ? '★' : '☆'}</button>
      </div>
      <div class="creator-videos">${
        videos.length
          ? videos.map((v) => `<div class="vrow" data-vid="${esc(v.videoId)}" data-cr="${esc(cr.id)}">
              ${v.thumb ? `<img class="thumb wide" loading="lazy" src="${esc(v.thumb)}" data-ph="${esc(initials(v.title))}" data-cls="wide" onerror="tpImgErr(this)" alt="">` : phHTML(v.title, 'wide')}
              <div class="rmain"><div class="rt">${esc(v.title)}</div>
                <div class="rs">${fmtAgo(Date.now() - v.ageMs)} · ♥ ${fmtNum(v.likes)} · 💬 ${fmtNum(v.comments)}</div></div>
              <div class="mv">${fmtNum(v.views)}<small>views</small></div>
              <div class="mv">${fmtNum(v.velocity)}<small>/hr</small></div>
            </div>`).join('')
          : `<div class="no-videos">No uploads in the last ${state.window === 'day' ? '24 hours' : '7 days'} — switch the window tab above.</div>`
      }</div>
    </div>`;
  }).join('');
  const keepScroll = list.scrollTop;
  list.innerHTML = html;
  list.scrollTop = keepScroll;
  finishCard('creators', sec, creators.length);
}

// ── Top 5 ideas rendering ──────────────────────────────────
function renderIdeas(sec) {
  const list = $('#list-ideas');
  if (!sec.items.length) {
    list.innerHTML = '<div class="sr-empty">Ideas appear as soon as creators, trends, news and games data lands.</div>';
    finishCard('ideas', sec, 0);
    return;
  }
  const _compPanel = renderCompilationsPanel();
  list.innerHTML = `<div class="ideas-note">🎬 <b>AI Compilation Engine</b> — first scans your Moment Vault for compilations you can make <i>right now</i>, then falls back to live-trend ideas. Every number is real.</div>
    ${_compPanel}
    <div class="lane-h"><h3>💡 Evidence-based ideas</h3><span class="why">from live trends / news / creators (used when the Vault can't compile yet)</span></div>
    <div class="ideas-grid">${sec.items.map((it) => {
      const meta = it.meta || {};
      const diff = (meta.difficulty || '').toLowerCase();
      return `<div class="idea-card">
        <div class="idea-top"><span class="rank" style="width:auto">${it.rank}</span><b>${esc(it.title)}</b>${scoreChip(it.metrics.score)}</div>
        <p class="idea-hook">${esc(meta.hook || it.subtitle)}</p>
        <ul class="idea-ev">${(meta.evidence || []).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
        <div class="idea-foot">
          ${meta.difficulty ? `<span class="diff ${esc(diff)}">${esc(meta.difficulty)}</span>` : ''}
          ${(it.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
          <span class="sp"></span>
          ${(meta.sources || []).slice(0, 2).map((s, i) => `<a class="mini-link" href="${esc(s)}" target="_blank" rel="noopener">source ${i + 1} ↗</a>`).join('')}
        </div>
      </div>`;
    }).join('')}</div>`;
  finishCard('ideas', sec, sec.items.length);
  wireCompActions(list);
}

const MOMENT_PERIODS = { week: 7 * 864e5, month: 31 * 864e5, year: 365 * 864e5, all: Infinity };

function momentCard(m) {
  const ev = m.meta?.eventName ? `<span class="badge ev">${esc(m.meta.eventIcon || '')} ${esc(m.meta.eventName)}</span>` : '';
  const cat = m.meta?.categoryName ? `<span class="badge cat">${esc(m.meta.categoryIcon || '')} ${esc(m.meta.categoryName)}</span>` : '';
  return `<div class="moment-card" data-rid="${esc(m.id)}" data-sec="moments">
    <div class="mc-thumb">
      ${m.thumbnail ? `<img loading="lazy" src="${esc(m.thumbnail)}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="mc-src">${esc(m.platform)}</span>
      ${starBtn(m)}
    </div>
    <div class="mc-body">
      <div class="mc-title">${esc(m.title)}</div>
      <div class="mc-sub">${esc(m.subtitle || m.author)}</div>
      <div class="mc-badges">${ev}${cat}</div>
      <div class="mc-foot">
        <span>👁 ${fmtNum(m.metrics.views)}${m.meta?.viewsLabel ? ' ' + esc(m.meta.viewsLabel) : ''}</span>
        <span>${fmtAgo(Date.now() - m.ageMs)}</span>
      </div>
    </div>
  </div>`;
}


// ── Vault intelligence (client) ──────────────────────────────
const EMOJI = { shock:'😱', joy:'😊', anger:'😡', fear:'😨', sadness:'😢', excitement:'🤩', suspense:'😬', humor:'😂' };
function vstate() { return state.vault || { items: [], facets: {}, compilations: [], trendingAgain: [], series: [] }; }
async function refreshVault() {
  try {
    const r = await fetch('/api/vault').then((x) => x.json());
    if (r.ok) state.vault = { items: r.items || [], facets: r.facets || {}, compilations: r.compilations || [], trendingAgain: r.trendingAgain || [], series: r.series || [] };
  } catch {}
}
function usedIds() { try { return new Set(JSON.parse(localStorage.getItem('tp.used') || '[]')); } catch { return new Set(); } }
function toggleUsed(id) {
  const s = usedIds(); if (s.has(id)) s.delete(id); else s.add(id);
  localStorage.setItem('tp.used', JSON.stringify([...s]));
}
const SMART = [
  ['unused', 'Unused clips', (m) => !usedIds().has(m.id)],
  ['unused-viral', 'Unused · high viral', (m) => !usedIds().has(m.id) && (m.meta?.scores?.virality || 0) >= 70],
  ['unused-week', 'Unused this week', (m) => !usedIds().has(m.id) && (m.meta?.vaultAgeMs ?? m.ageMs ?? 9e9) <= 7 * 864e5],
  ['unused-90', 'Unused · score > 90', (m) => !usedIds().has(m.id) && (m.meta?.scores?.virality || 0) > 90],
  ['evergreen', 'Evergreen', (m) => (m.meta?.scores?.evergreen || 0) >= 60],
  ['gems', 'Hidden gems', (m) => (m.meta?.scores?.virality || 0) >= 60 && (m.meta?.scores?.competition || 50) <= 35],
];

function vaultCard(m) {
  const md = m.meta || {}, sc = md.scores || {};
  const emos = Object.keys(md.emotions || {});
  const emo = emos.sort((a, b) => md.emotions[b] - md.emotions[a])[0];
  const tags = (md.tags || []).slice(0, 4);
  return `<div class="vlib-card" data-rid="${esc(m.id)}" data-sec="moments">
    <div class="vlib-thumb">
      ${m.thumbnail ? `<img loading="lazy" src="${esc(m.thumbnail)}" alt="" onerror="this.style.display='none'">` : ''}
      ${emo ? `<span class="vlib-emo">${EMOJI[emo] || '•'}</span>` : ''}
      ${md.duration ? `<span class="vlib-dur">${fmtVidLen(md.duration)}</span>` : ''}
      <span class="vdot vdot-${md.verification||'partial'}" title="${esc((md.verification||'partial'))}"></span>
      <span class="star ${state.bookmarks.some((b) => b.id === m.id) ? 'on' : ''}" data-bm="${esc(m.id)}">${state.bookmarks.some((b) => b.id === m.id) ? '★' : '☆'}</span>
    </div>
    <div class="vlib-body">
      <div class="vlib-title">${esc(m.title)}</div>
      <div class="vlib-meta">${esc(md.creator || m.author || '')} · ${esc(m.platform)}${md.game ? ' · ' + esc(md.game) : ''}</div>
      <div class="vlib-tags">${tags.map((t) => `<span>${esc(t)}</span>`).join('')}${emos.slice(0, 2).map((e) => `<span class="emo">${esc(e)}</span>`).join('')}</div>
      <div class="vlib-scores"><span>viral <b>${sc.virality ?? '–'}</b></span><span>ever <b>${sc.evergreen ?? '–'}</b></span><span>emo <b>${sc.emotion ?? '–'}</b></span><span>comp <b>${sc.competition ?? '–'}</b></span></div>
    </div>
  </div>`;
}

function renderMoments(sec) {
  const list = $('#list-moments');
  const st = state.vlib || { view: 'all', facetKey: null, facetVal: null, q: '', sort: 'virality' };
  const V = vstate();
  let items = (V.items && V.items.length ? V.items : sec.items || []);
  // search
  if (st.q) {
    const q = st.q.toLowerCase();
    items = items.filter((m) => { const md = m.meta || {}; const hay = `${m.title} ${md.creator} ${md.game} ${md.event} ${(md.tags || []).join(' ')} ${Object.keys(md.emotions || {}).join(' ')} ${md.momentType} ${(md.people || []).join(' ')} ${(md.teams || []).join(' ')}`.toLowerCase(); return hay.includes(q) || smartMatch(q, m); });
  }
  // smart filter
  if (st.view && st.view !== 'all') { const fn = (SMART.find((s) => s[0] === st.view) || [])[2]; if (fn) items = items.filter(fn); }
  // facet filter
  if (st.facetKey && st.facetVal) {
    items = items.filter((m) => { const md = m.meta || {};
      if (st.facetKey === 'creator') return md.creator === st.facetVal;
      if (st.facetKey === 'game') return (md.games || []).includes(st.facetVal) || md.game === st.facetVal;
      if (st.facetKey === 'event') return md.event === st.facetVal;
      if (st.facetKey === 'emotion') return !!(md.emotions || {})[st.facetVal];
      if (st.facetKey === 'momentType') return md.momentType === st.facetVal;
      if (st.facetKey === 'tag') return (md.tags || []).includes(st.facetVal);
      if (st.facetKey === 'sport') return (md.sports || []).includes(st.facetVal) || md.sport === st.facetVal;
      return true; });
  }
  items = sortVault(items, st.sort);

  const facets = V.facets || {};
  const railBlock = (title, key, entries, limit = 8) => {
    const rows = (entries || []).slice(0, limit);
    if (!rows.length) return '';
    return `<div class="vrail-block"><h5>${title}</h5>${rows.map(([v, n]) =>
      `<div class="vrail-item ${st.facetKey === key && st.facetVal === v ? 'on' : ''}" data-fk="${key}" data-fv="${esc(v)}"><span>${esc(v)}</span><em>${n}</em></div>`).join('')}</div>`;
  };
  const smartRows = SMART.map(([id, label, fn]) => { const n = (V.items || sec.items || []).filter(fn).length; return `<div class="vrail-item ${id.includes('unused') ? 'warn' : ''} ${st.view === id ? 'on' : ''}" data-smart="${id}"><span>${label}</span><em>${n}</em></div>`; }).join('');

  list.innerHTML = `<div class="vault-layout">
    <aside class="vault-rail">
      <input class="vrail-search" id="vsearch" placeholder="Search: funny kai, world cup goals…" value="${esc(st.q)}">
      <div class="vrail-block vrail-smart"><h5>Smart filters</h5>${smartRows}</div>
      ${railBlock('Creators', 'creator', facets.creator)}
      ${railBlock('Games', 'game', facets.game)}
      ${railBlock('Events', 'event', facets.event)}
      ${railBlock('Emotions', 'emotion', facets.emotion)}
      ${railBlock('Moment type', 'momentType', facets.momentType)}
      ${railBlock('Tags', 'tag', facets.tag, 12)}
      ${railBlock('Sports', 'sport', facets.sport)}
    </aside>
    <div class="vault-main">
      <div class="vault-toolbar">
        <div class="chips">${[['all', 'All'], ['unused', 'Unused'], ['evergreen', 'Evergreen'], ['gems', 'Hidden gems']].map(([v, l]) => `<button data-vview="${v}" class="${st.view === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <select id="vsort" class="sort-sel">${[['virality', 'Virality'], ['evergreen', 'Evergreen'], ['emotion', 'Emotion'], ['replayability', 'Replayability'], ['competition', 'Lowest competition'], ['newest', 'Newest']].map(([v, l]) => `<option value="${v}" ${st.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span class="sp"></span>
        <span class="vault-count">${items.length} of ${(V.items || sec.items || []).length} moments${st.facetVal ? ' · ' + esc(st.facetVal) + ' ✕' : ''}</span>
      </div>
      ${items.length ? `<div class="vlib-grid">${items.map(vaultCard).join('')}</div>` : `<div class="setup">🗃 No moments here yet. Save clips from the analyzer (🎬) or opportunities — they auto-tag by emotion, game, event, people & tags, then cluster themselves here like a personal library.</div>`}
    </div>
  </div>`;

  // wiring
  const vs = $('#vsearch'); if (vs) { vs.oninput = (e) => { state.vlib = { ...st, q: e.target.value }; renderMoments(sec); }; }
  list.querySelectorAll('[data-fk]').forEach((el) => { el.onclick = () => { const fk = el.dataset.fk, fv = el.dataset.fv; state.vlib = { ...st, facetKey: st.facetVal === fv ? null : fk, facetVal: st.facetVal === fv ? null : fv }; renderMoments(sec); }; });
  list.querySelectorAll('[data-smart]').forEach((el) => { el.onclick = () => { state.vlib = { ...st, view: el.dataset.smart, facetKey: null, facetVal: null }; renderMoments(sec); }; });
  list.querySelectorAll('[data-vview]').forEach((el) => { el.onclick = () => { state.vlib = { ...st, view: el.dataset.vview }; renderMoments(sec); }; });
  const ss = $('#vsort'); if (ss) ss.onchange = (e) => { state.vlib = { ...st, sort: e.target.value }; renderMoments(sec); };
  finishCard('moments', sec, items.length);
}
function smartMatch(q, m) { const fn = (SMART.find((s) => s[0] === q) || [])[2]; return fn ? fn(m) : false; }
function sortVault(items, key) {
  const sc = (m) => m.meta?.scores || {};
  const a = [...items];
  switch (key) {
    case 'evergreen': return a.sort((x, y) => (sc(y).evergreen || 0) - (sc(x).evergreen || 0));
    case 'emotion': return a.sort((x, y) => (sc(y).emotion || 0) - (sc(x).emotion || 0));
    case 'replayability': return a.sort((x, y) => (sc(y).replayability || 0) - (sc(x).replayability || 0));
    case 'competition': return a.sort((x, y) => (sc(x).competition || 0) - (sc(y).competition || 0));
    case 'newest': return a.sort((x, y) => (x.ageMs || 0) - (y.ageMs || 0));
    default: return a.sort((x, y) => (sc(y).virality || 0) - (sc(x).virality || 0));
  }
}

// ── Compilation cards (ideas section = AI Compilation Engine) ──
function compCard(c) {
  return `<div class="comp-card">
    <h4>${esc(c.title)}</h4>
    <div class="comp-stats"><span><b>${c.clipCount}</b> clips</span><span>≈ <b>${esc(c.estDuration)}</b></span><span>difficulty <b>${esc(c.difficulty)}</b></span><span>trend <b>${c.trendScore}</b></span><span>evergreen <b>${c.evergreenScore}</b></span></div>
    <div class="comp-why">${esc(c.why)}</div>
    <div class="comp-actions">
      <button class="mini-btn grad" data-compopen="${esc(c.id)}">Open collection</button>
      <button class="mini-btn" data-comporder="${esc(c.id)}">Copy clip order</button>
      <button class="mini-btn" data-compscript="${esc(c.id)}">Script</button>
      <button class="mini-btn" data-comptitles="${esc(c.id)}">Titles</button>
      <button class="mini-btn" data-comphooks="${esc(c.id)}">Hooks</button>
      <button class="mini-btn" data-compexport="${esc(c.id)}">Export</button>
    </div>
  </div>`;
}
function compClips(c) { return (c.clips || []).map((id) => vstate().items.find((m) => m.id === id)).filter(Boolean); }
function renderCompilationsPanel() {
  const V = vstate(); const comps = V.compilations || [];
  if (!comps.length) return `<div class="setup" style="margin:14px 16px">📦 The Vault is too small to compile from yet — save a handful of clips and this engine will start suggesting ready-to-make compilations (e.g. "Top 5 Funniest Kai Reactions"). Until then, evidence-based ideas from live trends show below.</div>`;
  return `<div class="lane-h"><h3>🎬 Ready-to-make compilations (from your Vault)</h3><span class="why">${comps.length} compilations you can build today with zero extra searching</span></div>
    <div class="comp-grid">${comps.slice(0, 10).map(compCard).join('')}</div>`;
}
function wireCompActions(root) {
  root.querySelectorAll('[data-compopen]').forEach((b) => b.onclick = () => {
    const c = vstate().compilations.find((x) => x.id === b.dataset.compopen); if (!c) return;
    const clips = compClips(c);
    const trace = clips.map((m,i)=>{ const src=m.meta?.source||{}; const ts=(src.timestampStart!=null)?fmtHMS(src.timestampStart):''; return `<div class="clip-trace"><span class="ct-n">${i+1}</span>${src.platformIcon||'🔗'} <b>${esc(src.platform||m.platform)}</b> · ${esc(src.creator||m.author||'')} ${ts?'· ⏱ '+esc(ts):''}<span class="sp"></span>${src.url?`<a class="mini-link" href="${esc(src.url)}" target="_blank" rel="noopener">Open original ↗</a>`:''}</div>`; }).join('');
    openModal('📂 ' + c.title, `<div class="comp-stats" style="padding:0 0 10px"><span><b>${c.clipCount}</b> clips</span><span>≈ <b>${esc(c.estDuration)}</b></span><span><b>${esc(c.difficulty)}</b></span><span class="why">every clip traceable to its source</span></div><div class="clip-trace-list">${trace}</div><details style="margin-top:10px"><summary style="cursor:pointer;color:var(--muted);font-size:12px">Browse clips</summary><div class="vlib-grid" style="margin-top:8px">${clips.map(vaultCard).join('')}</div></details>`);
  });
  const act = (key, fn) => root.querySelectorAll(`[data-${key}]`).forEach((b) => b.onclick = () => { const c = vstate().compilations.find((x) => x.id === b.dataset[key]); if (c) fn(c); });
  act('comporder', (c) => { const t = compClips(c).map((m, i) => `${i + 1}. ${m.title} — ${m.url}`).join('\n'); navigator.clipboard.writeText(`Clip order — ${c.title}\n` + t).then(() => toast({ icon: '📋', title: 'Clip order copied' })); });
  act('compscript', (c) => exportComp(c, 'script'));
  act('comptitles', (c) => exportComp(c, 'titles'));
  act('comphooks', (c) => exportComp(c, 'hooks'));
  act('compexport', (c) => exportComp(c, 'md'));
}
function exportComp(c, kind) {
  const clips = compClips(c);
  const titles = [`${c.title}`, `I Ranked ${c.title.replace(/^Top \d+ /, '')} So You Don't Have To`, `${c.clipCount} ${c.title.replace(/^Top \d+ /, '')} That Hit Different`, `The Definitive ${c.title}`];
  const hooks = [`You won't believe #${clips.length}…`, `Wait for the last one 👀`, `This ${c.title.replace(/^Top \d+ /, '').toLowerCase()} compilation is insane 🔥`];
  let text = '';
  if (kind === 'titles') text = titles.join('\n');
  else if (kind === 'hooks') text = hooks.join('\n');
  else if (kind === 'script') text = [`🎬 ${c.title}`, '', `HOST: "${hooks[0]}"`, '', ...clips.map((m, i) => `[CLIP ${i + 1}] ${m.title}\n  B-ROLL: ${m.url}\n  VO: "${m.title} — and here's why it hits."`), '', `HOST: "Which one's your favourite? Comment below."`].join('\n');
  else text = [`# ${c.title}`, `> ${c.clipCount} clips · ≈ ${c.estDuration} · ${c.difficulty} · trend ${c.trendScore} · evergreen ${c.evergreenScore}`, '', c.why, '', ...clips.map((m, i) => `${i + 1}. **${m.title}** — ${m.url}`)].join('\n');
  if (kind === 'md') download(`comp-${c.id}.md`, text); else { navigator.clipboard.writeText(text).then(() => toast({ icon: '📋', title: kind + ' copied' })); }
}

// ── Homepage lanes (Ready / Trending again / Evergreen / Gems) ──
function vaultLanesHTML() {
  const V = vstate(); const items = V.items || [];
  if (!items.length) return '';
  const comps = (V.compilations || []).slice(0, 4);
  const again = (V.trendingAgain || []).slice(0, 4);
  const evergreen = items.filter((m) => (m.meta?.scores?.evergreen || 0) >= 60).sort((a, b) => (b.meta.scores.evergreen) - (a.meta.scores.evergreen)).slice(0, 6);
  const gems = items.filter((m) => (m.meta?.scores?.virality || 0) >= 60 && (m.meta?.scores?.competition || 50) <= 35).sort((a, b) => (b.meta.scores.virality) - (a.meta.scores.virality)).slice(0, 6);
  const lane = (icon, title, why, cards) => cards ? `<div class="lane-h"><h3>${icon} ${title}</h3><span class="why">${why}</span></div><div class="vlib-grid" style="padding:0 16px 6px">${cards}</div>` : '';
  return [
    lane('✅', 'Ready Now', 'compilations already buildable from your Vault', comps.length ? comps.map((c) => compCard(c)).join('') : null),
    lane('🔁', 'Trending Again', 'old clips resurfacing because the trend returned', again.length ? again.map((t) => `<div class="comp-card"><h4>↻ "${esc(t.label)}" is trending again</h4><div class="comp-stats"><span><b>${t.count}</b> clips in Vault</span></div><div class="comp-why">A live trend just matched your stored clips — re-cut them while the wave is up.</div><div class="comp-actions"><button class="mini-btn grad" data-again="${esc(t.label)}">Open collection</button></div></div>`).join('') : null),
    lane('🌲', 'Evergreen', 'always performs well', evergreen.length ? evergreen.map(vaultCard).join('') : null),
    lane('💎', 'Hidden Gems', 'high potential · low competition', gems.length ? gems.map(vaultCard).join('') : null),
  ].join('');
}

const STAGE_META = {
  detected: ['🔍', 'Detected'], growing: ['📈', 'Growing'], exploding: ['🚀', 'Exploding'],
  peak: ['⛰️', 'Peak'], declining: ['📉', 'Declining'],
};
const STAGE_ORDER = ['detected', 'growing', 'exploding', 'peak', 'declining'];

function fmtWithin(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return m + 'm';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}
function fmtHMS(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(ss).padStart(2, '0');
}
function confHTML(c) {
  const cls = c >= 80 ? 'hi' : c >= 55 ? 'mid' : 'lo';
  return `<span class="conf ${cls}" title="Clip confidence - model estimate from live signals"><i></i>${c}%</span>`;
}
function stageChip(st) {
  const m = STAGE_META[st] || ['•', st];
  return `<span class="stage-chip ${st}">${m[0]} ${m[1]}</span>`;
}
function stageTimeline(st) {
  const ci = STAGE_ORDER.indexOf(st);
  return `<div class="stage-tl">${STAGE_ORDER.map((s2, i) => {
    const m = STAGE_META[s2];
    return `<span class="tl-step ${i < ci ? 'done' : ''} ${i === ci ? 'cur' : ''}">${m[0]}<em>${m[1]}</em></span>`;
  }).join('<span class="tl-sep">→</span>')}</div>`;
}

function heroHTML(o) {
  const m = o.metrics || {}, meta = o.meta || {};
  return `<div class="opp-hero" data-rid="${esc(o.id)}" data-sec="now">
    <div class="opp-hero-img">
      ${o.thumbnail ? `<img src="${esc(o.thumbnail)}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="rank1">#1 RIGHT NOW</span>
    </div>
    <div class="opp-body">
      <div class="opp-title">${esc(o.title)}</div>
      <div class="opp-chips">
        ${confHTML(m.confidence)}${stageChip(meta.stage)}
        <span class="momentum" title="momentum (recent observations)">${esc(meta.momentum || '—')}</span>
        ${platformBadge(o.platform)}
        ${meta.eventName ? `<span class="badge ev" style="color:#c4b5fd;border-color:rgba(196,181,253,.4);background:rgba(139,92,246,.14)">${esc(meta.eventIcon || '')} ${esc(meta.eventName)}</span>` : ''}
        ${meta.vodOffset != null ? `<span class="vod-tag">⏱ clip at ${fmtHMS(meta.vodOffset)} in VOD · ${meta.duration || '?'}s</span>` : ''}
      </div>
      <div class="opp-stats">
        <span><b>${meta.viewsLabel ? '▲ ' : '+'}${fmtNum(m.velocity)}</b> ${meta.viewsLabel ? 'upvotes/hr' : 'views/hr'}</span>
        <span>uploaded <b>${fmtAgo(Date.now() - o.ageMs)}</b></span>
        <span>first detected <b>${fmtAgo(meta.firstSeenTs)}</b></span>
        <span><b>${fmtNum(m.views)}</b> ${meta.viewsLabel || 'views'}</span>
      </div>
      <div class="opp-urgency">⏳ Post within <span class="hot">~${fmtWithin(meta.postWithinMs)}</span> · trend expires in ~${fmtWithin(Math.max(0, meta.expiresMs - Date.now()))} · best length <b>${esc(meta.clipLen || '15–30s')}</b></div>
      <div class="opp-hooks">${(meta.hooks || []).map((h) => `<span>${esc(h)}</span>`).join('')}</div>
      <div class="opp-tags">${(meta.hashtags || []).map((t) => `<span>${esc(t)}</span>`).join('')}</div>
      <div class="opp-actions">
        <button class="btn primary" data-open="${esc(o.id)}">▶ Open & clip details</button>
        <button class="btn" data-plan="${esc(o.id)}">📋 Copy clip plan</button>
        <button class="btn" data-scan="${esc(o.id)}">🔍 Deep scan (competition + similar Shorts)</button>
      </div>
    </div>
  </div>`;
}

function oppRow(o) {
  const m = o.metrics || {}, meta = o.meta || {};
  return `<div class="opp-row" data-rid="${esc(o.id)}" data-sec="now">
    <span class="rank">${o.rank}</span>
    ${thumbHTML(o, 'wide')}
    <div class="rmain">
      <div class="rt">${esc(o.title)}</div>
      <div class="rs">${esc(o.author || o.subtitle)} · ${esc(o.platform)}</div>
      <div class="opp-mini">
        ${stageChip(meta.stage)}
        <span class="momentum">${esc(meta.momentum || '')}</span>
        <span>${meta.viewsLabel ? '▲' : '+'}${fmtNum(m.velocity)}/hr</span>
        <span>⏳ post within ~${fmtWithin(meta.postWithinMs)}</span>
        ${meta.vodOffset != null ? `<span class="vod-tag">⏱ ${fmtHMS(meta.vodOffset)}</span>` : ''}
        <button class="mini-btn" data-plan="${esc(o.id)}">📋 plan</button>
        <button class="mini-btn" data-scan="${esc(o.id)}">🔍 scan</button>
      </div>
    </div>
    ${confHTML(m.confidence)}
  </div>`;
}

function planText(o) {
  const m = o.metrics || {}, meta = o.meta || {};
  return [
    `🎬 CLIP PLAN · TrendPulse · #${o.rank || 1} right now`,
    `${STAGE_META[meta.stage]?.[0] || ''} ${meta.stage || ''} · Clip confidence: ${m.confidence}% (est.)`,
    `Moment: "${o.title}"`,
    `Source: ${o.url}${meta.vodOffset != null ? `  (⏱ starts at ${fmtHMS(meta.vodOffset)} in the VOD · ${meta.duration || '?'}s clip)` : ''}`,
    `Uploaded ${fmtAgo(Date.now() - o.ageMs)} · first detected ${fmtAgo(meta.firstSeenTs)} · post within ~${fmtWithin(meta.postWithinMs)} · best length ${meta.clipLen}`,
    `Hooks:\n${(meta.hooks || []).map((h, i) => `${i + 1}. ${h}`).join('\n')}`,
    `Hashtags: ${(meta.hashtags || []).join(' ')}`,
  ].join('\n');
}
async function copyPlan(o) {
  try {
    await navigator.clipboard.writeText(planText(o));
    toast({ icon: '📋', title: 'Clip plan copied', body: 'Timestamp, hooks & hashtags ready for your editor notes.' });
  } catch {
    toast({ icon: '⚠️', title: 'Copy failed', body: planText(o).slice(0, 120) });
  }
}

function scanHTML(r) {
  if (r.error) return `<div class="scan-err">⚠️ ${esc(r.error)}</div>`;
  const c = r.competition || { count: 0, level: 'LOW' };
  return `<div class="scan-comp">Already uploaded by <b>${c.count}</b> short-form video${c.count === 1 ? '' : 's'} → Competition: <span class="lvl ${c.level.toLowerCase()}">${c.level}</span>
    <div class="rs" style="margin-top:4px">${c.level === 'LOW' ? '🟢 Open lane - post now.' : c.level === 'MEDIUM' ? '🟡 Room with a sharper angle.' : '🔴 Saturated - pick a unique angle or skip.'}</div></div>
    <div class="dr-block"><h3>Similar Shorts (does the format work?)</h3>
    ${(r.similar || []).map((v) => `<a class="sim-row" href="${esc(v.url)}" target="_blank" rel="noopener">
      ${v.thumb ? `<img src="${esc(v.thumb)}" alt="">` : ''}
      <span class="t">${esc(v.title)}</span><span class="v">${fmtNum(v.views)} views</span></a>`).join('') || '<div class="rs">None found - completely open lane 🟢</div>'}
    </div>`;
}
async function openWithScan(id) {
  const it = state.sections.get('now')?.items.find((x) => x.id === id);
  if (!it) return;
  openDrawer(it);
  const slot = $('#scan-slot');
  if (!slot) return;
  if (state.scans[id]) { slot.innerHTML = scanHTML(state.scans[id]); return; }
  slot.innerHTML = '<div class="scan-err">Scanning YouTube for competition + similar Shorts…</div>';
  try {
    const r = await fetch('/api/scan?q=' + encodeURIComponent(it.title)).then((x) => x.json());
    state.scans[id] = r;
    if ($('#scan-slot')) $('#scan-slot').innerHTML = scanHTML(r);
  } catch (e) {
    if ($('#scan-slot')) $('#scan-slot').innerHTML = `<div class="scan-err">⚠️ ${esc(String(e.message || e))}</div>`;
  }
}

const RANK_TABS = [
  ['now', '🏆 Right Now'], ['rising', '📈 Rising'], ['gems', '💎 Hidden Gems'],
  ['peak', '\u23F0 About To Peak'], ['vault', '📦 From Your Vault'],
];
const RANK_CATS = ['all', 'creators', 'gaming', 'sports', 'news', 'ai', 'tech', 'anime', 'manga', 'manhwa', 'manhua', 'webnovels', 'lightnovels'];
const RANK_SORTS = [
  ['score', 'Highest opportunity score'], ['growth', 'Highest growth'], ['competition', 'Lowest competition'],
  ['newest', 'Newest'], ['lifetime', 'Longest remaining lifetime'], ['engagement', 'Highest engagement'],
  ['discussed', 'Most discussed'], ['faceless', 'Best for faceless channels'],
  ['shorts', 'Best for Shorts'], ['reels', 'Best for Reels'], ['tiktok', 'Best for TikTok'],
];
const CAT_RES = [
  ['anime', /anime|naruto|one piece|jujutsu|demon slayer|dragon ball|attack on titan/i],
  ['manga', /manga|boruto|chapter \d+/i],
  ['manhwa', /manhwa|solo leveling|tower of god|omniscient reader/i],
  ['manhua', /manhua|cultivation|martial peak|soul land/i],
  ['webnovels', /web ?novel|royalroad/i],
  ['lightnovels', /light ?novel|re:zero|overlord novel/i],
  ['sports', /world cup|mundial|football|soccer|premier league|champions league|\bnba\b|\bnfl\b|\bufc\b/i],
  ['gaming', /game|gaming|fortnite|valorant|minecraft|roblox|gta|call of duty|apex|dota|elden ring/i],
  ['ai', /\bai\b|chatgpt|openai|gpt|claude|gemini|artificial intelligence/i],
  ['tech', /apple|iphone|tesla|spacex|crypto|bitcoin|samsung|android/i],
  ['news', /breaking|election|president|court|police|lawsuit/i],
];
function catOf(text) {
  for (const [c, re] of CAT_RES) if (re.test(text || '')) return c;
  return 'creators';
}
function sortRanking(list, mode) {
  const M = (x) => x.metrics || {}, T = (x) => x.meta || {};
  const a = [...list];
  switch (mode) {
    case 'growth': return a.sort((x, y) => (T(y).acceleration || 0) - (T(x).acceleration || 0));
    case 'competition': return a.sort((x, y) => ((T(x).competition?.score ?? 0) - (T(y).competition?.score ?? 0)) || (M(y).score - M(x).score));
    case 'newest': return a.sort((x, y) => (T(x).trendAgeMs || 0) - (T(y).trendAgeMs || 0));
    case 'lifetime': return a.sort((x, y) => (T(y).remainingMs || 0) - (T(x).remainingMs || 0));
    case 'engagement': return a.sort((x, y) => ((M(y).likes || T(y).discussion || 0) - (M(x).likes || T(x).discussion || 0)));
    case 'discussed': return a.sort((x, y) => ((T(y).discussion || 0) - (T(x).discussion || 0)));
    case 'faceless': return a.sort((x, y) => ((T(y).formats?.faceless || 0) - (T(x).formats?.faceless || 0)) || (M(y).score - M(x).score));
    case 'shorts': case 'reels': case 'tiktok':
      return a.sort((x, y) => ((T(y).formats?.[mode] || 0) - (T(x).formats?.[mode] || 0)) || (M(y).score - M(x).score));
    default: return a.sort((x, y) => M(y).score - M(x).score);
  }
}
function rankCardHTML(o, idx) {
  const m = o.metrics || {}, mt = o.meta || {};
  const comp = mt.competition || { level: '?', why: [] };
  const why = idx === 0 ? `<div class="rk-why"><h4>Why ranked #1</h4><ul>${[
    ...(o.reasons || []).slice(0, 4),
    ...comp.why.slice(0, 2),
    mt.acceleration ? `acceleration ${mt.acceleration > 0 ? '+' : ''}${mt.acceleration}% across recent observations` : null,
    `first detected ${fmtAgo(mt.firstSeenTs || Date.now())}`,
  ].filter(Boolean).map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>` : '';
  return `<div class="rk-card ${idx === 0 ? 'top1' : ''}">
    <div class="rk-head">
      <span class="rank" style="font-size:13px;width:auto">#${idx + 1}</span>
      ${thumbHTML(o, 'wide')}
      <div style="flex:1;min-width:0"><b>${esc(o.title)}</b><div class="rs">${esc(o.author || o.subtitle)} \u00b7 ${esc(o.platform)}</div></div>
      ${confHTML(m.confidence || 0)}
    </div>
    <div class="rk-badges">
      ${stageChip(mt.stage || 'peak')}
      <span class="comp-chip ${(comp.level || 'medium').toLowerCase()}" title="${esc(comp.why.join(' \u00b7 '))}">competition: ${esc(comp.level || '?')}</span>
      ${(mt.bestFormats || []).map((f) => `<span class="fmt-chip">${esc(f)}</span>`).join('')}
      ${mt.category ? `<span class="cat-chip">${esc(mt.category)}</span>` : ''}
      <span class="momentum">${esc(mt.momentum || '')}</span>
    </div>
    ${why}
    <div class="rk-stats">
      <span>post within <b>~${fmtWithin(mt.postWithinMs || 0)}</b></span>
      <span>expires in <b>~${fmtWithin(Math.max(0, mt.remainingMs || 0))}</b></span>
      ${m.velocity ? `<span><b>+${fmtNum(m.velocity)}</b>/hr</span>` : ''}
      <span>score <b>${m.score}</b></span>
    </div>
    <div class="rk-actions">
      <button class="mini-btn grad" data-openopp="${esc(o.id)}">\u25B6 details</button>
      <button class="mini-btn" data-plan="${esc(o.id)}">📋 clip plan</button>
      <button class="mini-btn" data-scan="${esc(o.id)}">🔍 verify competition</button>
    </div>
  </div>`;
}
function vaultRankCard(v, idx) {
  const mo = v.moment || {};
  return `<div class="rk-card">
    <div class="rk-head">
      <span class="rank" style="font-size:13px;width:auto">#${idx + 1}</span>
      ${thumbHTML(mo, 'wide')}
      <div style="flex:1;min-width:0"><b>${esc(mo.title)}</b>
        <div class="rs vault-match">matches current trend: <b>${esc(v.trend)}</b> \u00b7 ${v.match}% match</div></div>
      ${scoreChip(v.score)}
    </div>
    <div class="rk-stats"><span>${esc(mo.platform)} \u00b7 ${fmtNum(mo.metrics?.views || 0)} ${esc(mo.meta?.viewsLabel || 'views')} \u00b7 ${(mo.meta?.categoryName || '')}</span></div>
    <div class="rk-actions"><button class="mini-btn grad" data-openmoment="${esc(mo.id)}">\u25B6 open moment</button></div>
  </div>`;
}
function renderRankings(sec) {
  const list = $('#list-now');
  const R = sec.meta?.rankings || { now: sec.items || [], rising: [], gems: [], peak: [], vault: [] };
  const st = state.rank;
  const isVault = st.tab === 'vault';
  let items = [];
  if (isVault) {
    items = (R.vault || []).filter((v) => st.cat === 'all' || catOf(`${v.moment?.title} ${v.moment?.author}`) === st.cat);
  } else {
    items = (R[st.tab] || []).filter((o) => st.cat === 'all' || (o.meta?.category || catOf(`${o.title} ${o.author}`)) === st.cat);
    items = sortRanking(items, st.sort);
  }
  const top = items.slice(0, 5);
  const cards = top.length
    ? (isVault ? top.map(vaultRankCard).join('') : top.map(rankCardHTML).join(''))
    : `<div class="setup" style="grid-column:1/-1">${isVault ? '📦 Nothing in your vault matches the current trends yet \u2014 save moments from the analyzer or Twitch clips and they\u2019ll resurface here when they become relevant.' : 'No opportunities in this category right now \u2014 try another category or tab.'}</div>`;
  list.innerHTML = `
    <div class="rk-tabs">${RANK_TABS.map(([id, l]) => `<button data-rtab="${id}" class="${st.tab === id ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="rk-controls">
      <select id="rk-cat">${RANK_CATS.map((c) => `<option value="${c}" ${st.cat === c ? 'selected' : ''}>${c === 'all' ? 'All categories' : c}</option>`).join('')}</select>
      ${isVault ? '' : `<select id="rk-sort">${RANK_SORTS.map(([v, l]) => `<option value="${v}" ${st.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`}
      <span class="vault-count" style="margin-left:auto">transparent ranking \u2014 #1 shows its full evidence</span>
    </div>
    <div class="rk-list">${cards}</div>
    ${vaultLanesHTML()}`;
  list.querySelectorAll('[data-rtab]').forEach((b) => {
    b.onclick = () => { state.rank.tab = b.dataset.rtab; renderRankings(sec); };
  });
  const cat = $('#rk-cat'); if (cat) cat.onchange = () => { state.rank.cat = cat.value; renderRankings(sec); };
  const srt = $('#rk-sort'); if (srt) srt.onchange = () => { state.rank.sort = srt.value; renderRankings(sec); };
  list.querySelectorAll('[data-openopp]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const it = state.sections.get('now')?.items.find((x) => x.id === b.dataset.openopp);
      if (it) openDrawer(it);
    };
  });
  list.querySelectorAll('[data-openmoment]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const it = state.sections.get('moments')?.items.find((x) => x.id === b.dataset.openmoment);
      if (it) openDrawer(it);
    };
  });
  finishCard('now', sec, items.length);
  wireCompActions(list);
  list.querySelectorAll('[data-again]').forEach((b)=>b.onclick=()=>{ const t=b.dataset.again; const ids=(vstate().trendingAgain.find(x=>x.label===t)||{}).ids||[]; const clips=ids.map(id=>vstate().items.find(m=>m.id===id)).filter(Boolean); openModal('🔁 Trending again: '+t, `<div class="vlib-grid">${clips.map(vaultCard).join('')}</div>`); });
}

// ── AI Top Lists ─────────────────────────────────────────────
let TOPLIST = null;
function tlItemHTML(it) {
  return `<div class="tl-item ${it.rank === 1 ? 'top1' : ''}">
    <div class="tl-item-head">
      ${it.thumb ? `<img src="${esc(it.thumb)}" alt="" onerror="this.style.display='none'">` : ''}
      <div style="flex:1;min-width:0">
        <a href="${esc(it.url)}" target="_blank" rel="noopener"><b>${it.rank}. ${esc(it.title)}</b></a>
        <div class="tl-meta">${esc(it.source)} \u00b7 👁 ${fmtNum(it.popularity)} \u00b7 💬 ${fmtNum(it.discussion)} discussion</div>
      </div>
      ${scoreChip(it.score)}
    </div>
    <ul class="tl-why"><li style="list-style:none;color:var(--dim);padding-left:0;font-weight:700">Why it deserves #${it.rank}</li>${it.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
    <div class="tl-ideas"><b>Suggested Shorts:</b> ${it.shortsIdeas.map((x) => esc(x)).join(' \u00b7 ')}<br>
      <b>Hook:</b> "${esc(it.hooks[0])}" \u00b7 <b>Thumbnail:</b> ${esc(it.thumbnailIdea)}</div>
  </div>`;
}
function tlAssetsHTML(r) {
  const a = r.assets;
  return `<div class="tl-assets">
    <h4>🎬 Content creator kit (generated suggestions)</h4>
    <h4>YouTube titles</h4><ul>${a.titles.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    <h4>Hooks</h4><ul>${a.hooks.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    <h4>Intro</h4><p>${esc(a.intro)}</p>
    <h4>Hashtags</h4><div class="tl-chips">${a.hashtags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
    <h4>Thumbnail text</h4><div class="tl-chips">${a.thumbnailText.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
    <h4>SEO keywords</h4><div class="tl-chips">${a.seo.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
    <h4>Description</h4><p style="white-space:pre-line">${esc(a.description)}</p>
  </div>`;
}
function renderTopList(r) {
  TOPLIST = r;
  $('#tl-results').innerHTML = `
    <div class="tl-src">${r.sourcesUsed.map((x) => `<span>\u2713 ${esc(x)}</span>`).join('')}${r.trendMatches.length ? `<span>🔥 trending now: ${r.trendMatches.slice(0, 2).map(esc).join(', ')}</span>` : ''}</div>
    ${r.items.map(tlItemHTML).join('')}
    ${r.related.length ? `<details><summary style="cursor:pointer;color:var(--muted);font-size:12px;margin:8px 0">Related videos (${r.related.length})</summary>${r.related.map((v) => `<a class="sim-row" href="${esc(v.url)}" target="_blank" rel="noopener">${v.thumb ? `<img src="${esc(v.thumb)}" alt="">` : ''}<span class="t">${esc(v.title)}</span><span class="v">${fmtNum(v.views)} views</span></a>`).join('')}</details>` : ''}
    ${tlAssetsHTML(r)}
    <div class="tl-export">
      <button class="grad" data-exp="md">\u2B07 Markdown</button>
      <button data-exp="pdf">🖨 PDF</button>
      <button data-exp="script">🎬 Script</button>
      <button data-exp="blog">📝 Blog article</button>
      <button data-exp="shorts">📱 Shorts outline</button>
      <button data-exp="json">{ } JSON</button>
    </div>`;
  $$('#tl-results [data-exp]').forEach((b) => { b.onclick = () => exportTopList(b.dataset.exp); });
}
function tlMarkdown(r) {
  return [
    `# Top ${r.count} ${r.topic}`,
    `> Ranked by TrendPulse from real cross-platform evidence (${r.sourcesUsed.join(', ')}) \u00b7 ${new Date(r.generatedAt).toLocaleString()}`,
    '',
    ...r.items.map((it) => [
      `## ${it.rank}. ${it.title}`,
      `- **Source:** ${it.source} \u00b7 [link](${it.url})`,
      `- **Popularity:** ${it.popularity.toLocaleString()} \u00b7 **discussion:** ${it.discussion.toLocaleString()} \u00b7 **score:** ${it.score}/100`,
      `- **Why:** ${it.why.join('; ')}`,
      `- **Shorts ideas:** ${it.shortsIdeas.join(' / ')}`,
      `- **Hook:** "${it.hooks[0]}"`,
      '',
    ].join('\n')),
    `## Creator kit`,
    `Titles: ${r.assets.titles.join(' | ')}`,
    `Hashtags: ${r.assets.hashtags.join(' ')}`,
    `SEO: ${r.assets.seo.join(', ')}`,
  ].join('\n');
}
function tlScript(r) {
  return [
    `🎬 SCRIPT \u2014 Top ${r.count} ${r.topic}`,
    ``,
    `HOST (hook, 0:00\u20130:08): "${r.assets.hooks[0]}"`,
    `HOST (intro): ${r.assets.intro}`,
    ``,
    ...r.items.map((it) => [
      `[#${it.rank} \u00b7 ${it.title}]`,
      `  B-ROLL: ${it.url}`,
      `  VO: "Number ${it.rank} \u2014 ${it.title.replace(/"/g, '')}. ${it.why[0] || ''}"`,
      `  ON SCREEN: ${fmtNum(it.popularity)} views`,
      ``,
    ].join('\n')),
    `HOST (outro): "Agree with the ranking? Fight me in the comments."`,
  ].join('\n');
}
function tlBlog(r) {
  return [
    `Top ${r.count} ${r.topic} \u2014 Ranked With Real Data`,
    ``,
    r.assets.intro,
    ``,
    ...r.items.map((it) => [
      `${it.rank}. ${it.title}`,
      ``,
      `${it.why.join('. ')}. Source: ${it.source} (${it.url}).`,
      ``,
    ].join('\n')),
    `Final thoughts: rankings shift daily \u2014 data pulled ${new Date(r.generatedAt).toLocaleString()} via ${r.sourcesUsed.join(', ')}.`,
  ].join('\n');
}
function tlShortsOutline(r) {
  return r.items.slice(0, 5).map((it, i) => [
    `SHORT ${i + 1} \u2014 ${it.title}`,
    `  Hook (0\u20133s): "${it.hooks[0]}"`,
    `  Beat 1: show the moment \u2014 ${it.url}`,
    `  Beat 2: ${it.why[0] || 'show the numbers'}`,
    `  Beat 3: ${it.shortsIdeas[0]}`,
    `  CTA: "Follow for the full top ${r.count}"`,
    ``,
  ].join('\n')).join('\n');
}
function exportTopList(kind) {
  const r = TOPLIST;
  if (!r) return;
  const safe = r.topic.replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
  if (kind === 'json') return download(`toplist-${safe}.json`, JSON.stringify(r, null, 2));
  if (kind === 'md') return download(`toplist-${safe}.md`, tlMarkdown(r));
  if (kind === 'script') return download(`toplist-${safe}-script.txt`, tlScript(r));
  if (kind === 'blog') return download(`toplist-${safe}-blog.txt`, tlBlog(r));
  if (kind === 'shorts') return download(`toplist-${safe}-shorts.txt`, tlShortsOutline(r));
  if (kind === 'pdf') {
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>Top ${r.count} ${r.topic}</title><style>
      body{font-family:Inter,system-ui,sans-serif;max-width:720px;margin:40px auto;color:#151822;line-height:1.65;padding:0 16px}
      h1{letter-spacing:-.02em}h2{margin-top:26px;border-bottom:2px solid #8b5cf6;padding-bottom:4px}
      .src{color:#7c3aed;font-size:12px;font-weight:700}.meta{color:#666;font-size:12px}
      li{margin:3px 0}.kit{background:#f4f2ff;border:1px dashed #8b5cf6;border-radius:12px;padding:14px 18px;margin-top:26px}
      </style></head><body><h1>Top ${r.count} ${esc(r.topic)}</h1>
      <div class="src">Ranked from real evidence: ${r.sourcesUsed.map(esc).join(' \u00b7 ')}</div>
      ${r.items.map((it) => `<h2>${it.rank}. ${esc(it.title)}</h2><div class="meta">${esc(it.source)} \u00b7 ${it.popularity.toLocaleString()} views \u00b7 score ${it.score}/100</div><ul>${it.why.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p><b>Shorts:</b> ${it.shortsIdeas.map(esc).join(' \u00b7 ')}<br><b>Hook:</b> ${esc(it.hooks[0])}</p>`).join('')}
      <div class="kit"><b>Creator kit</b><br>Titles: ${r.assets.titles.map(esc).join(' | ')}<br>Hashtags: ${r.assets.hashtags.map(esc).join(' ')}<br>SEO: ${r.assets.seo.map(esc).join(', ')}</div>
      </body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 250);
  }
}
function openTopLists(prefill) {
  openModal('🏆 AI Top Lists', `
    <div class="an-input-row">
      <input id="tl-topic" placeholder='Try "Joe Rogan quotes", "Solo Leveling fights", "World Cup goals"\u2026' value="${esc(prefill || '')}">
      <select id="tl-count" style="width:auto;flex:none">${[5, 7, 10].map((n) => `<option value="${n}" ${n === 5 ? 'selected' : ''}>Top ${n}</option>`).join('')}</select>
      <button class="btn primary" id="tl-go">Generate</button>
    </div>
    <div id="tl-results"><div class="an-note" style="margin-top:12px">Searches <b>YouTube</b> (real views), <b>Reddit</b> (real upvotes & discussion), <b>live Google Trends</b> and <b>tracked news</b> \u2014 then ranks the evidence and explains every position. Creative assets (titles, hooks, scripts) are generated suggestions. ~25 searches/hour shared budget.</div></div>`);
  $('#modal').classList.add('wide');
  const go = async () => {
    const topic = $('#tl-topic').value.trim();
    const count = $('#tl-count').value;
    if (!topic) return;
    $('#tl-go').textContent = 'Ranking\u2026';
    $('#tl-go').disabled = true;
    $('#tl-results').innerHTML = `<div class="an-loading"><div class="spin">🏆</div><div style="margin-top:10px">Searching YouTube, Reddit, trends & news for \u201C${esc(topic)}\u201D\u2026</div></div>`;
    try {
      const r = await fetch(`/api/toplist?topic=${encodeURIComponent(topic)}&count=${count}`).then((x) => x.json());
      if (r.error) $('#tl-results').innerHTML = `<div class="setup err">\u26A0\uFE0F ${esc(r.error)}</div>`;
      else renderTopList(r);
    } catch (er) {
      $('#tl-results').innerHTML = `<div class="setup err">\u26A0\uFE0F ${esc(String(er.message || er))}</div>`;
    } finally {
      const b = $('#tl-go');
      if (b) { b.textContent = 'Generate'; b.disabled = false; }
    }
  };
  $('#tl-go').onclick = go;
  $('#tl-topic').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  setTimeout(() => $('#tl-topic').focus(), 60);
}



function renderAll() {
  for (const id of SECTION_ORDER) renderSection(id);
}

// ── SSE connection ─────────────────────────────────────────
let es = null;
function connect() {
  es = new EventSource('/api/events');
  es.addEventListener('snapshot', (e) => {
    const snap = JSON.parse(e.data);
    state.sections = new Map(snap.sections.map((s) => [s.id, s]));
    state.sources = snap.sources || [];
    state.alerts = snap.alerts || [];
    state.connected = true;
    setConn(true);
    renderAll();
    renderSourcesMini();
    refreshVault();
    rebuildPlatformSelect();
    renderBell();
    $('#last-sync').textContent = 'synced ' + fmtAgo(Date.now());
  });
  es.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'section') {
      state.sections.set(msg.id, msg.section);
      renderSection(msg.id);
      rebuildPlatformSelect();
      $('#last-sync').textContent = 'synced ' + fmtAgo(Date.now());
    } else if (msg.type === 'alert') {
      state.alerts.unshift(msg.alert);
      if (state.alerts.length > 40) state.alerts.length = 40;
      state.unread++;
      toast(msg.alert);
      renderBell();
    }
  };
  es.onerror = () => {
    state.connected = false;
    setConn(false);
    es.close();
    setTimeout(connect, 2500);
  };
}
function setConn(on) {
  const c = $('#conn');
  c.className = 'conn ' + (on ? 'on' : 'err');
  c.querySelector('span').textContent = on ? 'live · streaming' : 'reconnecting…';
}

// ── Alerts / toasts ────────────────────────────────────────
function toast(a) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span class="ic">${a.icon || '⚡'}</span><div style="flex:1"><b>${esc(a.title)}</b><span>${esc(a.body || '')}</span></div>`;
  t.onclick = () => { closeToast(t); if (a.url) window.open(a.url, '_blank'); else focusItem(a.section, a.itemId); };
  $('#toasts').appendChild(t);
  setTimeout(() => closeToast(t), 8000);
}
function closeToast(t) {
  if (!t.parentNode) return;
  t.classList.add('out');
  setTimeout(() => t.remove(), 350);
}
function renderBell() {
  const dot = $('#bell-dot');
  dot.hidden = state.unread === 0;
  dot.textContent = state.unread > 9 ? '9+' : state.unread;
}
function renderNotifPop() {
  const p = $('#notif-pop');
  p.innerHTML = `<div class="notif-h">Notifications <button id="notif-clear">Mark all read</button></div>
    <div class="notif-list">${
      state.alerts.length
        ? state.alerts.map((a) => `<div class="notif" data-sec="${esc(a.section || '')}" data-item="${esc(a.itemId || '')}" data-url="${esc(a.url || '')}">
            <span class="ic">${a.icon || '⚡'}</span>
            <div style="flex:1"><b>${esc(a.title)}</b><span>${esc(a.body || '')}</span><time>${fmtAgo(a.ts)}</time></div>
          </div>`).join('')
        : '<div class="notif-empty">Real alerts will appear here — new uploads from your watchlist, trend spikes, videos exploding out of the gate.</div>'
    }</div>`;
  $('#notif-clear').onclick = () => { state.unread = 0; renderBell(); };
  $$('.notif', p).forEach((n) => {
    n.onclick = () => {
      p.hidden = true; $('#backdrop').hidden = true;
      if (n.dataset.url) window.open(n.dataset.url, '_blank');
      else focusItem(n.dataset.sec, n.dataset.item);
    };
  });
}
function focusItem(sectionId, itemId) {
  if (!sectionId) return;
  $('#card-' + sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (!itemId) return;
  setTimeout(() => {
    const list = $('#list-' + sectionId);
    if (!list) return;
    const row = [...list.querySelectorAll('[data-rid]')].find((r) => r.dataset.rid === itemId);
    if (row) {
      row.classList.remove('flash');
      void row.offsetWidth;
      row.classList.add('flash');
    }
  }, 450);
}

// ── Drawer ─────────────────────────────────────────────────
function openDrawer(it) {
  const d = $('#drawer');
  d.innerHTML = drawerHTML(it);
  showBackdrop(true);
  d.hidden = false; d.style.display = 'flex';
  requestAnimationFrame(() => d.classList.add('open'));
  wireDrawer(it);
}
function closeDrawer() {
  const d = $('#drawer');
  d.classList.remove('open');
  setTimeout(() => { d.hidden = true; d.style.display = 'none'; d.innerHTML = ''; }, 260);
  // only drop the backdrop if no other overlay still needs it
  if ($('#modal-wrap').hidden && $('#notif-pop').hidden) showBackdrop(false);
}
function embedHTML(it) {
  const host = location.hostname || 'localhost';
  if (it.embed?.type === 'twitch-clip' && it.embed.src) {
    const sep = it.embed.src.includes('?') ? '&' : '?';
    return `<div class="embed-box"><iframe allowfullscreen
      src="${esc(it.embed.src)}${sep}parent=${encodeURIComponent(host)}"></iframe></div>`;
  }
  if (it.embed?.type === 'youtube' && it.embed.id) {
    const startQ = it.embed.start != null ? `?start=${Math.floor(it.embed.start)}&autoplay=1` : '';
    return `<div class="embed-box"><iframe allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen
      src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(it.embed.id)}${startQ}"></iframe></div>`;
  }
  return '';
}
function metricsGrid(it) {
  const m = it.metrics || {};
  const cells = [];
  const add = (v, l) => v != null && v !== '' && cells.push(`<div class="metric"><b>${v}</b><span>${l}</span></div>`);
  if (m.score != null) add(m.score, 'Viral score');
  if (it.kind === 'creator') {
    add(fmtNum(m.subs), 'Subscribers');
    add(fmtNum(m.latestViews), 'Latest video views');
    add(fmtNum(m.velocity), 'Views / hr');
    add(m.videos7d, 'Uploads · 7 days');
    if (it.meta?.live) add(fmtNum(it.meta.live.viewers), 'Live viewers now');
  }
  if (it.kind === 'video') {
    add(fmtNum(m.views), 'Views'); add(fmtNum(m.likes), 'Likes');
    add(fmtNum(m.comments), 'Comments'); add(fmtNum(m.velocity), 'Views / hr');
    add(fmtAgo(Date.now() - it.ageMs), 'Published');
  }
  if (it.kind === 'game') { add(fmtNum(m.players), 'Players'); add(fmtNum(m.viewers), 'Watching'); add((m.growth >= 0 ? '+' : '') + m.growth + '%', 'Growth'); }
  if (it.kind === 'topic') { add(fmtNum(m.searches || m.mentions), m.searches ? 'Searches' : 'Mentions'); add((m.growth >= 0 ? '+' : '') + m.growth + '%', 'Growth'); }
  if (it.kind === 'post') { add(fmtNum(m.ups), 'Upvotes'); add(fmtNum(m.comments), 'Comments'); add(fmtNum(m.velocity), 'Upvotes / hr'); add(fmtAgo(Date.now() - it.ageMs), 'Posted'); }
  if (it.kind === 'podcast') { add(m.popularity, 'Popularity'); add(it.category, 'Category'); }
  if (it.kind === 'news') { add(fmtAgo(Date.now() - it.ageMs), 'Published'); add(it.platform, 'Source'); }
  if (it.kind === 'opportunity') {
    const meta = it.meta || {};
    add(m.confidence + '%', 'Clip confidence');
    add((meta.viewsLabel ? '▲ ' : '+') + fmtNum(m.velocity), meta.viewsLabel ? 'Upvotes / hr' : 'Views / hr');
    add(fmtNum(m.views), meta.viewsLabel || 'Views');
    if (meta.firstSeenTs) add(fmtAgo(meta.firstSeenTs), 'First detected');
    if (meta.postWithinMs) add('~' + fmtWithin(meta.postWithinMs), 'Post within');
    if (meta.clipLen) add(meta.clipLen, 'Best length');
  }
  if (it.kind === 'moment') {
    add(fmtNum(m.views), it.meta?.viewsLabel === 'upvotes' ? 'Upvotes' : 'Views');
    add(fmtAgo(Date.now() - it.ageMs), 'Captured');
    if (it.meta?.creator) add(it.meta.creator, 'Creator');
    if (it.meta?.eventName) add(it.meta.eventName, 'Event');
    if (it.meta?.categoryName) add(it.meta.categoryName, 'Category');
    if (it.meta?.game) add(it.meta.game, 'Game');
  }
  return `<div class="dr-metrics">${cells.slice(0, 6).join('')}</div>`;
}
function breakdownHTML(it) {
  const b = it.breakdown || {};
  if (!Object.keys(b).length) return '';
  const rows = [['Velocity', b.velocity], ['Growth', b.growth], ['Scale', b.scale], ['Engagement', b.engagement], ['Freshness', b.freshness]];
  return `<div class="dr-block"><h3>Why this score</h3>${rows
    .map(([l, v]) => `<div class="bd-row"><span>${l}</span><div class="bd-bar"><i style="width:${v || 0}%"></i></div><em>${v ?? 0}</em></div>`)
    .join('')}</div>`;
}
function drawerHTML(it) {
  const on = state.bookmarks.some((b) => b.id === it.id);
  const md = it.meta || {};
  const src = md.source || { platform: it.platform, url: it.url, creator: md.creator || it.author, originalTitle: it.title, verification: md.verification || 'partial' };
  const ver = md.verification || src.verification || 'partial';
  const vIcon = ver === 'verified' ? '🟢' : ver === 'missing' ? '🔴' : '🟡';
  const vLabel = ver === 'verified' ? 'Verified source' : ver === 'missing' ? 'Missing source' : 'Partially verified';
  const signals = md.detectedSignals || [];
  const chain = md.sourceChain || [];
  const sc = md.scores || {};
  const ts = (src.timestampStart != null) ? fmtHMS(src.timestampStart) + (src.timestampEnd != null ? ' → ' + fmtHMS(src.timestampEnd) : '') : null;
  const factRow = (icon, k, v) => v ? `<div class="vmeta-row"><span class="k">${icon} ${esc(k)}</span><span class="v">${esc(String(v))}</span></div>` : '';
  return `
  <header class="dr-h">
    <div style="flex:1;min-width:0">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:7px;flex-wrap:wrap">
        ${platformBadge(it.platform)}
        <span class="verify-badge verify-${ver}" title="${esc(vLabel)}">${vIcon} ${esc(vLabel)}</span>
        ${md.momentType ? `<span class="badge" style="color:var(--muted);border-color:var(--border)">${esc(md.momentType)}</span>` : ''}
      </div>
      <div class="dr-title">${esc(it.title)}</div>
      <div class="dr-sub">${esc(md.creator || it.author || '')}</div>
    </div>
    <button class="x" id="dr-close">✕</button>
  </header>
  <div class="dr-body">
    ${embedHTML(it)}
    <div class="dr-block"><h3>🔎 Verified source (real data)</h3>
      <div class="vmeta-grid">
        ${factRow(src.platformIcon || '🔗', 'Platform', src.platform)}
        ${factRow('👤', src.channelLabel || 'Creator', src.creator)}
        ${factRow('🎬', 'Original', src.originalTitle)}
        ${factRow('⏱', 'Timestamp', ts)}
        ${factRow('📅', 'Uploaded', src.publishedTs ? new Date(src.publishedTs).toLocaleDateString() : null)}
        ${factRow('🕒', 'Detected', (md.detectedTs || md.vaultedTs) ? new Date(md.detectedTs || md.vaultedTs).toLocaleDateString() : null)}
        ${factRow('', 'Duration', src.duration ? src.duration + 's' : null)}
      </div>
    </div>
    <div class="dr-block"><h3>✓ Why this moment was detected (real signals)</h3>
      ${signals.length ? `<ul class="detected-list">${signals.map((sg) => `<li>${esc(sg.label)}</li>`).join('')}</ul>` : '<div class="rs">No recorded detection signals.</div>'}
    </div>
    <div class="dr-block"><h3>🧠 AI analysis <span class="ai-tag">estimated · not fact</span></h3>
      <div class="score-grid">${[['Emotion',sc.emotion],['Replayability',sc.replayability],['Meme potential',sc.memePotential],['Competition',sc.competition],['Virality',sc.virality],['Evergreen',sc.evergreen],['Clip quality',sc.clipQuality],['Editing difficulty',sc.editingDifficulty]].filter(([,v])=>v!=null).map(([l,v])=>`<div class="bd-row"><span>${l}</span><div class="bd-bar"><i style="width:${v||0}%"></i></div><em>${v}</em></div>`).join('')}</div>
      <div class="vlib-tags" style="margin-top:8px">${(md.tags||[]).map(t=>`<span>${esc(t)}</span>`).join('')}${Object.keys(md.emotions||{}).map(e=>`<span class="emo">${esc(e)}</span>`).join('')}</div>
    </div>
    <div class="dr-block"><h3>🔗 Source chain</h3>
      <div class="source-chain">${chain.map((c,i)=>`${i?'<span class="sc-arrow">↓</span>':''}<span class="sc-step"><span class="sc-ic">${c.icon}</span>${esc(c.label)}</span>`).join('')}</div>
    </div>
    ${sparkSVG(it.history, 'bigspark', 460, 64)}
    <div class="dr-links">
      ${src.url ? `<a class="btn primary" href="${esc(src.url)}" target="_blank" rel="noopener">▶ Open original</a>` : ''}
      ${(src.url && ts) ? `<a class="btn" href="${esc(src.url)}" target="_blank" rel="noopener">⏱ Jump to timestamp</a>` : ''}
      ${src.creator ? `<a class="btn" href="${esc(channelUrl(src.platform, src.creator))}" target="_blank" rel="noopener">📺 Open ${esc(src.channelLabel||'channel')}</a>` : ''}
      ${src.url ? `<button class="btn" id="dr-copyurl">🔗 Copy link</button>` : ''}
      ${ts ? `<button class="btn" id="dr-copyts">📋 Copy timestamp</button>` : ''}
      <button class="btn" id="dr-bm">${on ? '★ Bookmarked' : '☆ Bookmark'}</button>
      ${it.embed?.type === 'youtube' && it.embed.id ? `<button class="btn" id="dr-findclip">🎬 Re-analyze</button>` : ''}
    </div>
    ${(it.tags || []).length ? `<div class="tags">${it.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
  </div>`;
}
function channelUrl(platform, creator) {
  if (platform === 'YouTube') return 'https://www.youtube.com/@' + encodeURIComponent(creator.replace(/^@/, ''));
  if (platform === 'Twitch') return 'https://www.twitch.tv/' + encodeURIComponent(creator);
  if (platform === 'Reddit') return 'https://www.reddit.com/user/' + encodeURIComponent(creator.replace(/^u\//, ''));
  return '#';
}
function wireDrawer(it) {
  $('#dr-close').onclick = closeDrawer;
  const fc = $('#dr-findclip');
  if (fc) fc.onclick = () => { closeAllOverlays(); openAnalyzer('https://www.youtube.com/watch?v=' + it.embed.id); };
  const planBtn = $('#dr-plan');
  if (planBtn) planBtn.onclick = () => copyPlan(it);
  const scanBtn = $('#dr-scan-btn');
  if (scanBtn) {
    const run = async () => {
      const slot = $('#scan-slot');
      if (state.scans[it.id]) { slot.innerHTML = scanHTML(state.scans[it.id]); return; }
      slot.innerHTML = '<div class="scan-err">Scanning YouTube for competition + similar Shorts…</div>';
      try {
        const r = await fetch('/api/scan?q=' + encodeURIComponent(it.title)).then((x) => x.json());
        state.scans[it.id] = r;
        if ($('#scan-slot')) $('#scan-slot').innerHTML = scanHTML(r);
      } catch (e) {
        if ($('#scan-slot')) $('#scan-slot').innerHTML = `<div class="scan-err">⚠️ ${esc(String(e.message || e))}</div>`;
      }
    };
    scanBtn.onclick = run;
  }
  const _u = $('#dr-used'); if (_u) _u.onclick = () => { toggleUsed(it.id); _u.textContent = usedIds().has(it.id) ? '✓ Marked as used' : 'Mark as used (for Unused filters)'; refreshVault().then(()=>{ if(state.sections.get('moments')) renderMoments(state.sections.get('moments')); }); };
  const _cu = $('#dr-copyurl'); if (_cu) _cu.onclick = () => { const u = (it.meta?.source?.url || it.url); navigator.clipboard?.writeText(u).then(()=>toast({icon:'🔗',title:'Source link copied'})); };
  const _ct = $('#dr-copyts'); if (_ct) _ct.onclick = () => { const st = it.meta?.source?.timestampStart; const txt = fmtHMS(st) + ' — ' + (it.meta?.source?.originalTitle || it.title) + ' ' + (it.meta?.source?.url||''); navigator.clipboard?.writeText(txt).then(()=>toast({icon:'📋',title:'Timestamp copied'})); };
  $('#dr-bm').onclick = () => {
    toggleBookmark(it);
    $('#dr-bm').textContent = state.bookmarks.some((b) => b.id === it.id) ? '★ Bookmarked' : '☆ Bookmark';
  };
}

// ── Bookmarks ──────────────────────────────────────────────
function saveBookmarks() {
  localStorage.setItem('tp.bookmarks', JSON.stringify(state.bookmarks));
  const c = $('#bm-count');
  c.hidden = state.bookmarks.length === 0;
  c.textContent = state.bookmarks.length;
}
function toggleBookmark(it) {
  const i = state.bookmarks.findIndex((b) => b.id === it.id);
  if (i >= 0) state.bookmarks.splice(i, 1);
  else state.bookmarks.push({ ...it, savedAt: Date.now() });
  saveBookmarks();
  renderAll();
}
function openBookmarks() {
  openModal(`★ Bookmarks <span class="rs" style="font-weight:400">(${state.bookmarks.length})</span>`,
    state.bookmarks.length
      ? `<div class="card-list" style="max-height:none">${state.bookmarks.map((it, i) => rowHTML({ ...it, rank: i + 1 }, it.originSection || it.section || 'videos')).join('')}</div>`
      : '<div class="sr-empty">Star rows on any card and they will appear here.</div>');
}

// ── Modals ─────────────────────────────────────────────────
function openModal(title, bodyHTML) {
  $('#modal').innerHTML = `<div class="modal-h"><h2>${title}</h2><button class="x" id="modal-close" title="Close (Esc)">✕</button></div>
    <div class="modal-body">${bodyHTML}</div>`;
  const mw = $('#modal-wrap'); mw.hidden = false; mw.style.display = 'grid';
  showBackdrop(true);
  $('#modal-close').onclick = closeAllOverlays;
}
function showBackdrop(on) {
  const b = $('#backdrop');
  b.hidden = !on;
  b.style.display = on ? 'block' : 'none';
}
function closeAllOverlays() {
  $('#modal').classList.remove('wide');
  const mw = $('#modal-wrap'); mw.hidden = true; mw.style.display = 'none';
  const np = $('#notif-pop'); np.hidden = true; np.style.display = 'none';
  closeDrawer();
  showBackdrop(false);
}
function openExpanded(id) {
  const sec = state.sections.get(id);
  if (!sec) return;
  const items = sortItems(filterItems(sec.items), state.sort[id] || 'score');
  openModal(`${SECTION_TITLES[id] || id} — all ${items.length} items`,
    `<div class="card-list" style="max-height:none">${items.map((it) => rowHTML(it, id)).join('')}</div>`);
}

// ── Search ─────────────────────────────────────────────────
let searchTimer = null;
function openSearch() {
  openModal('🔎 Search everything',
    `<input class="search-input" id="sr-input" placeholder="Try “Speed”, “Kai Cenat”, “World Cup”…" autofocus>
     <div id="sr-results"><div class="sr-empty">Searches your dashboard + YouTube, Twitch and Reddit live.</div></div>`);
  const input = $('#sr-input');
  setTimeout(() => input.focus(), 60);
  input.oninput = () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (!q) return ($('#sr-results').innerHTML = '<div class="sr-empty">Type to search…</div>');
    searchTimer = setTimeout(() => runSearch(q), 280);
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') runSearch(input.value.trim()); };
}
async function runSearch(q) {
  const box = $('#sr-results');
  if (!box) return;
  box.innerHTML = '<div class="sr-empty">Searching live sources…</div>';
  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(q)).then((r) => r.json());
    let html = '';
    if (res.local?.length) {
      html += `<div class="sr-group"><h4>On your dashboard</h4>${res.local
        .map((it) => `<div class="sr-item" data-rid="${esc(it.id)}" data-sec="${esc(it.originSection || it.section)}">
          ${it.thumbnail ? `<img src="${esc(it.thumbnail)}" onerror="this.style.display='none'">` : ''}
          <div style="flex:1;min-width:0"><div class="t">${esc(it.title)}</div>
          <div class="s">${esc(it.platform)} · ${esc(it.subtitle || '')} · score ${it.metrics?.score ?? '—'}</div></div></div>`)
        .join('')}</div>`;
    }
    for (const g of res.sources || []) {
      html += `<div class="sr-group"><h4>${esc(g.source)}</h4>${g.items
        .map((r) => `<a class="sr-item" href="${esc(r.url)}" target="_blank" rel="noopener">
          ${r.thumbnail ? `<img src="${esc(r.thumbnail)}" onerror="this.style.display='none'">` : ''}
          <div style="flex:1;min-width:0"><div class="t">${esc(r.title)}</div>
          <div class="s">${esc(r.subtitle || '')}${r.live ? ' · 🔴 LIVE' : ''}</div></div>
          <span class="rs">↗</span></a>`)
        .join('')}</div>`;
    }
    box.innerHTML = html || '<div class="sr-empty">No results. Try another query.</div>';
    $$('#sr-results .sr-item[data-rid]').forEach((el) => {
      el.onclick = () => {
        const sec = state.sections.get(el.dataset.sec);
        const it = sec?.items.find((x) => x.id === el.dataset.rid) ||
          state.sections.get('viral')?.items.find((x) => x.id === el.dataset.rid);
        if (it) { closeAllOverlays(); openDrawer(it); }
      };
    });
  } catch {
    box.innerHTML = '<div class="sr-empty">Search failed — is the server running?</div>';
  }
}

// ── Settings / sources ─────────────────────────────────────
function openSettings() {
  const rows = state.sources
    .map((s) => {
      const cls = !s.ok ? ((s.mode || '').includes('needs') ? 'sim' : 'err') : (s.mode || '').includes('live') ? 'live' : 'sim';
      return `<tr><td>${esc(s.label)}</td><td>${esc(SECTION_TITLES[s.section] || s.section || '')}</td>
        <td><span class="mode ${cls}">${esc(s.mode)}</span></td>
        <td style="text-align:right">${s.ok ? s.count + ' items' : esc(s.error || '—')}</td>
        <td style="color:var(--dim)">${s.ts ? fmtAgo(s.ts) : '—'}</td></tr>`;
    })
    .join('');
  openModal('⚙️ Sources — all real, nothing simulated',
    `<table class="src-table"><tr><td style="color:var(--dim)">Source</td><td style="color:var(--dim)">Section</td><td style="color:var(--dim)">Mode</td><td style="color:var(--dim);text-align:right">Data</td><td style="color:var(--dim)">Polled</td></tr>${rows}</table>
    <div class="help">
      <b style="color:var(--text)">Honesty guarantee</b> — TrendPulse contains zero simulated data. A source is <span class="mode live">LIVE</span>, <span class="mode sim">NEEDS KEY</span> (section shows a setup card), or <span class="mode err">ERROR</span> (section shows the real error and retries).<br><br>
      <b style="color:var(--text)">Connect keys</b> in <code>.env</code>: <code>YOUTUBE_API_KEY</code> (creators + trending + search), <code>TWITCH_CLIENT_ID</code> + <code>TWITCH_CLIENT_SECRET</code> (creator live status + top games), <code>REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD</code> (optional — public JSON works too). Google Trends, Apple Podcasts, Steam and news RSS need nothing.<br><br>
      <b style="color:var(--text)">Viral score</b> = 30% velocity + 25% growth + 20% scale + 15% engagement + 10% freshness, normalized per content kind.<br><br>
      <b style="color:var(--text)">Top 5 ideas</b> are generated from the live data above (creator uploads, Google Trends, news, games, Reddit) — the ideas are synthetic, every number under them is real.
    </div>`);
}
function renderSourcesMini() {
  const el = $('#src-mini');
  el.innerHTML = state.sources
    .map((s) => {
      const cls = !s.ok ? ((s.mode || '').includes('needs') ? 'sim' : 'err') : 'live';
      const short = s.label.split(' · ')[0];
      return `<span class="src-pill ${cls}" title="${esc(s.label)} — ${esc(s.mode)}">${esc(short)}</span>`;
    })
    .join('');
  const live = state.sources.filter((s) => s.ok).length;
  $('#foot-sources').textContent = `${live}/${state.sources.length} sources live`;
}
function rebuildPlatformSelect() {
  const sel = $('#platform-select');
  const plats = new Set();
  for (const s of state.sections.values()) for (const it of s.items) plats.add((it.platform || '').split(' · ')[0]);
  const current = sel.value;
  const opts = ['all', ...[...plats].filter(Boolean).sort()];
  sel.innerHTML = opts.map((p) => `<option value="${p === 'all' ? 'all' : esc(p)}">${p === 'all' ? 'All platforms' : esc(p)}</option>`).join('');
  if (opts.includes(current)) sel.value = current;
}

// ── Watchlist add/remove ───────────────────────────────────
async function addCreatorFromInput() {
  const input = $('#add-handle');
  const handle = input.value.trim();
  if (!handle) return;
  input.disabled = true;
  $('#add-btn').textContent = 'Adding…';
  try {
    const r = await fetch('/api/watchlist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle }),
    }).then((x) => x.json());
    if (!r.ok) throw new Error(r.error || 'failed');
    input.value = '';
    toast({ icon: '✅', title: `${handle} added to your watchlist`, body: 'First real data is loading now.' });
  } catch (e) {
    toast({ icon: '⚠️', title: 'Could not add creator', body: String(e.message || e) });
  } finally {
    input.disabled = false;
    $('#add-btn').textContent = '+ Add';
  }
}

// ── Video Analyzer ───────────────────────────────────────────
function fmtVidLen(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${ss}s` : `${ss}s`;
}
function srtTime(sec) {
  const ms = Math.round((sec % 1) * 1000);
  const t = Math.floor(sec);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), ss = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}
function srtForMoment(m) {
  return (m.caption || [])
    .map((c, i) => `${i + 1}\n${srtTime(c.t)} --> ${srtTime(c.t + c.d)}\n${c.text}\n`)
    .join('\n');
}
function clipKitText(v, m) {
  return [
    `🎬 CLIP KIT \u00b7 TrendPulse`,
    `Video: ${v.title} (${v.url})`,
    `Clip: ${srtTime(m.start)} \u2192 ${srtTime(m.end)}  (${m.length}s)  \u00b7  score ${m.score}/100  \u00b7  ${m.bestFor}`,
    `Direct link: ${v.url}&t=${m.start}`,
    ``,
    `Why this moment:`,
    ...m.reasons.map((r) => `  \u2022 ${r}`),
    ``,
    `Suggested title: ${m.title}`,
    `Hooks:`,
    ...m.hooks.map((h, i) => `  ${i + 1}. ${h}`),
    `Hashtags: #shorts ${(m.trendHits || []).map((t) => '#' + t.toLowerCase().replace(/[^a-z0-9]+/g, '')).join(' ')}`.trim(),
    ``,
    `Transcript segment:`,
    ...(m.caption || []).map((c) => `[${srtTime(c.t)}] ${c.text}`),
  ].join('\n');
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function heatHTML(r) {
  const hm = r.heatmap;
  if (hm && hm.length) {
    const dur = r.video.duration || hm[hm.length - 1].t || 1;
    const cells = hm.map((b) => {
      const hue = 195 - b.intensity * 195;
      return `<div class="heat-cell" title="${srtTime(b.t)} \u00b7 ${Math.round(b.intensity * 100)}% of peak" style="background:hsla(${hue},85%,55%,${(0.12 + b.intensity * 0.8).toFixed(2)})"></div>`;
    }).join('');
    const markers = r.moments.map((m) =>
      `<span class="mo-marker" style="left:${(((m.start + m.end) / 2 / dur) * 100).toFixed(1)}%" data-jump="${m.start}" title="Opportunity #${m.rank}">#${m.rank}</span>`
    ).join('');
    const emojis = hm.filter((b) => b.intensity > 0.5).slice(0, 7).map((b) =>
      `<span class="heat-emoji" style="left:${((b.t / dur) * 100).toFixed(1)}%">${b.intensity > 0.8 ? '🔥' : b.intensity > 0.65 ? '😂' : '😀'}</span>`
    ).join('');
    return `<div class="dr-block"><h3>Retention heatmap \u2014 YouTube "most replayed" (real viewer data)</h3>
      <div class="heatstrip" id="heatstrip">${cells}${markers}${emojis}</div>
      <div class="heat-labels"><span>0:00</span><span>${fmtVidLen(dur / 2)}</span><span>${fmtVidLen(dur)}</span></div></div>`;
  }
  if (r.video.chapters?.length) {
    return `<div class="dr-block"><h3>Chapters (retention data unavailable for this video/network)</h3>
      <div class="opp-tags">${r.video.chapters.map((c) => `<span>${srtTime(c.t).slice(0, 5)} \u00b7 ${esc(c.title)}</span>`).join('')}</div></div>`;
  }
  return '';
}
function moFrameHTML(m, v) {
  if (m.tile) {
    const t = m.tile;
    const dw = 150, dh = Math.round(dw * t.h / t.w);
    return `<div class="mo-frame" title="Real preview frame at ${srtTime(Math.round((m.start + m.end) / 2))}" style="height:${dh}px;background-image:url('${esc(t.url)}');background-size:${t.cols * dw}px ${t.rows * dh}px;background-position:-${t.x * dw}px -${t.y * dh}px"></div>`;
  }
  return `<div class="mo-frame"><div class="ph">frame at ${srtTime(Math.round((m.start + m.end) / 2))}</div></div>`;
}
function moCardHTML(m, v) {
  return `<div class="mo-card ${m.rank === 1 ? 'top1' : ''}" id="mo-${m.start}">
    <div class="mo-head">
      <span class="rank" style="width:auto;font-size:12px">#${m.rank}</span>
      <button class="mo-time" data-preview="${m.start}" title="Preview from here">\u25B6 ${srtTime(m.start).slice(0, 5)} \u2192 ${srtTime(m.end).slice(0, 5)}</button>
      <span class="mo-len">${m.length}s \u00b7 best for ${esc(m.bestFor)}</span>
      <span style="flex:1"></span>
      ${scoreChip(m.score)}
    </div>
    <div class="mo-grid">
      ${moFrameHTML(m, v)}
      <div style="min-width:0">
        <ul class="reasons">${m.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        <div class="mo-title-row"><b>Suggested title: \u201C${esc(m.title)}\u201D</b><button class="copy-mini" data-copy="${esc(m.title)}">copy</button></div>
        <div class="mo-hooks">${m.hooks.map((h) => esc(h)).join('  \u00b7  ')}</div>
      </div>
    </div>
    <div class="mo-actions">
      <button class="btn primary" data-preview="${m.start}">\u25B6 Preview at ${srtTime(m.start).slice(0, 5)}</button>
      <button class="btn" data-srt="${m.start}">\u2B07 .srt subtitles</button>
      <button class="btn" data-kit="${m.start}">📄 Clip kit</button>
      <button class="btn" data-vault="${m.start}">💾 Save to Vault</button>
      <button class="btn" data-moscan="${m.start}">🔍 Competition</button>
    </div>
    <div class="mo-scan" id="mscan-${m.start}"></div>
  </div>`;
}
let ANALYZER = null;

function renderAnalyzer(r) {
  ANALYZER = r;
  const v = r.video;
  $('#modal').innerHTML = `
    <div class="modal-h"><h2>🎬 Clip Opportunities</h2><button class="x" id="modal-close">\u2715</button></div>
    <div class="modal-body">
      <div class="an-video">
        <img src="${esc(v.thumbnail)}" alt="" onerror="this.style.display='none'">
        <div style="flex:1;min-width:0">
          <h3>${esc(v.title)}</h3>
          <div class="rs">${esc(v.author)} \u00b7 ${fmtVidLen(v.duration)} \u00b7 👁 ${fmtNum(v.views)} views</div>
          <div class="an-meta">
            <span class="an-flag ${v.captionsAvailable ? 'ok' : 'no'}">${v.captionsAvailable ? `\u2713 captions (${esc(v.captionsLang || '?')})` : '\u2717 captions unavailable'}</span>
            <span class="an-flag ${v.heatmapAvailable ? 'ok' : 'no'}">${v.heatmapAvailable ? '\u2713 retention heatmap' : '\u2717 heatmap unavailable'}</span>
            ${v.chapters?.length ? `<span class="an-flag ok">\u2713 ${v.chapters.length} chapters</span>` : ''}
          </div>
          ${v.degraded ? `<div class="setup" style="margin:10px 0 0;border-color:rgba(251,191,36,.5)"><b>🔌 Captions &amp; heatmap couldn't be fetched.</b> This almost always means the server is reaching YouTube through a <b>VPN / proxy</b> (YouTube blocks those endpoints for non-residential IPs). Note: Firefox's VPN does NOT affect the server \u2014 but a system-wide VPN or your Docker network might. ${v.chapters?.length ? 'Showing a <b>chapter-based</b> fallback below in the meantime.' : 'This video also has no chapters, so there is nothing to fall back to.'}</div>` : ''}
          ${v.diag ? `<details style="margin:8px 0 0" open><summary style="cursor:pointer;color:var(--dim);font-size:10.5px;font-family:var(--mono)">diagnostics (send this if it fails)</summary><div class="rs" style="font-family:var(--mono);font-size:10px;margin-top:4px;white-space:pre-wrap">page tracks: ${v.diag.pageTracks} \u00b7 innertube tracks: ${v.diag.innertubeTracks} (${esc(v.diag.innertubeClient || 'none')})\ntranscript segs: ${v.diag.transcriptSegments} \u00b7 caption track: ${esc(v.diag.captionLang || '?')}/${esc(v.diag.captionKind || '?')}\ntranscript download: status=${esc(String(v.diag.trStatus))} len=${v.diag.trLen || 0}\nheatmap markers: ${v.diag.heatmapMarkers} \u00b7 chapters: ${v.diag.chapters}${v.diag.captionBaseUrl ? '\ncaption url: ' + esc(v.diag.captionBaseUrl) : ''}${v.diag.transcriptError ? '\nerror: ' + esc(v.diag.transcriptError).slice(0,200) : ''}</div></details>` : ''}
        </div>
      </div>
      ${heatHTML(r)}
      ${r.moments.length
        ? `<div class="dr-block"><h3>${r.moments.length} moments worth clipping</h3></div>` + r.moments.map((m) => moCardHTML(m, v)).join('')
        : `<div class="setup">\u26A0\uFE0F No clip-worthy moments detected \u2014 ${!v.captionsAvailable && !v.heatmapAvailable ? 'captions and retention data were both unavailable from this network, so there was nothing real to analyze.' : 'this video may have very flat retention.'}</div>`}
      ${v.captionsAvailable ? `<details style="margin-top:6px"><summary style="cursor:pointer;color:var(--muted);font-size:12px">Transcript (${r.transcriptTotal} segments${r.transcriptTotal > r.transcript.length ? ', showing first ' + r.transcript.length : ''})</summary>
        <div class="tr-box" style="margin-top:8px">${r.transcript.map((sg) => `<div><span>${srtTime(sg.start).slice(0, 5)}</span>${esc(sg.text)}</div>`).join('')}</div></details>` : ''}
      <div class="an-note">Moments = YouTube's real "most replayed" retention peaks \u00D7 real caption signals (laughter, emotion, facts, pacing) \u00D7 live Google Trends cross-check. Scores are model estimates from real signals; titles/hooks are suggestions.</div>
    </div>`;
  $('#modal-close').onclick = closeAllOverlays;
  wireAnalyzer(v);
}

function wireAnalyzer(v) {
  const body = $('#modal .modal-body');
  body.addEventListener('click', async (e) => {
    const jump = e.target.closest('[data-jump]');
    if (jump) { document.getElementById('mo-' + jump.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    const prev = e.target.closest('[data-preview]');
    if (prev) {
      const m = ANALYZER.moments.find((x) => String(x.start) === prev.dataset.preview);
      if (m) openDrawer({
        kind: 'video', platform: 'YouTube', title: m.title, subtitle: `${v.title} \u00b7 ${srtTime(m.start)}\u2013${srtTime(m.end)}`,
        author: v.author, category: `Clip \u00b7 ${m.length}s \u00b7 score ${m.score}`,
        url: `${v.url}&t=${m.start}`, thumbnail: v.thumbnail,
        embed: { type: 'youtube', id: v.id, start: m.start },
        ageMs: 0, metrics: { views: v.views, score: m.score }, history: [],
        meta: { firstSeenTs: Date.now() },
      });
      return;
    }
    const cp = e.target.closest('[data-copy]');
    if (cp) { navigator.clipboard?.writeText(cp.dataset.copy); toast({ icon: '📋', title: 'Title copied' }); return; }
    const srt = e.target.closest('[data-srt]');
    if (srt) {
      const m = ANALYZER.moments.find((x) => String(x.start) === srt.dataset.srt);
      if (m) download(`${v.id}_${m.start}s.srt`, srtForMoment(m));
      return;
    }
    const kit = e.target.closest('[data-kit]');
    if (kit) {
      const m = ANALYZER.moments.find((x) => String(x.start) === kit.dataset.kit);
      if (m) download(`${v.id}_clipkit_${m.start}s.txt`, clipKitText(v, m));
      return;
    }
    const vault = e.target.closest('[data-vault]');
    if (vault) {
      const m = ANALYZER.moments.find((x) => String(x.start) === vault.dataset.vault);
      if (m) {
        try {
          const rr = await fetch('/api/moments/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ video: v, moment: m }) }).then((x) => x.json());
          toast(rr.ok ? { icon: '💾', title: 'Saved to the Moment Vault', body: `${srtTime(m.start)} \u2014 find it under 🏆 Moments` } : { icon: '\u26A0\uFE0F', title: 'Save failed', body: rr.error || '' });
        } catch (er) { toast({ icon: '\u26A0\uFE0F', title: 'Save failed', body: String(er.message || er) }); }
      }
      return;
    }
    const scan = e.target.closest('[data-moscan]');
    if (scan) {
      const m = ANALYZER.moments.find((x) => String(x.start) === scan.dataset.moscan);
      const slot = document.getElementById('mscan-' + m.start);
      if (!m || !slot) return;
      if (state.scans['mo-' + m.start]) { slot.innerHTML = scanHTML(state.scans['mo-' + m.start]); return; }
      slot.innerHTML = '<div class="scan-err">Scanning YouTube for existing Shorts on this moment\u2026</div>';
      try {
        const rr = await fetch('/api/scan?q=' + encodeURIComponent(`${m.title} ${v.author}`)).then((x) => x.json());
        state.scans['mo-' + m.start] = rr;
        slot.innerHTML = scanHTML(rr);
      } catch (er) { slot.innerHTML = `<div class="scan-err">\u26A0\uFE0F ${esc(String(er.message || er))}</div>`; }
    }
  });
}

function openAnalyzer(prefill) {
  openModal('🎬 Video Analyzer', `
    <div class="an-input-row">
      <input id="an-url" placeholder="Paste a YouTube URL \u2014 podcast, stream VOD, match highlights\u2026" value="${esc(prefill || '')}">
      <button class="btn primary" id="an-go">Analyze</button>
    </div>
    <div id="an-results"><div class="an-note" style="margin-top:12px">Finds the 30 seconds worth posting inside any video: retention peaks (YouTube's real "most replayed" data) \u00D7 captions (laughter, emotion, facts) \u00D7 what's trending right now. Works with zero API keys \u00b7 ~15 analyses/hour.</div></div>`);
  $('#modal').classList.add('wide');
  const go = async () => {
    const url = $('#an-url').value.trim();
    if (!url) return;
    $('#an-go').textContent = 'Reading video\u2026';
    $('#an-go').disabled = true;
    $('#an-results').innerHTML = `<div class="an-loading"><div class="spin">🎬</div><div style="margin-top:10px">Reading the video\u2026</div></div>`;
    try {
      const _metaRes = await fetch('/api/analyze-meta?url=' + encodeURIComponent(url));
      if (!_metaRes.ok) throw new Error(_metaRes.status === 404 ? 'server is missing the new /api/analyze-meta route — rebuild the container: docker compose build --no-cache && docker compose up' : 'server error ' + _metaRes.status);
      const _metaTxt = await _metaRes.text();
      let rr; try { rr = JSON.parse(_metaTxt); } catch { throw new Error('server returned non-JSON — rebuild the container: docker compose build --no-cache && docker compose up (then Ctrl+Shift+R)'); }
      if (rr.error) { $('#an-results').innerHTML = `<div class="setup err">\u26A0\uFE0F ${esc(rr.error)}</div>`; return; }
      const v = rr.result.video;
      $('#an-results').innerHTML = `
        <div class="an-video">
          <img src="${esc(v.thumbnail)}" alt="" onerror="this.style.display='none'">
          <div style="flex:1;min-width:0"><h3>${esc(v.title)}</h3>
            <div class="rs">${esc(v.author)} \u00b7 ${fmtVidLen(v.duration)} \u00b7 👁 ${fmtNum(v.views)} views</div>
            <div class="an-meta"><span class="an-flag no">\u2717 captions need your browser</span>${v.chapters?.length ? `<span class="an-flag ok">\u2713 ${v.chapters.length} chapters</span>` : ''}</div>
          </div>
        </div>
        <div class="setup" style="border-color:rgba(34,211,238,.45);margin:12px 0">
          <b>⚡ YouTube now blocks server-side captions</b> (a \u201Cproof-of-origin\u201D token only a real browser can make). But <b>your browser is a real viewer</b>, so it can read them. Grab the transcript one of two ways:
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <button class="btn primary" id="an-auto">\Auto-extract (opens YouTube briefly)</button>
            <button class="btn" id="an-paste">\Paste the transcript</button>
            <button class="btn" id="an-meta">Skip \u2014 analyze without transcript</button>
          </div>
          <div id="an-extract" style="margin-top:10px"></div>
        </div>`;
      $('#an-auto').onclick = () => autoExtract(url, v);
      $('#an-paste').onclick = () => showPaste(v);
      $('#an-meta').onclick = () => renderAnalyzer(rr.result);
    } catch (er) {
      $('#an-results').innerHTML = `<div class="setup err">\u26A0\uFE0F ${esc(String(er.message || er))}</div>`;
    } finally {
      const b = $('#an-go');
      if (b) { b.textContent = 'Analyze'; b.disabled = false; }
    }
  };
  $('#an-go').onclick = go;
  $('#an-url').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  setTimeout(() => $('#an-url').focus(), 60);
}



// ── Browser-side transcript extraction (bypasses YouTube's server-side block) ──
const TP_POPUP = `<!doctype html><html><head><meta charset="utf-8"><title>TrendPulse · reading transcript</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0e15;color:#e9ebf2;display:grid;place-items:center;height:100vh;margin:0;text-align:center}
.box{max-width:440px;padding:24px}.spin{font-size:30px;animation:r 1.2s linear infinite}@keyframes r{to{transform:rotate(360deg)}}
#st{margin-top:14px;color:#8d94a8;font-size:13px;min-height:18px}</style></head>
<body><div class="box"><div class="spin">🎬</div><h3>Reading the transcript…</h3>
<div id="st">Opening YouTube with your session</div>
<p style="color:#5d6478;font-size:12px;margin-top:18px">Keep this tab open a few seconds. If it can’t auto-read, close it and use <b>I’ll paste the transcript</b>.</p>
</div><script>
(function(){
  var vid='__VID__';
  var KEY='AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
  var st=document.getElementById('st');
  function send(o){ try{ if(window.opener) window.opener.postMessage(Object.assign({tpTranscript:1},o),'*'); }catch(e){} }
  function set(t){ st.textContent=t; }
  function parseXML(x){var s=[],re=/<text start="([\d.]+)"(?: dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g,m;while((m=re.exec(x))){var t=m[3].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/<[^>]+>/g,'').trim();if(t)s.push({start:+m[1],dur:+(m[2]||2),text:t});}return s;}
  function parseP(x){var s=[],re=/<p t="(\d+)"(?: d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g,m;while((m=re.exec(x))){var t=m[3].replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').trim();if(t)s.push({start:+m[1]/1000,dur:+(m[2]||2000)/1000,text:t});}return s;}
  function parseJ(x){try{var j=JSON.parse(x);if(j.events){return j.events.filter(function(e){return e.segs&&e.segs.length;}).map(function(e){return{start:(e.tStartMs||0)/1000,dur:(e.dDurationMs||2000)/1000,text:e.segs.map(function(s){return s.utf8||'';}).join('').trim();}}).filter(function(s){return s.text;});}}catch(e){}return null;}
  function parse(x){return parseJ(x)||parseP(x)||parseXML(x);}
  function tryFetch(url,opts){return fetch(url,opts).then(function(r){return r.ok?r.text():Promise.reject(r.status);});}
  var clients=[{clientName:'ANDROID',clientVersion:'19.09.37',androidSdkVersion:30},{clientName:'WEB',clientVersion:'2.20240701.00.00'},{clientName:'TVHTML5',clientVersion:'7.20240701.00.00'}];
  function innertube(ci){
    if(ci>=clients.length)return Promise.reject('no client');
    set('Asking YouTube’s player (method '+(ci+1)+'/'+clients.length+')');
    return tryFetch('https://www.youtube.com/youtubei/v1/player?key='+KEY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context:{client:clients[ci]},videoId:vid})}).then(function(txt){
      var j=JSON.parse(txt);var tr=(j.captions&&j.captions.playerCaptionsTracklistRenderer&&j.captions.playerCaptionsTracklistRenderer.captionTracks)||[];
      var base=tr.length?(tr.find(function(t){return t.languageCode==='en';})||tr[0]).baseUrl:null;
      if(!base)return innertube(ci+1);
      return tryFetch(base).then(function(b){var s=parse(b);if(s&&s.length)return s;return tryFetch(base+'&fmt=json3').then(function(b2){var s2=parse(b2);if(s2&&s2.length)return s2;return innertube(ci+1);});});
    }).catch(function(){return innertube(ci+1);});
  }
  function watchPage(){
    set('Reading the video page with your cookies');
    return tryFetch('https://www.youtube.com/watch?v='+vid+'&hl=en',{credentials:'include'}).then(function(html){
      var m=html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:var|<\/script>)/s);if(!m)throw 0;
      var pr=JSON.parse(m[1]);var tr=(pr.captions&&pr.captions.playerCaptionsTracklistRenderer&&pr.captions.playerCaptionsTracklistRenderer.captionTracks)||[];
      var base=tr.length?(tr.find(function(t){return t.languageCode==='en';})||tr[0]).baseUrl:null;if(!base)throw 0;
      return tryFetch(base,{credentials:'include'}).then(function(b){var s=parse(b);if(s&&s.length)return s;return tryFetch(base+'&fmt=json3',{credentials:'include'}).then(function(b2){var s2=parse(b2);if(s2&&s2.length)return s2;throw 0;});});
    });
  }
  set('Opening YouTube with your session');
  innertube(0).then(function(s){send({ok:true,segments:s,method:'innertube'});}).catch(function(){
    watchPage().then(function(s){send({ok:true,segments:s,method:'watchpage'});}).catch(function(){
      set('Auto-read blocked — close this tab and paste the transcript instead');
      send({ok:false,error:'auto-extract failed'});
    });
  });
  setTimeout(function(){ send({ok:false,error:'timeout'}); }, 22000);
})();
<\/script></body></html>`;

function parsePastedTranscript(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const re = /^\[?(\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d+)?\]?\s*(.*)$/;
  const segs = [];
  for (const l of lines) {
    const m = l.match(re);
    if (m && m[2]) {
      const stamp = (l.match(/(\d{1,2}:)?\d{1,2}:\d{2}/) || [])[0];
      if (!stamp) continue;
      const pp = stamp.split(':').map(Number);
      const start = pp.length === 3 ? pp[0] * 3600 + pp[1] * 60 + pp[2] : pp[0] * 60 + pp[1];
      segs.push({ start, dur: 3, text: m[2] });
    }
  }
  if (segs.length) {
    for (let i = 0; i < segs.length - 1; i++) segs[i].dur = Math.max(0.5, segs[i + 1].start - segs[i].start);
    return segs;
  }
  const n = lines.length;
  return lines.map((t, i) => ({ start: i * 3, dur: 3, text: t }));
}

function autoExtract(url, v) {
  const slot = $('#an-extract');
  const videoId = (url.match(/[?&]v=([\w-]{11})/) || url.match(/youtu\.be\/([\w-]{11})/) || url.match(/shorts\/([\w-]{11})/) || [])[1];
  if (!videoId) { slot.innerHTML = '<div class="setup err">⚠️ could not read the video id.</div>'; return; }
  slot.innerHTML = '<div class="rs">Opening a small YouTube tab to read the transcript with your session… allow the pop-up. If nothing happens in ~10s, use <b>I’ll paste the transcript</b>.</div>';
  const html = TP_POPUP.split('__VID__').join(videoId);
  const w = window.open('', 'tp_tx_' + videoId, 'width=460,height=320');
  if (!w) { slot.innerHTML = '<div class="setup err">⚠️ pop-up blocked — allow pop-ups for localhost, or use <b>I’ll paste the transcript</b>.</div>'; return; }
  w.document.open(); w.document.write(html); w.document.close();
  let done = false;
  const onMsg = (e) => {
    if (!e.data || e.data.tpTranscript !== 1) return;
    if (done) return; done = true;
    window.removeEventListener('message', onMsg);
    try { w.close(); } catch {}
    if (e.data.ok && e.data.segments && e.data.segments.length) submitTranscript(url, v, e.data.segments, e.data.method);
    else showPaste(v, 'Auto-read could not get the transcript — paste it instead:');
  };
  window.addEventListener('message', onMsg);
  setTimeout(() => { if (!done) { done = true; window.removeEventListener('message', onMsg); try { w.close(); } catch {} showPaste(v, 'Auto-read timed out — paste the transcript instead:'); } }, 24000);
}

function showPaste(v, msg) {
  const slot = $('#an-extract');
  slot.innerHTML = `<div class="setup" style="border-color:rgba(139,92,246,.4)">
    ${esc(msg || 'Paste the transcript:')}
    <ol style="margin:8px 0 8px 18px;font-size:12px;color:var(--muted)">
      <li>Open the video on YouTube → <b>…</b> (or description) → <b>Show transcript</b>.</li>
      <li>In the transcript panel, <b>Ctrl+A</b> then <b>Ctrl+C</b> (select all → copy).</li>
      <li>Paste below → <b>Analyze with transcript</b>.</li>
    </ol>
    <textarea id="an-pastebox" rows="8" style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border2);border-radius:10px;padding:10px;font-size:12px" placeholder="[0:00] ...&#10;[0:03] ..."></textarea>
    <div style="margin-top:8px"><button class="btn primary" id="an-pastego">Analyze with transcript</button></div>
  </div>`;
  $('#an-pastego').onclick = () => {
    const segs = parsePastedTranscript($('#an-pastebox').value);
    if (!segs.length) { toast({ icon: '⚠️', title: 'Paste looked empty' }); return; }
    submitTranscript($('#an-url').value.trim(), v, segs, 'paste');
  };
}

async function submitTranscript(url, v, segments, method) {
  const slot = $('#an-extract');
  slot.innerHTML = `<div class="rs">Got ${segments.length} caption lines via <b>${esc(method)}</b> — scoring moments…</div>`;
  try {
    const rr = await fetch('/api/analyze-with-transcript', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, segments }) }).then((x) => x.json());
    if (rr.error) { slot.innerHTML = `<div class="setup err">⚠️ ${esc(rr.error)}</div>`; return; }
    renderAnalyzer(rr.result);
    refreshVault();
  } catch (er) {
    slot.innerHTML = `<div class="setup err">⚠️ ${esc(String(er.message || er))}</div>`;
  }
}

// ── Wire up ────────────────────────────────────────────────
function init() {
  $('#grid').innerHTML = SECTION_ORDER.map(cardShell).join('');
  saveBookmarks();

  // Grid interactions (delegated)
  $('#grid').addEventListener('click', (e) => {
    const star = e.target.closest('.star');
    if (star) {
      e.stopPropagation();
      const rid = star.dataset.bm;
      let it = null;
      for (const s of state.sections.values()) { it = s.items.find((x) => x.id === rid); if (it) break; }
      if (it) toggleBookmark(it);
      return;
    }
    const unwatch = e.target.closest('[data-unwatch]');
    if (unwatch) {
      e.stopPropagation();
      fetch('/api/watchlist?handle=' + encodeURIComponent(unwatch.dataset.unwatch), { method: 'DELETE' });
      return;
    }
    const exp = e.target.closest('[data-exp]');
    if (exp) return openExpanded(exp.dataset.exp);
    const vrow = e.target.closest('.vrow');
    if (vrow) {
      const cr = state.sections.get('creators')?.items.find((x) => x.id === vrow.dataset.cr);
      const v = cr?.meta?.videos.find((x) => x.videoId === vrow.dataset.vid);
      if (cr && v) return openDrawer(videoItemFrom(v, cr));
    }
    const ch = e.target.closest('.creator-h');
    if (ch) {
      const it = state.sections.get('creators')?.items.find((x) => x.id === ch.dataset.rid);
      if (it) return openDrawer(it);
    }
    const planBtn = e.target.closest('[data-plan]');
    if (planBtn) {
      e.stopPropagation();
      const it = state.sections.get('now')?.items.find((x) => x.id === planBtn.dataset.plan);
      if (it) copyPlan(it);
      return;
    }
    const scanBtn = e.target.closest('[data-scan]');
    if (scanBtn) {
      e.stopPropagation();
      openWithScan(scanBtn.dataset.scan);
      return;
    }
    const opp = e.target.closest('.opp-hero, .opp-row');
    if (opp) {
      const it = state.sections.get('now')?.items.find((x) => x.id === opp.dataset.rid);
      if (it) return openDrawer(it);
    }
    const mc = e.target.closest('.moment-card');
    if (mc) {
      const it = state.sections.get('moments')?.items.find((x) => x.id === mc.dataset.rid);
      if (it) return openDrawer(it);
    }
    const row = e.target.closest('.row');
    if (row) {
      const sec = state.sections.get(row.dataset.sec) || state.sections.get('viral');
      const it = sec?.items.find((x) => x.id === row.dataset.rid);
      if (it) openDrawer(it);
    }
  });
  $('#grid').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'add-handle') addCreatorFromInput();
  });
  $('#add-btn')?.addEventListener('click', addCreatorFromInput);

  // Rows inside modals (bookmarks, expanded)
  $('#modal').addEventListener('click', (e) => {
    const star = e.target.closest('.star');
    if (star) {
      const rid = star.dataset.bm;
      let it = null;
      for (const s of state.sections.values()) { it = s.items.find((x) => x.id === rid); if (it) break; }
      it = it || state.bookmarks.find((x) => x.id === rid);
      if (it) toggleBookmark(it);
      return;
    }
    const row = e.target.closest('.row');
    if (!row) return;
    const sec = state.sections.get(row.dataset.sec) || state.sections.get('viral');
    const it = sec?.items.find((x) => x.id === row.dataset.rid) || state.bookmarks.find((x) => x.id === row.dataset.rid);
    if (it) { closeAllOverlays(); openDrawer(it); }
  });

  // Sort selects
  for (const id of SECTION_ORDER) {
    const sel = $('#sort-' + id);
    if (sel) sel.onchange = (e) => { state.sort[id] = e.target.value; renderSection(id); };
  }

  // Window tabs + platform filter
  $('#window-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('#window-tabs button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    state.window = b.dataset.win;
    renderAll();
  });
  $('#platform-select').onchange = (e) => { state.filters.platform = e.target.value; renderAll(); };

  // Topbar
  $('#search-btn').onclick = openSearch;
  $('#analyze-btn').onclick = () => openAnalyzer();
  $('#settings-btn').onclick = openSettings;
  $('#bell-btn').onclick = () => {
    const p = $('#notif-pop');
    const opening = p.hidden;
    p.hidden = !opening; p.style.display = opening ? 'block' : 'none';
    if (opening) { renderNotifPop(); state.unread = 0; renderBell(); showBackdrop(true); }
    else showBackdrop(false);
  };
  $('#theme-btn').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('tp.theme', next);
  };
  document.documentElement.dataset.theme = localStorage.getItem('tp.theme') || 'dark';

  // Sidebar nav
  $('#nav').addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    $$('#nav a').forEach((x) => x.classList.remove('active'));
    a.classList.add('active');
    if (a.dataset.target === 'bookmarks') return openBookmarks();
    if (a.dataset.target === 'toplists') return openTopLists();
    if (a.dataset.target === 'top') return window.scrollTo({ top: 0, behavior: 'smooth' });
    $('#card-' + a.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Backdrop + esc + ⌘K
  $('#backdrop').onclick = closeAllOverlays;
  $('#modal-wrap').addEventListener('click', (e) => { if (e.target.id === 'modal-wrap') closeAllOverlays(); });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
    if (e.key === 'Escape') closeAllOverlays();
  });

  // Tickers
  setInterval(() => {
    $('#side-clock').textContent = new Date().toLocaleTimeString();
    for (const id of SECTION_ORDER) {
      const sec = state.sections.get(id);
      const upd = $('#upd-' + id);
      if (sec?.updatedAt && upd) upd.textContent = 'updated ' + fmtAgo(sec.updatedAt);
    }
  }, 4000);
  $('#side-clock').textContent = new Date().toLocaleTimeString();

  // self-heal: guarantee no overlay/backdrop is stuck at boot
  closeAllOverlays();

  connect();
}

init();
