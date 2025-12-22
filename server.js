const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const { MOVIES } = require("@consumet/extensions");
const axios = require('axios');

// =========================================================================
// ⬇️ ⬇️ ⬇️  USER CONFIGURATION  ⬇️ ⬇️ ⬇️
// =========================================================================

const TMDB_KEY = 'b80e5b1b965da72a2a23ba5680cb778a'; 
const RD_TOKEN = 'VNED7ID5VRKYQJY7ICAX32N6MSPAJ3OO7REGYZ5NGVWZL7NJ2MCQ';     

// =========================================================================
// ⬆️ ⬆️ ⬆️  END CONFIGURATION  ⬆️ ⬆️ ⬆️
// =========================================================================

// SWITCHED PROVIDER: SuperStream is often more reliable than FlixHQ
const provider = new MOVIES.SuperStream(); 

const builder = new addonBuilder({
    id: "org.community.sojustream.final",
    version: "3.0.0",
    name: "SojuStream (SuperSafe)",
    description: "K-Content • SuperStream HTTPS • No Ads • English",
    resources: ["catalog", "stream"],
    types: ["movie", "series"],
    catalogs: [
        { type: "movie", id: "kmovie_popular", name: "Popular K-Movies" },
        { type: "movie", id: "kmovie_new", name: "New K-Movies" },
        { type: "series", id: "kdrama_popular", name: "Popular K-Dramas" },
        { type: "series", id: "kdrama_new", name: "New K-Dramas" }
    ],
    idPrefixes: ["tmdb:"]
});

// --- 1. CATALOG HANDLER (WITH KEYWORD BLOCKER) ---
builder.defineCatalogHandler(async function(args) {
    const page = (args.extra && args.extra.skip ? (args.extra.skip / 20) + 1 : 1);
    const date = new Date().toISOString().split('T')[0];
    let fetchUrl = '';

    // 🔒 BASE FILTERS: English, No Adult, Korean Only
    const baseParams = `api_key=${TMDB_KEY}&language=en-US&include_adult=false&with_original_language=ko&page=${page}`;

    if (args.extra && args.extra.search) {
        fetchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${args.extra.search}&language=en-US&include_adult=false`;
    } 
    else if (args.id === 'kmovie_popular') fetchUrl = `https://api.themoviedb.org/3/discover/movie?${baseParams}&sort_by=vote_count.desc&vote_count.gte=100`;
    else if (args.id === 'kmovie_new') fetchUrl = `https://api.themoviedb.org/3/discover/movie?${baseParams}&sort_by=primary_release_date.desc&primary_release_date.lte=${date}&vote_count.gte=20`;
    else if (args.id === 'kdrama_popular') fetchUrl = `https://api.themoviedb.org/3/discover/tv?${baseParams}&sort_by=vote_count.desc&vote_count.gte=100`;
    else if (args.id === 'kdrama_new') fetchUrl = `https://api.themoviedb.org/3/discover/tv?${baseParams}&sort_by=first_air_date.desc&first_air_date.lte=${date}&vote_count.gte=20`;

    try {
        const response = await axios.get(fetchUrl);
        let items = response.data.results || [];

        // 🛡️ MANUAL FILTER: Remove items with suspicious titles or no poster
        items = items.filter(item => {
            const title = (item.title || item.name || "").toLowerCase();
            const suspicious = ["erotic", "sex", "porn", "japanese mom", "18+"];
            if (!item.poster_path) return false; // Remove if no poster
            if (suspicious.some(word => title.includes(word))) return false; // Remove bad words
            return true;
        });

        return {
            metas: items.map(item => ({
                id: `tmdb:${item.id}`,
                type: item.media_type === 'movie' ? 'movie' : 'series', // Handle mixed results
                name: item.title || item.name,
                poster: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
                description: item.overview
            }))
        };
    } catch (e) { return { metas: [] }; }
});

// --- 2. STREAM HANDLER (SUPERSTREAM HTTPS) ---
builder.defineStreamHandler(async function(args) {
    if (!args.id.startsWith("tmdb:")) return { streams: [] };
    const tmdbId = args.id.split(":")[1];

    // 1. Get English Metadata
    let title = "";
    try {
        // We try 'movie' first, if fails try 'tv' (Simple guess since we don't always know type in stream handler)
        // Or better: rely on args.type
        const type = args.type === 'movie' ? 'movie' : 'tv';
        const meta = (await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`)).data;
        title = meta.title || meta.name;
    } catch (e) { return { streams: [] }; }

    console.log(`🔍 Searching SuperStream for: ${title}`);
    const streams = [];

    try {
        // 2. Search SuperStream
        const search = await provider.search(title);
        if (search.results.length > 0) {
            const match = search.results[0]; // Take first match
            const info = await provider.fetchMediaInfo(match.id);
            
            // 3. Get Episode/Movie Source
            let epId = null;
            if (info.episodes && info.episodes.length > 0) {
                epId = info.episodes[0].id; // Default to Ep 1
            } else {
                epId = match.id; // Sometimes for movies the ID is same
            }

            if (epId) {
                const sources = await provider.fetchEpisodeSources(epId, match.id);
                // SuperStream usually returns a direct .mp4 or .m3u8
                const best = sources.sources.find(s => s.quality === 'auto' || s.quality === '1080p' || s.quality === '720p');
                
                if (best) {
                    streams.push({
                        title: `⚡ SuperStream - ${title}`,
                        url: best.url,
                        behaviorHints: { notWebReady: true }
                    });
                }
            }
        }
    } catch (e) { console.log("SuperStream Error:", e.message); }

    return { streams: streams };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });