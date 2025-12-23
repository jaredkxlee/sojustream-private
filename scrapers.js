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
    // ✅ Resources now include 'catalog' and 'stream'
    resources: ["catalog", "stream"], 
    types: ["movie", "series"],
    idPrefixes: ["tmdb:", "tt"],
    // ✅ Catalog definition to allow browsing within Stremio
    catalogs: [
        {
            id: "kisskh_drama",
            type: "series",
            name: "KissKH Popular",
            extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
        }
    ]
});

// --- 1. CATALOG HANDLER (Browse KissKH Directly) ---
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
                    id: `tmdb:${item.id}`, // Note: Mapping KissKH ID to a TMDB-style prefix
                    type: "series",
                    name: item.title,
                    poster: item.thumbnail,
                    description: `KissKH Library Item`
                }))
            };
        } catch (e) { return { metas: [] }; }
    }
    return { metas: [] };
});

// --- 2. STREAM HANDLER (Fetch Video Links) ---
builder.defineStreamHandler(async function(args) {
    const streams = [];
    let tmdbId, season, episode;

    // Support both IMDb (tt) and TMDB prefixes
    if (args.id.startsWith("tt")) {
        const findUrl = `https://api.themoviedb