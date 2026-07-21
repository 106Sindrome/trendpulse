// ─────────────────────────────────────────────────────────────
// Vault intelligence layer — derives rich, searchable metadata
// for every saved moment from REAL signals (title + transcript +
// known entities + engagement). All classifications are lexicon /
// heuristic based and labelled as model estimates in the UI.
// ─────────────────────────────────────────────────────────────

// ── Lexicons (keyword → facet) ───────────────────────────────
export const EMOTION_LEX = {
  shock: ['shock', 'shocked', 'omg', 'oh my god', 'wait what', 'no way', 'unbelievable', 'insane', 'crazy', 'wtf', 'bro what', 'are you serious', 'holy', 'speechless'],
  joy: ['happy', 'joy', 'love', 'wholesome', 'sweet', 'beautiful', 'amazing', 'awesome', 'yay', 'heartwarming', 'feel good', 'blessed'],
  anger: ['angry', 'rage', 'rage quit', 'pissed', 'furious', 'toxic', 'mad', 'outrage', 'livid', 'screaming at', 'this is bullshit'],
  fear: ['scary', 'horror', 'terrified', 'creepy', 'jumpscare', 'afraid', 'nightmare', 'spooky', 'haunted', 'panic'],
  sadness: ['sad', 'crying', 'tears', 'emotional', 'heartbreak', 'depressing', 'tearjerker', 'miss you', 'goodbye'],
  excitement: ['hype', 'hyped', 'lets go', "let's go", 'epic', 'legendary', 'goated', 'insane play', 'pog', 'poggers', 'clutch'],
  suspense: ['suspense', 'tense', 'cliffhanger', 'will he', 'plot twist', 'wait for it', 'hold on', 'oh no'],
  humor: ['funny', 'laugh', 'lmao', 'lol', 'hilarious', 'joke', 'meme', 'comedic', 'crack me up', 'dead', '💀'],
};

export const MOMENT_TYPE_LEX = {
  reaction: ['react', 'reaction', 'reacts to', 'watching', 'first time'],
  clutch: ['clutch', '1v', 'ace', 'comeback', 'insane play', 'outplay', 'god'],
  fail: ['fail', 'funny fail', 'mess up', 'disaster', 'worst', 'embarrassing'],
  goal: ['goal', 'scored', 'strike', 'header', 'tap in', 'volley', 'bicycle'],
  save: ['save', 'goalkeeper', 'keeper', 'gk', 'stop', 'reflex'],
  penalty: ['penalty', 'pen', 'spot kick'],
  freekick: ['free kick', 'free-kick', 'set piece'],
  celebration: ['celebration', 'celebrates', 'dab', 'siu', 'dance'],
  redcard: ['red card', 'sent off', 'sending off', 'var'],
  speedrun: ['speedrun', 'world record', 'wr', 'any%', 'fastest'],
  bossfight: ['boss', 'boss fight', 'final boss', 'defeat'],
  pvp: ['pvp', 'duel', '1v1', 'eliminat'],
  donation: ['donation', 'tip', 'bits', 'subscribe', 'sub gift'],
  wholesome: ['wholesome', 'kind', 'heartwarming', 'sweet moment'],
  rage: ['rage', 'rage quit', 'angry', 'furious', 'smash'],
  lucky: ['lucky', 'rng', 'crit', 'miracle', 'somehow'],
  bug: ['bug', 'glitch', 'exploit', 'broken', 'easter egg', 'secret'],
};

// facet tag groups (each becomes a searchable tag when its keywords hit)
export const TAG_LEX = {
  // gaming
  funny: ['funny', 'laugh', 'lmao', 'lol', 'hilarious', 'meme', 'comedy'],
  rage: ['rage', 'rage quit', 'angry', 'furious'],
  clutch: ['clutch', '1v', 'ace', 'comeback', 'insane play'],
  speedrun: ['speedrun', 'world record', 'any%'],
  bossfight: ['boss fight', 'final boss', 'boss'],
  pvp: ['pvp', '1v1', 'duel'],
  fails: ['fail', 'mess up', 'disaster'],
  lucky: ['lucky', 'rng', 'crit', 'miracle'],
  bugs: ['bug', 'glitch', 'exploit', 'easter egg', 'secret'],
  // football
  goals: ['goal', 'scored', 'strike', 'header'],
  owngoals: ['own goal', 'own-goal'],
  longshots: ['long shot', 'long-range', 'from distance', 'screamer'],
  saves: ['save', 'goalkeeper', 'keeper', 'reflex'],
  penalties: ['penalty', 'pen', 'spot kick'],
  freekicks: ['free kick', 'free-kick', 'set piece'],
  celebrations: ['celebration', 'celebrates', 'siu', 'dab'],
  redcards: ['red card', 'sent off', 'var'],
  crowdreactions: ['crowd', 'stadium', 'fans', 'chant'],
  // streamers
  reactions: ['react', 'reaction', 'reacts'],
  laughing: ['laugh', 'laughing', 'cracking up', 'lmao'],
  emotional: ['emotional', 'crying', 'tears', 'heartfelt'],
  toxic: ['toxic', 'tilt', 'flame'],
  donations: ['donation', 'tip', 'bits'],
  chatmoments: ['chat', 'tts', 'text to speech'],
  crazymoments: ['crazy', 'wild', 'insane moment', 'unhinged'],
  // general viral
  wtf: ['wtf', 'what the', 'bizarre', 'unbelievable'],
  satisfying: ['satisfying', 'oddly satisfying', 'asmr', 'perfect'],
  inspirational: ['inspirational', 'motivation', 'motivational', 'never give up'],
  cute: ['cute', 'adorable', 'wholesome', 'aww'],
  scary: ['scary', 'horror', 'creepy', 'jumpscare'],
  cringe: ['cringe', 'awkward', 'secondhand'],
  plottwist: ['plot twist', 'twist', 'unexpected ending'],
  unexpected: ['unexpected', 'surprise', 'out of nowhere'],
};

// evergreen vs trend-bound signals
const EVERGREEN_WORDS = ['funny', 'laugh', 'fail', 'clutch', 'satisfying', 'wholesome', 'cute', 'scary', 'goal', 'save', 'speedrun', 'boss', 'reaction', 'meme', 'compilation', 'best of', 'top'];
const TREND_BOUND_WORDS = ['trailer', 'reveal', 'announcement', 'update', 'patch', 'news', 'release', 'leak', 'rumor', 'breaking', 'today', '2026', '2025', 'world cup', 'worlds', 'vct', 'season'];

// known entities (expandable; matched as whole words)
const PEOPLE = ['kai cenat', 'ishowspeed', 'speed', 'mrbeast', 'xqc', 'pokimane', 'hasan', 'asmongold', 'jynxzi', 'caseoh', 'logan paul', 'ksi', 'joe rogan', 'rogan', 'markiplier', 'jacksepticeye', 'dream', 'tenz', 'shroud', 'tarik', 'ludwig', 'sidemen', 'lando', 'norris', 'messi', 'ronaldo', 'mbappe', 'haaland', 'neymar'];
const TEAMS = ['real madrid', 'barcelona', 'manchester city', 'manchester united', 'liverpool', 'arsenal', 'chelsea', 'psg', 'bayern', 'juventus', 'inter', 'milan', 'dortmund', 'atletico', 'napoli', 'tottenham', 'spurs', 'england', 'spain', 'argentina', 'brazil', 'france', 'portugal', 'germany', 'morocco'];
const GAMES = ['gta 6', 'gta vi', 'gta v', 'fortnite', 'valorant', 'minecraft', 'roblox', 'league of legends', 'lol', 'counter-strike', 'cs2', 'csgo', 'apex legends', 'apex', 'elden ring', 'overwatch', 'rocket league', 'dota', 'ea fc', 'ea sports fc', 'fifa', 'efootball', 'football manager', 'cod', 'call of duty', 'warzone', 'world of warcraft', 'wow', 'zelda', 'mario', 'hollow knight', 'helldivers', 'palworld', 'lethal company'];
const SPORTS = ['football', 'soccer', 'world cup', 'mundial', 'champions league', 'premier league', 'la liga', 'nba', 'nfl', 'ufc', 'f1', 'formula 1', 'tennis', 'boxing'];

function norm(t) { return String(t || '').toLowerCase(); }
function hitAny(text, words) { return words.filter((w) => text.includes(w)); }

export function detectEmotions(t) {
  const text = norm(t);
  const out = {};
  for (const [emo, words] of Object.entries(EMOTION_LEX)) {
    const h = hitAny(text, words);
    if (h.length) out[emo] = Math.min(1, 0.4 + h.length * 0.3);
  }
  return out;
}
export function detectMomentType(t) {
  const text = norm(t);
  let best = null, bestN = 0;
  for (const [type, words] of Object.entries(MOMENT_TYPE_LEX)) {
    const h = hitAny(text, words);
    if (h.length > bestN) { bestN = h.length; best = type; }
  }
  return best || 'highlight';
}
export function detectTags(t) {
  const text = norm(t);
  const tags = [];
  for (const [tag, words] of Object.entries(TAG_LEX)) if (hitAny(text, words).length) tags.push(tag);
  return tags;
}
export function extractEntities(t) {
  const text = norm(t);
  return {
    people: PEOPLE.filter((p) => text.includes(p)),
    teams: TEAMS.filter((x) => text.includes(x)),
    games: GAMES.filter((g) => text.includes(g)),
    sports: SPORTS.filter((s) => text.includes(s)),
  };
}

// ── Multi-score model (0–100, each labelled an estimate) ─────
export function computeScores(m, enrichment) {
  const mt = m.metrics || {};
  const md = m.meta || {};
  const text = norm(`${m.title} ${md.creator} ${md.game} ${md.event} ${(enrichment.tags || []).join(' ')} ${(enrichment.emotions ? Object.keys(enrichment.emotions) : []).join(' ')}`);
  const views = mt.views || 0;
  const likes = mt.likes || 0;
  const comments = mt.comments || 0;
  const vel = mt.velocity || 0;
  const eng = views > 0 ? (likes + comments * 3) / views : 0;

  const virality = clamp(Math.round((mt.score || 0) * 0.5 + Math.min(50, Math.log10(vel + 1) * 9) + Math.min(30, eng * 600)));
  const emotion = clamp(Math.round((enrichment.emotionIntensity || 0) * 70 + (enrichment.emotions?.excitement || 0) * 30));
  const replay = clamp(Math.round((enrichment.tags?.includes('funny') ? 45 : 0) + (enrichment.tags?.includes('satisfying') ? 35 : 0) + (enrichment.tags?.includes('clutch') ? 30 : 0) + (enrichment.tags?.includes('cute') ? 25 : 0) + Math.min(20, eng * 300)));
  const meme = clamp(Math.round((enrichment.tags?.includes('funny') ? 40 : 0) + (enrichment.tags?.includes('wtf') ? 40 : 0) + (enrichment.tags?.includes('cringe') ? 25 : 0) + (enrichment.emotions?.shock || 0) * 30 + (enrichment.emotions?.humor || 0) * 30));
  const evergreen = clamp(Math.round(evergreenSignal(text) * 100));
  const competition = typeof md.competitionScore === 'number' ? md.competitionScore : 50;
  // quality proxies (no real A/V analysis possible) — engagement + source reputation
  const srcBonus = { 'Twitch': 6, 'YouTube': 8, 'analyzer': 4 }[m.platform] ?? 3;
  const clipQuality = clamp(Math.round(Math.min(70, eng * 900) + srcBonus + 18));
  const audioQuality = clamp(Math.round(45 + srcBonus + (m.platform === 'YouTube' ? 12 : 0)));
  const visualQuality = clamp(Math.round(45 + srcBonus + (views > 500000 ? 10 : 0)));
  const len = md.duration || 0;
  const editingDifficulty = clamp(Math.round(len > 90 ? 75 : len > 45 ? 55 : len > 20 ? 35 : 20));

  return { virality, evergreen, emotion, replayability: replay, competition, memePotential: meme, clipQuality, audioQuality, visualQuality, editingDifficulty };
}
function evergreenSignal(text) {
  const ev = hitAny(text, EVERGREEN_WORDS).length;
  const tb = hitAny(text, TREND_BOUND_WORDS).length;
  return Math.max(0, Math.min(1, 0.4 + ev * 0.18 - tb * 0.22));
}
const clamp = (n) => Math.max(0, Math.min(100, n));

// ── One-shot enrichment ──────────────────────────────────────
export function enrichMoment(m) {
  const md = m.meta || {};
  const text = `${m.title || ''} ${md.creator || ''} ${md.game || ''} ${md.event || ''} ${md.category || ''}`;
  const emotions = detectEmotions(text);
  const emotionIntensity = Math.max(0, ...Object.values(emotions), 0);
  const momentType = md.momentType || detectMomentType(text);
  const tags = [...new Set([...(md.tags || []), ...detectTags(text)])];
  const ent = extractEntities(text);
  const people = [...new Set([...(md.people || []), ...ent.people])];
  const teams = [...new Set([...(md.teams || []), ...ent.teams])];
  const games = [...new Set([...(md.games || []), ...ent.games])];
  const sports = [...new Set([...(md.sports || []), ...ent.sports])];
  const enrichment = { emotions, emotionIntensity, tags };
  const scores = computeScores(m, enrichment);
  return { emotions, emotionIntensity, momentType, tags, people, teams, games, sports, scores };
}

// ── Smart natural-language-ish search (token + lexicon expansion) ──
export function matchesQuery(m, query) {
  const q = norm(query).trim();
  if (!q) return true;
  const md = m.meta || {};
  const hay = norm(`${m.title} ${md.creator} ${md.game} ${md.event} ${md.sport} ${md.category} ${(md.tags || []).join(' ')} ${(md.people || []).join(' ')} ${(md.teams || []).join(' ')} ${(md.games || []).join(' ')} ${(md.sports || []).join(' ')} ${md.momentType} ${Object.keys(md.emotions || {}).join(' ')}`);
  const tokens = q.split(/\s+/).filter((t) => t.length > 1);
  // expand query tokens via lexicons (so "funny" also matches humor lexicon words, etc.)
  const expanded = new Set(tokens);
  for (const tok of tokens) {
    if (TAG_LEX[tok]) TAG_LEX[tok].forEach((w) => expanded.add(w));
    if (EMOTION_LEX[tok]) EMOTION_LEX[tok].forEach((w) => expanded.add(w));
    if (MOMENT_TYPE_LEX[tok]) MOMENT_TYPE_LEX[tok].forEach((w) => expanded.add(w));
  }
  return [...expanded].some((w) => w.length > 1 && hay.includes(w));
}

// ── Facet counts for the library rail ────────────────────────
export function buildFacets(moments) {
  const facet = (keyFn) => {
    const c = {};
    for (const m of moments) for (const k of keyFn(m)) c[k] = (c[k] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  };
  const md = (m) => m.meta || {};
  return {
    creator: facet((m) => md(m).creator ? [md(m).creator] : []),
    game: facet((m) => md(m).games?.length ? md(m).games : (md(m).game ? [md(m).game] : [])),
    event: facet((m) => md(m).event ? [md(m).event] : []),
    emotion: facet((m) => Object.keys(md(m).emotions || {})),
    momentType: facet((m) => md(m).momentType ? [md(m).momentType] : []),
    tag: facet((m) => md(m).tags || []),
    sport: facet((m) => md(m).sports?.length ? md(m).sports : (md(m).sport ? [md(m).sport] : [])),
  };
}
