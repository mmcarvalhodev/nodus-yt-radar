export const CONFIG = {
  // All YouTube Data API v3 calls go through this Worker (which holds the
  // env.YOUTUBE_API_KEY secret server-side). The extension never holds the key.
  WORKER_BASE: "https://worker-yt-radar.mmcarvalho-dev.workers.dev",
  DEFAULT_REGION: "BR",
  CACHE_TTL_MINUTES: 30,
  MAX_RESULTS: 50,
  ADS_URL: "https://your-domain.com/yt-rank-radar/ads.json",

  REGIONS: [
    { code: "BR", label: "Brasil",           flag: "🇧🇷" },
    { code: "US", label: "United States",    flag: "🇺🇸" },
    { code: "PT", label: "Portugal",         flag: "🇵🇹" },
    { code: "JP", label: "Japan",            flag: "🇯🇵" },
    { code: "KR", label: "South Korea",      flag: "🇰🇷" },
    { code: "MX", label: "Mexico",           flag: "🇲🇽" },
    { code: "AR", label: "Argentina",        flag: "🇦🇷" },
    { code: "GB", label: "United Kingdom",   flag: "🇬🇧" },
    { code: "FR", label: "France",           flag: "🇫🇷" },
    { code: "DE", label: "Germany",          flag: "🇩🇪" },
    { code: "IN", label: "India",            flag: "🇮🇳" },
    { code: "SA", label: "Saudi Arabia",     flag: "🇸🇦" },
    { code: "EG", label: "Egypt",            flag: "🇪🇬" },
    { code: "TR", label: "Turkey",           flag: "🇹🇷" },
    { code: "ID", label: "Indonesia",        flag: "🇮🇩" },
    { code: "RU", label: "Russia",           flag: "🇷🇺" },
    { code: "PL", label: "Poland",           flag: "🇵🇱" },
    { code: "UA", label: "Ukraine",          flag: "🇺🇦" },
    { code: "VN", label: "Vietnam",          flag: "🇻🇳" },
    { code: "TH", label: "Thailand",         flag: "🇹🇭" },
    { code: "IT", label: "Italy",            flag: "🇮🇹" },
    { code: "NL", label: "Netherlands",      flag: "🇳🇱" },
    { code: "NG", label: "Nigeria",          flag: "🇳🇬" },
    { code: "CN", label: "China",            flag: "🇨🇳" },
    { code: "TW", label: "Taiwan",           flag: "🇹🇼" }
  ],

  OVERLAY_MODES: {
    OFF: "off",
    BADGE: "badge",
    EXPANDED: "expanded",
    TICKER: "ticker"
  },

  CATEGORIES: [
    { id: "", label: "All" },
    { id: "10", label: "Music" },
    { id: "20", label: "Gaming" },
    { id: "24", label: "Entertainment" },
    { id: "17", label: "Sports" },
    { id: "25", label: "News & Politics" },
    { id: "22", label: "People & Blogs" },
    { id: "23", label: "Comedy" },
    { id: "28", label: "Science & Tech" },
    { id: "27", label: "Education" },
    { id: "26", label: "Howto & Style" },
    { id: "19", label: "Travel & Events" },
    { id: "1",  label: "Film & Animation" },
    { id: "2",  label: "Autos & Vehicles" },
    { id: "15", label: "Pets & Animals" }
  ]
};
