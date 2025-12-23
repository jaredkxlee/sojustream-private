const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// =========================================================================
// 🔒 SECURE CONFIGURATION (Only TMDB needed now)
// =========================================================================

const TMDB_KEY = process.env.TMDB_KEY; 

// =========================================================================

const builder = new addonBuilder({
    id: "org.sojustream.catalog.only",
    version: "11.0.0",
    name: "SojuStream (Catalog Only)",
    description: "K-Drama & Movie Menus • Uses Cinemeta for Links • Works with Torrentio/RD",
    
    // ✅ ONLY "catalog" and "meta" - No more stream handling
    resources: ["catalog", "meta"], 
    
    types: ["movie", "series"],
    catalogs: [
        { type: "movie", id: "kmovie_popular", name: "Popular K-Movies", extra: [{ name: "search" }, { name: "skip" }] },
        { type: "movie", id: "kmovie_new", name: "New K-Movies", extra: [{ name: "search" }, { name: "skip" }] },
        { type: "series", id: "kdrama_popular", name: "Popular K-Dramas", extra: [{ name: "search" }, { name: "skip" }] },
        { type: "series", id: "kdrama_new", name: "New K-Dramas", extra: [{ name: "search" }, { name: "skip" }] }
    ],
    idPrefixes: ["tmdb:"]
});

// --- 1. CATALOG HANDLER (INFINITE SCROLL) ---
builder.defineCatalogHandler(async function(args) {
    const page = (args.extra && args.extra.skip ? (args.extra.skip / 20) + 1 : 1);
    const date = new Date().toISOString().split('T')[0];
    
    if (!TMDB_KEY) return { metas: [] };

    const baseParams = `api_key=${TMDB_KEY}&language=en-US&include_adult=false&with_original_language=ko&page=${page}`;
    let fetchUrl = "";

    if (args.extra && args.extra.search) fetchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${args.extra.search}&language=en-US&include_adult=false`;
    else if (args.id === 'kmovie_popular') fetchUrl = `https://api.themoviedb.org/3/discover/movie?${baseParams}&sort_by=vote_count.desc&vote_count.gte=100`;
    else if (args.id === 'kmovie_new') fetchUrl = `https://api.themoviedb.org/3/discover/movie?${baseParams}&sort_by=primary_release_date.desc&primary_release_date.lte=${date}&vote_count.gte=10`;
    else if (args.id === 'kdrama_popular') fetchUrl = `https://api.themoviedb.org/3/discover/tv?${baseParams}&sort_by=vote_count.desc&vote_count.gte=100`;
    else if (args.id === 'kdrama_new') fetchUrl = `https://api.themoviedb.org/3/discover/tv?${baseParams}&sort_by=first_air_date.desc&first_air_date.lte=${date}&vote_count.gte=10`;

    try {
        const response = await axios.get(fetchUrl);
        let items = response.data.results || [];

        // 🛡️ PORN FILTER
        items = items.filter(item => {
            const title = (item.title || item.name || "").toLowerCase();
            const badWords = ["erotic", "sex", "porn", "japanese mom", "18+", "uncensored"];
            if (!item.poster_path) return false;
            return !badWords.some(word => title.includes(word));
        });

        return {
            metas: items.map(item => ({
                id: `tmdb:${item.id}`,
                type: item.media_type === 'movie' || args.type === 'movie' ? 'movie' : 'series',
                name: item.title || item.name,
                poster: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
                description: item.overview
            }))
        };
    } catch (e) { return { metas: [] }; }
});

// --- 2. META HANDLER ---
// This ensures that when you click a poster, you see the seasons and episodes
builder.defineMetaHandler(async function(args) {
    if (!args.id.startsWith("tmdb:")) return { meta: {} }; 
    const tmdbId = args.id.split(":")[1];
    const type = args.type === 'series' ? 'tv' : 'movie'; 

    try {
        const url = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`;
        const meta = (await axios.get(url)).data;
        
        const result = {
            id: args.id,
            type: args.type,
            name: meta.title || meta.name,
            poster: `https://image.tmdb.org/t/p/w500${meta.poster_path}`,
            background: meta.backdrop_path ? `https://image.tmdb.org/t/p/original${meta.backdrop_path}` : null,
            description: meta.overview,
            releaseInfo: (meta.release_date || meta.first_air_date || "").substring(0, 4),
            videos: [] 
        };

        if (args.type === 'series') {
            try {
                // Fetch Season 1 Episodes so they appear in Stremio
                const s1Url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/1?api_key=${TMDB_KEY}&language=en-US`;
                const s1Data = (await axios.get(s1Url)).data;
                result.videos = s1Data.episodes.map(ep => ({
                    id: `tmdb:${tmdbId}:${ep.season_number}:${ep.episode_number}`,
                    title: ep.name || `Episode ${ep.episode_number}`,
                    released: new Date(ep.air_date).toISOString(),
                    episode: ep.episode_number,
                    season: ep.season_number,
                }));
            } catch (e) {}
        }
        return { meta: result };
    } catch (e) { return { meta: {} }; }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });