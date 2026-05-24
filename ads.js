import { CONFIG } from "./config.js";

let cachedAds = null;
let adsFetchedAt = 0;
const ADS_CACHE_MS = 60 * 60 * 1000;

export async function fetchAds() {
  if (cachedAds && Date.now() - adsFetchedAt < ADS_CACHE_MS) {
    return cachedAds;
  }

  if (!CONFIG.ADS_URL || CONFIG.ADS_URL.includes("your-domain.com")) {
    return getDefaultAds();
  }

  try {
    const res = await fetch(CONFIG.ADS_URL);
    if (!res.ok) throw new Error("ads fetch failed");
    cachedAds = await res.json();
    adsFetchedAt = Date.now();
    return cachedAds;
  } catch {
    return getDefaultAds();
  }
}

export function selectAdForRegion(ads, regionCode) {
  if (!ads || ads.length === 0) return getDefaultAd();

  const active = ads.filter((a) => a.active);
  const regional = active.filter((a) => a.country === regionCode || a.country === "all");
  const pool = regional.length > 0 ? regional : active;

  if (pool.length === 0) return getDefaultAd();
  return pool[Math.floor(Math.random() * pool.length)];
}

function getDefaultAds() {
  return [getDefaultAd()];
}

function getDefaultAd() {
  return {
    id: "nodus_ad",
    title: "Nodus AI",
    description: "nodus-ai.app",
    imageUrl: "",
    targetUrl: "https://nodus-ai.app",
    country: "all",
    active: true
  };
}
