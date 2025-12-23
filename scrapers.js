require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// 🔒 CONFIGURATION
const TMDB_KEY = process.env.TMDB_KEY;
const PROXY_URL = "https://jaredkx-soju-tunnel.hf.space"; 
const PROXY_PASS = process.env.PROXY_PASS; 

const builder = new addonBuilder({
    id: "org.sojustream.complete",
    version: "3.0.0",
    name: "SojuStream (KissKH Catalog & Links)",
    description: "Multi-source Asian content via MediaFlow Proxy",
    resources: ["catalog", "stream"], 
    types: ["movie", "series"],
    idPrefixes: ["tmdb:", "tt"],
    catalogs: [
        {
            id: "kisskh_drama",
            type: "series",
            name: "KissKH Popular",
            extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
        }
    ]
});

// --- 1. CATALOG HANDLER ---
builder.defineCatalogHandler(async function(args) {
    if (args.id === "kisskh_drama") {
        const page = args.extra && args.extra.skip ? (args.extra.skip / 20) + 1 : 1;
        let url = `https://kisskh.co/api/DramaList/List?page=${page}&pageSize=20&type=0`;

        if (args.extra && args.extra.search) {
            url = `https://kisskh.co/api/DramaList/Search?q=${encodeURIComponent(args.extra.search)}&type=0`;
        }

        try {
            const response = await axios.get(url);
            const items = response.data.results || response.data;
            return {
                metas: items.map(item => ({
                    id: `tmdb:${item.id}`,
                    type: "series",
                    name: item.title,
                    poster: item.thumbnail,
                    description: `KissKH Library Item`
                }))
            };
        } catch (e) { 
            console.error("Catalog Error:", e.message);
            return { metas: [] }; 
        }
    }
    return { metas: [] };
});

// --- 2. STREAM HANDLER ---
builder.defineStreamHandler(async function(args) {
    const streams = [];
    let tmdbId, season, episode;

    try {
        // Parse IDs (Support both tt and tmdb)
        if (args.id.startsWith("tt")) {
            const findUrl = `https://api.themoviedb.org/3/find/${args.id.split(':')[0]}?api_key=${TMDB_KEY}&external_source=imdb_id`;
            const findRes = await axios.get(findUrl);
            const result = findRes.data.movie_results[0] || findRes.data.tv_results[0];
            
            if (!result) return { streams: [] };
            tmdbId = result.id;
            const parts = args.id.split(":");
            season = parts[1] || 1;
            episode = parts[2] || 1;
        } else {
            const parts = args.id.split(":");
            tmdbId = parts[1];
            season = parts[2] || 1;
            episode = parts[3] || 1;
        }

        const type = args.type === 'series' ? 'tv' : 'movie';
        const meta = (await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}`)).data;
        const title = meta.name || meta.title;

        // Search KissKH for the stream
        const searchRes = await axios.get(`https://kisskh.co/api/DramaList/Search?q=${encodeURIComponent(title)}&type=0`);
        if (searchRes.data && searchRes.data[0]) {
            const drama = searchRes.data[0];
            const detail = await axios.get(`https://kisskh.co/api/DramaList/Drama/${drama.id}?isMovie=${args.type === 'movie'}`);
            const targetEpNum = episode || 1;
            const ep = detail.data.episodes.find(e => e.number == targetEpNum);
            
            if (ep) {
                const streamInfo = await axios.get(`https://kisskh.co/api/ExternalLoader/VideoService/${ep.id}?device=2`);
                const videoUrl = streamInfo.data.Video;
                const headers = JSON.stringify({ "Referer": "https://kisskh.co/" });
                const proxiedUrl = `${PROXY_URL}/proxy/stream?url=${encodeURIComponent(videoUrl)}&api_password=${PROXY_PASS}&headers=${encodeURIComponent(headers)}`;
                
                streams.push({
                    name: "⚡ Soju-Tunnel (KissKH)",
                    title: `1080p | ${title} | E${targetEpNum}`,
                    url: proxiedUrl
                });
            }
        }
    } catch (e) { 
        console.error("Scraper Error:", e.message); 
    }

    return { streams };
});

// ✅ RENDER PORT BINDING
serveHTTP(builder.getInterface(), { 
    port: process.env.PORT || 10000, 
    host: "0.0.0.0" 
});