export function getFromStorage(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => resolve(result[key] ?? null));
  });
}

export function setToStorage(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

export async function getSettings() {
  const settings = await getFromStorage("settings");
  return {
    regionCode: "BR",
    overlayMode: "badge",
    cacheTTLMinutes: 30,
    categoryId: "",
    language: "",
    uiMode: "popup",     // "popup" (default, back-compat) | "sidepanel" (Chrome only)
    ...(settings || {})
  };
}

export function saveSettings(settings) {
  return setToStorage("settings", settings);
}

export function cacheKey(regionCode, categoryId = "") {
  return `ranking_${regionCode}_${categoryId || "all"}`;
}

export async function getCachedRanking(regionCode, ttlMinutes, categoryId = "") {
  const key = cacheKey(regionCode, categoryId);
  const cached = await getFromStorage(key);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > ttlMinutes * 60 * 1000) return null;
  return cached;
}

export function setCachedRanking(regionCode, videos, categoryId = "") {
  const key = cacheKey(regionCode, categoryId);
  return setToStorage(key, { fetchedAt: Date.now(), regionCode, categoryId, videos });
}

export async function getCachedVideo(videoId) {
  const cached = await getFromStorage(`video_${videoId}`);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > 10 * 60 * 1000) return null;
  return cached.video;
}

export function setCachedVideo(videoId, video) {
  return setToStorage(`video_${videoId}`, { fetchedAt: Date.now(), video });
}

// ── Channel country cache (rarely changes — 24h TTL) ──
const CHANNEL_COUNTRY_TTL_MS = 24 * 3600 * 1000;

export async function getCachedChannelCountry(channelId) {
  const cached = await getFromStorage(`chcountry_${channelId}`);
  if (!cached) return undefined;
  if (Date.now() - cached.fetchedAt > CHANNEL_COUNTRY_TTL_MS) return undefined;
  return cached.country;
}

export function setCachedChannelCountry(channelId, country) {
  return setToStorage(`chcountry_${channelId}`, { fetchedAt: Date.now(), country: country || null });
}

// ── Video history (snapshots for trend/growth calculation) ──

const HISTORY_TTL_MS  = 48 * 3600 * 1000;
const MIN_SNAP_GAP_MS =  5 * 60 * 1000;   // don't save more often than 5 min

export async function getVideoHistory(videoId) {
  return (await getFromStorage(`hist_${videoId}`)) || [];
}

export async function addVideoSnapshot(videoId, views, likes, comments) {
  const history = await getVideoHistory(videoId);
  const now     = Date.now();
  const last    = history[history.length - 1];
  if (last && now - last.ts < MIN_SNAP_GAP_MS) return;

  history.push({ ts: now, v: Number(views), l: Number(likes), c: Number(comments) });

  const cutoff = now - HISTORY_TTL_MS;
  const pruned = history.filter(s => s.ts >= cutoff);
  await setToStorage(`hist_${videoId}`, pruned);
}
