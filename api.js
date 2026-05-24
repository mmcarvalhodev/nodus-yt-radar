// NODUS YT Radar — YouTube Data API client (via Cloudflare Worker proxy)
// ---------------------------------------------------------------------
// The extension never holds the YouTube Data v3 API key. All calls go
// through https://worker-yt-radar.mmcarvalho-dev.workers.dev which holds
// env.YOUTUBE_API_KEY server-side. Error codes are preserved from the
// previous client to keep popup/sidepanel error handling working:
//   QUOTA_EXCEEDED · CATEGORY_UNAVAILABLE · RANKING_UNAVAILABLE · API_ERROR
import { CONFIG } from "./config.js";

function ytErrorFromBody(body, fallbackStatus) {
  const code    = body?.code  || "API_ERROR";
  const message = body?.error || `API error ${fallbackStatus}`;
  return Object.assign(new Error(message), { code });
}

export async function fetchMostPopularVideos(regionCode, categoryId = "") {
  const url = new URL(`${CONFIG.WORKER_BASE}/youtube/most-popular`);
  url.searchParams.set("region", regionCode);
  url.searchParams.set("max", String(CONFIG.MAX_RESULTS));
  if (categoryId) url.searchParams.set("category", categoryId);

  const res  = await fetch(url.toString());
  const body = await res.json().catch(() => ({}));

  if (!res.ok) throw ytErrorFromBody(body, res.status);
  if (!body.items || body.items.length === 0) {
    throw Object.assign(new Error("No ranking data for this region."), { code: "RANKING_UNAVAILABLE" });
  }
  return body.items;
}

export async function fetchVideoDetails(videoId) {
  const url = new URL(`${CONFIG.WORKER_BASE}/youtube/video`);
  url.searchParams.set("id", videoId);

  const res  = await fetch(url.toString());
  const body = await res.json().catch(() => ({}));

  if (!res.ok) throw ytErrorFromBody(body, res.status);
  return body.item || null;
}

// Returns the channel's ISO country code (e.g. "US", "BR") if the creator set one.
// Many large channels (MrBeast, T-Series, music labels) have it. Smaller ones don't.
// On any error, returns null silently — country is a nice-to-have signal.
export async function fetchChannelCountry(channelId) {
  if (!channelId) return null;
  const url = new URL(`${CONFIG.WORKER_BASE}/youtube/channel-country`);
  url.searchParams.set("id", channelId);

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const body = await res.json().catch(() => ({}));
  return body.country || null;
}
