// TrendPulse server — zero dependencies (Node >= 20 built-in fetch only).
// Serves the dashboard, the JSON API, and the Server-Sent-Events stream.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { store, subscribe, snapshot, setItems } from './store.js';
import { startScheduler, globalSearch, refreshProducer } from './scheduler.js';
import { getWatchlist, addCreator, removeCreator } from './creators.js';
import * as youtube from './adapters/youtube.js';
import { analyzeVideo, analyzeMeta, analyzeWithTranscript, parseVideoId, tileAt } from './analyze.js';
import { analyzedToMoment, ingestMoments, vaultItems } from './moments.js';
import { buildTopList } from './toplists.js';
import { enrichMoment, matchesQuery, buildFacets } from './metadata.js';
import { buildCompilations, trendingAgain, detectSeries } from './compilations.js';

// Deep-scan cache + quota guard (each scan ~ 200 YouTube units).
const scanCache = new Map(); // key -> { ts, result }
let scanHour = 0, scanCount = 0;
// Video analysis cache + rate limit (heavy: watch-page scrape + captions + heatmap).
const analyzeCache = new Map(); // videoId -> { ts, result }
let anHour = 0, anCount = 0;

const env = process.env;
const PORT = +(env.PORT || 3000);
const PUBLIC = join(process.cwd(), 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 6e6) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function staticFile(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath;
  const p = normalize(join(PUBLIC, rel));
  if (!p.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    const buf = await readFile(p);
    send(res, 200, buf, MIME[extname(p)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

function tilePayload(result) {
  const sb = result.video.storyboard;
  return {
    result: {
      ...result,
      moments: result.moments.map((m) => ({ ...m, tile: tileAt(sb, (m.start + m.end) / 2) })),
    },
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (u.pathname === '/api/health') {
      return send(res, 200, JSON.stringify({ ok: true, version: store.version, ts: Date.now() }));
    }
    if (u.pathname === '/api/snapshot') {
      return send(res, 200, JSON.stringify(snapshot()));
    }
    if (u.pathname === '/api/search' && req.method === 'GET') {
      const q = (u.searchParams.get('q') || '').slice(0, 80);
      return send(res, 200, JSON.stringify(await globalSearch(env, q)));
    }
    if (u.pathname === '/api/creators' && req.method === 'GET') {
      return send(res, 200, JSON.stringify({ creators: getWatchlist() }));
    }
    if (u.pathname === '/api/watchlist' && req.method === 'POST') {
      const body = await readJSONBody(req);
      const entry = await addCreator(body); // validates handle, persists to data/watchlist.json
      await refreshProducer('creators');    // immediate refresh so it appears at once
      return send(res, 200, JSON.stringify({ ok: true, creator: entry }));
    }
    if (u.pathname === '/api/watchlist' && req.method === 'DELETE') {
      const handle = (u.searchParams.get('handle') || '').slice(0, 80);
      await removeCreator(handle);
      await refreshProducer('creators');
      return send(res, 200, JSON.stringify({ ok: true }));
    }
    if (u.pathname === '/api/analyze' && req.method === 'GET') {
      const videoId = parseVideoId(u.searchParams.get('url') || u.searchParams.get('v') || '');
      if (!videoId) return send(res, 200, JSON.stringify({ error: 'Paste a valid YouTube URL (watch, youtu.be, shorts or live link).' }));
      const cached = analyzeCache.get(videoId);
      if (cached && Date.now() - cached.ts < 6 * 3.6e6) {
        return send(res, 200, JSON.stringify({ ok: true, cached: true, ...tilePayload(cached.result) }));
      }
      const hour = Math.floor(Date.now() / 3.6e6);
      if (hour !== anHour) { anHour = hour; anCount = 0; }
      if (anCount >= 15) {
        return send(res, 200, JSON.stringify({ error: 'Analysis limit reached for this hour (15) — this keeps YouTube from rate-limiting your IP.' }));
      }
      anCount++;
      const trends = (store.sections.get('trends')?.items || []).map((t) => t.title).slice(0, 25);
      const result = await analyzeVideo(videoId, trends);
      analyzeCache.set(videoId, { ts: Date.now(), result });
      if (analyzeCache.size > 100) analyzeCache.delete(analyzeCache.keys().next().value);
      return send(res, 200, JSON.stringify({ ok: true, ...tilePayload(result) }));
    }
    if (u.pathname === '/api/moments/save' && req.method === 'POST') {
      const body = await readJSONBody(req);
      const { video, moment } = body || {};
      if (!video?.id || !moment) return send(res, 200, JSON.stringify({ error: 'missing video/moment' }));
      const item = analyzedToMoment(video, moment);
      { const e = enrichMoment(item); item.meta = { ...(item.meta||{}), ...e }; }
      await ingestMoments([item]);
      setItems('moments', vaultItems()); // refresh the vault section immediately
      return send(res, 200, JSON.stringify({ ok: true, id: item.id }));
    }
    if (u.pathname === '/api/toplist' && req.method === 'GET') {
      const topic = (u.searchParams.get('topic') || '').slice(0, 100).trim();
      const count = Math.min(20, Math.max(3, +(u.searchParams.get('count') || 5)));
      if (!topic) return send(res, 200, JSON.stringify({ error: 'Enter a topic, e.g. "Joe Rogan quotes" or "Solo Leveling fights".' }));
      const key = topic.toLowerCase() + '|' + count;
      const cached = scanCache.get('tl:' + key);
      if (cached && Date.now() - cached.ts < 2 * 3.6e6) return send(res, 200, JSON.stringify({ ok: true, cached: true, ...cached.result }));
      const hour = Math.floor(Date.now() / 3.6e6);
      if (hour !== scanHour) { scanHour = hour; scanCount = 0; }
      if (scanCount >= 25) return send(res, 200, JSON.stringify({ error: 'Hourly search budget reached (shared with deep scans) — try again soon.' }));
      scanCount++;
      const trends = (store.sections.get('trends')?.items || []).map((t) => t.title);
      const news = (store.sections.get('news')?.items || []).map((n) => n.title);
      const result = await buildTopList(env, topic, { trendsTitles: trends, newsTitles: news, count });
      scanCache.set('tl:' + key, { ts: Date.now(), result });
      return send(res, 200, JSON.stringify({ ok: true, ...result }));
    }
    if (u.pathname === '/api/analyze-meta' && req.method === 'GET') {
      const videoId = parseVideoId(u.searchParams.get('url') || u.searchParams.get('v') || '');
      if (!videoId) return send(res, 200, JSON.stringify({ error: 'Paste a valid YouTube URL.' }));
      const result = await analyzeMeta(videoId);
      return send(res, 200, JSON.stringify({ ok: true, result }));
    }
    if (u.pathname === '/api/analyze-with-transcript' && req.method === 'POST') {
      const body = await readJSONBody(req);
      const videoId = parseVideoId(body?.url || body?.videoId || '');
      if (!videoId) return send(res, 200, JSON.stringify({ error: 'missing video url/id' }));
      const trends = (store.sections.get('trends')?.items || []).map((t) => t.title).slice(0, 25);
      const result = await analyzeWithTranscript(videoId, body?.segments || [], trends);
      return send(res, 200, JSON.stringify({ ok: true, result }));
    }
    if (u.pathname === '/api/vault' && req.method === 'GET') {
      const items = vaultItems();
      return send(res, 200, JSON.stringify({ ok: true, items, facets: buildFacets(items),
        compilations: buildCompilations(items),
        trendingAgain: trendingAgain(items, (store.sections.get('trends')?.items || []).map((t) => t.title)),
        series: detectSeries(items) }));
    }
    if (u.pathname === '/api/vault/search' && req.method === 'GET') {
      const q = (u.searchParams.get('q') || '').trim();
      const items = vaultItems().filter((m) => matchesQuery(m, q));
      return send(res, 200, JSON.stringify({ ok: true, q, items, facets: buildFacets(items) }));
    }
    if (u.pathname === '/api/scan' && req.method === 'GET') {
      if (!youtube.youtubeConfigured(env)) {
        return send(res, 200, JSON.stringify({ error: 'Deep scan needs YOUTUBE_API_KEY in .env' }));
      }
      const q = (u.searchParams.get('q') || '').slice(0, 120).trim();
      if (!q) return send(res, 200, JSON.stringify({ error: 'missing query' }));
      const key = q.toLowerCase();
      const cached = scanCache.get(key);
      if (cached && Date.now() - cached.ts < 2 * 3.6e6) {
        return send(res, 200, JSON.stringify(cached.result));
      }
      const hour = Math.floor(Date.now() / 3.6e6);
      if (hour !== scanHour) { scanHour = hour; scanCount = 0; }
      if (scanCount >= 25) {
        return send(res, 200, JSON.stringify({ error: 'Scan quota reached for this hour — try again soon (protects your YouTube API quota).' }));
      }
      scanCount++;
      const result = await youtube.deepScan(env, q);
      scanCache.set(key, { ts: Date.now(), result });
      if (scanCache.size > 300) scanCache.delete(scanCache.keys().next().value);
      return send(res, 200, JSON.stringify(result));
    }
    if (u.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
      const unsub = subscribe((data) => res.write(`data: ${data}\n\n`));
      const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
      req.on('close', () => {
        clearInterval(ping);
        unsub();
      });
      return;
    }
    return await staticFile(res, u.pathname);
  } catch (e) {
    send(res, 500, JSON.stringify({ error: String(e?.message || e) }));
  }
});

await startScheduler(env);
server.listen(PORT, () => {
  console.log('');
  console.log('⚡ TrendPulse is live — 100% real data, zero simulation');
  console.log(`   Dashboard  →  http://localhost:${PORT}`);
  console.log(`   SSE stream →  http://localhost:${PORT}/api/events`);
  console.log('');
  console.log('   Sources:');
  console.log(`   • YouTube ${env.YOUTUBE_API_KEY ? 'LIVE (creators + trending videos + search)' : 'NOT CONNECTED — add YOUTUBE_API_KEY to .env'}`);
  console.log(`   • Twitch  ${env.TWITCH_CLIENT_ID ? 'LIVE (creator live status + top games)' : 'NOT CONNECTED — add TWITCH_CLIENT_ID/SECRET to .env'}`);
  console.log(`   • Reddit  ${env.REDDIT_CLIENT_ID ? 'LIVE (OAuth)' : 'public JSON (add credentials for reliability)'}`);
  console.log('   • Google Trends, Apple Podcasts, Steam, news RSS — always live, no keys needed');
  console.log('');
});
