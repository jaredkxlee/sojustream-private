require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// 🔒 CONFIGURATION
const TMDB_KEY = process.env.TMDB_KEY;
const PROXY_URL = "https://jaredlkx-soju-tunnel.hf.space"; // Your Correct Proxy URL
const PROXY_PASS = process.env.PROXY_PASS; // Ensure this matches your Space secrets

const builder = new addonBuilder({
    id: "org.sojustream.jared.v12", // 👈 CHANGED ID (Mandatory for refresh)
    version: "12.0.0",
    name: "SojuStream (Final Proxy)",
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

// Helper: Wrap URL in MediaFlow Proxy
function getProxiedUrl(targetUrl) {
    const headers = JSON.stringify({ 
        "Referer": "https://kisskh.do/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });
    return `${PROXY_URL}/proxy/stream?url=${encodeURIComponent(targetUrl)}&api_password=${PROXY_PASS}&headers=${encodeURIComponent(headers)}`;
}

// --- 1. CATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    console.log(`[Catalog] Requesting ${args.id}`);
    const domain = "kisskh.do";
    let targetUrl = "";
    
    // ✅ 1. Map IDs to YOUR provided APIs
    if (args.extra && args.extra.search) {
        targetUrl = `https://${domain}/api/DramaList/Search?q=${encodeURIComponent(args.extra.search)}&type=0`;
    } else {
        switch(args.id) {
            case "latest_updates":
                targetUrl = `https://${domain}/api/DramaList/List?page=1&type=0&sub=0&country=0&status=0&order=2`;
                break;
            case "top_kdrama":
                // Using 'order=1' for Top Rated based on your previous logs
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
        // ✅ 2. Try fetching via Proxy first
        console.log(`[Catalog] Fetching via Proxy: ${targetUrl}`);
        const proxiedUrl = getProxiedUrl(targetUrl);
        let response = await axios.get(proxiedUrl, { timeout: 8000 }); // 8s timeout
        
        // If proxy returns junk, try direct (fallback)
        if (!response.data || (!response.data.results && !Array.isArray(response.data))) {
            console.log("[Catalog] Proxy failed/empty. Trying Direct...");
            response = await axios.get(targetUrl, { 
                headers: { 
                    "Referer": "https://kisskh.do/",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                },
                timeout: 5000
            });
        }

        const items = response.data.results || response.data;

        if (!Array.isArray(items)) {
            console.error("[Catalog] Final Result is not an array:", response.data);
            return { metas: [] };
        }

        // ✅ 3. Map to Stremio Format
        const metas = items.map(item => ({
            id: `tmdb:${item.id}`,
            type: "series",
            name: item.title,
            poster: item.thumbnail,
            description: "Watch on KissKH"
        }));

        console.log(`[Catalog] Returning ${metas.length} items`);
        return { metas };

    } catch (e) {
        console.error("[Catalog] Error:", e.message);
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

        // 1. Get Title from TMDB
        const type = args.type === 'series' ? 'tv' : 'movie';
        const metaRes = await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}`);
        const title = metaRes.data.name || metaRes.data.title;

        // 2. Search KissKH (Proxied)
        const searchUrl = `https://kisskh.do/api/DramaList/Search?q=${encodeURIComponent(title)}&type=0`;
        const searchRes = await axios.get(getProxiedUrl(searchUrl));

        if (searchRes.data && searchRes.data[0]) {
            const drama = searchRes.data[0];
            // 3. Get Episode List (Proxied)
            const detailUrl = `https://kisskh.do/api/DramaList/Drama/${drama.id}?isMovie=${args.type === 'movie'}`;
            const detailRes = await axios.get(getProxiedUrl(detailUrl));
            
            const targetEp = (detailRes.data.episodes || []).find(e => e.number == episode);
            
            if (targetEp) {
                // 4. Get Video Link (Proxied)
                const videoApiUrl = `https://kisskh.do/api/ExternalLoader/VideoService/${targetEp.id}?device=2`;
                const videoRes = await axios.get(getProxiedUrl(videoApiUrl));
                
                // 5. Return MediaFlow Stream URL
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