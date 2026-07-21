// ─────────────────────────────────────────────────────────────
// Video Intelligence — "which 30 seconds of this 2-hour video are
// actually worth posting?"
//
// Real inputs (no keys required):
//   • watch-page scrape  → title, channel, duration, views, chapters,
//                          caption track URLs, storyboard spec
//   • captions (timedtext) → real transcript with real timestamps
//   • get_heatmap        → YouTube's own "most replayed" retention data
//
// Model layer (clearly labelled): peaks × transcript signals
// (laughter, applause, exclamations, facts/numbers, opinionated
// language, pacing) × cross-check against LIVE Google Trends →
// scored clip opportunities with transparent "why" reasons.
// ─────────────────────────────────────────────────────────────
import { fetchText } from './lib/http.js';
import { enrichMoment } from './metadata.js';

const BROWSER_UA = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
export const ANALYZE_BUILD = 'v4-android-metafallback';

export function parseVideoId(input) {
  const s = String(input || '').trim();
  for (const re of [/[?&]v=([\w-]{11})/, /youtu\.be\/([\w-]{11})/, /shorts\/([\w-]{11})/, /embed\/([\w-]{11})/, /live\/([\w-]{11})/, /^([\w-]{11})$/]) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

const decodeXml = (s) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));

const parseHMS = (s) => {
  const p = String(s || '').split(':').map(Number);
  return p.length && p.every((n) => Number.isFinite(n)) ? p.reduce((a, v) => a * 60 + v, 0) : null;
};

// ── Watch-page scrape → player response + chapters ───────────
async function scrapePlayer(videoId) {
  const html = await fetchText(`https://www.youtube.com/watch?v=${videoId}&hl=en&gl=US`, { headers: { ...BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' } }, 15000);
  const pm = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:var|<\/script>)/s);
  if (!pm) throw new Error('YouTube page could not be parsed — private, age-gated or region-locked video?');
  const pr = JSON.parse(pm[1]);
  if (pr.playabilityStatus && pr.playabilityStatus.status !== 'OK') {
    throw new Error('YouTube says: ' + (pr.playabilityStatus.reason || pr.playabilityStatus.status));
  }
  const chapters = [];
  const dm = html.match(/ytInitialData\s*=\s*(\{.+?\});<\/script>/s);
  if (dm) {
    try {
      const walk = (o) => {
        if (!o || typeof o !== 'object' || chapters.length >= 40) return;
        const r = o.macroMarkersListItemRenderer;
        if (r) {
          const t = parseHMS(r.timeDescription?.simpleText);
          const title = r.title?.simpleText;
          if (t != null && title) chapters.push({ t, title });
        }
        for (const k of Object.keys(o)) walk(o[k]);
      };
      walk(JSON.parse(dm[1]));
      chapters.sort((a, b) => a.t - b.t);
    } catch { /* chapters are optional */ }
  }
  return { pr, chapters };
}

// ── Innertube player (the call the YouTube player makes) — fallback source for
//    caption tracks + video details when the watch-page scrape omits them.
async function innertubePlayer(videoId) {
  const clients = [
    { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30 },
    { clientName: 'WEB', clientVersion: '2.20240701.00.00' },
    { clientName: 'WEB_EMBEDDED_PLAYER', clientVersion: '1.20240701.00.00' },
    { clientName: 'ANDROID_EMBEDDED_PLAYER', clientVersion: '19.09.37', androidSdkVersion: 30 },
  ];
  for (const client of clients) {
    try {
      const body = JSON.stringify({ context: { client }, videoId });
      const txt = await fetchText('https://www.youtube.com/youtubei/v1/player?key=' + INNERTUBE_KEY, {
        method: 'POST',
        headers: { ...BROWSER_UA, 'Content-Type': 'application/json', Origin: 'https://www.youtube.com', Referer: `https://www.youtube.com/watch?v=${videoId}`, 'Accept-Language': 'en-US,en;q=0.9' },
        body,
      }, 10000);
      const j = JSON.parse(txt);
      const tracks = j.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      if (tracks.length || j.videoDetails?.title) {
        return { tracks, videoDetails: j.videoDetails, spec: j.storyboards?.playerStoryboardSpecRenderer?.spec, client: client.clientName };
      }
    } catch { /* try next client */ }
  }
  return { tracks: [], videoDetails: null, spec: null, client: null };
}

// ── Transcript (real captions) ───────────────────────────────
const GOOGLEBOT_UA = { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Accept-Language': 'en-US,en;q=0.9' };

/** Returns { segs, status, len, preview } so a failed download is diagnosable. */
async function fetchTranscript(baseUrl) {
  const parse = (body) => {
    if (!body || body.length < 30) return null;
    try {
      const j = JSON.parse(body);
      if (j.events) {
        const segs = j.events
          .filter((e) => e.segs && e.segs.length)
          .map((e) => ({ start: (e.tStartMs || 0) / 1000, dur: (e.dDurationMs || 2000) / 1000, text: e.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim() }))
          .filter((s) => s.text);
        if (segs.length) return segs;
      }
    } catch { /* not json */ }
    const segs = [];
    const reP = /<p t="(\d+)"(?: d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g;
    let m;
    while ((m = reP.exec(body))) {
      const text = decodeXml(m[3].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      if (text) segs.push({ start: +m[1] / 1000, dur: (+m[2] || 2000) / 1000, text });
    }
    if (segs.length) return segs;
    const reT = /<text start="([\d.]+)"(?: dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
    while ((m = reT.exec(body))) {
      const text = decodeXml(m[3]).replace(/\s+/g, ' ').trim();
      if (text) segs.push({ start: +m[1], dur: +(m[2] || 2), text });
    }
    return segs.length ? segs : null;
  };
  const last = { status: null, len: 0, preview: '' };
  // Try several format/UA combinations; YouTube's caption CDN is lenient toward Googlebot.
  const variants = [
    [baseUrl, BROWSER_UA],
    [baseUrl + '&fmt=json3', BROWSER_UA],
    [baseUrl + '&fmt=srv3', BROWSER_UA],
    [baseUrl, GOOGLEBOT_UA],
    [baseUrl + '&fmt=json3', GOOGLEBOT_UA],
  ];
  for (const [url, ua] of variants) {
    let body = '';
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { ...ua, Accept: '*/*', Referer: 'https://www.youtube.com/', Origin: 'https://www.youtube.com', 'Sec-Fetch-Mode': 'cors', Cookie: 'CONSENT=YES+' },
        signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined,
      });
      last.status = res.status;
      body = await res.text();
    } catch (e) { last.status = last.status || ('ERR:' + (e?.name || 'net')); body = ''; }
    last.len = body.length;
    last.preview = body.slice(0, 140).replace(/[\r\n]+/g, ' ');
    const segs = parse(body);
    if (segs && segs.length) return { segs, status: last.status, len: last.len, preview: last.preview };
  }
  return { segs: [], status: last.status, len: last.len, preview: last.preview };
}

// ── Retention heatmap ("most replayed") ──────────────────────
async function fetchHeatmap(videoId) {
  try {
    const body = JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20250601.00.00', hl: 'en' } },
      videoId,
    });
    const txt = await fetchText('https://www.youtube.com/youtubei/v1/get_heatmap?key=' + INNERTUBE_KEY, {
      method: 'POST',
      headers: { ...BROWSER_UA, 'Content-Type': 'application/json', Origin: 'https://www.youtube.com', Referer: `https://www.youtube.com/watch?v=${videoId}` },
      body,
    }, 8000);
    const j = JSON.parse(txt);
    const markers = j?.heatmap?.heatmapRenderer?.heatmapMarkers || [];
    if (!markers.length) return null;
    return markers.map((m) => ({ t: (m.startMillis ?? (m.startSeconds || 0) * 1000) / 1000 }));
  } catch {
    return null;
  }
}

function bucketize(markerTs, duration, buckets = 90) {
  const size = Math.max(1, duration / buckets);
  const counts = new Array(buckets).fill(0);
  for (const { t } of markerTs) counts[Math.min(buckets - 1, Math.floor(t / size))]++;
  const max = Math.max(1, ...counts);
  return counts.map((c, i) => ({ t: Math.round(i * size), intensity: +(c / max).toFixed(3) }));
}

// ── Storyboard frames (real preview frame at any timestamp) ──
function storyboardInfo(spec) {
  if (!spec) return null;
  const parts = spec.split('|');
  const lvl = (parts[1] || '').split('#');
  const [w, h, cols, rows, interval] = lvl.map(Number);
  if (!w || !h || !cols || !rows || !interval) return null;
  return { base: parts[0], w, h, cols, rows, interval };
}
export function tileAt(sb, t) {
  if (!sb) return null;
  const frame = Math.floor(t / sb.interval);
  const perSheet = sb.cols * sb.rows;
  const idx = frame % perSheet;
  return {
    url: sb.base.replace('$L', '0').replace('$N', String(Math.floor(frame / perSheet))),
    x: idx % sb.cols, y: Math.floor(idx / sb.cols),
    w: sb.w, h: sb.h, cols: sb.cols, rows: sb.rows,
  };
}

// ── Moment detection ─────────────────────────────────────────
const RE = {
  laughter: /\[laughter\]|\[laughs\]|\(laughter\)|\[laught|\blaugh(s|ing)?\b|haha|lmao/gi,
  applause: /\[applause\]|\[cheers?\]|\[music\]|\[cheering\]/gi,
  exclaim: /!/g,
  question: /\?/g,
  numbers: /\b\d{1,3}(?:[.,]\d+)?\s?(?:%|percent|million|billion|thousand|\bk\b|\bx\b|times|years?|dollars?)?\b/gi,
  strong: /\bnever\b|\bworst\b|best (?:ever|in the world)|everyone knows|the truth|actually\b|you'?re wrong|\bnobody\b|\bsecret\b|\billegal\b|\bbanned\b|\binsane\b|\bcrazy\b|\bunbelievable\b|\bexposed\b|\bguarantee\b|\blie(s|d)?\b/gi,
};
const count = (text, re) => (text.match(re) || []).length;

function pickTitle(text, fallback) {
  const sents = text.split(/(?<=[.!?])\s+/).filter((s) => s.length >= 20 && s.length <= 110);
  const ranked = sents.sort((a, b) => (count(b, RE.exclaim) - count(a, RE.exclaim)) || (b.length - a.length));
  const best = ranked[0] || '';
  const clean = best.replace(/^\s*[-–—•]\s*/, '').trim();
  return clean || fallback;
}

function scoreAnchor(a, window, trends) {
  const text = window.segments.map((s) => s.text).join(' ');
  const words = (text.match(/\b[\w']+\b/g) || []).length;
  const wps = words / Math.max(1, window.end - window.start);
  const sig = {
    laughter: count(text, RE.laughter),
    applause: count(text, RE.applause),
    exclaim: count(text, RE.exclaim),
    question: count(text, RE.question),
    numbers: count(text, RE.numbers),
    strong: count(text, RE.strong),
  };
  const trendHits = trends.filter((t) => {
    const tw = t.split(/\s+/).filter((w) => w.length > 3).map((w) => w.toLowerCase());
    return tw.length && tw.filter((w) => text.toLowerCase().includes(w)).length >= Math.min(2, tw.length);
  });

  const hasT = window.hasTranscript;
  const c = {
    retention: a.retention ?? (a.chapter ? 0.55 : 0.35),
    laughter: hasT ? Math.min(1, sig.laughter / 2) : 0,
    applause: hasT ? Math.min(1, sig.applause / 2) : 0,
    emotion: hasT ? Math.min(1, (sig.exclaim + sig.question) / 4) : 0,
    facts: hasT ? Math.min(1, sig.numbers / 3) : 0,
    strong: hasT ? Math.min(1, sig.strong / 2) : 0,
    pacing: hasT ? Math.min(1, wps / 3.5) : 0,
    trending: Math.min(1, trendHits.length),
  };
  const W = { retention: 0.40, laughter: 0.14, applause: 0.06, emotion: 0.10, facts: 0.07, strong: 0.10, pacing: 0.06, trending: 0.07 };
  const score = Math.round(100 * Object.entries(W).reduce((s, [k, w]) => s + c[k] * w, 0));

  const reasons = [];
  if (a.retention != null) reasons.push(`\u25B2 rewatch spike \u2014 ${Math.round(a.retention * 100)}% of this video's peak (YouTube "most replayed" data)`);
  if (sig.laughter) reasons.push(`😂 laughter detected ${sig.laughter}\u00D7 in this window`);
  if (sig.applause) reasons.push(`👏 applause / crowd reaction markers (${sig.applause})`);
  if (sig.exclaim + sig.question >= 3) reasons.push(`🔥 high-emotion delivery (${sig.exclaim} exclamations, ${sig.question} questions)`);
  if (sig.strong >= 2) reasons.push(`🎯 strong / opinionated language (${sig.strong} markers) \u2014 comment bait`);
  if (sig.numbers >= 2) reasons.push(`📊 concrete facts & numbers (${sig.numbers})`);
  if (wps >= 2.8) reasons.push(`\u23E9 fast pacing (${wps.toFixed(1)} words/sec)`);
  for (const t of trendHits.slice(0, 2)) reasons.push(`🔎 mentions trending topic "${t}"`);
  if (a.chapter) reasons.push(`📑 chapter: "${a.chapter}"`);
  if (!hasT && a.retention == null) reasons.push('\u26A0\uFE0F limited signals \u2014 captions & heatmap unavailable for this video/network');

  const dominant = sig.laughter >= 2 ? 'funny' : sig.strong >= 2 ? 'bold' : sig.numbers >= 2 ? 'fact' : trendHits.length ? 'trend' : 'hook';
  const hooks = {
    funny: ['Try not to laugh \u2014 impossible 😂', 'He could NOT keep a straight face\u2026', 'The reaction you didn\u2019t know you needed'],
    bold: ['He actually said this on air\u2026 😳', 'This take is going to start a war 🔥', 'Nobody expected this answer'],
    fact: ['The number nobody talks about\u2026 📊', 'This changes everything we thought', 'Wait\u2026 that can\u2019t be real 🤯'],
    trend: ['Everyone is searching for this right now 📈', 'The internet can\u2019t stop talking about this', 'Before it blows up \u2014 here\u2019s the context'],
    hook: ['You need to hear this\u2026 👂', 'The moment everyone will be clipping', 'Watch till the end 👀'],
  }[dominant];

  return { score, reasons, sig, wps: +wps.toFixed(2), trendHits, hooks };
}

export function findMoments({ duration, segments, buckets, chapters, trends }) {
  const hasTranscript = segments.length > 0;
  let anchors = [];

  if (buckets) {
    const sm = buckets.map((b, i) => {
      const prev = buckets[i - 1]?.intensity || 0, next = buckets[i + 1]?.intensity || 0;
      return { t: b.t, retention: (prev + b.intensity * 2 + next) / 4 };
    });
    for (const p of [...sm].sort((a, b) => b.retention - a.retention)) {
      if (anchors.length >= 10 || p.retention < 0.3) break;
      if (!anchors.some((a) => Math.abs(a.t - p.t) < 55)) anchors.push({ t: p.t, retention: +p.retention.toFixed(2) });
    }
    anchors.sort((a, b) => a.t - b.t);
  } else if (chapters.length > 1) {
    anchors = chapters.slice(0, 12).map((c) => ({ t: c.t, retention: null, chapter: c.title }));
  } else if (hasTranscript) {
    for (let t = 30; t < duration - 30 && anchors.length < 10; t += 90) anchors.push({ t, retention: null });
  }

  const moments = [];
  for (const a of anchors) {
    let start = Math.max(0, a.t - 22), end = Math.min(duration, a.t + 22);
    // snap to caption sentence boundaries
    if (hasTranscript) {
      const near = (tt, dir) => {
        let best = null;
        for (const s of segments) {
          if (dir < 0 && s.start <= tt && s.start >= tt - 12) best = s.start;
          if (dir > 0 && s.start >= tt && s.start <= tt + 12) { best = s.start + s.dur; break; }
        }
        return best;
      };
      start = near(start, -1) ?? start;
      end = near(end, +1) ?? end;
      end = Math.max(end, start + 12);
    }
    const segs = hasTranscript
      ? segments.filter((s) => s.start < end && s.start + s.dur > start)
      : [];
    const res = scoreAnchor(a, { segments: segs, start, end, hasTranscript }, trends);
    if (res.reasons.length === 0) continue;
    moments.push({
      start: Math.round(start), end: Math.round(end),
      length: Math.round(end - start),
      ...res,
      title: pickTitle(segs.map((s) => s.text).join(' '), a.chapter || 'The moment everyone will clip'),
      caption: segs.map((s) => ({ t: +s.start.toFixed(2), d: +s.dur.toFixed(2), text: s.text })),
      bestFor: res.score >= 85 ? 'Shorts \u00B7 Reels \u00B7 TikTok' : res.score >= 68 ? 'Shorts \u00B7 TikTok' : 'TikTok',
    });
  }
  return moments.sort((a, b) => b.score - a.score).slice(0, 8).map((m, i) => ({ ...m, rank: i + 1 }));
}

// ── Full analysis ────────────────────────────────────────────
/** Metadata-only (no transcript download) — the client fetches the transcript in the browser. */
export async function analyzeMeta(videoId) {
  const { pr, chapters } = await scrapePlayer(videoId);
  const vd = pr.videoDetails || {};
  let itTracks = [], itClient = null, itVD = null, itSpec = null;
  try { const it = await innertubePlayer(videoId); itTracks = it.tracks; itClient = it.client; itVD = it.videoDetails; itSpec = it.spec; } catch {}
  return analyzeFromParts(videoId, { pr, chapters, vd, itVD, itSpec, pageTrackCount: (pr.captions?.playerCaptionsTracklistRenderer?.captionTracks || []).length, itTracks, itClient }, null, []);
}

/** Run moment detection on a transcript the browser supplied (bypasses the PO-token wall). */
export async function analyzeWithTranscript(videoId, segments, trendTitles = []) {
  const { pr, chapters } = await scrapePlayer(videoId);
  const vd = pr.videoDetails || {};
  let itVD = null, itSpec = null;
  try { const it = await innertubePlayer(videoId); itVD = it.videoDetails; itSpec = it.spec; } catch {}
  const segs = Array.isArray(segments) ? segments.filter((x) => x && typeof x.start === 'number' && x.text) : [];
  return analyzeFromParts(videoId, { pr, chapters, vd, itVD, itSpec, pageTrackCount: 0, itTracks: [], itClient: 'browser' }, segs, trendTitles, true);
}


function stampEnrichment(moments){ for(const m of moments){ const e=enrichMoment(m); m.meta={...(m.meta||{}), ...e}; } return moments; }
function analyzeFromParts(videoId, ctx, segments, trendTitles, fromBrowser = false) {
  const { pr, chapters, vd, itVD, itSpec, pageTrackCount, itTracks, itClient } = ctx;
  const finalVD = (vd && vd.title) ? vd : (itVD || vd || {});
  const finalSpec = pr.storyboards?.playerStoryboardSpecRenderer?.spec || itSpec;
  const finalDuration = +finalVD.lengthSeconds || +vd.lengthSeconds || 0;
  const duration = finalDuration;
  const track = (pr.captions?.playerCaptionsTracklistRenderer?.captionTracks || [])[0] || null;
  const markers = duration > 90 ? null : null; // heatmap still needs server PO token; skip here
  const buckets = null;
  let moments = findMoments({ duration, segments: segments || [], buckets, chapters, trends: trendTitles });
  const degraded = !(segments && segments.length) && !buckets;
  if (degraded && chapters.length && !moments.length) {
    moments = chapters.slice(0, 10).map((c, i, arr) => {
      const next = arr[i + 1]?.t ?? duration;
      const start = Math.round(c.t), end = Math.round(Math.min(duration, next));
      return { start, end, length: Math.max(8, end - start), rank: 0, score: 38,
        reasons: ['\U0001F4D1 chapter: "' + c.title + '"', '\u26A0\uFE0F no transcript supplied \u2014 ranked by chapter structure.'],
        hooks: ['The part about ' + c.title + '\u2026', 'You need to hear this chapter \U0001F442', c.title + ' \u2014 explained fast'],
        caption: [], bestFor: 'Shorts \u00b7 TikTok', trendHits: [], title: c.title };
    }).sort((a, b) => b.length - a.length).map((m, i) => ({ ...m, rank: i + 1 }));
  }
  if (degraded && !moments.length) {
    const metaTitle = finalVD?.title || vd?.title || '';
    const metaViews = +finalVD?.viewCount || +vd?.viewCount || 0;
    if (metaTitle) {
      const vel = finalDuration > 0 ? Math.round(metaViews / Math.max(1, finalDuration / 3600)) : 0;
      moments = [{ start: 0, end: finalDuration || 30, length: finalDuration || 30, rank: 1, score: 34,
        reasons: ['\u26A0\uFE0F no transcript available \u2014 use \u201CGet the real transcript\u201D for precise moments.',
          `\u2139\uFE0F Whole-clip angle from the video's own data (${metaViews.toLocaleString()} views \u00b7 ${vel.toLocaleString()} views/hr).`],
        hooks: [`You won't believe "${metaTitle.slice(0, 40)}"\u2026`, 'The internet is losing it over this \U0001F525', 'Watch till the end \u2014 ' + metaTitle.slice(0, 30)],
        caption: [], bestFor: 'Shorts \u00b7 TikTok', trendHits: [], title: metaTitle || 'Post this clip now' }];
    }
  }
  return {
    video: {
      id: videoId, title: finalVD.title || vd.title || 'Unknown video', author: finalVD.author || vd.author || '',
      duration: finalDuration, views: +finalVD.viewCount || +vd.viewCount || 0,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, url: `https://www.youtube.com/watch?v=${videoId}`,
      chapters, captionsAvailable: !!(segments && segments.length), captionsLang: track?.languageCode || null,
      heatmapAvailable: false, degraded, storyboard: storyboardInfo(finalSpec),
      diag: { pageTracks: pageTrackCount, innertubeTracks: itTracks.length, innertubeClient: itClient,
        transcriptSegments: segments ? segments.length : 0, fromBrowser, build: ANALYZE_BUILD, chapters: chapters.length },
    },
    moments, heatmap: buckets, transcript: (segments || []).slice(0, 900), transcriptTotal: segments ? segments.length : 0,
  };
}

export async function analyzeVideo(videoId, trendTitles = []) {
  const { pr, chapters } = await scrapePlayer(videoId);
  const vd = pr.videoDetails || {};
  const duration = +vd.lengthSeconds || 0;
  const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const track = tracks.find((t) => t.languageCode === 'en' && t.kind === 'asr') || tracks.find((t) => t.languageCode === 'en') || tracks.find((t) => (t.languageCode || '').startsWith('en')) || tracks[0];
  let pageTrackCount = tracks.length, itTracks = [], itClient = null, itVD = null, itSpec = null;
  try { const it = await innertubePlayer(videoId); itTracks = it.tracks; itClient = it.client; itVD = it.videoDetails; itSpec = it.spec; } catch { itTracks = []; }
  if (!tracks.length && itTracks.length) { /* keep server-side best effort below */ }
  let segments = [], transcriptError = '', trStatus = null, trLen = 0, trPreview = '', trBaseUrl = '';
  const trackDump = track ? JSON.stringify(track).slice(0, 160) : '(none)';
  const consume = (r) => { if (!r) return false; trStatus = r.status; trLen = r.len; trPreview = r.preview || trPreview; if (r.segs && r.segs.length) { segments = r.segs; return true; } return false; };
  if (track?.baseUrl) { trBaseUrl = track.baseUrl; try { consume(await fetchTranscript(track.baseUrl)); } catch (e) { transcriptError = String(e?.message || e); } }
  if (!segments.length && itTracks.length) { const itTrack = itTracks.find((t) => t.languageCode === (track?.languageCode || 'en')) || itTracks[0]; if (itTrack?.baseUrl) { if (!trBaseUrl) trBaseUrl = itTrack.baseUrl; try { consume(await fetchTranscript(itTrack.baseUrl)); } catch (e) { transcriptError = transcriptError || String(e?.message || e); } } }
  if (!segments.length && !transcriptError) transcriptError = trStatus === 200 && trLen === 0 ? 'YouTube returned EMPTY captions (PO-token wall) — use the in-browser "Get the real transcript" button.' : `download=${trStatus} len=${trLen} :: ${trPreview}`;
  const markers = duration > 90 ? await fetchHeatmap(videoId) : null;
  const buckets = markers && duration ? bucketize(markers, duration) : null;
  return analyzeFromParts(videoId, { pr, chapters, vd, itVD, itSpec, pageTrackCount, itTracks, itClient }, segments.length ? segments : null, trendTitles);
}
