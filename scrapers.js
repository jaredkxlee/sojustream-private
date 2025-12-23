require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// 🔒 PROXY CONFIGURATION (Tinyproxy on Render)
// We use an Agent to handle the secure tunnel
const proxyAgent = new HttpsProxyAgent('https://jaredlkx:12345678@soju-proxy.onrender.com');

// Axios Instance with Proxy Agent (Uses this for ALL requests)
const client = axios.create({
    timeout: 15000,
    httpsAgent: proxyAgent, // For HTTPS sites (KissKH)
    httpAgent: proxyAgent,  // For HTTP sites
    headers: {
        "Referer": "https://kisskh.do/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
});

const TMDB_KEY = "b80e5b1b965da72a2a23ba5680cb778a"; 

const builder = new addonBuilder({
    id: "org.sojustream.jared.v19", // v19 Tinyproxy
    version: "19.0.0",
    name: "SojuStream (v19 Final)",
    description: "KissKH via Tinyproxy",
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

// --- 1. CATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    console.log(`[v19] Requesting ${args.id}`);
    const domain = "kisskh.do";
    const page = args.extra && args.extra.skip ? Math.floor(args.extra.skip / 20) + 1 : 1;
    let targetUrl = "";
    
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
        console.log(`[v19] Fetching: ${targetUrl}`);
        // Request directly - the 'client' handles the proxy automatically
        const response = await client.get(targetUrl);
        const items = response.data.results || response.data;

        if (!Array.isArray(items)) {
            if (response.data.data && Array.isArray(response.data.data)) {
                 return { metas: mapItems(response.data.data) };
            }
            return { metas: [] };
        }

        console.log(`[v19] Success! Found ${items.length} items.`);
        return { metas: mapItems(items) };

    } catch (e) {
        console.error(`[v19] Error: ${e.message}`);
        if (e.response) console.error(`[v19] Status: ${e.response.status}`);
        return { metas: [] };
    }
});

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

        // 1. Get TMDB Title (No proxy needed here usually, but client uses it safely)
        const metaRes = await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}`);
        const title = metaRes.data.name || metaRes.data.title;

        // 2. Search KissKH (Proxied)
        const searchUrl = `https://kisskh.do/api/DramaList/Search?q=${encodeURIComponent(title)}&type=0`;
        const searchRes = await client.get(searchUrl);

        if (searchRes.data && searchRes.data[0]) {
            const drama = searchRes.data[0];
            const detailUrl = `https://kisskh.do/api/DramaList/Drama/${drama.id}?isMovie=${args.type === 'movie'}`;
            const detailRes = await client.get(detailUrl);
            
            const targetEp = (detailRes.data.episodes || []).find(e => e.number == episode);
            
            if (targetEp) {
                const videoApiUrl = `https://kisskh.do/api/ExternalLoader/VideoService/${targetEp.id}?device=2`;
                const videoRes = await client.get(videoApiUrl);
                
                // The final video URL usually doesn't need a proxy to PLAY, 
                // but we might need to proxy it if it's geo-blocked.
                // For now, let's return the direct link.
                streams.push({
                    name: "⚡ SojuStream",
                    title: `1080p | ${title} | E${episode}`,
                    url: videoRes.data.Video
                });
            }
        }
    } catch (e) { console.error("Stream Error:", e.message); }
    return { streams };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 10000, host: "0.0.0.0" });