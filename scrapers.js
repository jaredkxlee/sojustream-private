require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// 🔒 CONFIGURATION
const FLARESOLVERR_URL = "https://soju-proxy.onrender.com/v1"; 
const TMDB_KEY = "b80e5b1b965da72a2a23ba5680cb778a";
const SESSION_NAME = 'kisskh-v27';

// 🚀 IN-MEMORY CACHE
const CACHE = { meta: {}, expiry: {} };

const builder = new addonBuilder({
    id: "org.sojustream.jared.v27",
    version: "27.0.0",
    name: "SojuStream (v27 Korea Only)",
    description: "KissKH: Korea Only, Performance Fix",
    resources: ["catalog", "meta", "stream"], 
    types: ["series", "movie"],
    idPrefixes: ["kisskh:"], 
    catalogs: [
        { id: "latest_updates", type: "series", name: "KissKH: Latest K-Drama", extra: [{ name: "skip", isRequired: false }] },
        { id: "top_kdrama", type: "series", name: "KissKH: Top K-Drama", extra: [{ name: "skip", isRequired: false }] },
        { id: "upcoming_drama", type: "series", name: "KissKH: Upcoming K-Drama", extra: [{ name: "skip", isRequired: false }] }
    ]
});

// ✅ HELPER: INTELLIGENT FETCH
async function fetchWithFlare(targetUrl, useCache = true, customTimeout = 40000) {
    if (useCache && CACHE[targetUrl] && Date.now() < CACHE.expiry[targetUrl]) return CACHE[targetUrl];

    try {
        console.log(`[v27] ⏳ Requesting: ${targetUrl}`);
        // Ensure session exists
        await axios.post(FLARESOLVERR_URL, { cmd: 'sessions.create', session: SESSION_NAME }).catch(() => {});

        const response = await axios.post(FLARESOLVERR_URL, {
            cmd: 'request.get',
            url: targetUrl,
            session: SESSION_NAME,
            maxTimeout: customTimeout,
        }, { timeout: customTimeout + 5000 });

        if (response.data.status === 'ok') {
            const rawText = response.data.solution.response;
            const jsonStart = rawText.indexOf('{');
            const jsonEnd = rawText.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1) {
                const data = JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
                if (useCache) {
                    CACHE[targetUrl] = data;
                    CACHE.expiry[targetUrl] = Date.now() + (30 * 60 * 1000); 
                }
                return data;
            }
        }
        return null;
    } catch (e) {
        console.error(`[v27] ❌ Error: ${e.message}`);
        return null;
    }
}

// --- 1. CATALOG HANDLER (Fixed Korea Only) ---
builder.defineCatalogHandler(async (args) => {
    const page = args.extra && args.extra.skip ? Math.floor(args.extra.skip / 20) + 1 : 1;
    let targetUrl = "";
    switch(args.id) {
        case "latest_updates": targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=0&order=2`; break;
        case "top_kdrama": targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=0&order=1`; break;
        case "upcoming_drama": targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=3&order=2`; break;
        default: return { metas: [] };
    }

    const data = await fetchWithFlare(targetUrl);
    const items = data ? (data.results || data.data || data) : [];
    if (Array.isArray(items)) {
        return { metas: items.map(item => ({
            id: `kisskh:${item.id}`, type: "series", name: item.title, poster: item.thumbnail, posterShape: 'landscape'
        })) };
    }
    return { metas: [] };
});

// --- 2. META HANDLER ---
builder.defineMetaHandler(async (args) => {
    const kisskhId = args.id.split(":")[1];
    const data = await fetchWithFlare(`https://kisskh.do/api/DramaList/Drama/${kisskhId}?isMovie=false`);
    if (!data) return { meta: { id: args.id, type: "series", name: "Error" } };

    return { meta: {
        id: args.id, type: "series", name: data.title, poster: data.thumbnail, background: data.thumbnail, description: data.description,
        videos: (data.episodes || []).map(ep => ({
            id: `kisskh:${kisskhId}:${1}:${ep.number}`, title: `Episode ${ep.number}`, season: 1, episode: parseInt(ep.number)
        })).sort((a,b) => a.episode - b.episode)
    }};
});

// --- 3. STREAM HANDLER (FlareSolverr for ALL requests) ---
builder.defineStreamHandler(async (args) => {
    const parts = args.id.split(":");
    const dramaId = parts[1];
    const epNum = parts[3];

    // 1. Get Details (Fresh Fetch)
    const data = await fetchWithFlare(`https://kisskh.do/api/DramaList/Drama/${dramaId}?isMovie=false`);
    if (!data || !data.episodes) return { streams: [] };

    const ep = data.episodes.find(e => String(e.number) === String(epNum));
    if (!ep) return { streams: [] };

    // 2. Get Video Link (Use FlareSolverr to solve the challenge on this specific API)
    const videoData = await fetchWithFlare(`https://kisskh.do/api/ExternalLoader/VideoService/${ep.id}?device=2`, false, 50000);

    if (videoData && videoData.Video) {
        return { streams: [{ name: "⚡ SojuStream", title: `1080p | Ep ${epNum}`, url: videoData.Video }] };
    }
    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 10000, host: "0.0.0.0" });
