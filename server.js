const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const { MOVIES } = require("@consumet/extensions");
const axios = require('axios');

// =========================================================================
// ⬇️ ⬇️ ⬇️  USER CONFIGURATION  ⬇️ ⬇️ ⬇️
// =========================================================================

// 🔒 SECURITY UPDATE: Use process.env to hide keys
const TMDB_KEY = process.env.TMDB_KEY; 
const RD_TOKEN = process.env.RD_TOKEN;     

// =========================================================================
// ⬆️ ⬆️ ⬆️  END CONFIGURATION  ⬆️ ⬆️ ⬆️
// =========================================================================

// FLIXHQ: The stable engine
const provider = new MOVIES.FlixHQ(); 
// ... rest of the code stays the same ...
const builder = new addonBuilder({
    id: "org.community.sojustream.fixed52",
    version: "5.2.0",
    name: "SojuStream (Fixed)",
    description: "K-Content • FlixHQ • No Porn • English",
    resources: ["catalog", "meta", "stream"], 
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

        // 🛡️ MANUAL FILTER
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

// --- 2. META HANDLER (REWRITTEN: Fixes "Content Not Found") ---
builder.defineMetaHandler(async function(args) {
    if (!args.id.startsWith("tmdb:")) return { meta: {} };
    const tmdbId = args.id.split(":")[1];
    
    // Auto-detect type if possible, or fallback
    const type = args.type === 'series' ? 'tv' : 'movie';

    try {
        const url = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`;
        const meta = (await axios.get(url)).data;

        return {
            meta: {
                id: args.id,
                type: args.type,
                name: meta.title || meta.name,
                poster: `https://image.tmdb.org/t/p/w500${meta.poster_path}`,
                background: meta.backdrop_path ? `https://image.tmdb.org/t/p/original${meta.backdrop_path}` : null,
                description: meta.overview,
                releaseInfo: (meta.release_date || meta.first_air_date || "").substring(0, 4),
                // IMPORTANT: For series, we provide empty videos so Stremio doesn't crash
                // For movies, we provide one streamable object
                videos: args.type === 'movie' ? [{ id: args.id, title: "Watch Movie", streams: [] }] : []
            }
        };
    } catch (e) { 
        console.log("Meta Error:", e.message);
        return { meta: {} }; 
    }
});

// --- 3. STREAM HANDLER (IMPROVED: Fuzzy Search) ---
builder.defineStreamHandler(async function(args) {
    if (!args.id.startsWith("tmdb:")) return { streams: [] };
    const tmdbId = args.id.split(":")[1];

    let title = "";
    try {
        const type = args.type === 'movie' ? 'movie' : 'tv';
        const meta = (await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?append_to_response=external_ids&api_key=${TMDB_KEY}&language=en-US`)).data;
        title = meta.title || meta.name;
    } catch (e) { return { streams: [] }; }

    console.log(`🔍 Searching FlixHQ for: ${title}`);
    const streams = [];

    try {
        // CLEAN TITLE: Remove special chars like ":" or "-" to help search
        const cleanTitle = title.replace(/[^a-zA-Z0-9 ]/g, " "); 
        const search = await provider.search(cleanTitle);
        
        if (search.results.length > 0) {
            const match = search.results[0];
            const info = await provider.fetchMediaInfo(match.id);
            
            // Get Episode ID
            let epId = (info.episodes && info.episodes.length > 0) ? info.episodes[0].id : match.id;
            
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