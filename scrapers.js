require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// 🔒 CONFIGURATION
const TMDB_KEY = process.env.TMDB_KEY;
const PROXY_URL = "https://jaredkx-soju-tunnel.hf.space"; 
const PROXY_PASS = process.env.PROXY_PASS; 

// Mandatory headers to bypass "EmptyContent" / 403 blocks
const browserHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Referer": "https://kisskh.do/",
    "Origin": "https://kisskh.do"
};

const builder = new addonBuilder({
    id: "org.sojustream.do",
    version: "4.1.0",
    name: "SojuStream (.do Multi-Catalog)",
    description: "Multi-category Asian content from KissKH.do",
    resources: ["catalog", "stream"], 
    types: ["series", "movie"],
    idPrefixes: ["tmdb:", "tt"],
    // Unified catalog structure to prevent EmptyContent
    catalogs: [
        {
            id: "top_kdrama",
            type: "series",
            name: "KissKH: Top K-Drama",
            extra: [{ name: "skip", isRequired: false }, { name: "search", isRequired: false }]
        },
        {
            id: "latest_drama",
            type: "series",
            name: "KissKH: Latest Updates",
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

// --- 1. CATALOG HANDLER (Fixed for kisskh.do) ---
builder.defineCatalogHandler(async (args) => {
    let url = "";
    const page = args.extra && args.extra.skip ? Math.floor(args.extra.skip / 20) + 1 : 1;

    if (args.extra && args.extra.search) {
        url = `https://kisskh.do/api/DramaList/Search?q=${encodeURIComponent(args.extra.search)}&type=0`;
    } else {
        switch(args.id) {
            case "top_kdrama":
                url = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=0&order=1`;
                break;
            case "latest_drama":
                url = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=0&status=0&order=2`;
                break;
            case "upcoming_drama":
                url = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=0&status=3&order=2`;
                break;
            default: return { metas: [] };
        }
    }

    try {
        const response = await axios.get(url, { headers: browserHeaders });
        const items = response.data.results || response.data;
        if (!Array.isArray(items)) return { metas: [] };

        return {
            metas: items.map(item => ({
                id: `tmdb:${item.id}`,
                type: "series",
                name: item.title,
                poster: item.thumbnail,
                description: `Watch on KissKH via Soju-Tunnel`
            }))
        };
    } catch (e) { 
        console.error("Catalog API Error:", e.message);
        return { metas: [] }; 
    }
});

// --- 2. STREAM HANDLER ---
builder.defineStreamHandler(async (args) => {
    const streams = [];
    let tmdbId, season, episode;
    try {
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
        const metaRes = await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}`);
        const title = metaRes.data.name || metaRes.data.title;

        const searchRes = await axios.get(`https://kisskh.do/api/DramaList/Search?q=${encodeURIComponent(title)}&type=0`, { headers: browserHeaders });
        if (searchRes.data && searchRes.data[0]) {
            const drama = searchRes.data[0];
            const detail = await axios.get(`https://kisskh.do/api/DramaList/Drama/${drama.id}?isMovie=${args.type === 'movie'}`, { headers: browserHeaders });
            const targetEp = detail.data.ep