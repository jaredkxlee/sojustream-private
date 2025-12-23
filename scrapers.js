require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// 🔒 FLARESOLVERR CONFIGURATION
const FLARESOLVERR_URL = "https://soju-proxy.onrender.com/v1"; 
const SESSION_NAME = 'kisskh-persistent';

// 🚀 IN-MEMORY CACHE (Saves speed!)
const CACHE = {
    catalog: {}, // Stores list of movies
    meta: {},    // Stores details (to fix "Season 10737")
    expiry: {}   // When to refresh
};

const builder = new addonBuilder({
    id: "org.sojustream.jared.v25",
    version: "25.0.0",
    name: "SojuStream (v25 Speed Fix)",
    description: "KissKH: Cached & Optimized",
    resources: ["catalog", "meta", "stream"], 
    types: ["series", "movie"],
    idPrefixes: ["kisskh:"], 
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
        }
    ]
});

// ✅ HELPER: STARTUP SESSION (Run once, use forever)
async function initSession() {
    try {
        console.log(`[v25] 🔥 Warming up FlareSolverr...`);
        await axios.post(FLARESOLVERR_URL, {
            cmd: 'sessions.create', session: SESSION_NAME
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 5000 }).catch(() => {});
        console.log(`[v25] ✅ Session Ready.`);
    } catch (e) {
        console.log(`[v25] ⚠️ Session Init Warning: ${e.message}`);
    }
}
// Run on startup
initSession();

// ✅ HELPER: FETCH WITH TIMEOUT & CACHE
async function fetchWithFlare(targetUrl, type = 'json') {
    // 1. Check Cache
    if (CACHE[targetUrl] && Date.now() < CACHE.expiry[targetUrl]) {
        console.log(`[v25] ⚡ Served from Cache: ${targetUrl}`);
        return CACHE[targetUrl];
    }

    try {
        console.log(`[v25] ⏳ Fetching: ${targetUrl}`);
        
        // 2. Request with Strict Timeout (Stremio gives up after ~15s)
        const response = await axios.post(FLARESOLVERR_URL, {
            cmd: 'request.get',
            url: targetUrl,
            session: SESSION_NAME,
            maxTimeout: 15000, // 15s Max
        }, { 
            headers: { 'Content-Type': 'application/json' },
            timeout: 20000 // Cut connection if stuck
        });

        if (response.data.status === 'ok') {
            const rawText = response.data.solution.response;
            const jsonStart = rawText.indexOf('{');
            const jsonEnd = rawText.lastIndexOf('}');
            
            if (jsonStart !== -1 && jsonEnd !== -1) {
                const data = JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
                
                // 3. Save to Cache (Valid for 15 minutes)
                CACHE[targetUrl] = data;
                CACHE.expiry[targetUrl] = Date.now() + (15 * 60 * 1000);
                return data;
            }
        }
        return null;
    } catch (e) {
        console.error(`[v25] ❌ Fetch Error: ${e.message}`);
        return null;
    }
}

// --- 1. CATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    const page = args.extra && args.extra.skip ? Math.floor(args.extra.skip / 20) + 1 : 1;
    let targetUrl = "";
    
    if (args.extra && args.extra.search) {
        targetUrl = `https://kisskh.do/api/DramaList/Search?q=${encodeURIComponent(args.extra.search)}&type=0`;
    } else {
        switch(args.id) {
            case "latest_updates": targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=0&status=0&order=2`; break;
            case "top_kdrama": targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=0&order=1`; break;
            default: return { metas: [] };
        }
    }

    const data = await fetchWithFlare(targetUrl);
    const items = data ? (data.results || data.data || data) : [];

    if (Array.isArray(items)) {
        return { metas: items.map(item => ({
            id: `kisskh:${item.id}`,
            type: "series",
            name: item.title,
            poster: item.thumbnail, 
            description: item.status || "Watch on KissKH",
            posterShape: 'landscape'
        })) };
    }
    return { metas: [] };
});

// --- 2. META HANDLER (Crucial for "Season 10737" Fix) ---
builder.defineMetaHandler(async (args) => {
    if (!args.id.startsWith("kisskh:")) return { meta: {} };
    
    const kisskhId = args.id.split(":")[1];
    const detailUrl = `https://kisskh.do/api/DramaList/Drama/${kisskhId}?isMovie=false`;
    
    // Use Cache if possible, otherwise this might timeout
    const data = await fetchWithFlare(detailUrl);

    if (!data) {
        // FAILSAFE: If timeout, return BASIC meta so Stremio doesn't bug out
        // This prevents the "Season 10737" bug by giving at least a title
        return { meta: {
            id: args.id, type: "series", name: "Loading...", description: "Please go back and click again."
        }};
    }

    // Sort Episodes properly (Newest to Oldest usually, but Stremio likes Oldest to Newest)
    const episodes = (data.episodes || []).sort((a, b) => parseInt(a.number) - parseInt(b.number));

    return {
        meta: {
            id: args.id,
            type: "series",
            name: data.title,
            poster: data.thumbnail,
            background: data.thumbnail,
            description: data.description || "Description unavailable.",
            releaseInfo: data.releaseDate,
            genres: data.genres ? data.genres.map(g => g.name) : [],
            // 🔥 FIXED: Explicitly tell Stremio the Season/Episode structure
            videos: episodes.map(ep => ({
                id: `kisskh:${kisskhId}:${1}:${ep.number}`,
                title: `Episode ${ep.number}`,
                season: 1,
                episode: parseInt(ep.number) || 1,
                released: new Date().toISOString()
            }))
        }
    };
});

// --- 3. STREAM HANDLER ---
builder.defineStreamHandler(async (args) => {
    if (!args.id.startsWith("kisskh:")) return { streams: [] };

    console.log(`[v25] Stream: ${args.id}`);
    const parts = args.id.split(":");
    const dramaId = parts[1];
    const episodeNum = parts[3]; 

    if (!dramaId || !episodeNum) return { streams: [] };

    try {
        const detailUrl = `https://kisskh.do/api/DramaList/Drama/${dramaId}?isMovie=false`;
        const data = await fetchWithFlare(detailUrl); // Uses Cache! Fast!
        
        if (!data || !data.episodes) return { streams: [] };

        const targetEp = data.episodes.find(e => e.number == episodeNum);

        if (targetEp) {
            const videoApiUrl = `https://kisskh.do/api/ExternalLoader/VideoService/${targetEp.id}?device=2`;
            // Video link request MUST be fresh (no cache)
            const videoData = await fetchWithFlare(videoApiUrl);
            
            if (videoData && videoData.Video) {
                return {
                    streams: [{
                        name: "⚡ SojuStream",
                        title: `Ep ${episodeNum} | ${data.title}`,
                        url: videoData.Video
                    }]
                };
            }
        }
    } catch (e) {
        console.error("Stream Error:", e.message);
    }
    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 10000, host: "0.0.0.0" });