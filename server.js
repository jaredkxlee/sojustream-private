const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const { MOVIES } = require("@consumet/extensions");
const axios = require('axios');

// =========================================================================
// 🔒 SECURE CONFIGURATION
// =========================================================================

const TMDB_KEY = process.env.TMDB_KEY; 
const RD_TOKEN = process.env.RD_TOKEN;     

// =========================================================================

const provider = new MOVIES.FlixHQ(); 

const builder = new addonBuilder({
    id: "org.sojustream.diagnostic",
    version: "6.1.0",
    name: "SojuStream (Debug)",
    description: "Debug Mode • Shows Errors on Screen",
    resources: ["catalog", "meta", "stream"], 
    types: ["movie", "series"],
    catalogs: [
        { type: "series", id: "kdrama_popular", name: "Popular K-Dramas" }
    ],
    idPrefixes: ["tmdb:", "error:"]
});

// --- 1. CATALOG HANDLER (DIAGNOSTIC MODE) ---
builder.defineCatalogHandler(async function(args) {
    // DIAGNOSTIC CHECK 1: Do we have a key?
    if (!TMDB_KEY) {
        return {
            metas: [{
                id: 'error:nokey',
                type: 'series',
                name: "❌ ERROR: KEY MISSING",
                description: "The addon cannot see 'TMDB_KEY'. Go to Render -> Services -> Environment -> Linked Groups and make sure 'api' is linked.",
                poster: "https://via.placeholder.com/500x750/ff0000/ffffff?text=NO+KEY"
            }]
        };
    }

    const page = 1;
    const baseParams = `api_key=${TMDB_KEY}&language=en-US&include_adult=false&with_original_language=ko&page=${page}`;
    const fetchUrl = `https://api.themoviedb.org/3/discover/tv?${baseParams}&sort_by=vote_count.desc&vote_count.gte=100`;

    try {
        const response = await axios.get(fetchUrl);
        const items = response.data.results || [];
        
        return {
            metas: items.map(item => ({
                id: `tmdb:${item.id}`,
                type: 'series',
                name: item.name,
                poster: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
                description: item.overview
            }))
        };
    } catch (e) {
        // DIAGNOSTIC CHECK 2: What did TMDB say?
        const status = e.response ? e.response.status : "Unknown";
        const msg = e.response ? JSON.stringify(e.response.data) : e.message;
        
        return {
            metas: [{
                id: 'error:tmdb',
                type: 'series',
                name: `❌ ERROR ${status}`,
                description: `TMDB REJECTED THE KEY.\nDetails: ${msg}\nYour Key Length: ${TMDB_KEY.length} chars.\n\nIF 401: You used the wrong key type.`,
                poster: "https://via.placeholder.com/500x750/ff0000/ffffff?text=API+ERROR"
            }]
        };
    }
});

builder.defineMetaHandler(async function(args) { return { meta: {} }; });
builder.defineStreamHandler(async function(args) { return { streams: [] }; });

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });