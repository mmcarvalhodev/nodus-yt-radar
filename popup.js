import { CONFIG } from "./config.js";
import { formatViews } from "./ranking.js";
import { LANGUAGES, RTL_LANGS, detectLanguage, setLanguage, t, tr } from "./i18n.js";

const $ = (id) => document.getElementById(id);

let currentSettings = {};
let currentRegion   = "BR";
let currentCategory = "";
let currentLang     = "en";
let currentVideoId  = null;
let userPickedRegion = false; // when true, disable auto-switch by language

document.addEventListener("DOMContentLoaded", async () => {
  currentSettings = await sendMessage({ type: "GET_SETTINGS" });
  currentRegion   = currentSettings.regionCode   || "BR";
  currentCategory = currentSettings.categoryId   || "";
  currentLang     = currentSettings.language      || detectLanguage();

  setLanguage(currentLang);
  applyDir(currentLang);

  buildRegionSelect();
  buildCategorySelect();
  buildLangSelect();
  applyI18n();

  $("overlay-mode").value = currentSettings.overlayMode || "badge";
  $("cache-ttl").value    = String(currentSettings.cacheTTLMinutes || 30);
  $("lang-select").value  = currentLang;

  // Only show the "Open as" setting in browsers that support side panel (Chrome MV3).
  // In Firefox there's no chrome.sidePanel — the row stays hidden, popup is the only mode.
  if (typeof chrome !== "undefined" && chrome.sidePanel) {
    const uiModeRow = $("sm-row-uimode");
    if (uiModeRow) uiModeRow.style.display = "";
    $("ui-mode").value = currentSettings.uiMode || "popup";
  }

  // Auto-detect region from the active YouTube tab
  const ctx = await getPageContext();
  if (ctx.regionCode && isValidRegion(ctx.regionCode)) {
    currentRegion = ctx.regionCode;
  }
  $("region-select").value   = currentRegion;
  $("category-select").value = currentCategory;

  $("region-select").addEventListener("change",   onRegionChange);
  $("category-select").addEventListener("change", onCategoryChange);
  $("overlay-mode").addEventListener("change",    onOverlayChange);
  $("cache-ttl").addEventListener("change",       onCacheTTLChange);
  $("lang-select").addEventListener("change",     onLangChange);
  const uiModeSel = $("ui-mode");
  if (uiModeSel) uiModeSel.addEventListener("change", onUIModeChange);

  initSettingsModal();
  initTooltips();

  await Promise.all([loadCurrentVideo(), loadTopVideos()]);
  loadAd();
});

// ── Builders ──────────────────────────────────────────────

function buildRegionSelect() {
  const sel = $("region-select");
  sel.innerHTML = "";
  CONFIG.REGIONS.forEach(({ code, label, flag }) => {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = `${flag} ${label}`;
    sel.appendChild(opt);
  });
}

function buildCategorySelect() {
  const sel = $("category-select");
  sel.innerHTML = "";
  const strings = t();
  CONFIG.CATEGORIES.forEach(({ id }) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = strings.categories[id] || id || "All";
    sel.appendChild(opt);
  });
}

function buildLangSelect() {
  const sel = $("lang-select");
  sel.innerHTML = "";
  LANGUAGES.forEach(({ code, label }) => {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = label;
    sel.appendChild(opt);
  });
}

function applyI18n() {
  const strings = t();
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const parts = key.split(".");
    let val = strings;
    for (const p of parts) val = val?.[p];
    if (typeof val === "string") el.textContent = val;
  });
}

// ── Event handlers ────────────────────────────────────────

async function onRegionChange() {
  currentRegion = $("region-select").value;
  currentSettings.regionCode = currentRegion;
  userPickedRegion = true;
  await sendMessage({ type: "SAVE_SETTINGS", settings: currentSettings });
  notifyContentScript();
  await Promise.all([loadCurrentVideo(), loadTopVideos()]);
}

async function onCategoryChange() {
  currentCategory = $("category-select").value;
  currentSettings.categoryId = currentCategory;
  await sendMessage({ type: "SAVE_SETTINGS", settings: currentSettings });
  await loadTopVideos();
}

async function onOverlayChange() {
  currentSettings.overlayMode = $("overlay-mode").value;
  await sendMessage({ type: "SAVE_SETTINGS", settings: currentSettings });
  notifyContentScript();
}

async function onCacheTTLChange() {
  currentSettings.cacheTTLMinutes = Number($("cache-ttl").value);
  await sendMessage({ type: "SAVE_SETTINGS", settings: currentSettings });
}

async function onUIModeChange() {
  const next = $("ui-mode").value;
  currentSettings.uiMode = next;
  await sendMessage({ type: "SAVE_SETTINGS", settings: currentSettings });
  // Ask background to reconfigure chrome.action.setPopup so the new mode
  // takes effect on the next toolbar click without requiring a reload.
  await sendMessage({ type: "APPLY_UI_MODE", uiMode: next });
}

async function onLangChange() {
  currentLang = $("lang-select").value;
  currentSettings.language = currentLang;
  setLanguage(currentLang);
  applyDir(currentLang);
  await sendMessage({ type: "SAVE_SETTINGS", settings: currentSettings });
  buildCategorySelect();
  $("category-select").value = currentCategory;
  applyI18n();
  await Promise.all([loadCurrentVideo(), loadTopVideos()]);
}

function initSettingsModal() {
  const gearBtn = $("gear-btn");
  const modal   = $("settings-modal");
  const overlay = $("sm-overlay");
  if (!gearBtn || !modal) return;

  gearBtn.addEventListener("click", () => modal.classList.add("open"));
  overlay?.addEventListener("click", () => modal.classList.remove("open"));
}

function notifyContentScript() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: "SETTINGS_UPDATED",
        settings: currentSettings
      }).catch(() => {});
    }
  });
}

// ── Current video ─────────────────────────────────────────

async function loadCurrentVideo() {
  const container       = $("current-video");
  const metricsEl       = $("current-metrics");
  const metricsSection  = $("metrics-section");
  const storyBlock      = $("story-block");
  const storySection    = $("story-section");
  const historySection  = $("history-section");
  const historyBlock    = $("history-block");
  const labelEl         = $("analysis-label");
  const strings         = t();

  if (labelEl) labelEl.textContent = "";
  container.innerHTML = `<div class="status-loading">${strings.ui.loading}</div>`;
  if (metricsSection) metricsSection.style.display = "none";
  if (storySection) storySection.style.display = "none";
  if (historySection) historySection.style.display = "none";

  try {
    const videoId = await getActiveTabVideoId();
    if (!videoId) {
      container.innerHTML = `<div class="empty-state">${strings.ui.noVideo}</div>`;
      return;
    }

    currentVideoId = videoId;
    const data = await sendMessage({
      type: "CHECK_VIDEO_RANK",
      videoId,
      regionCode: currentRegion,
      categoryId: currentCategory,
      allowAutoSwitch: !userPickedRegion
    });

    if (data.error) throw new Error(data.message);

    // Auto-switch happened: silently update the dropdown to reflect the new region
    // and refresh the Top Videos list to match.
    if (data.autoSwitched) {
      currentRegion = data.autoSwitched.to;
      const sel = $("region-select");
      if (sel) sel.value = currentRegion;
      loadTopVideos();
    }

    // Auto-set category from the video itself
    const videoCatId = data.video?.snippet?.categoryId || "";
    if (videoCatId && isValidCategory(videoCatId) && videoCatId !== currentCategory) {
      currentCategory = videoCatId;
      const catSel = $("category-select");
      if (catSel) catSel.value = currentCategory;
      loadTopVideos();
    }

    if (labelEl) {
      labelEl.innerHTML = "";
      const txt = document.createElement("span");
      txt.textContent = strings.ui.analyzingNow;
      labelEl.appendChild(txt);
      if (data.autoSwitched) {
        const chip = document.createElement("span");
        chip.className = "auto-switch-chip";
        const flag = getRegionFlag(data.autoSwitched.to);
        const tpl = strings.ui.autoSwitched || "{flag} auto-switched to {region}";
        chip.textContent = tpl.replace("{flag}", flag).replace("{region}", data.autoSwitched.to);
        chip.title = strings.ui.autoSwitchedTip || "Video not in your region's Top 50 — showing the country suggested by its audio language. Click the region selector to override.";
        labelEl.appendChild(chip);
      }
    }

    container.innerHTML = "";
    container.appendChild(renderVideoInfo(data.video));

    if (storyBlock && storySection) {
      const storyEl = renderStory(data.result);
      if (storyEl) {
        storyBlock.innerHTML = "";
        storyBlock.appendChild(storyEl);
        storySection.style.display = "";
      }
    }

    if (metricsEl && metricsSection) {
      metricsEl.innerHTML = "";
      metricsEl.appendChild(renderMetrics(data.result));
      metricsSection.style.display = "";
    }

    if (historyBlock && historySection) {
      const histEl = renderHistory(data.history || []);
      if (histEl) {
        historyBlock.innerHTML = "";
        historyBlock.appendChild(histEl);
        historySection.style.display = "";
      }
    }
  } catch (err) {
    container.innerHTML = `<div class="status-error">${escapeHtml(err.message || "Error.")}</div>`;
  }
}

function renderVideoInfo(video) {
  const thumbUrl = video.snippet?.thumbnails?.medium?.url || video.snippet?.thumbnails?.default?.url || "";
  const title    = video.snippet?.title || "";
  const channel  = video.snippet?.channelTitle || "";
  const views    = formatViews(video.statistics?.viewCount || 0);
  const strings  = t();

  const regionEntry = CONFIG.REGIONS.find(r => r.code === currentRegion);
  const regionChip  = regionEntry ? `${regionEntry.flag} ${regionEntry.label}` : currentRegion;
  const catChip     = currentCategory ? (strings.categories?.[currentCategory] || currentCategory) : "";

  const row = document.createElement("div");
  row.className = "video-info-row";

  if (thumbUrl) {
    const img = document.createElement("img");
    img.className = "video-thumb";
    img.src = thumbUrl;
    img.alt = "";
    row.appendChild(img);
  }

  const meta = document.createElement("div");
  meta.className = "video-meta";
  meta.innerHTML = `
    <div class="video-title">${escapeHtml(title)}</div>
    <div class="video-channel-views">${escapeHtml(channel)} · ${views}</div>
    <div class="video-context">
      <span class="vc-chip">${escapeHtml(regionChip)}</span>
      ${catChip ? `<span class="vc-chip">${escapeHtml(catChip)}</span>` : ""}
    </div>
  `;
  row.appendChild(meta);
  return row;
}

// ── Story sentence (narrative interpretation above metrics) ──

function buildStorySentence(result) {
  const strings = t();
  const tplKeys = strings.story || {};

  const now      = result.viewsPerHourNow || 0;
  const avg      = result.avgTop50VelocityPerHour || 0;
  const excess   = result.viewsOverCutoff || 0;
  const needed   = result.viewsNeededForTop50 || 0;
  const eng      = Math.round((result.engagementRate || 0) * 1000) / 10; // 0.062 → 6.2
  const trend    = result.growthData?.trend;

  const params = {
    region:    result.regionCode,
    rank:      result.rank,
    excess:    formatViews(excess),
    needed:    formatViews(needed),
    nowPerH:   formatViews(now),
    avgPerH:   formatViews(avg),
    eng:       String(eng)
  };

  // Pick a template based on status + velocity + history
  let key, icon;

  if (result.status === "FOUND") {
    if (trend === "slowing") { key = "inTopSlow";  icon = "⚠"; }
    else if (result.isBurst) { key = "inTopBurst"; icon = "⚡"; }
    else                     { key = "inTop";      icon = "🚀"; }
  } else if (result.currentViews >= result.rank50Views) {
    // Above cutoff
    if (now > 0 && avg > 0 && now < avg * 0.5) {
      key = "aboveCutoffSlow"; icon = "📊";
    } else {
      key = "aboveCutoff"; icon = "📊";
    }
  } else {
    // Below cutoff
    if (result.isBurst || (now > 0 && avg > 0 && now > avg * 1.5)) {
      key = "burst"; icon = "⚡";
    } else if (eng >= 5) {
      key = "belowEngaged"; icon = "💬";
    } else {
      key = "below"; icon = "📉";
    }
  }

  let tpl = tplKeys[key];
  if (!tpl) tpl = fallbackStory(key);

  const text = tpl.replace(/\{(\w+)\}/g, (_, k) => params[k] != null ? params[k] : `{${k}}`);
  return { icon, text };
}

function fallbackStory(key) {
  // English fallback if locale lacks story.* keys
  return {
    inTop:           "Currently #{rank} in Top 50 {region}, growing at {nowPerH}/h.",
    inTopSlow:       "In Top 50 {region} at #{rank}, but velocity is falling — may drop out.",
    inTopBurst:      "⚡ #{rank} in Top 50 {region} with a recent burst — {nowPerH}/h.",
    aboveCutoff:     "Has {excess} more views than the #50 in Top 50 {region}, growing at {nowPerH}/h.",
    aboveCutoffSlow: "Has {excess} more views than the #50 in Top 50 {region}, but YouTube didn't add it to the chart because growth slowed ({nowPerH}/h vs {avgPerH}/h average).",
    burst:           "Recent burst! Growing at {nowPerH}/h — well above the Top 50 average ({avgPerH}/h).",
    belowEngaged:    "Outside Top 50 {region}, but engagement is strong ({eng}% vs 1–3% average) — could grow.",
    below:           "Outside Top 50 {region}. Needs {needed} more views to enter, growing at {nowPerH}/h."
  }[key] || "";
}

function renderStory(result) {
  const { icon, text } = buildStorySentence(result);
  if (!text) return null;
  const wrap = document.createElement("div");
  wrap.className = "story";
  wrap.innerHTML = `
    <div class="story-icon">${escapeHtml(icon || "📊")}</div>
    <div class="story-text">${escapeHtml(text)}</div>
  `;
  return wrap;
}

// ── Metrics grid (4 cells with concrete reference points) ──

function renderMetrics(result) {
  const strings = t();
  const flag    = getRegionFlag(result.regionCode);
  const tips    = strings.tooltips || {};
  const tip = (k, fb) => tips[k] || fb;

  const group = document.createElement("div");
  group.className = "metric-group";

  const groupTitle = document.createElement("div");
  groupTitle.className = "metric-group-title";
  groupTitle.innerHTML = `${escapeHtml(strings.ui.metrics || strings.ui.performanceAnalysis)} <span class="metric-group-arrow">▼</span>`;
  group.appendChild(groupTitle);

  const grid = document.createElement("div");
  grid.className = "metric-grid";

  // ── Cell 1: Position ──
  const posCell = document.createElement("div");
  posCell.className = "metric-cell";
  let posValue, posSub, posClass;
  if (result.status === "FOUND") {
    posValue = `${flag} #${result.rank}`;
    posSub   = (strings.ui.posInTop50Sub || "Top 50 · {region}").replace("{region}", result.regionCode);
    posClass = "mc-found";
  } else if (result.currentViews >= result.rank50Views) {
    posValue = strings.ui.posStrong || "Strong, outside chart";
    posSub   = (strings.ui.posAboveSub || "{has} views · cutoff: {cut}")
      .replace("{has}", formatViews(result.currentViews))
      .replace("{cut}", formatViews(result.rank50Views));
    posClass = "mc-estimated";
  } else {
    posValue = strings.ui.posBelow || "Outside chart";
    posSub   = (strings.ui.posBelowSub || "Needs +{need} to enter Top 50")
      .replace("{need}", formatViews(result.viewsNeededForTop50));
    posClass = "mc-estimated";
  }
  const posLabel = (strings.ui.position || "Position");
  posCell.innerHTML = `
    <div class="mc-label">${escapeHtml(posLabel)}</div>
    <div class="mc-value mc-rank ${posClass}">${escapeHtml(String(posValue))}</div>
    <div class="mc-sub mc-sub-wrap">${escapeHtml(posSub)}</div>
  `;

  // ── Cell 2: HEAT ──
  const heatCell = document.createElement("div");
  heatCell.className = "metric-cell";
  const heatBaseline = result.heatBaseline || 60;
  const heatTipTxt   = tip("viralScore",
    "Composite score: 45% velocity, 20% views, 20% engagement, 15% recency.");
  const heatCmpTpl   = strings.ui.heatBaseline || "Top 50 avg ~{avg}";
  const heatCmp      = heatCmpTpl.replace("{avg}", heatBaseline);
  heatCell.innerHTML = `
    <div class="mc-label">HEAT <span class="info-icon" data-tip="${escapeHtml(heatTipTxt)}">i</span></div>
    <div class="mc-value" style="color:${result.momentum.color}">${result.viralScore}<span style="font-size:10px;font-weight:400;color:#555">/100</span></div>
    <div class="mc-bar-wrap"><div class="mc-bar" style="width:${result.viralScore}%;background:${result.momentum.color}"></div></div>
    <div class="mc-sub">${escapeHtml(heatCmp)} · ${escapeHtml(result.momentum.label)}</div>
  `;

  // ── Cell 3: Velocity ──
  const velCell = document.createElement("div");
  velCell.className = "metric-cell";
  const velTipTxt = tip("velocityVsTop50",
    "Current views/hour. Top 50 videos average ~1500/h.");
  const velSubTpl = strings.ui.velocityBaseline || "Top 50 ~{avg}/h";
  const velSub    = velSubTpl.replace("{avg}", formatViews(result.avgTop50VelocityPerHour || 0));
  let trendTag = "";
  if (result.growthData?.trend === "slowing") {
    trendTag = `<span class="trend-tag slow">${escapeHtml(strings.growth?.slowing || "↘ Slowing")}</span>`;
  } else if (result.growthData?.trend === "accelerating") {
    trendTag = `<span class="trend-tag accel">${escapeHtml(strings.growth?.accelerating || "⚡ Accelerating")}</span>`;
  } else if (result.isBurst) {
    trendTag = `<span class="trend-tag accel">${escapeHtml(strings.ui.burst || "⚡ Breakout!")}</span>`;
  }
  velCell.innerHTML = `
    <div class="mc-label">${escapeHtml(strings.ui.velocityNow || "Velocity now")} <span class="info-icon" data-tip="${escapeHtml(velTipTxt)}">i</span></div>
    <div class="mc-value">${formatViews(result.viewsPerHourNow || 0)}<span style="font-size:10px;font-weight:400;color:#555"> ${escapeHtml(strings.ui.viewsPerHourUnit || "views/h")}</span></div>
    <div class="mc-sub">${escapeHtml(velSub)} ${trendTag}</div>
  `;

  // ── Cell 4: Engagement ──
  const engCell = document.createElement("div");
  engCell.className = "metric-cell";
  const engPct = Math.round((result.engagementRate || 0) * 1000) / 10; // 0.062 → 6.2
  const engColor = engPct >= 5 ? "#00c853" : engPct >= 3 ? "#ffab00" : "#888";
  const engTipTxt = tip("engagementRate",
    "(likes + 3×comments) / views. YouTube average is 1–3%. Above 5% = strongly engaged.");
  const engBaseline = strings.ui.engagementBaseline || "YouTube avg 1–3%";
  let engTag = "";
  if (engPct >= 5) {
    engTag = `<span class="trend-tag accel">${escapeHtml(strings.ui.engagementHigh || "✓ Strong")}</span>`;
  } else if (engPct < 1) {
    engTag = `<span class="trend-tag slow">${escapeHtml(strings.ui.engagementLow || "Low")}</span>`;
  }
  engCell.innerHTML = `
    <div class="mc-label">${escapeHtml(strings.ui.engagement || "Engagement")} <span class="info-icon" data-tip="${escapeHtml(engTipTxt)}">i</span></div>
    <div class="mc-value" style="color:${engColor}">${engPct}<span style="font-size:10px;font-weight:400;color:#555">%</span></div>
    <div class="mc-sub">${escapeHtml(engBaseline)} ${engTag}</div>
  `;

  grid.append(posCell, heatCell, velCell, engCell);
  group.appendChild(grid);
  return group;
}

function renderHistory(history) {
  if (!history || history.length < 2) return null;

  const strings = t();

  // Outer collapsible group (mirrors .metric-group hover pattern)
  const group = document.createElement("div");
  group.className = "history-group";

  const groupTitle = document.createElement("div");
  groupTitle.className = "history-group-title";
  groupTitle.innerHTML = `${escapeHtml(strings.ui.viewsEvolution)} <span class="history-group-arrow">▼</span>`;
  group.appendChild(groupTitle);

  const block = document.createElement("div");
  block.className = "history-collapsible";

  // Build sparkline SVG
  const counts = history.map(h => Number(h.v || 0));
  const minV = Math.min(...counts);
  const maxV = Math.max(...counts);
  const range = maxV - minV || 1;
  const W = 380, H = 40, PAD = 3;

  const pts = counts.map((v, i) => {
    const x = (i / (counts.length - 1)) * W;
    const y = H - PAD - ((v - minV) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const lastPt = pts.split(" ").pop().split(",");
  const polygonPts = `0,${H} ${pts} ${W},${H}`;

  const wrap = document.createElement("div");
  wrap.className = "sparkline-wrap";
  wrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ff8800" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="#ff8800" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <polygon points="${polygonPts}" fill="url(#sg)"/>
      <polyline points="${pts}" fill="none" stroke="#ff8800" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="3" fill="#ff8800"/>
    </svg>
  `;
  block.appendChild(wrap);

  // Delta pills
  const now   = history[history.length - 1];
  const nowV  = Number(now.v || 0);
  const nowTs = now.ts || Date.now();

  function findNearest(ms) {
    const target = nowTs - ms;
    let best = history[0];
    for (const h of history) {
      if (Math.abs(h.ts - target) < Math.abs(best.ts - target)) best = h;
    }
    return Number(best.v || 0);
  }

  const d1h  = nowV - findNearest(3600000);
  const d6h  = nowV - findNearest(6 * 3600000);
  const d24h = nowV - findNearest(24 * 3600000);

  const deltaRow = document.createElement("div");
  deltaRow.className = "delta-row";

  [[d1h, "1h"], [d6h, "6h"], [d24h, "24h"]].forEach(([delta, label]) => {
    if (delta <= 0) return;
    const pill = document.createElement("span");
    pill.className = "delta-pill";
    pill.textContent = `+${formatViews(delta)} / ${label}`;
    deltaRow.appendChild(pill);
  });

  const accel = d1h > 0 && d6h > 0 && (d1h / (d6h / 6)) > 1.1;
  const decel = d1h > 0 && d6h > 0 && (d1h / (d6h / 6)) < 0.9;
  if (accel || decel) {
    const tag = document.createElement("span");
    tag.className = `trend-tag ${accel ? "accel" : "slow"}`;
    tag.textContent = accel ? strings.growth.accelerating : strings.growth.slowing;
    deltaRow.appendChild(tag);
  }

  block.appendChild(deltaRow);
  group.appendChild(block);
  return group;
}

// ── Top videos ────────────────────────────────────────────

async function loadTopVideos() {
  const container = $("top-videos-list");
  const strings = t();
  container.innerHTML = `<div class="status-loading">${strings.ui.loadingTop}</div>`;

  try {
    const data = await sendMessage({
      type: "GET_TOP_VIDEOS",
      regionCode: currentRegion,
      categoryId: currentCategory
    });
    if (data.error) throw new Error(data.message);

    container.innerHTML = "";

    if (data.usedFallback && currentCategory) {
      const catLabel = strings.categories[currentCategory] || currentCategory;
      const note = document.createElement("div");
      note.className = "fallback-note";
      note.textContent = strings.rank.fallbackNote
        .replace("{cat}", catLabel)
        .replace("{region}", currentRegion);
      container.appendChild(note);
    }

    data.videos.slice(0, 50).forEach((video, i) => {
      container.appendChild(renderTopVideoItem(video, i + 1));
    });

    const ts = $("last-updated");
    if (ts) ts.textContent = strings.ui.updatedNow;
  } catch (err) {
    container.innerHTML = `<div class="status-error">${escapeHtml(err.message || "Error.")}</div>`;
  }
}

function renderTopVideoItem(video, rank) {
  const a = document.createElement("a");
  a.className = "top-video-item";
  a.href = `https://www.youtube.com/watch?v=${video.id}`;
  a.target = "_blank";
  a.rel = "noopener noreferrer";

  const rankEl = document.createElement("div");
  rankEl.className = "top-video-rank" + (rank === 1 ? " gold" : rank === 2 ? " silver" : rank === 3 ? " bronze" : "");
  rankEl.textContent = `#${rank}`;

  const thumbEl = document.createElement("img");
  thumbEl.className = "top-video-thumb";
  thumbEl.src = video.snippet?.thumbnails?.default?.url || "";
  thumbEl.alt = "";

  const info = document.createElement("div");
  info.className = "top-video-info";
  info.innerHTML = `
    <div class="top-video-title">${escapeHtml(video.snippet?.title || "")}</div>
    <div class="top-video-channel">${escapeHtml(video.snippet?.channelTitle || "")}</div>
  `;

  const views = document.createElement("div");
  views.className = "top-video-views";
  views.textContent = formatViews(video.statistics?.viewCount || 0);

  a.append(rankEl, thumbEl, info, views);
  return a;
}

// ── Promotions ────────────────────────────────────────────

const WORKER_BASE        = CONFIG.WORKER_BASE;
const CAROUSEL_VIDEO_MS  = 15000;
const CAROUSEL_BUMPER_MS = 2200;
const CAROUSEL_FLASH_MS  = 1600;
const CAROUSEL_SWAP_AT   = 700;

async function loadAd() {
  const container = $("ad-container");
  try {
    const qs = `region=${encodeURIComponent(currentRegion)}&category=${encodeURIComponent(currentCategory)}`;
    const res = await fetch(`${WORKER_BASE}/promotions?${qs}`);
    if (!res.ok) return;
    const data = await res.json();
    const promo = data.promo;
    if (!promo) return;
    buildSpotlightCarousel(container, [promo]);
  } catch { /* skip */ }
}

function buildSpotlightCarousel(container, promos) {
  const header = document.createElement("div");
  header.className = "spotlight-header";
  const labelEl = document.createElement("span");
  labelEl.className = "spotlight-label";
  labelEl.textContent = "Community Spotlight";
  header.appendChild(labelEl);

  let dotsEl = null;
  if (promos.length > 1) {
    dotsEl = document.createElement("div");
    dotsEl.className = "spotlight-dots";
    promos.forEach((_, i) => {
      const dot = document.createElement("div");
      dot.className = "sdot" + (i === 0 ? " active" : "");
      dotsEl.appendChild(dot);
    });
    header.appendChild(dotsEl);
  }
  container.appendChild(header);

  const carouselWrap = document.createElement("div");
  carouselWrap.className = "spotlight-carousel-wrap";

  const carouselEl = document.createElement("div");
  carouselEl.className = "spotlight-carousel";

  const sequence = [];
  promos.forEach((promo, i) => {
    const vSlide = buildVideoSlide(promo);
    carouselEl.appendChild(vSlide);
    sequence.push({ el: vSlide, dot: i, duration: CAROUSEL_VIDEO_MS });

    const bSlide = buildBumperSlide();
    carouselEl.appendChild(bSlide);
    sequence.push({ el: bSlide, dot: null, duration: CAROUSEL_BUMPER_MS });
  });

  const flashEl = document.createElement("div");
  flashEl.className = "spotlight-golden-flash";
  carouselEl.appendChild(flashEl);

  carouselWrap.appendChild(carouselEl);

  const progressWrap = document.createElement("div");
  progressWrap.className = "spotlight-progress";
  const progressBar = document.createElement("div");
  progressBar.className = "spotlight-progress-bar";
  progressWrap.appendChild(progressBar);
  carouselWrap.appendChild(progressWrap);

  container.appendChild(carouselWrap);

  let current   = 0;
  let swapTimer = null;
  let nextTimer = null;
  let progAnim  = null;
  let progStart = null;

  function allDots() {
    return dotsEl ? Array.from(dotsEl.querySelectorAll(".sdot")) : [];
  }

  function startProgress(duration) {
    if (progAnim) cancelAnimationFrame(progAnim);
    progressBar.style.width = "0%";
    progStart = performance.now();
    function tick(now) {
      const pct = Math.min(((now - progStart) / duration) * 100, 100);
      progressBar.style.width = pct + "%";
      if (pct < 100) progAnim = requestAnimationFrame(tick);
    }
    progAnim = requestAnimationFrame(tick);
  }

  function stopProgress() {
    if (progAnim) cancelAnimationFrame(progAnim);
    progressBar.style.width = "0%";
  }

  function activateStep(index) {
    sequence.forEach(s => {
      s.el.classList.remove("active");
      s.el.stopVideo?.();
    });
    const step = sequence[index];
    step.el.classList.add("active");
    step.el.startVideo?.();
    const dots = allDots();
    if (step.dot !== null) {
      dots.forEach(d => d.classList.remove("active"));
      if (dots[step.dot]) dots[step.dot].classList.add("active");
      startProgress(step.duration);
    } else {
      stopProgress();
    }
  }

  function advance(fromIndex) {
    const nextIndex = (fromIndex + 1) % sequence.length;
    flashEl.classList.remove("firing");
    void flashEl.offsetWidth;
    flashEl.classList.add("firing");
    clearTimeout(swapTimer);
    swapTimer = setTimeout(() => activateStep(nextIndex), CAROUSEL_SWAP_AT);
    clearTimeout(nextTimer);
    nextTimer = setTimeout(() => {
      current = nextIndex;
      advance(current);
    }, sequence[nextIndex].duration + CAROUSEL_FLASH_MS);
  }

  activateStep(0);
  nextTimer = setTimeout(() => advance(0), sequence[0].duration);
}

function buildVideoSlide(promo) {
  const videoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(promo.videoId)}`;
  const thumbUrl = escapeHtml(promo.thumbnailUrl || `https://i.ytimg.com/vi/${promo.videoId}/mqdefault.jpg`);

  const tierBadge = promo.tier === "gold"
    ? `<span class="vs-tier-badge gold">★ Premium</span>`
    : promo.tier === "silver"
    ? `<span class="vs-tier-badge silver">✦ Featured</span>`
    : promo.tier === "bronze"
    ? `<span class="vs-tier-badge bronze">▲ Featured</span>`
    : "";

  const slide = document.createElement("div");
  slide.className = "c-slide";
  slide.innerHTML = `
    <img class="vs-thumb" src="${thumbUrl}" alt="" />
    <div class="vs-gradient"></div>
    ${tierBadge}
    <div class="vs-info">
      <div>
        <div class="vs-title">${escapeHtml(promo.title)}</div>
        <div class="vs-channel">${escapeHtml(promo.channel)}</div>
      </div>
      <a class="vs-watch" href="${videoUrl}" target="_blank" rel="noopener noreferrer">Watch →</a>
    </div>
  `;

  slide.querySelector(".vs-watch").addEventListener("click", (e) => {
    e.stopPropagation();
    fetch(`${WORKER_BASE}/promotions/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promotionId: promo.id }),
    }).catch(() => {});
  });

  let iframeEl   = null;
  let msgHandler = null;

  slide.startVideo = () => {
    if (iframeEl) return;

    const src = `${WORKER_BASE}/player?v=${encodeURIComponent(promo.videoId)}&c=${encodeURIComponent(promo.channel||'')}&ti=${encodeURIComponent((promo.title||'').slice(0,60))}`;

    iframeEl = document.createElement("iframe");
    iframeEl.className = "vs-iframe";
    iframeEl.src = src;
    iframeEl.setAttribute("frameborder", "0");
    iframeEl.allow = "autoplay";
    iframeEl.referrerPolicy = "strict-origin-when-cross-origin";

    slide.appendChild(iframeEl);
  };

  slide.stopVideo = () => {
    if (iframeEl) { iframeEl.remove(); iframeEl = null; }
  };

  return slide;
}

function buildBumperSlide() {
  const slide = document.createElement("div");
  slide.className = "c-slide";
  slide.innerHTML = `
    <div class="bs-wrap">
      <img class="bs-logo" src="icons/icon128.png" alt="" />
      <span class="bs-name">NODUS YT Radar</span>
      <span class="bs-sub">Community Spotlight</span>
    </div>
  `;
  return slide;
}

// ── Helpers ───────────────────────────────────────────────

function isValidRegion(code) {
  return CONFIG.REGIONS.some(r => r.code === code);
}

function isValidCategory(id) {
  return CONFIG.CATEGORIES.some(c => c.id === id);
}

async function getPageContext() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return resolve({});
      chrome.tabs.sendMessage(tabs[0].id, { type: "GET_PAGE_CONTEXT" }, (res) => {
        if (chrome.runtime.lastError || !res) return resolve({});
        resolve(res);
      });
    });
  });
}

async function getActiveTabVideoId() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const match = (tabs[0]?.url || "").match(/[?&]v=([^&]+)/);
      resolve(match ? match[1] : null);
    });
  });
}

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ error: true, message: chrome.runtime.lastError.message });
        return;
      }
      resolve(res || { error: true, message: "No response" });
    });
  });
}

function getRegionFlag(code) {
  const flags = {
    BR: "🇧🇷", US: "🇺🇸", PT: "🇵🇹", JP: "🇯🇵", KR: "🇰🇷",
    MX: "🇲🇽", AR: "🇦🇷", GB: "🇬🇧", FR: "🇫🇷", DE: "🇩🇪", IN: "🇮🇳",
    SA: "🇸🇦", EG: "🇪🇬", TR: "🇹🇷", ID: "🇮🇩", RU: "🇷🇺", PL: "🇵🇱",
    UA: "🇺🇦", VN: "🇻🇳", TH: "🇹🇭", IT: "🇮🇹", NL: "🇳🇱", NG: "🇳🇬",
    CN: "🇨🇳", TW: "🇹🇼"
  };
  return flags[code] || "🌍";
}

function applyDir(lang) {
  document.documentElement.dir = RTL_LANGS.has(lang) ? "rtl" : "ltr";
}

function initTooltips() {
  const box = document.getElementById("tip-box");
  if (!box) return;

  document.addEventListener("mouseover", (e) => {
    const icon = e.target.closest(".info-icon[data-tip]");
    if (!icon) return;
    box.textContent = icon.dataset.tip;
    box.style.display = "block";

    const r       = icon.getBoundingClientRect();
    const TIP_W   = 220;
    const MARGIN  = 8;
    const vpW     = document.documentElement.clientWidth;

    let left = r.left;
    if (left + TIP_W > vpW - MARGIN) left = vpW - TIP_W - MARGIN;
    if (left < MARGIN) left = MARGIN;

    const top = r.top - box.offsetHeight - 7;
    box.style.left = left + "px";
    box.style.top  = (top < MARGIN ? r.bottom + 7 : top) + "px";
  });

  document.addEventListener("mouseout", (e) => {
    if (e.target.closest(".info-icon[data-tip]")) box.style.display = "none";
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
