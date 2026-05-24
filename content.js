(function () {
  "use strict";

  let currentVideoId = null;
  let overlayMode = "badge";
  let lastResult = null;
  let checkScheduled = false;

  init();

  async function init() {
    try {
      const settings = await sendMessageWithRetry({ type: "GET_SETTINGS" });
      overlayMode = settings.overlayMode || "badge";
    } catch {
      overlayMode = "badge";
    }
    watchUrlChanges();
    scheduleCheck();
  }

  function getCurrentVideoId() {
    return new URLSearchParams(window.location.search).get("v");
  }

  function watchUrlChanges() {
    // YouTube uses SPA navigation. Wrapping history.pushState from the content-script
    // isolated world has no effect on the page's calls, so we poll location.href.
    // popstate (back/forward) is a separate signal.
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // Stale overlay can survive SPA DOM updates in a wrong position — clear it.
        removeOverlay();
        currentVideoId = null; // force re-fetch + re-mount even if videoId is the same
        scheduleCheck();
      }
    }, 500);

    window.addEventListener("popstate", () => {
      removeOverlay();
      currentVideoId = null;
      scheduleCheck();
    });
  }

  function scheduleCheck() {
    if (checkScheduled) return;
    checkScheduled = true;
    setTimeout(() => { checkScheduled = false; checkCurrentVideo(); }, 1000);
  }

  async function checkCurrentVideo() {
    const videoId = getCurrentVideoId();
    if (!videoId) return;

    if (videoId === currentVideoId) {
      if (!document.getElementById("yt-rank-radar-overlay") &&
          !document.getElementById("yt-rank-radar-ticker") &&
          lastResult && overlayMode !== "off") {
        injectFromLast();
      }
      return;
    }

    currentVideoId = videoId;
    removeOverlay();

    try {
      const settings = await sendMessageWithRetry({ type: "GET_SETTINGS" });
      overlayMode = settings.overlayMode || "badge";
      if (overlayMode === "off") return;

      const data = await sendMessageWithRetry({ type: "CHECK_VIDEO_RANK", videoId });
      if (data.error) return;

      lastResult = data.result;

      const player = await waitForPlayer();
      if (!player) return;

      removeOverlay();
      mountOverlay(player, data.result, overlayMode);
    } catch {
      // ignore
    }
  }

  function mountOverlay(player, result, mode) {
    if (mode === "off") return;

    if (mode === "badge" || mode === "expanded") {
      const el = buildBadge(result, mode);
      document.body.appendChild(el);
      positionBadge(el, player);
      attachPositionListeners(el, () => {
        const p = document.querySelector("#movie_player");
        if (p && el.isConnected) positionBadge(el, p);
      });
    } else if (mode === "ticker") {
      const el = buildTicker(result);
      document.body.appendChild(el);
      positionTicker(el, player);
      attachPositionListeners(el, () => {
        const p = document.querySelector("#movie_player");
        if (p && el.isConnected) positionTicker(el, p);
      });
    }
  }

  function positionBadge(el, player) {
    const r = player.getBoundingClientRect();
    el.style.top = (r.top + 12) + "px";
    el.style.right = (window.innerWidth - r.right + 12) + "px";
  }

  function positionTicker(el, player) {
    const r = player.getBoundingClientRect();
    el.style.bottom = (window.innerHeight - r.bottom + 56) + "px";
    el.style.left = r.left + "px";
    el.style.width = r.width + "px";
  }

  function attachPositionListeners(el, fn) {
    window.addEventListener("scroll", fn, { passive: true });
    window.addEventListener("resize", fn, { passive: true });
    document.addEventListener("fullscreenchange", fn);
    el._cleanup = () => {
      window.removeEventListener("scroll", fn);
      window.removeEventListener("resize", fn);
      document.removeEventListener("fullscreenchange", fn);
    };
  }

  function removeOverlay() {
    ["yt-rank-radar-overlay", "yt-rank-radar-ticker"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) { el._cleanup?.(); el.remove(); }
    });
  }

  async function injectFromLast() {
    const player = await waitForPlayer();
    if (player && lastResult) mountOverlay(player, lastResult, overlayMode);
  }

  function buildBadge(result, mode) {
    const el = document.createElement("div");
    el.id = "yt-rank-radar-overlay";
    const flag  = getRegionFlag(result.regionCode);
    // badgeLabel already conveys official vs estimate — no extra prefix needed
    const label = result.status === "FOUND"
      ? `#${result.rank}`
      : result.badgeLabel;

    if (mode === "expanded") {
      el.textContent = `${flag} ${label} · ${result.momentum.label} ${result.viralScore}/100`;
    } else {
      el.textContent = `${flag} ${label}`;
    }
    el.title = "Click to open YT Rank Radar";
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      chrome.runtime.sendMessage({ type: "OPEN_POPUP" });
    });
    return el;
  }

  function buildTicker(result) {
    const wrapper = document.createElement("div");
    wrapper.id = "yt-rank-radar-ticker";
    const span = document.createElement("span");
    let text = `🔥 ${result.regionCode} ${result.label} — Viral Score ${result.viralScore}/100`;
    if (result.viewsNeededForTop50 > 0) {
      text += ` — ${formatViews(result.viewsNeededForTop50)} views to Top 50`;
    }
    text += `    •    ${getRegionFlag(result.regionCode)} YT Rank Radar`;
    span.textContent = text;
    wrapper.appendChild(span);
    return wrapper;
  }

  function waitForPlayer(attempts = 30) {
    return new Promise((resolve) => {
      const check = (n) => {
        const el = document.querySelector("#movie_player");
        if (el) return resolve(el);
        if (n <= 0) return resolve(null);
        setTimeout(() => check(n - 1), 400);
      };
      check(attempts);
    });
  }

  function sendMessageWithRetry(msg, retries = 4, delay = 700) {
    return new Promise((resolve, reject) => {
      const attempt = (n) => {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) {
            if (n > 0) return setTimeout(() => attempt(n - 1), delay);
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (!res) {
            if (n > 0) return setTimeout(() => attempt(n - 1), delay);
            return reject(new Error("No response"));
          }
          if (res.error) return reject(Object.assign(new Error(res.message), { code: res.code }));
          resolve(res);
        });
      };
      attempt(retries);
    });
  }

  function getRegionFlag(code) {
    const flags = {
      BR: "🇧🇷", US: "🇺🇸", PT: "🇵🇹", JP: "🇯🇵", KR: "🇰🇷",
      MX: "🇲🇽", AR: "🇦🇷", GB: "🇬🇧", FR: "🇫🇷", DE: "🇩🇪", IN: "🇮🇳"
    };
    return flags[code] || "🌍";
  }

  function formatViews(n) {
    n = Number(n);
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
    return String(n);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "SETTINGS_UPDATED") {
      overlayMode = message.settings?.overlayMode || "badge";
      currentVideoId = null;
      removeOverlay();
      if (overlayMode !== "off") scheduleCheck();
      return;
    }
    if (message.type === "GET_PAGE_CONTEXT") {
      sendResponse({ regionCode: detectYouTubeRegion(), videoId: getCurrentVideoId() });
      return true;
    }
  });

  function detectYouTubeRegion() {
    // 1. URL ?gl= param
    const urlGl = new URLSearchParams(window.location.search).get("gl");
    if (urlGl && /^[A-Z]{2}$/i.test(urlGl)) return urlGl.toUpperCase();

    // 2. PREF cookie (YouTube stores gl=XX there)
    const pref = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("PREF="));
    if (pref) {
      const m = decodeURIComponent(pref.split("=").slice(1).join("=")).match(/\bgl=([A-Z]{2})\b/i);
      if (m) return m[1].toUpperCase();
    }

    // 3. <html lang="pt-BR"> → "BR"
    const lang = document.documentElement.lang || navigator.language || "";
    if (lang.includes("-")) return lang.split("-").pop().toUpperCase();

    return null;
  }
})();
