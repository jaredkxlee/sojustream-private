require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// 🔒 CONFIGURATION
const TMDB_KEY = process.env.TMDB_KEY;
const PROXY_URL = "https://jaredlkx-soju-tunnel.hf.space"; 
const PROXY_PASS = process.env.PROXY_PASS; 

const builder = new addonBuilder({
    id: "org.sojustream.jared.v12.fix2", // 👈 New ID to force refresh
    version: "12.0.3",
    name: "SojuStream (Fixed Password)",
    description: "KissKH via MediaFlow",
    resources: ["catalog", "stream"], 
    types: ["series", "movie"],
    idPrefixes: ["tmdb:", "tt"],
    catalogs: [
        {
            id: "latest_updates",
            type: "series",
            name: "KissKH: Latest Updates",
            extra: [{ name: "search", isRequired: false }]
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

// ✅ HELPER: THIS IS WHERE THE FIX IS
function getProxiedUrl(targetUrl) {
    const headers = JSON.stringify({ 
        "Referer": "https://kisskh.do/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });

    // 🔴 THE FIX: encodeURIComponent wraps special symbols like '@'
    const safeUrl = encodeURIComponent(targetUrl);
    const safePass = encodeURIComponent(PROXY_PASS); // 👈 Fixes 'soju@123'
    const safeHeaders = encodeURIComponent(headers);

    return `${PROXY_URL}/proxy/stream?url=${safeUrl}&api_password=${safePass}&headers=${safeHeaders}`;
}

// --- 1. CATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    console.log(`[Catalog] Requesting ${args.id}`);
    const domain = "kisskh.do";
    let targetUrl = "";
    
    if (args.extra && args.extra.search) {
        targetUrl = `https://${domain}/api/DramaList/Search?q=${encodeURIComponent(args.extra.search)}&type=0`;
    } else {
        switch(args.id) {
            case "latest_updates":
                targetUrl = `https://${domain}/api/DramaList/List?page=1&type=0&sub=0&country=0&status=0&order=2`;
                break;
            case "top_kdrama":
                targetUrl = `https://${domain}/api/DramaList/List?page=1&type=0&sub=0&country=2&status=0&order=1`;
                break;
            case "upcoming_drama":
                targetUrl = `https://${domain}/api/DramaList/List?page=1&type=0&sub=0&country=0&status=3&order=2`;
                break;
            default:
                return { metas: [] };
        }
    }

    try {
        const proxiedUrl = getProxiedUrl(targetUrl);
        const response = await axios.get(proxiedUrl, { timeout: 10000 });
        const items = response.data.results || response.data;

        if (!Array.isArray(items)) {
            console.error("[Catalog] Proxy returned invalid data:", response.data);
            return { metas: [] };
        }

        return {
            metas: items.map(item => ({
                id: `tmdb:${item.id}`,
                type: "series",
                name: item.title,
                poster: item.thumbnail,
                description: "Watch on KissKH"
            }))
        };

    } catch (e) {
        // Log the exact error for debugging
        if (e.response) {
            console.error(`[Catalog] Error ${e.response.status}: ${e.response.statusText}`);
        } else {
            console.error("[Catalog] Connection Error:", e.message);
        }
        return { metas: [] };
    }
});

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
                constPkStreamUrl = videoRes.data.Video;

                // Ensure the final stream link also uses the encoded password
                const finalUrl = getProxiedUrl(constPkStreamUrl);
                
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