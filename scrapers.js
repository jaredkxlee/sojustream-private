require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

const FLARESOLVERR_URL = "https://jaredlkx-soju-proxy.hf.space/v1"; 
const SESSION_NAME = 'soju_stable_v30';
const FLARE_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

const builder = new addonBuilder({
    id: "org.sojustream.jared.v30",
    version: "30.0.8",
    name: "SojuStream (Stable)",
    description: "KissKH: Search & Catalogs Fixed | South Korea Only",
    resources: ["catalog", "meta", "stream"], 
    types: ["series", "movie"],
    idPrefixes: ["kisskh:"], 
    catalogs: [
        { id: "latest_updates", type: "series", name: "KissKH: Latest K-Drama", extra: [{ name: "skip", isRequired: false }] },
        { id: "top_kdrama", type: "series", name: "KissKH: Top K-Drama" },
        { id: "upcoming_kdrama", type: "series", name: "KissKH: Upcoming K-Drama" },
        { id: "most_searched", type: "series", name: "KissKH: Most Searched" },
        { id: "search_kdrama", type: "series", name: "KissKH: Search", extra: [{ name: "search", isRequired: true }] }
    ]
});

async function fetchWithFlare(targetUrl, customTimeout = 60000) {
    try {
        await axios.post(FLARESOLVERR_URL, { cmd: 'sessions.create', session: SESSION_NAME }).catch(() => {});
        const response = await axios.post(FLARESOLVERR_URL, {
            cmd: 'request.get',
            url: targetUrl,
            session: SESSION_NAME,
            maxTimeout: customTimeout,
            headers: { "User-Agent": FLARE_UA } 
        }, { timeout: customTimeout + 5000 });

        if (response.data && response.data.status === 'ok') {
            const rawText = response.data.solution.response;
            const jsonStart = rawText.indexOf('{');
            const jsonEnd = rawText.lastIndexOf('}');
            
            if (jsonStart !== -1 && jsonEnd !== -1) {
                const cleanJson = rawText.substring(jsonStart, jsonEnd + 1);
                // Validate that we actually got JSON data before parsing
                if (cleanJson.includes('"status"') || cleanJson.includes('"title"') || cleanJson.includes('"results"')) {
                    return JSON.parse(cleanJson);
                }
            }
        }
        return null;
    } catch (e) {
        console.error(`[v30] Proxy Error: ${e.message}`);
        // Reset session on failure to clear potential challenge loops
        axios.post(FLARESOLVERR_URL, { cmd: 'sessions.destroy', session: SESSION_NAME }).catch(() => {});
        return null;
    }
}

// --- CATALOG HANDLERS (Fixed API Patterns) ---
builder.defineCatalogHandler(async (args) => {
    let targetUrl;
    const page = args.extra && args.extra.skip ? Math.floor(args.extra.skip / 20) + 1 : 1;

    if (args.id === "search_kdrama") {
        targetUrl = `https://kisskh.do/api/DramaList/Search?q=${encodeURIComponent(args.extra.search)}&type=0`;
    } else if (args.id === "most_searched") {
        targetUrl = `https://kisskh.do/api/DramaList/MostSearch?ispc=true`;
    } else if (args.id === "top_kdrama") {
        targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=0&order=1`;
    } else if (args.id === "upcoming_kdrama") {
        targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=3&order=2`;
    } else {
        targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=0&order=2`;
    }

    const data = await fetchWithFlare(targetUrl, 45000);
    const items = data ? (data.results || data.data || data) : [];
    
    return { metas: Array.isArray(items) ? items.map(item => ({
        id: `kisskh:${item.id}`, type: "series", name: item.title, poster: item.thumbnail, posterShape: 'landscape'
    })) : [] };
});

// --- META HANDLER (Required to prevent manifest crash) ---
builder.defineMetaHandler(async (args) => {
    const kisskhId = args.id.split(":")[1];
    const data = await fetchWithFlare(`https://kisskh.do/api/DramaList/Drama/${kisskhId}?isMovie=false`, 45000);
    if (!data) return { meta: {} };

    return { meta: {
        id: args.id, type: "series", name: data.title, poster: data.thumbnail, background: data.thumbnail, description: data.description,
        videos: (data.episodes || []).map(ep => ({
            id: `kisskh:${kisskhId}:1:${ep.number}`, 
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

    const data = await fetchWithFlare(`https://kisskh.do/api/DramaList/Drama/${dramaId}?isMovie=false`, 50000);
    if (!data || !data.episodes) return { streams: [] };

    const ep = data.episodes.find(e => String(e.number) === String(epNum));
    if (!ep) return { streams: [] };

    const videoData = await fetchWithFlare(`https://kisskh.do/api/ExternalLoader/VideoService/${ep.id}?device=2`, 55000);
    if (videoData && videoData.Video) {
        return { streams: [{ name: "⚡ SojuStream", title: `Ep ${epNum} | 1080p`, url: videoData.Video }] };
    }
    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 10000, host: "0.0.0.0" });