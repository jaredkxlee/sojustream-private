require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// 🔒 FLARESOLVERR CONFIGURATION
const FLARESOLVERR_URL = "https://soju-proxy.onrender.com/v1"; 

const builder = new addonBuilder({
    id: "org.sojustream.jared.v24",
    version: "24.0.0",
    name: "SojuStream (v24 Final)",
    description: "KissKH: Landscape Mode & Fixed Streams",
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
        },
        {
            id: "upcoming_drama",
            type: "series",
            name: "KissKH: Upcoming",
            extra: [{ name: "skip", isRequired: false }]
        }
    ]
});

// ✅ HELPER: FLARESOLVERR SESSION
async function fetchWithFlare(targetUrl) {
    const sessionName = 'kisskh-browser';
    try {
        // 1. Ensure Session Exists
        await axios.post(FLARESOLVERR_URL, {
            cmd: 'sessions.create', session: sessionName
        }, { headers: { 'Content-Type': 'application/json' } }).catch(() => {});

        // 2. Request Data
        const response = await axios.post(FLARESOLVERR_URL, {
            cmd: 'request.get',
            url: targetUrl,
            session: sessionName,
            maxTimeout: 60000,
        }, { headers: { 'Content-Type': 'application/json' } });

        if (response.data.status === 'ok') {
            const rawText = response.data.solution.response;
            const jsonStart = rawText.indexOf('{');
            const jsonEnd = rawText.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1) {
                return JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
            }
        }
        return null;
    } catch (e) {
        console.error(`[FlareSolverr] Connection Failed: ${e.message}`);
        return null;
    }
}

// --- 1. CATALOG HANDLER (Raw & Landscape) ---
builder.defineCatalogHandler(async (args) => {
    console.log(`[v24] Catalog Request: ${args.id}`);
    const page = args.extra && args.extra.skip ? Math.floor(args.extra.skip / 20) + 1 : 1;
    let targetUrl = "";
    
    // --- YOUR EXACT API LOGIC ---
    if (args.extra && args.extra.search) {
        // Search API
        targetUrl = `https://kisskh.do/api/DramaList/Search?q=${encodeURIComponent(args.extra.search)}&type=0`;
    } else {
        switch(args.id) {
            case "latest_updates":
                // Latest Updates API
                targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=0&status=0&order=2`;
                break;
            case "top_kdrama":
                // Top K-Drama API
                targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=0&order=1`;
                break;
            case "upcoming_drama":
                // Upcoming API
                targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=0&status=3&order=2`;
                break;
            default:
                return { metas: [] };
        }
    }

    const data = await fetchWithFlare(targetUrl);
    if (!data) return { metas: [] };

    // Handle "results" vs "data" wrappers
    const items = data.results || data.data || data;

    if (Array.isArray(items)) {
        return { metas: items.map(item => ({
            id: `kisskh:${item.id}`,
            type: "series",
            name: item.title,
            // 🔥 RAW LANDSCAPE THUMBNAIL (No TMDB)
            poster: item.thumbnail, 
            description: item.status || "Watch on KissKH",
            posterShape: 'landscape' // Hint to Stremio (some clients respect this)
        })) };
    }
    return { metas: [] };
});

// --- 2. META HANDLER (Detail View) ---
builder.defineMetaHandler(async (args) => {
    // Only handle our custom IDs
    if (!args.id.startsWith("kisskh:")) return { meta: {} };
    
    const kisskhId = args.id.split(":")[1];
    const detailUrl = `https://kisskh.do/api/DramaList/Drama/${kisskhId}?isMovie=false`;
    const data = await fetchWithFlare(detailUrl);

    if (!data) return { meta: {} };

    return {
        meta: {
            id: args.id,
            type: "series",
            name: data.title,
            poster: data.thumbnail,     // Landscape
            background: data.thumbnail, // Landscape
            description: data.description || "No description.",
            releaseInfo: data.releaseDate,
            genres: data.genres ? data.genres.map(g => g.name) : [],
            // Important: We must list videos so Stremio knows episodes exist
            videos: (data.episodes || []).map(ep => ({
                id: `kisskh:${kisskhId}:${1}:${ep.number}`, // Format: ID:Season:Episode
                title: `Episode ${ep.number}`,
                season: 1,
                episode: parseInt(ep.number) || 1,
                released: new Date().toISOString()
            })).reverse() // KissKH lists newest first, Stremio likes oldest first usually, but reverse is safer
        }
    };
});

// --- 3. STREAM HANDLER (Fixed Episode Selection) ---
builder.defineStreamHandler(async (args) => {
    if (!args.id.startsWith("kisskh:")) return { streams: [] };

    console.log(`[v24] Stream Request: ${args.id}`);

    // Parse the Stremio ID: kisskh:DRAMA_ID:SEASON:EPISODE
    const parts = args.id.split(":");
    const dramaId = parts[1];
    const episodeNum = parts[3]; // <--- This is the key fix

    if (!dramaId || !episodeNum) {
        console.error("[v24] Invalid ID format for stream");
        return { streams: [] };
    }

    try {
        // 1. Get Drama Details to find the specific Episode ID
        const detailUrl = `https://kisskh.do/api/DramaList/Drama/${dramaId}?isMovie=false`;
        const data = await fetchWithFlare(detailUrl);
        
        if (!data || !data.episodes) return { streams: [] };

        // 2. Find the exact episode object
        const targetEp = data.episodes.find(e => e.number == episodeNum);

        if (targetEp) {
            // 3. Get the Video Link
            const videoApiUrl = `https://kisskh.do/api/ExternalLoader/VideoService/${targetEp.id}?device=2`;
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