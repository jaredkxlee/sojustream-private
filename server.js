const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const { MOVIES } = require("@consumet/extensions");
const axios = require('axios');

// =========================================================================
// ⬇️ ⬇️ ⬇️  USER CONFIGURATION  ⬇️ ⬇️ ⬇️
// =========================================================================

// 🔒 Keys are now safe in process.env
const TMDB_KEY = process.env.TMDB_KEY; 
const RD_TOKEN = process.env.RD_TOKEN;     

// =========================================================================
// ⬆️ ⬆️ ⬆️  END CONFIGURATION  ⬆️ ⬆️ ⬆️
// =========================================================================

const provider = new MOVIES.FlixHQ(); 

const builder = new addonBuilder({
    id: "org.community.sojustream.v55",
    version: "5.5.0",
    name: "SojuStream (Final)",
    description: "K-Content • FlixHQ • No Porn • English",
    
    // ⚠️ CRITICAL FIX 1: Removed "meta" from this list.
    // This forces Stremio to use Cinemeta for posters/plot (Fixes "Content Not Found")
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

// --- 1. CATALOG HANDLER (SAFE & CLEAN) ---
builder.defineCatalogHandler(async function(args) {
    const page = (args.extra && args.extra.skip ? (args.extra.skip / 20) + 1 : 1);
    const date = new Date().toISOString().split('T')[0];
    let fetchUrl = '';

    const baseParams = `api_key=${TMDB_KEY}&language=en-US&include_adult=false&with_original_language=ko&page=${page}`;

    if (args.extra && args.extra.search) {
        fetchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${args.extra.search}&language=en-US&include_adult=false`;
    } 
    else if (args.id === 'kmovie_popular') fetchUrl = `https://api.themoviedb.org/3/discover/movie?${baseParams}&sort_by=vote_count.desc&vote_count.gte=100`;
    else if (args.id === 'kmovie_new') fetchUrl = `https://api.themoviedb.org/3/discover/movie?${baseParams}&sort_by=primary_release_date.desc&primary_release_date.lte=${date}&vote_count.gte=10`;
    else if (args.id === 'kdrama_popular') fetchUrl = `https://api.themoviedb.org/3/discover/tv?${baseParams}&sort_by=vote_count.desc&vote_count.gte=100`;
    else if (args.id === 'kdrama_new') fetchUrl = `https://api.themoviedb.org/3/discover/tv?${baseParams}&sort_by=first_air_date.desc&first_air_date.lte=${date}&vote_count.gte=10`;

    try {
        const response = await axios.get(fetchUrl);
        let items = response.data.results || [];

        // 🛡️ TITLE FILTER
        items = items.filter(item => {
            const title = (item.title || item.name || "").toLowerCase();
            const badWords = ["erotic", "sex", "porn", "japanese mom", "18+", "uncensored"];
            if (!item.poster_path) return false;
            if (badWords.some(word => title.includes(word))) return false;
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

// --- 2. STREAM HANDLER (CRITICAL FIX 2: Supports Series Episodes) ---
builder.defineStreamHandler(async function(args) {
    if (!args.id.startsWith("tmdb:")) return { streams: [] };

    // PARSE ID: Handles "tmdb:123" (Movie) AND "tmdb:123:1:5" (Series S1 E5)
    const parts = args.id.split(":");
    const tmdbId = parts[1];
    const season = parts[2] ? parseInt(parts[2]) : null;
    const episode = parts[3] ? parseInt(parts[3]) : null;

    let title = "";
    try {
        // Fetch English Title from TMDB
        const type = args.type === 'movie' ? 'movie' : 'tv';
        const meta = (await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?append_to_response=external_ids&api_key=${TMDB_KEY}&language=en-US`)).data;
        title = meta.title || meta.name;
    } catch (e) { return { streams: [] }; }

    console.log(`🔍 Searching FlixHQ for: ${title} ${season ? `(S${season} E${episode})` : ''}`);
    const streams = [];

    try {
        // FUZZY SEARCH: Clean symbols from title
        const cleanTitle = title.replace(/[^a-zA-Z0-9 ]/g, " "); 
        const search = await provider.search(cleanTitle);
        
        if (search.results.length > 0) {
            const match = search.results[0];
            const info = await provider.fetchMediaInfo(match.id);
            
            let targetEpId = null;

            if (args.type === 'series' && season && episode) {
                // SERIES LOGIC: Find the exact episode
                const epObj = info.episodes.find(e => e.season === season && e.number === episode);
                if (epObj) {
                    targetEpId = epObj.id;
                } else {
                    console.log(`   ⚠️ Episode S${season}E${episode} not found on FlixHQ.`);
                }
            } else {
                // MOVIE LOGIC: Use the main ID (or first 'episode' which is the movie)
                targetEpId = (info.episodes && info.episodes.length > 0) ? info.episodes[0].id : match.id;
            }
            
            // FETCH STREAM
            if (targetEpId) {
                const sources = await provider.fetchEpisodeSources(targetEpId, match.id);
                // Try to find the best quality
                const best = sources.sources.find(s => s.quality === 'auto' || s.quality === '1080p') || sources.sources[0];
                
                if (best) {
                    streams.push({
                        title: `⚡ FlixHQ - ${title} ${season ? `S${season}E${episode}` : '[Movie]'}`,
                        url: best.url
                    });
                }
            }
        }
    } catch (e) { console.log("FlixHQ Error:", e.message); }

    return { streams: streams };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });