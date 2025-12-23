require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

const FLARESOLVERR_URL = "https://jaredlkx-soju-proxy.hf.space/v1"; 
const SESSION_NAME = 'soju_stable_v31'; // Forced fresh session ID

const builder = new addonBuilder({
    id: "org.sojustream.jared.v31",
    version: "31.0.0",
    name: "SojuStream (Stable Final)",
    description: "KissKH: 180s Timeout | Persistent Session Fix",
    resources: ["catalog", "meta", "stream"], 
    types: ["series", "movie"],
    idPrefixes: ["kisskh:"], 
    catalogs: [
        { id: "latest_updates", type: "series", name: "KissKH: Latest K-Drama", extra: [{ name: "skip", isRequired: false }] },
        { id: "top_kdrama", type: "series", name: "KissKH: Top K-Drama" },
        { id: "upcoming_kdrama", type: "series", name: "KissKH: Upcoming K-Drama" }
    ]
});

/**
 * Robust fetcher with extended timeouts for modern Cloudflare challenges.
 */
async function fetchWithFlare(targetUrl, customTimeout = 180000) { // Set to 180s
    try {
        // Step 1: Ensure persistent session exists
        await axios.post(FLARESOLVERR_URL, { 
            cmd: 'sessions.create', 
            session: SESSION_NAME 
        }).catch(() => {});

        // Step 2: Request via FlareSolverr
        const response = await axios.post(FLARESOLVERR_URL, {
            cmd: 'request.get',
            url: targetUrl,
            session: SESSION_NAME,
            maxTimeout: customTimeout,
            // Removed 'headers' as it is unsupported in v2.0+
        }, { timeout: customTimeout + 10000 }); // Axial timeout slightly longer than proxy timeout

        if (response.data && response.data.status === 'ok') {
            const rawText = response.data.solution.response;
            const jsonStart = rawText.indexOf('{');
            const jsonEnd = rawText.lastIndexOf('}');
            
            if (jsonStart !== -1 && jsonEnd !== -1) {
                const cleanJson = rawText.substring(jsonStart, jsonEnd + 1);
                // Basic check to ensure it's not a Cloudflare error page
                if (cleanJson.includes('"status"') || cleanJson.includes('"results"') || cleanJson.includes('"Video"')) {
                    return JSON.parse(cleanJson);
                }
            }
        }
        return null;
    } catch (e) {
        console.error(`[v31] Proxy/Timeout Error: ${e.message}`);
        // If 500 error occurs, destroy session to reset the headless browser
        axios.post(FLARESOLVERR_URL, { cmd: 'sessions.destroy', session: SESSION_NAME }).catch(() => {});
        return null;
    }
}

// --- CATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    const page = args.extra && args.extra.skip ? Math.floor(args.extra.skip / 20) + 1 : 1;
    let targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=0&order=2`;
    
    if (args.id === "top_kdrama") {
        targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=0&order=1`;
    } else if (args.id === "upcoming_kdrama") {
        targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=3&order=2`;
    }

    const data = await fetchWithFlare(targetUrl, 90000); // 90s for simple lists
    const items = data ? (data.results || data.data || data) : [];
    
    return { metas: Array.isArray(items) ? items.map(item => ({
        id: `kisskh:${item.id}`,
        type: "series",
        name: item.title,
        poster: item.thumbnail,
        posterShape: 'landscape'
    })) : [] };
});

// --- META HANDLER ---
builder.defineMetaHandler(async (args) => {
    const kisskhId = args.id.split(":")[1];
    const data = await fetchWithFlare(`https://kisskh.do/api/DramaList/Drama/${kisskhId}?isMovie=false`, 120000);
    
    if (!data) return { meta: {} };

    return { meta: {
        id: args.id,
        type: "series",
        name: data.title,
        poster: data.thumbnail,
        background: data.thumbnail,
        description: data.description,
        videos: (data.episodes || []).map(ep => ({
            id: `kisskh:${kisskhId}:1:${ep.number}`, // Standardized episode format
            title: `Episode ${ep.number}`,
            season: 1,
            episode: parseInt(ep.number)
        })).sort((a,b) => a.episode - b.episode)
    }};
});

// --- STREAM HANDLER ---
builder.defineStreamHandler(async (args) => {
    const parts = args.id.split(":");
    const dramaId = parts[1];
    const epNum = parts[3];

    // Find internal Episode ID first
    const data = await fetchWithFlare(`https://kisskh.do/api/DramaList/Drama/${dramaId}?isMovie=false`, 120000);
    if (!data || !data.episodes) return { streams: [] };

    const ep = data.episodes.find(e => String(e.number) === String(epNum));
    if (!ep) return { streams: [] };

    // Final API call for mp4 link - using full 180s timeout
    const videoData = await fetchWithFlare(`https://kisskh.do/api/ExternalLoader/VideoService/${ep.id}?device=2`, 180000);

    if (videoData && videoData.Video) {
        return { streams: [{
            name: "⚡ SojuStream",
            title: `Ep ${epNum} | 1080p | Session Recovery`,
            url: videoData.Video
        }] };
    }
    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 10000, host: "0.0.0.0" });