// Rough language detection from a string of text (title/description).
// Uses distinctive stopword sets — not perfect, but good enough as a fallback
// when defaultAudioLanguage and channel.country are both missing.
export function detectLanguageFromText(text) {
  if (!text) return null;
  const lower = " " + String(text).toLowerCase().replace(/[^\p{L}\s]/gu, " ") + " ";
  const patterns = {
    en: /\b(the|is|are|was|were|will|would|can|what|when|where|why|how|this|that|with|have|has|you|your|my|just|about|here|there|like|would|could|should|if)\b/g,
    pt: /\b(de|do|da|dos|das|que|para|com|por|em|na|no|nas|nos|uma|uns|umas|são|foi|seu|sua|você|tem|estão|também|mais|sobre|este|isso|esse|aquele|pelo|pela)\b/g,
    es: /\b(el|la|los|las|del|que|para|por|con|una|son|fue|tu|su|esto|esta|este|esa|ese|aquel|pero|también|sobre|muy|hacia)\b/g,
    fr: /\b(le|la|les|des|que|pour|avec|une|sont|été|votre|notre|cette|ces|aussi|très|mais|chez|tout)\b/g,
    de: /\b(der|die|das|den|dem|des|eine|einen|einem|ist|sind|war|haben|nicht|auch|sehr|aber|wenn|nach|über)\b/g,
    ja: /[ぁ-んァ-ヶー一-龯]/g,
    ko: /[가-힣]/g,
    zh: /[一-鿿]/g,
    ar: /[؀-ۿ]/g,
    hi: /[ऀ-ॿ]/g,
    ru: /[а-яА-Я]/g
  };

  let bestLang = null;
  let bestCount = 0;
  for (const [lang, pat] of Object.entries(patterns)) {
    const matches = (lower.match(pat) || []).length;
    // Different thresholds: stopwords need 2+, scripts (single chars) need 4+
    const threshold = ["ja", "ko", "zh", "ar", "hi", "ru"].includes(lang) ? 4 : 2;
    if (matches >= threshold && matches > bestCount) {
      bestCount = matches;
      bestLang = lang;
    }
  }
  return bestLang;
}

// Maps a video's defaultAudioLanguage (e.g. "en-US", "pt") to the most likely
// YouTube market country code. Used to auto-switch the displayed region when
// the video isn't in the user's local Top 50.
export function suggestCountryFromLanguage(lang) {
  if (!lang) return null;
  const lower = String(lang).toLowerCase();
  const full = {
    "en-us": "US", "en-gb": "GB", "en-ca": "CA", "en-au": "AU",
    "pt-br": "BR", "pt-pt": "PT",
    "es-mx": "MX", "es-es": "ES", "es-ar": "AR",
    "zh-tw": "TW", "zh-hk": "TW", "zh-cn": "TW"
  };
  if (full[lower]) return full[lower];
  const base = lower.split("-")[0];
  const baseMap = {
    en: "US", pt: "BR", es: "MX", fr: "FR", de: "DE", it: "IT",
    nl: "NL", ja: "JP", ko: "KR", zh: "TW", hi: "IN", ar: "SA",
    ru: "RU", tr: "TR", pl: "PL", id: "ID", vi: "VN", th: "TH",
    uk: "UA"
  };
  return baseMap[base] || null;
}

export function findVideoRank(videoId, topVideos) {
  const index = topVideos.findIndex((v) => v.id === videoId);
  return index === -1 ? null : index + 1;
}

// Returns a range string — NEVER a single number (prevents "Top 2" trust bug)
export function estimateRankByViews(currentViews, topVideos) {
  const sorted = topVideos.map((v) => Number(v.statistics.viewCount));
  const rank50 = sorted[sorted.length - 1];

  if (currentViews >= rank50) return "Top 50+";

  const ratio = rank50 / Math.max(currentViews, 1);

  if (ratio <= 1.15) return "Top 51–60";
  if (ratio <= 1.4)  return "Top 60–80";
  if (ratio <= 1.8)  return "Top 80–120";
  if (ratio <= 2.5)  return "Top 120–200";
  if (ratio <= 4)    return "Top 200–500";
  return "500+";
}

export function calculateViewsNeeded(currentViews, topVideos) {
  const rank50Views = Number(topVideos[topVideos.length - 1]?.statistics?.viewCount || 0);
  return Math.max(0, rank50Views - currentViews);
}

// Real average hourly velocity across all Top 50 videos (dynamic benchmark)
function calcAvgTop50Velocity(topVideos) {
  const total = topVideos.reduce((acc, v) => {
    const views = Number(v.statistics?.viewCount || 0);
    const ageH  = Math.max((Date.now() - new Date(v.snippet?.publishedAt).getTime()) / 3_600_000, 1);
    return acc + views / ageH;
  }, 0);
  return Math.max(total / topVideos.length, 1);
}

// Weights: 20% volume (age-penalized), 45% velocity (vs real Top50 avg), 20% engagement, 15% recency
export function calculateViralScore(video, topVideos) {
  const views    = Number(video.statistics?.viewCount    || 0);
  const likes    = Number(video.statistics?.likeCount    || 0);
  const comments = Number(video.statistics?.commentCount || 0);

  const publishedAt = new Date(video.snippet?.publishedAt).getTime();
  const ageHours    = Math.max((Date.now() - publishedAt) / 3_600_000, 1);
  const viewsPerHour = views / ageHours;

  const rank50Views       = Number(topVideos[topVideos.length - 1]?.statistics?.viewCount || 1);
  const avgTop50Velocity  = calcAvgTop50Velocity(topVideos);
  const velocityRatio     = viewsPerHour / avgTop50Velocity;

  // Age penalty: at 30 days old, view score halved
  const agePenalty     = Math.min(ageHours / 720, 1);
  const adjustedViews  = views * (1 - agePenalty * 0.5);

  // 20% — age-penalized views vs Top 50 cutoff
  const viewScore = Math.min((adjustedViews / rank50Views) * 20, 20);

  // 45% — velocity normalized to real Top 50 average
  const velocityScore = Math.min(velocityRatio * 45, 45);

  // 20% — engagement with confidence factor (hidden likes / disabled comments)
  const likesHidden    = likes === 0;
  const commDisabled   = comments === 0;
  const confidence     = likesHidden && commDisabled ? 0.5 : (likesHidden || commDisabled) ? 0.75 : 1.0;
  const engagementRate = (likes + comments * 3) / Math.max(views, 1);
  const engagementScore = Math.min(engagementRate * 2000 * confidence, 20);

  // 15% — recency bonus, decays after 72h
  const recencyScore = ageHours <= 72
    ? 15
    : Math.max(0, 15 - (ageHours - 72) / 16);

  return Math.round(Math.min(viewScore + velocityScore + engagementScore + recencyScore, 100));
}

export function getMomentumTier(score) {
  if (score >= 80) return "exploding";
  if (score >= 60) return "viral";
  if (score >= 40) return "rising_fast";
  if (score >= 20) return "heating_up";
  return "cold";
}

const TIER_COLORS = {
  exploding:   "#ff0033",
  viral:       "#ff4400",
  rising_fast: "#ffab00",
  heating_up:  "#aaaaaa",
  cold:        "#555555"
};

export function getMomentumLabel(score, strings) {
  const tier     = getMomentumTier(score);
  const tiers    = strings?.tiers || {};
  const defaults = {
    exploding:   "🚀 Exploding",
    viral:       "🔴 Viral",
    rising_fast: "🟠 Rising Fast",
    heating_up:  "🟡 Heating Up",
    cold:        "⚫ Cold"
  };
  return { label: tiers[tier] || defaults[tier], color: TIER_COLORS[tier], tier };
}

// Burst detection: last hour is 2.5× the 6h average AND at least 500 new views
export function detectBurst(history) {
  if (!history || history.length < 3) return false;
  const latest = history[history.length - 1];

  const findBefore = (msAgo) => {
    const target  = latest.ts - msAgo;
    const window  = 20 * 60_000;
    let best = null;
    for (const s of history) {
      if (s === latest) continue;
      if (s.ts <= target + window && (!best || Math.abs(s.ts - target) < Math.abs(best.ts - target))) best = s;
    }
    return best;
  };

  const snap1h = findBefore(3_600_000);
  const snap6h = findBefore(6 * 3_600_000);
  if (!snap1h || !snap6h || snap1h === snap6h) return false;

  const rate1h      = latest.v - snap1h.v;
  const avgPer6h    = (latest.v - snap6h.v) / 6;
  return rate1h > avgPer6h * 2.5 && rate1h > 500;
}

// Computes growth deltas from saved history snapshots
export function calculateGrowthFromHistory(history) {
  if (!history || history.length < 2) return null;

  const latest   = history[history.length - 1];
  const latestTs = latest.ts;
  const latestV  = latest.v;

  const closest = (hoursAgo) => {
    const target = latestTs - hoursAgo * 3_600_000;
    const window = 15 * 60_000;
    let best = null;
    for (const s of history) {
      if (s.ts <= target + window && (!best || Math.abs(s.ts - target) < Math.abs(best.ts - target))) best = s;
    }
    return best && best !== latest ? best : null;
  };

  const snap1h  = closest(1);
  const snap6h  = closest(6);
  const snap24h = closest(24);

  const delta1h  = snap1h  ? latestV - snap1h.v  : null;
  const delta6h  = snap6h  ? latestV - snap6h.v  : null;
  const delta24h = snap24h ? latestV - snap24h.v : null;

  let trend = null;
  if (snap1h && snap6h && snap1h !== snap6h) {
    const rate1h = (latestV - snap1h.v) / 1;
    const rate6h = (latestV - snap6h.v) / 6;
    if (rate1h > rate6h * 1.3) trend = "accelerating";
    else if (rate1h < rate6h * 0.7) trend = "slowing";
    else trend = "steady";
  }

  return { delta1h, delta6h, delta24h, trend };
}

export function getStatusMessage(result, strings) {
  const s = strings?.status || {};
  if (result.status === "FOUND") {
    if (result.rank <= 10) return s.top10  || `🚀 Viral — Top 10`;
    if (result.rank <= 25) return s.top25  || `🔥 Hot — Top 25`;
    return (s.top50 || "✅ Trending — #{rank}").replace("{rank}", result.rank);
  }
  if (result.currentViews >= result.rank50Views) return s.aboveCut  || "⚡ Strong — outside chart by algorithm";
  if (result.estimatedRank === "Top 50+" || result.estimatedRank === "Top 51–60") return s.nearTop50 || "🔥 Closing in on Top 50";
  return s.out || "📉 Outside Trending Range";
}

// Recent velocity from history (views/h over last hour or so).
// Falls back to age-based average if no recent snapshot exists.
function calcViewsPerHourNow(currentViews, history, fallbackPerHour) {
  if (!history || history.length < 2) return fallbackPerHour;
  const latest = history[history.length - 1];
  const oneHourAgo = latest.ts - 3_600_000;
  const sixHoursAgo = latest.ts - 6 * 3_600_000;
  // Prefer 1h window, otherwise 6h
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].ts <= oneHourAgo) {
      const hours = Math.max((latest.ts - history[i].ts) / 3_600_000, 0.1);
      return Math.max(0, (latest.v - history[i].v) / hours);
    }
  }
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].ts <= sixHoursAgo) {
      const hours = Math.max((latest.ts - history[i].ts) / 3_600_000, 0.1);
      return Math.max(0, (latest.v - history[i].v) / hours);
    }
  }
  return fallbackPerHour;
}

// Engagement rate: (likes + 3×comments) / views — same weighting as viralScore.
function calcEngagementRate(video) {
  const views    = Number(video.statistics?.viewCount    || 0);
  const likes    = Number(video.statistics?.likeCount    || 0);
  const comments = Number(video.statistics?.commentCount || 0);
  if (views <= 0) return 0;
  return (likes + comments * 3) / views;
}

// Typical viralScore of an in-Top-50 video — used as the HEAT baseline.
function calcHeatBaseline(topVideos) {
  if (!topVideos || topVideos.length === 0) return 60;
  const scores = topVideos.map(v => calculateViralScore(v, topVideos));
  const sum = scores.reduce((a, b) => a + b, 0);
  return Math.round(sum / scores.length);
}

export function buildRankResult(video, topVideos, regionCode, strings, history = []) {
  const videoId         = video.id;
  const views           = Number(video.statistics?.viewCount || 0);
  const rank50Views     = Number(topVideos[topVideos.length - 1]?.statistics?.viewCount || 0);
  const rank            = findVideoRank(videoId, topVideos);
  const viralScore      = calculateViralScore(video, topVideos);
  const momentum        = getMomentumLabel(viralScore, strings);
  const growthData      = calculateGrowthFromHistory(history);
  const isBurst         = detectBurst(history);

  const publishedAt     = new Date(video.snippet?.publishedAt).getTime();
  const ageDays         = Math.max((Date.now() - publishedAt) / 86_400_000, 1 / 24);
  const ageHours        = ageDays * 24;
  const viewsPerHour    = views / ageHours;
  const avgTop50Vel     = calcAvgTop50Velocity(topVideos);
  const velocityRatio   = Math.round((viewsPerHour / avgTop50Vel) * 100);

  // New concrete metrics
  const viewsPerHourNow         = calcViewsPerHourNow(views, history, viewsPerHour);
  const avgTop50VelocityPerHour = Math.round(avgTop50Vel);
  const engagementRate          = calcEngagementRate(video);
  const heatBaseline            = calcHeatBaseline(topVideos);
  const viewsOverCutoff         = Math.max(0, views - rank50Views);

  const viewsPerDay     = Math.round(views / ageDays);
  const percentOfTop50  = rank50Views > 0
    ? Math.min(Math.round((views / rank50Views) * 100), 999)
    : 0;

  const common = {
    regionCode,
    viralScore, momentum,
    currentViews: views, rank50Views,
    viewsPerDay, percentOfTop50, velocityRatio,
    viewsPerHourNow: Math.round(viewsPerHourNow),
    avgTop50VelocityPerHour,
    engagementRate,
    heatBaseline,
    viewsOverCutoff,
    growthData, isBurst
  };

  if (rank !== null) {
    const result = {
      status: "FOUND", rank,
      label:               `#${rank} Top 50 ${regionCode}`,
      badgeLabel:          `#${rank}`,
      viewsNeededForTop50: 0,
      ...common
    };
    result.statusMessage = getStatusMessage(result, strings);
    return result;
  }

  const estimatedRank = estimateRankByViews(views, topVideos);
  const viewsNeeded   = calculateViewsNeeded(views, topVideos);

  const result = {
    status: "NOT_FOUND", estimatedRank,
    label:               `${estimatedRank} ${regionCode}`,
    badgeLabel:          estimatedRank,
    viewsNeededForTop50: viewsNeeded,
    ...common
  };
  result.statusMessage = getStatusMessage(result, strings);
  return result;
}

export function formatViews(n) {
  n = Number(n);
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)         return (n / 1_000).toFixed(0) + "K";
  return String(n);
}
