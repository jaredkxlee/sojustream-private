require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// 🔒 Use your Hugging Face proxy URL
const FLARESOLVERR_URL = "https://jaredlkx-soju-proxy.hf.space/v1"; 
const SESSION_NAME = 'sojustream_v29_stable';

const builder = new addonBuilder({
    id: "org.sojustream.jared.v29",
    version: "29.0.0",
    name: "SojuStream (Fixed)",
    description: "KissKH: South Korea Only | Optimized HF Proxy",
    resources: ["catalog", "meta", "stream"], 
    types: ["series", "movie"],
    idPrefixes: ["kisskh:"], 
    catalogs: [
        { id: "latest_updates", type: "series", name: "KissKH: Latest K-Drama", extra: [{ name: "skip", isRequired: false }] },
        { id: "top_kdrama", type: "series", name: "KissKH: Top K-Drama", extra: [{ name: "skip", isRequired: false }] },
        { id: "upcoming_drama", type: "series", name: "KissKH: Upcoming K-Drama", extra: [{ name: "skip", isRequired: false }] }
    ]
});

/**
 * Optimized fetcher that reuses a FlareSolverr session to save RAM.
 * Each new session consumes ~150MB-200MB of RAM.
 */
async function fetchWithFlare(targetUrl, customTimeout = 30000) {
    try {
        // Step 1: Ensure the persistent session exists
        await axios.post(FLARESOLVERR_URL, { 
            cmd: 'sessions.create', 
            session: SESSION_NAME 
        }).catch(() => {}); // Ignore error if session already exists

        // Step 2: Make the request using the session
        const response = await axios.post(FLARESOLVERR_URL, {
            cmd: 'request.get',
            url: targetUrl,
            session: SESSION_NAME,
            maxTimeout: customTimeout,
        }, { timeout: customTimeout + 5000 });

        if (response.data && response.data.status === 'ok') {
            const rawText = response.data.solution.response;
            
            // Step 3: Extract JSON from the HTML response
            const jsonStart = rawText.indexOf('{');
            const jsonEnd = rawText.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1) {
                return JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
            }
        }
        return null;
    } catch (e) {
        console.error(`[v29] Fetch Error: ${e.message}`);
        // If the session crashed, try destroying it so the next request can start fresh
        axios.post(FLARESOLVERR_URL, { cmd: 'sessions.destroy', session: SESSION_NAME }).catch(() => {});
        return null;
    }
}

// --- 1. CATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    const page = args.extra && args.extra.skip ? Math.floor(args.extra.skip / 20) + 1 : 1;
    let targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=0&order=2`;
    
    if (args.id === "top_kdrama") {
        targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=0&order=1`;
    } else if (args.id === "upcoming_drama") {
        targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=3&order=2`;
    }

    const data = await fetchWithFlare(targetUrl, 35000);
    const items = data ? (data.results || data.data || data) : [];
    
    return { metas: Array.isArray(items) ? items.map(item => ({
        id: `kisskh:${item.id}`,
        type: "series",
        name: item.title,
        poster: item.thumbnail,
        posterShape: 'landscape'
    })) : [] };
});

// --- 2. META HANDLER ---
builder.defineMetaHandler(async (args) => {
    const kisskhId = args.id.split(":")[1];
    const data = await fetchWithFlare(`https://kisskh.do/api/DramaList/Drama/${kisskhId}?isMovie=false`, 40000);
    
    if (!data) return { meta: {} };

    return { meta: {
        id: args.id,
        type: "series",
        name: data.title,
        poster: data.thumbnail,
        background: data.thumbnail,
        description: data.description,
        videos: (data.episodes || []).map(ep => ({
            id: `kisskh:${kisskhId}:1:${ep.number}`, // Standardizes ID for Stream Handler
            title: `Episode ${ep.number}`,
            season: 1,
            episode: parseInt(ep.number)
        })).sort((a,b) => a.episode - b.episode)
    }};
});

// --- 3. STREAM HANDLER ---
builder.defineStreamHandler(async (args) => {
    const parts = args.id.split(":");
    const dramaId = parts[1];
    const epNum = parts[3];

    console.log(`[v29] Attempting to find stream for Drama ${dramaId} Episode ${epNum}`);

    // Fetch meta again to get the specific internal 'id' for the episode
    const data = await fetchWithFlare(`https://kisskh.do/api/DramaList/Drama/${dramaId}?isMovie=false`, 45000);
    if (!data || !data.episodes) return { streams: [] };

    const ep = data.episodes.find(e => String(e.number) === String(epNum));
    if (!ep) return { streams: [] };

    // Final API call for the actual video URL
    const videoData = await fetchWithFlare(`https://kisskh.do/api/ExternalLoader/VideoService/${ep.id}?device=2`, 55000);

    if (videoData && videoData.Video) {
        return { streams: [{
            name: "⚡ SojuStream",
            title: `Ep ${epNum} | 1080p | Auto-Bypass`,
            url: videoData.Video
        }] };
    }
    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 10000, host: "0.0.0.0" });
