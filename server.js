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

// FIX: Back to FlixHQ (Stable) because SuperStream crashed the server
const provider = new MOVIES.FlixHQ(); 

const builder = new addonBuilder({
    id: "org.community.sojustream.safe",
    version: "3.1.0",
    name: "SojuStream (Safe)",
    description: "K-Content • FlixHQ • No Porn • English",
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

// --- 1. CATALOG HANDLER (WITH "JAPANESE MOM" BLOCKER) ---
builder.defineCatalogHandler(async function(args) {
    const page = (args.extra && args.extra.skip ? (args.extra.skip / 20) + 1 : 1);
    const date = new Date().toISOString().split('T')[0];
    let fetchUrl = '';

    // 🔒 BASE FILTERS: English, No Adult, Korean Only
    const baseParams = `api_key=${TMDB_KEY}&language=en-US&include_adult=false&with_original_language=ko&page=${page}`;

    // A. SEARCH
    if (args.extra && args.extra.search) {
        fetchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${args.extra.search}&language=en-US&include_adult=false`;
    } 
    // B. CATALOGS (High Vote Counts to block trash)
    else if (args.id === 'kmovie_popular') fetchUrl = `https://api.themoviedb.org/3/discover/movie?${baseParams}&sort_by=vote_count.desc&vote_count.gte=100`;
    else if (args.id === 'kmovie_new') fetchUrl = `https://api.themoviedb.org/3/discover/movie?${baseParams}&sort_by=primary_release_date.desc&primary_release_date.lte=${date}&vote_count.gte=10`;
    else if (args.id === 'kdrama_popular') fetchUrl = `https://api.themoviedb.org/3/discover/tv?${baseParams}&sort_by=vote_count.desc&vote_count.gte=100`;
    else if (args.id === 'kdrama_new') fetchUrl = `https://api.themoviedb.org/3/discover/tv?${baseParams}&sort_by=first_air_date.desc&first_air_date.lte=${date}&vote_count.gte=10`;

    try {
        const response = await axios.get(fetchUrl);
        let items = response.data.results || [];

        // 🛡️ THE NUCLEAR FILTER 🛡️
        // This manually checks every single title and hides it if it's suspicious
        items = items.filter(item => {
            const title = (item.title || item.name || "").toLowerCase();
            const badWords = ["erotic", "sex", "porn", "japanese mom", "18+", "uncensored", "av idol"];
            
            if (!item.poster_path) return false; // Hide if no poster
            if (badWords.some(word => title.includes(word))) return false; // Hide if bad word found
            
            return true;
        });

        return {
            metas: items.map(item => ({
                id: `tmdb:${item.id}`,
                type: item.media_type === 'movie' ? 'movie' : 'series',
                name: item.title || item.name,
                poster: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
                description: item.overview
            }))
        };
    } catch (e) { return { metas: [] }; }
});

// --- 2. STREAM HANDLER (FLIXHQ) ---
builder.defineStreamHandler(async function(args) {
    if (!args.id.startsWith("tmdb:")) return { streams: [] };
    const tmdbId = args.id.split(":")[1];

    let title = "";
    try {
        const type = args.type === 'movie' ? 'movie' : 'tv';
        const meta = (await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`)).data;
        title = meta.title || meta.name;
    } catch (e) { return { streams: [] }; }

    console.log(`🔍 Searching FlixHQ for: ${title}`);
    const streams = [];

    try {
        const search = await provider.search(title);
        if (search.results.length > 0) {
            const match = search.results[0];
            const info = await provider.fetchMediaInfo(match.id);
            
            let epId = null;
            if (info.episodes && info.episodes.length > 0) {
                epId = info.episodes[0].id; // Default to Ep 1
            } else {
                epId = match.id;
            }

            if (epId) {
                const sources = await provider.fetchEpisodeSources(epId, match.id);
                const best = sources.sources.find(s => s.quality === 'auto' || s.quality === '1080p');
                
                if (best) {
                    streams.push({
                        title: `⚡ FlixHQ - ${title}`,
                        url: best.url
                    });
                }
            }
        }
    } catch (e) { console.log("FlixHQ Error:", e.message); }

    return { streams: streams };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });