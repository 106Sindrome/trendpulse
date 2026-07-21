# ⚡ TrendPulse

**TrendPulse tells you exactly what to clip before everyone else does.**

It watches YouTube, Twitch, Reddit, Google Trends, Steam and breaking news in real time, detects exploding moments, scores them by viral potential, and tells you **what to turn into Shorts, Reels and TikToks before the trend peaks.**

Most trend tools answer *"what's trending?"* — TrendPulse answers the only question Shorts creators actually ask:

> **"What clip can I upload in the next 20 minutes that has the highest chance of getting views?"**

The homepage leads with 🔥 **Best Right Now** — a ranked list of opportunities, each with:

```
#1  Kai Cenat — "KAI REACTS TO GTA 6 TRAILER"
    🟢 94% clip confidence   🚀 Exploding   ▲▲▲ momentum
    +1.4M views/hr · uploaded 18 min ago · first detected 18 min ago
    ⏳ Post within ~2h · best length 15–30s
    💬 "Kai wasn't expecting this… 😳"  ·  #shorts #kaicenat #gta6
    [📋 Copy clip plan]  [🔍 Deep scan]
```

- **Clip Confidence** (0–99) from real live signals — velocity, scale, freshness, stage.
- **Trend lifecycle**: 🔍 Detected → 📈 Growing → 🚀 Exploding → ⛰️ Peak → 📉 Declining — know if you're early or late.
- **First Seen** timestamps (persisted) — creators love being first; now you can prove you were.
- **Momentum arrows** — growth matters more than total views.
- **Hooks + hashtags + best clip length** on every opportunity, and a one-click **📋 clip plan** (timestamp, hooks, hashtags) for your editor notes.
- **🔍 Deep scan** — real YouTube data: how many Shorts already cover this (**competition: LOW/MEDIUM/HIGH**) and the biggest similar Shorts (format validation: "12M · 8.2M · 4.5M views — the format works").
- **Real timestamps where they exist** — Twitch clips carry their VOD offset ("⏱ clip starts at 1:02:34 · 32s").
- **🏆 Moment Vault = the intelligence layer.** Every saved moment is auto-enriched with searchable metadata (creator, game, event, sport, people, teams, **emotion**, **moment type**, **tags**) + a **10-dimension score model** (virality · evergreen · emotion · replayability · competition · meme potential · clip/audio/visual quality · editing difficulty). It **self-clusters** like a personal Plex library (facet rail + smart filters like *Unused high-viral* + natural-language search), and the **💡 AI Compilation Engine** scans it first to propose compilations you can build *today* — *"Top 5 Funniest Kai Reactions"*, *"Top 10 World Cup Goals"* — detecting series and resurfacing old clips when trends return.
- **💡 Top-5 ideas** generated from real evidence, including vault-backed ones ("the clips are already in your vault").
- **🎯 Creator watchlist** — Speed, Kai Cenat, Joe Rogan, MrBeast, xQc, Sidemen, KSI, Logan Paul, Pokimane, HasanAbi + anyone you add.

### A note on Competition scores
The per-card competition chip is an **estimate from real signals that cost no API quota**: cross-source saturation (how many of your live sections already cover the same entity), Google Trends volume, Reddit community size, and niche-category effects. Every estimate shows its reasoning on hover, and the **🔍 Deep Scan** button verifies it against real YouTube Shorts counts on demand.

### Honesty guarantee
**Zero simulated data, ever.** Every number is real. Model outputs (confidence, lifetime, stage, hooks, moment scores) are clearly labelled estimates computed *from* real signals — the analyzer's "why" list shows each real signal behind every score. If a source needs a key you haven't added, you see a setup card — never fake numbers. If the analyzer can't reach captions/heatmap from your network, it tells you and falls back to chapters with a warning instead of guessing. Deferred by design (needs heavier stacks): audio-level detection (screams/applause via ML), auto-editing (ffmpeg 9:16 crops + captions), and one-click publishing — the clip-kit export (timestamps + SRT + title + hashtags) is the bridge to CapCut today.

### Roadmap status
- **Phase 1 — Discovery** ✅ (trends, creators, games, news, ranked opportunities)
- **Phase 2 — Video Intelligence** ✅ (paste URL → top moments with timestamps, scores, reasons, real frames)
- **Phase 2.5 — Opportunity Rankings + AI Top Lists** ✅ (ranked Top-5 homepage, evidence-transparent, topic → ranked list + creator kit + exports)
- **Phase 3 — Production** ✅ mostly (titles, hooks, hashtags, subtitles, clip-kit export, competition, scripts/blog/outline exports) · ⏳ thumbnail-expression analysis
- **Phase 4 — One-click Publishing** ⏳ (auto-edit + publish needs ffmpeg + platform OAuth — different stack)

---

## 🚀 Quick start

```bash
cp .env.example .env       # (or use the included .env)
docker compose up --build
```

Open **http://localhost:3000**. Without keys you already get real data: Google Trends, Apple Podcasts, Steam player counts, news (DEXERTO, PC Gamer, Eurogamer, The Verge, IGN) and Reddit (public JSON). Add keys for the full experience:

| Variable | Unlocks |
|---|---|
| `YOUTUBE_API_KEY` | **Creator Watchlist** (real uploads, views, likes, velocity for every creator), **Trending Videos**, YouTube search. [Get it](https://console.cloud.google.com/apis/library/youtube.googleapis.com) (enable *YouTube Data API v3*). Quota use ≈ 8K of your 10K/day. |
| `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET` | **LIVE badges** on creators (real viewer counts when they stream), trending Twitch game categories. [Get them](https://dev.twitch.tv/console/apps) — app-token flow is automatic. |
| `REDDIT_CLIENT_ID` / `_SECRET` / `_USERNAME` / `_PASSWORD` | Reliable Reddit via OAuth script app ([create one](https://www.reddit.com/prefs/apps)). Optional — public JSON works without keys. |
| `GEO` | Region for Google Trends + YouTube (e.g. `US`, `PT`). |

---

## 🧭 The dashboard

**🕐 Window tabs — Last 24 hours / Last 7 days** sit above the whole dashboard and filter every section (creator uploads, trending videos, Reddit, news). Games, podcasts and Google Trends are "live now" feeds and show in both.

| Section | What it shows (all real) |
|---|---|
| 🎬 **Video Analyzer** | **Paste any YouTube URL** → the tool finds the moments worth clipping inside it: **YouTube's real "most replayed" retention peaks** × **real captions** (laughter, applause, exclamations, facts, pacing) × cross-check against **live Google Trends**. Each opportunity: timestamp range (9:42–10:08), score with transparent ✓ reasons ("rewatch spike — 90% of peak", "laughter detected 2×", "mentions trending topic 'World Cup 2026'"), suggested title, hooks, hashtags, best length & platform, **real preview frame at that timestamp**, ▶ preview-embed starting exactly there, **real .srt subtitle download**, clip-kit export, 🔍 competition scan, and 💾 one-tap save to the Vault. Renders the full **retention heatmap** (editor-mode timeline with 🔥😂 markers). Zero keys needed. |
| 🔥 **Opportunity Rankings** | The homepage experience — five ranked Top-5 lists recomputed from live data every few minutes: **🏆 Right Now** (overall strongest), **📈 Rising** (fastest acceleration, pre-peak), **💎 Hidden Gems** (high potential × low competition), **⏰ About To Peak** (high momentum + short remaining window — "post within 2h/6h/today"), **📦 From Your Vault** (vaulted moments re-matched against today's trends). Every card: Opportunity Score, trend stage, First Seen, post-within, competition chip, best formats, hooks, and — for #1 — a full **"Why ranked #1"** evidence list. Filter by 13 categories (Creators, Gaming, Sports, News, AI, Tech, Anime, Manga, Manhwa, Manhua, Web Novels, Light Novels…) and rerank by 11 modes (score, growth, lowest competition, newest, longest lifetime, engagement, most discussed, best for faceless/Shorts/Reels/TikTok). |
| 🏆 **AI Top Lists** | Enter any topic — "Joe Rogan quotes", "Solo Leveling fights", "World Cup goals" — and get an evidence-ranked Top 5/7/10 built from **real** YouTube views, Reddit upvotes/discussion, live Google Trends and tracked news. Each item: rank, why it deserves the position, popularity, discussion level, related videos, suggested Shorts ideas, hooks, thumbnail idea. Plus a **creator kit** (titles, hooks, intro, hashtags, thumbnail text, description, SEO keywords) and 6 exports: **Markdown · PDF · Script · Blog article · Shorts outline · JSON**. |
| 🎯 **Creator Watchlist** | Speed, Kai Cenat, Joe Rogan, MrBeast, xQc, Sidemen, KSI, Logan Paul, Pokimane, HasanAbi — latest uploads with **real views/likes/comments and velocity (views/hr)**, LIVE badge when they're streaming on Twitch. **Add any creator** from the card header (`@handle` or name → resolved via YouTube API, persisted). Remove custom ones with ✕. |
| 💡 **Top 5 Clip Ideas** | Generated from the live data: "Top 5 Speed moments this week" (evidence: his real uploads + views), "Clip this video NOW" when velocity spikes, "Top 5 outfield players as goalkeepers" & "Top 5 moments of the 2026 World Cup" when football is trending, **vault-backed compilations** ("Top 5 goals of the 2026 Mundial — the clips are already in your vault"), "Top 5 {game} clips to post this week", "5 things you missed: {breaking headline}", Reddit debate-bait. Each idea shows format tags (Shorts/Reels/TikTok), difficulty, real evidence and source links. |
| 🏆 **Moment Vault** | The **intelligence layer**, not storage. Each moment auto-tags by **emotion / moment-type / game / event / people / teams / tags** and carries a **10-score model** (virality, evergreen, emotion, replayability, competition, meme potential, clip/audio/visual quality, editing difficulty — all estimates). UI = a **media library**: left facet rail (creators, games, events, emotions, types, tags, sports) + **smart filters** (Unused, Unused high-viral, Unused this week, Unused >90, Evergreen, Hidden gems) + **search** (`funny kai`, `world cup goals`). Drawer shows the full score breakdown + a "mark as used" toggle. |
| 💡 **AI Compilation Engine** | **Vault-first**: clusters your clips into ready compilations (*"Top 5 Funniest Kai Reactions"*, *"Best of IShowSpeed"*) with clip count, est. duration, difficulty, trend + evergreen scores and **Open / Copy order / Script / Titles / Hooks / Export**. **Series detection** ("Kai Reacts ep 1–N") + **trend-matching** (old clips trending again). Evidence-based live ideas only fill in when the Vault is sparse. |
| 🎥 **Trending Videos** | YouTube's most-viewed recent videos (gaming first), view velocity refreshed every 3 minutes. |
| 🔎 **Trending Topics** | Google Trends daily trending searches with traffic numbers + related news. |
| 💬 **Reddit** | Gaming/creator multireddit — hot, rising, and top-of-the-week posts with upvote velocity. |
| ⚡ **News** | DEXERTO (creator culture), PC Gamer, Eurogamer, The Verge, IGN — freshest first. |
| 🎮 **Trending Games** | Two real charts via the window tabs — **Today**: live player counts (official Steam API), weekly most-played rank with ▲▼ movement vs last week, Twitch live viewers; **This week**: Steam's real rolling top-sellers + hot new releases chart, merged with live players. Football (soccer) games — EA Sports FC, eFootball, Football Manager, Twitch's Football category — are flagged ⚽. |
| 🎙️ **Podcasts** | Apple Podcasts top-40 chart (find guests worth clipping — e.g. Rogan's latest episodes). |
| 📈 **Viral Radar** | Cross-section ranking of the strongest real opportunities. |

Also: **⌘K global search** (dashboard + YouTube/Twitch/Reddit APIs), **alerts** (🚨 creator just posted, 🚀 video exploding out of the gate, 📊 trend spike), **bookmarks**, per-card sorting, dark/light themes, embedded YouTube playback in the detail drawer.

---

## 🚨 Alerts you get (real events only)

- **New upload** from any watchlist creator (fires within ~12 min of publishing)
- **Velocity spike** — a fresh video passing 250K views/hr
- **Trend spike** — a Google Trends topic crossing 10K searches
- **Viral moment** — a freshly vaulted clip already past 150K views

---

## 🏗️ Architecture

```
server/
├── adapters/          real data sources only
│   ├── youtube.js     trending search · channel/resolve · uploads · batched stats
│   ├── twitch.js      creator live status · top game categories
│   ├── reddit.js      hot + rising + top-of-week (OAuth or public JSON)
│   └── feeds.js       Google Trends RSS · Apple Podcasts · Steam · news RSS
├── creators.js        watchlist (defaults + data/watchlist.json) + snapshot builder
├── moments.js         Moment Vault collectors → persistent vault (data/moments.json)
├── metadata.js        Vault intelligence: lexicon tagging (emotion/type/tags), entity extraction, 10-score model, NL search, facets
├── compilations.js    AI Compilation Engine: cluster Vault → ready compilations, series detection, trend-matching
├── analyze.js         Video Intelligence: watch-page scrape + captions + retention heatmap → scored clip moments
├── opportunity.js     Opportunity engine: confidence, stage, first-seen, momentum, competition estimate, five rankings
├── toplists.js        AI Top Lists: topic → evidence-ranked list + creator kit (YouTube + Reddit + Trends + News)
├── ideas.js           Top-5 ideas engine (pure function of live data + vault)
├── scoring.js         Viral Score: 30% velocity · 25% growth · 20% scale · 15% engagement · 10% freshness
├── scheduler.js       producer registry, intervals, history/growth, alerts
└── index.js           HTTP + SSE (/api/events, /api/snapshot, /api/search, /api/watchlist)
```

**Add a source** = one producer in `scheduler.js` returning normalized items (`server/items.js`). Scoring, windows, SSE push, search and UI adapt automatically. **Custom watchlist entries** persist to `data/watchlist.json` (mount it as a volume in production — compose already maps `./data:/app/data` if you add it).

### Quota budgeting (YouTube, 10K units/day)
Creator uploads refresh every 12 min (playlistItems = 1 unit/creator + one batched stats call), trending search every 25 min (100 units) with cheap 1-unit stats refreshes every 3 min. Total ≈ 8K/day — search on demand uses the remainder.

---

## 🗺️ What's intentionally absent
No live-streams ranking (this is about **creators and their content**), no Kick/TikTok/X sections (no usable public APIs — rather than fake them, they're excluded), no simulated numbers anywhere. If TikTok Research / X API access lands later, each is one adapter away.
