import { fetchMostPopularVideos, fetchVideoDetails, fetchChannelCountry } from "./api.js";
import { buildRankResult, suggestCountryFromLanguage, detectLanguageFromText } from "./ranking.js";
import { setLanguage, detectLanguage, t } from "./i18n.js";
import {
  getSettings,
  saveSettings,
  getCachedRanking,
  setCachedRanking,
  getCachedVideo,
  setCachedVideo,
  getCachedChannelCountry,
  setCachedChannelCountry,
  getVideoHistory,
  addVideoSnapshot
} from "./storage.js";
import { fetchAds, selectAdForRegion } from "./ads.js";

// Bust stale cache from older versions that stored absolute rank numbers
const CACHE_VERSION = "v2";
chrome.storage.local.get(["_cacheVersion"], (res) => {
  if (res._cacheVersion !== CACHE_VERSION) {
    chrome.storage.local.get(null, (all) => {
      const staleKeys = Object.keys(all).filter(k => k.startsWith("ranking_") || k.startsWith("video_"));
      if (staleKeys.length) chrome.storage.local.remove(staleKeys);
    });
    chrome.storage.local.set({ _cacheVersion: CACHE_VERSION });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    sendResponse({ error: true, code: err.code || "UNKNOWN", message: err.message });
  });
  return true;
});

// ── UI mode: popup (default) vs side panel (Chrome MV3 opt-in) ──
// When uiMode is "sidepanel" we clear chrome.action's default_popup so
// the toolbar click fires onClicked → we open the side panel manually.
// When "popup" we restore default_popup so the popup opens directly.
async function applyUIMode() {
  if (!chrome.action || !chrome.action.setPopup) return;
  const settings = await getSettings();
  const isSidePanel = settings.uiMode === "sidepanel" && !!chrome.sidePanel;
  try {
    chrome.action.setPopup({ popup: isSidePanel ? "" : "popup.html" });
  } catch { /* ignore on Firefox if it complains */ }
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: isSidePanel })
      .catch(() => { /* not fatal — fallback to onClicked below */ });
  }
}
chrome.runtime.onInstalled.addListener(applyUIMode);
chrome.runtime.onStartup.addListener(applyUIMode);

// Fallback action click handler for side panel mode (used if setPanelBehavior
// isn't honored). Only fires when default_popup is empty (= sidepanel mode).
if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(async (tab) => {
    if (!chrome.sidePanel || !chrome.sidePanel.open) return;
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch (err) {
      console.warn("[YT Radar] sidePanel.open failed:", err?.message || err);
    }
  });
}

async function handleMessage(message) {
  switch (message.type) {
    case "CHECK_VIDEO_RANK":
      return checkVideoRank(message.videoId, message.regionCode, message.categoryId, message.allowAutoSwitch);

    case "GET_TOP_VIDEOS":
      return getTopVideos(message.regionCode, message.categoryId);

    case "GET_SETTINGS":
      return getSettings();

    case "SAVE_SETTINGS":
      await saveSettings(message.settings);
      return { ok: true };

    case "APPLY_UI_MODE":
      await applyUIMode();
      return { ok: true };

    case "GET_AD":
      return getAd(message.regionCode);

    case "OPEN_POPUP":
      if (chrome.action.openPopup) {
        chrome.action.openPopup().catch(() => {});
      }
      return { ok: true };

    default:
      throw Object.assign(new Error("Unknown message type"), { code: "UNKNOWN_MESSAGE" });
  }
}

async function checkVideoRank(videoId, regionCode, categoryId, allowAutoSwitch = true) {
  if (!videoId) throw Object.assign(new Error("No video ID"), { code: "NO_VIDEO" });

  const settings = await getSettings();
  const region   = regionCode || settings.regionCode;
  const category = categoryId !== undefined ? categoryId : (settings.categoryId || "");
  const ttl      = settings.cacheTTLMinutes;
  const lang     = settings.language || detectLanguage();

  setLanguage(lang);

  // Top 50 first — if the video is in it, reuse that entry and skip videos.list?id=
  // (mostPopular returns part=snippet,statistics,contentDetails — same shape as videos.list?id)
  let rankingResult = await getRanking(region, ttl, category);
  let video = rankingResult.videos.find(v => v.id === videoId) || await getVideo(videoId);

  if (!video) {
    throw Object.assign(new Error("Video not found"), { code: "VIDEO_NOT_FOUND" });
  }

  // Auto-switch: if not in user's region Top 50, infer the video's likely region from:
  //   1. defaultAudioLanguage (when set)
  //   2. channel.country (cached 24h)
  //   3. title language detection (fallback when neither above works)
  //
  // For each candidate we still fetch that region's Top 50 to use as comparison
  // baseline. If the video IS in that Top 50, that's the strongest match and we
  // stop. Otherwise we keep the first candidate as context (badge/flag uses it).
  // Skipped when the caller explicitly forbids it (e.g. user picked region manually).
  let effectiveRegion = region;
  let autoSwitched   = null;
  const videoInTop50 = rankingResult.videos.some(v => v.id === videoId);

  if (!videoInTop50 && allowAutoSwitch) {
    // Weighted voting across 3 signals. Highest weight = most trustworthy.
    const votes = {};
    const topReason = {};
    const vote = (cc, reason, weight) => {
      if (!cc || cc === region) return;
      if (!votes[cc] || weight > (votes[cc].weight || 0)) topReason[cc] = reason;
      votes[cc] = { score: (votes[cc]?.score || 0) + weight, weight: Math.max(votes[cc]?.weight || 0, weight) };
    };

    // Signal A (weight 3): channel.country — set explicitly by creator
    const channelId = video.snippet?.channelId;
    if (channelId) {
      let chCountry = await getCachedChannelCountry(channelId);
      if (chCountry === undefined) {
        try {
          chCountry = await fetchChannelCountry(channelId);
          await setCachedChannelCountry(channelId, chCountry);
        } catch {
          chCountry = null;
        }
      }
      vote(chCountry, "channel", 3);
    }

    // Signal B (weight 2): title language detection
    vote(
      suggestCountryFromLanguage(detectLanguageFromText(video.snippet?.title || "")),
      "title",
      2
    );

    // Signal C (weight 1): defaultAudioLanguage — often mis-set, lowest trust
    vote(
      suggestCountryFromLanguage(video.snippet?.defaultAudioLanguage || video.snippet?.defaultLanguage),
      "language",
      1
    );

    // Sort candidates by score desc (ties broken by insertion order — channel > title > lang)
    const candidates = Object.entries(votes)
      .sort((a, b) => b[1].score - a[1].score)
      .map(([cc]) => ({ cc, reason: topReason[cc] }));

    // Try each candidate — prefer the one where video IS in Top 50.
    let firstViable = null;
    for (const cand of candidates) {
      try {
        const altRanking = await getRanking(cand.cc, ttl, category);
        if (altRanking.videos.some(v => v.id === videoId)) {
          effectiveRegion = cand.cc;
          rankingResult   = altRanking;
          autoSwitched    = { from: region, to: cand.cc, reason: cand.reason };
          firstViable     = null;
          break;
        }
        if (!firstViable) firstViable = { cand, ranking: altRanking };
      } catch { /* try next candidate */ }
    }
    // Fallback: video not in any candidate's Top 50, use top-voted as context
    if (!autoSwitched && firstViable) {
      effectiveRegion = firstViable.cand.cc;
      rankingResult   = firstViable.ranking;
      autoSwitched    = { from: region, to: firstViable.cand.cc, reason: firstViable.cand.reason + "_context" };
    }
  }

  // Save snapshot for trend tracking (fire-and-forget)
  addVideoSnapshot(
    videoId,
    video.statistics?.viewCount  || 0,
    video.statistics?.likeCount  || 0,
    video.statistics?.commentCount || 0
  ).catch(() => {});

  const history = await getVideoHistory(videoId);

  return {
    result: buildRankResult(video, rankingResult.videos, effectiveRegion, t(), history),
    video,
    history,
    regionCode: effectiveRegion,
    categoryId: category,
    usedFallback: rankingResult.usedFallback,
    autoSwitched
  };
}

async function getTopVideos(regionCode, categoryId) {
  const settings = await getSettings();
  const region = regionCode || settings.regionCode;
  const category = categoryId !== undefined ? categoryId : (settings.categoryId || "");
  const ttl = settings.cacheTTLMinutes;
  const rankingResult = await getRanking(region, ttl, category);
  return { videos: rankingResult.videos, regionCode: region, categoryId: category, usedFallback: rankingResult.usedFallback };
}

async function getAd(regionCode) {
  const ads = await fetchAds();
  return { ad: selectAdForRegion(ads, regionCode) };
}

async function getRanking(regionCode, ttlMinutes, categoryId = "") {
  const cached = await getCachedRanking(regionCode, ttlMinutes, categoryId);
  if (cached) return { videos: cached.videos, usedFallback: false };

  try {
    const videos = await fetchMostPopularVideos(regionCode, categoryId);

    if (categoryId) {
      const matching = videos.filter(v => v.snippet?.categoryId === categoryId);
      const matchRatio = matching.length / videos.length;

      if (matchRatio < 0.4) {
        await setCachedRanking(regionCode, videos, categoryId);
        return { videos, usedFallback: true };
      }
    }

    await setCachedRanking(regionCode, videos, categoryId);
    return { videos, usedFallback: false };
  } catch (err) {
    if (err.code === "CATEGORY_UNAVAILABLE" && categoryId) {
      const videos = await fetchMostPopularVideos(regionCode, "");
      await setCachedRanking(regionCode, videos, categoryId);
      return { videos, usedFallback: true };
    }
    throw err;
  }
}

async function getVideo(videoId) {
  const cached = await getCachedVideo(videoId);
  if (cached) return cached;

  const video = await fetchVideoDetails(videoId);
  if (video) await setCachedVideo(videoId, video);
  return video;
}
