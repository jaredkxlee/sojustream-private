require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// 🔒 Use your Hugging Face proxy URL
const FLARESOLVERR_URL = "https://jaredlkx-soju-proxy.hf.space/v1"; 
const SESSION_NAME = 'sojustream-final';

const builder = new addonBuilder({
    id: "org.sojustream.jared.v29",
    version: "29.0.0",
    name: "SojuStream (Fixed)",
    description: "KissKH: South Korea Only | HF Proxy Optimized",
    resources: ["catalog", "meta", "stream"], 
    types: ["series", "movie"],
    idPrefixes: ["kisskh:"], 
    catalogs: [
        { id: "latest_updates", type: "series", name: "KissKH: Latest K-Drama", extra: [{ name: "skip", isRequired: false }] },
        { id: "top_kdrama", type: "series", name: "KissKH: Top K-Drama", extra: [{ name: "skip", isRequired: false }] },
        { id: "upcoming_drama", type: "series", name: "KissKH: Upcoming K-Drama", extra: [{ name: "skip", isRequired: false }] }
    ]
});

// ✅ HELPER: PROXY FETCH WITH ERROR HANDLING
async function fetchWithFlare(targetUrl, customTimeout = 50000) {
    try {
        // Ensure session exists
        await axios.post(FLARESOLVERR_URL, { cmd: 'sessions.create', session: SESSION_NAME }).catch(() => {});
        
        const response = await axios.post(FLARESOLVERR_URL, {
            cmd: 'request.get',
            url: targetUrl,
            session: SESSION_NAME,
            maxTimeout: customTimeout,
        }, { timeout: customTimeout + 5000 });

        if (response.data && response.data.status === 'ok') {
            const rawText = response.data.solution.response;
            const jsonStart = rawText.indexOf('{');
            const jsonEnd = rawText.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1) {
                return JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
            }
        }
        return null;
    } catch (e) {
        console.error(`[v29] Fetch Error: ${e.message}`);
        return null;
    }
}

// --- CATALOG ---
builder.defineCatalogHandler(async (args) => {
    const page = args.extra && args.extra.skip ? Math.floor(args.extra.skip / 20) + 1 : 1;
    let targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=0&order=2`;
    if (args.id === "top_kdrama") targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=0&order=1`;
    if (args.id === "upcoming_drama") targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=3&order=2`;

    const data = await fetchWithFlare(targetUrl);
    const items = data ? (data.results || data.data || data) : [];
    
    return { metas: Array.isArray(items) ? items.map(item => ({
        id: `kisskh:${item.id}`,
        type: "series",
        name: item.title,
        poster: item.thumbnail,
        posterShape: 'landscape'
    })) : [] };
});

// --- META ---
builder.defineMetaHandler(async (args) => {
    const kisskhId = args.id.split(":")[1];
    const data = await fetchWithFlare(`https://kisskh.do/api/DramaList/Drama/${kisskhId}?isMovie=false`);
    if (!data) return { meta: {} };

    return { meta: {
        id: args.id,
        type: "series",
        name: data.title,
        poster: data.thumbnail,
        background: data.thumbnail,
        description: data.description,
        videos: (data.episodes || []).map(ep => ({
            id: `kisskh:${kisskhId}:1:${ep.number}`, // Fixes ID parsing
            title: `Episode ${ep.number}`,
            season: 1,
            episode: parseInt(ep.number)
        })).sort((a,b) => a.episode - b.episode)
    }};
});

// --- STREAM ---
builder.defineStreamHandler(async (args) => {
    const parts = args.id.split(":");
    const dramaId = parts[1];
    const epNum = parts[3];

    // Get fresh details to find current Episode ID
    const data = await fetchWithFlare(`https://kisskh.do/api/DramaList/Drama/${dramaId}?isMovie=false`);
    if (!data || !data.episodes) return { streams: [] };

    const ep = data.episodes.find(e => String(e.number) === String(epNum));
    if (!ep) return { streams: [] };

    // Request the raw video link
    const videoData = await fetchWithFlare(`https://kisskh.do/api/ExternalLoader/VideoService/${ep.id}?device=2`, 55000);

    if (videoData && videoData.Video) {
        return { streams: [{
            name: "⚡ SojuStream",
            title: `Ep ${epNum} | 1080p`,
            url: videoData.Video
        }] };
    }
    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 10000, host: "0.0.0.0" });
