// 1. PASTE THIS LINE AT THE VERY TOP (Line 1):
process.env.PROXY_PASS = "https://jaredlkx:12345678@jaredlkx-soju-tunnel.hf.space:443";require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// 🔒 CONFIGURATION
const TMDB_KEY = process.env.TMDB_KEY;
const PROXY_URL = "https://jaredlkx-soju-tunnel.hf.space"; 
// 🛡️ AUTO-FIX: Trims hidden spaces from the password
constRPXY_PASS = (process.env.PROXY_PASS || "").trim();

const builder = new addonBuilder({
    id: "org.sojustream.jared.v16", // 👈 Version 16 (Check for this in logs!)
    version: "16.0.0",
    name: "SojuStream (v16 Fix)",
    description: "KissKH via MediaFlow",
    resources: ["catalog", "stream"], 
    types: ["series", "movie"],
    idPrefixes: ["tmdb:", "tt"],
    catalogs: [
        {
            id: "latest_updates",
            type: "series",
            name: "KissKH: Latest Updates",
            extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
        },
        {
            id: "top_kdrama",
            type: "series",
            name: "KissKH: Top K-Drama",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            id: "upcoming_drama",
            type: "series",
            name: "KissKH: Upcoming",
            extra: [{ name: "skip", isRequired: false }]
        }
    ]
});

// ✅ HELPER: SAFE URL BUILDER (Fixes 422 Errors)
function getProxiedUrl(targetUrl) {
    const headers = { 
        "Referer": "https://kisskh.do/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };

    const params = new URLSearchParams();
    params.append("url", targetUrl);
    params.append("api_password", PROXY_PASS || ""); // Uses your 12345678 password
    params.append("headers", JSON.stringify(headers));

    return `${PROXY_URL}/proxy/stream?${params.toString()}`;
}

// --- 1. CATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    console.log(`[v16] Requesting ${args.id}`); // 👈 LOOK FOR [v16] IN LOGS
    const domain = "kisskh.do";
    const page = args.extra && args.extra.skip ? Math.floor(args.extra.skip / 20) + 1 : 1;
    
    if (args.extra && args.extra.search) {
        targetUrl = `https://${domain}/api/DramaList/Search?q=${encodeURIComponent(args.extra.search)}&type=0`;
    } else {
        switch(args.id) {
            case "latest_updates":
                targetUrl = `https://${domain}/api/DramaList/List?page=${page}&type=0&sub=0&country=0&status=0&order=2`;
                break;
            case "top_kdrama":
                targetUrl = `https://${domain}/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=0&order=1`;
                break;
            case "upcoming_drama":
                targetUrl = `https://${domain}/api/DramaList/List?page=${page}&type=0&sub=0&country=0&status=3&order=2`;
                break;
            default:
                return { metas: [] };
        }
    }

    try {
        const proxiedUrl = getProxiedUrl(targetUrl);
        // Debug Log
        console.log(`[v16] Connecting to Proxy... (Pass len: ${PROXY_PASS.length})`);
        
        const response = await axios.get(proxiedUrl, { timeout: 15000 });
        const items = response.data.results || response.data;

        if (!Array.isArray(items)) {
            // Handle "MostSearch" or wrapped data formats
            if (response.data.data && Array.isArray(response.data.data)) {
                 return { metas: mapItems(response.data.data) };
            }
            console.error("[v16] Proxy returned invalid data structure:", JSON.stringify(response.data).substring(0, 100));
            return { metas: [] };
        }

        console.log(`[v16] Success! Found ${items.length} items.`);
        return { metas: mapItems(items) };

    } catch (e) {
        if (e.response) console.error(`[v16] Proxy Error ${e.response.status}:`, e.response.data);
        else console.error("[v16] Connection Error:", e.message);
        return { metas: [] };
    }
});

// Helper to map items
function mapItems(items) {
    return items.map(item => ({
        id: `tmdb:${item.id}`,
        type: "series",
        name: item.title,
        poster: item.thumbnail,
        description: "Watch on KissKH"
    }));
}

// --- 2. STREAM HANDLER ---
builder.defineStreamHandler(async (args) => {
    const streams = [];
    try {
        const parts = args.id.split(":");
        const tmdbId = parts[1];
        const episode = parts[3] || 1;

        const type = args.type === 'series' ? 'tv' : 'movie';
        const metaRes = await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}`);
        const title = metaRes.data.name || metaRes.data.title;

        // Search KissKH (Proxied)
        const searchUrl = `https://kisskh.do/api/DramaList/Search?q=${encodeURIComponent(title)}&type=0`;
        const searchRes = await axios.get(getProxiedUrl(searchUrl));

        if (searchRes.data && searchRes.data[0]) {
            const drama = searchRes.data[0];
            const detailUrl = `https://kisskh.do/api/DramaList/Drama/${drama.id}?isMovie=${args.type === 'movie'}`;
            const detailRes = await axios.get(getProxiedUrl(detailUrl));
            
            const targetEp = (detailRes.data.episodes || []).find(e => e.number == episode);
            
            if (targetEp) {
                const videoApiUrl = `https://kisskh.do/api/ExternalLoader/VideoService/${targetEp.id}?device=2`;
                const videoRes = await axios.get(getProxiedUrl(videoApiUrl));
                const finalUrl = getProxiedUrl(videoRes.data.Video);
                
                streams.push({
                    name: "⚡ Soju-Proxy",
                    title: `1080p | ${title} | E${episode}`,
                    url: finalUrl
                });
            }
        }
    } catch (e) { console.error("Stream Error:", e.message); }
    return { streams };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 10000, host: "0.0.0.0" });