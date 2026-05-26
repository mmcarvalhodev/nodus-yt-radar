# NODUS YT Radar

**Real-time regional ranking, viral score and momentum for the YouTube video you're watching.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/Version-0.2.1-green.svg)](https://github.com/mmcarvalhodev/nodus-yt-radar)
[![Platform](https://img.shields.io/badge/Platform-Chrome%20%7C%20Firefox%20%7C%20Edge%20%7C%20Brave-orange.svg)](https://nodus-ai.app/yt-radar)
[![Privacy](https://img.shields.io/badge/No%20account-required-brightgreen.svg)](https://nodus-ai.app/yt-radar-privacy)

> **The video on your screen vs. the Top 50 of its country, right now.**

---

## What is YT Radar?

YT Radar is a browser extension that tells you, in real time, **how the YouTube video you're currently watching ranks against the Top 50 most-popular videos of its country** — plus a heat index, momentum trend, and a Top 50 dashboard you can filter by region and category.

It also detects when the channel you're watching is from a different country than your current region, and **auto-switches the leaderboard accordingly** (so a Mr Beast video doesn't get measured against Brazilian charts just because you're in Brazil).

---

## The problem

- "Is this video doing well?" is a binary question without context
- YouTube's own UI gives you views and likes but no comparison baseline
- Most YouTube analytics tools require a Google login and only work for your own channel
- Trends are regional, not global — a video can be huge in Japan and invisible in Brazil
- By the time a video is "trending," the momentum window is already half over

## The solution

- **Live rank vs. country Top 50** — every watched video gets compared against the country's chart of the moment
- **Viral score and heat index** — composite metric combining views/day, like ratio, comment velocity
- **Momentum trend** — local snapshots track if the video is accelerating or cooling down across your viewing sessions
- **Auto region detection** — uses the channel's declared country, falls back to title-language heuristics
- **Top 50 dashboard** — filter by 25 countries and 14 categories, no login required
- **Spotlight feed** — a Community Spotlight slot showcasing user-submitted videos (free + paid tiers)
- **17-language UI** — fully localized
- **Optional side panel mode (Chrome)** — open the analytics as a Chrome side panel instead of a popup

---

## Architecture

```
YouTube watch page → content script → background.js
                                         │
                                         ▼
                            Cloudflare Worker (proxy)
                            ─────────────────────────
                            Holds YOUTUBE_API_KEY as env secret
                            (extension never holds the key)
                                         │
                                         ▼
                            https://www.googleapis.com/youtube/v3
```

### Why the Worker proxy?

Embedding a YouTube Data API key in a browser extension is a security smell — bots scrape public extension packages for `AIza...` keys and exhaust the daily quota. The Worker holds the key server-side, lets us add caching and rate-limit centrally, and keeps the extension's host permissions narrow (`*.youtube.com` and the worker domain — that's it).

### What's stored where

- **In your browser** (`chrome.storage.local`): your settings (region, category, overlay style, UI mode, language), short-lived per-video cache, 48h view-count history for momentum, and a 24h cache of channel-country detections.
- **In the Worker** (D1 database): only Community Spotlight submissions (paid promo system). Regular ranking lookups are not logged per-user.
- **Never collected**: which videos you watch, your YouTube account, your browsing history, telemetry of any kind.

Full policy: [nodus-ai.app/yt-radar-privacy](https://nodus-ai.app/yt-radar-privacy)

---

## Repository structure

```
yt-rank-radar/
├── manifest.json           # Chrome MV3 manifest (popup + optional side panel)
├── manifest-firefox.json   # Firefox MV3 manifest
├── background.js           # Service worker — message hub, cache, region detection
├── content.js              # Content script — overlay badge on YouTube watch pages
├── overlay.css             # Overlay styling
├── popup.html / popup.js / popup.css   # Main UI (popup or side panel)
├── sidepanel.html          # Side panel shell (reuses popup.js + popup.css)
├── api.js                  # YouTube API client (calls the Worker, never googleapis directly)
├── ads.js                  # Sponsor/spotlight slot logic
├── config.js               # Static config (regions, categories, worker base URL)
├── ranking.js              # Rank math, heat index, momentum trend, region inference
├── storage.js              # chrome.storage helpers + per-key TTL
├── i18n.js                 # Runtime i18n
├── i18n/                   # 17 locale files
└── icons/                  # Extension icons
```

No build step. No bundler. Plain ES modules.

> The Cloudflare Worker source (`WORKER_YT_RADAR.js`) is kept private because it contains billing logic for the Community Spotlight (Paddle integration) and admin endpoints. The 3 YouTube proxy endpoints it exposes — `/youtube/most-popular`, `/youtube/video`, `/youtube/channel-country` — are documented in `api.js` and are the only ones the extension actually calls.

---

## Installation

### Chrome Web Store

[Install for Chrome →](https://nodus-ai.app/yt-radar)

Works on Chrome, Edge, Brave and other Chromium-based browsers.

### Firefox Add-ons

[Install for Firefox →](https://nodus-ai.app/yt-radar)

### Manual (Developer Mode)

```bash
git clone https://github.com/mmcarvalhodev/nodus-yt-radar.git
cd nodus-yt-radar
```

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the cloned folder

For Firefox: open `about:debugging` → **This Firefox** → **Load Temporary Add-on** → pick `manifest-firefox.json`.

---

## Verify the code yourself

```bash
# How rank vs. Top 50 is actually computed
cat ranking.js

# Region inference (channel.country → title language → audio language)
cat background.js  # see checkVideoRank()

# What ends up in chrome.storage.local
cat storage.js

# The Worker-proxied API client (no key in the extension)
cat api.js
```

Nothing is minified. Nothing is obfuscated.

---

## About the author

I'm M M Carvalho, a Brazilian solo full-stack developer. I build the NODUS family of browser extensions:

- **[NODUS](https://github.com/mmcarvalhodev/nodus)** — capture and organize AI conversations across 7 platforms
- **[NODUS HN Radar](https://github.com/mmcarvalhodev/nodus-hn-radar)** — reading layer + signal dashboard for Hacker News
- **NODUS YT Radar** — this project

My bias is toward simple, local-first tools that respect the user. No accounts unless they're necessary. No telemetry I wouldn't be comfortable showing the code for. If a feature can live in the browser, it should — and when it can't (like the YouTube API quota), the backend stays as small and inspectable as possible.

If YT Radar helps you spot a video's momentum before it peaks and you'd like to support more work like this, the support links below are appreciated — the extension itself is and will remain free.

---

## License

MIT License — see [LICENSE](LICENSE).

Use it, fork it, ship it. A credit link back is appreciated but not required.

---

## Links

- **Product page:** [nodus-ai.app/yt-radar](https://nodus-ai.app/yt-radar)
- **Privacy policy:** [nodus-ai.app/yt-radar-privacy](https://nodus-ai.app/yt-radar-privacy)
- **NODUS main site:** [nodus-ai.app](https://nodus-ai.app)
- **Sister projects:** [NODUS](https://github.com/mmcarvalhodev/nodus) · [HN Radar](https://github.com/mmcarvalhodev/nodus-hn-radar)

## Support

- **Email:** mmcarvalho.dev@gmail.com
- **GitHub Issues:** [Report a bug](https://github.com/mmcarvalhodev/nodus-yt-radar/issues)
- **Ko-fi:** [ko-fi.com/mmcarvalho](https://ko-fi.com/mmcarvalho)
- **GitHub Sponsors:** [github.com/sponsors/mmcarvalhodev](https://github.com/sponsors/mmcarvalhodev)
- **Community Spotlight:** got a video to promote? Submit at [nodus-ai.app/yt-radar](https://nodus-ai.app/yt-radar)

---

*Built local-first where it can be. Inspectable where it can't.*
