require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

const TMDB_KEY = process.env.TMDB_KEY || "b80e5b1b965da72a2a23ba5680cb778a";

// 🚀 TURBO CACHE: Shared memory to make Search instant
const CACHE = new Map();
const CACHE_TIME = 2 * 60 * 60 * 1000; // 2 Hours

// 🏷️ GENRE MAP (Required for the "Filter" display)
const GENRES = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 
    99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History", 
    27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 
    10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western", 10759: "Action/Adventure",
    10762: "Kids", 10765: "Sci-Fi/Fantasy", 10768: "War/Politics"
};

const builder = new addonBuilder({
    id: "org.sojustream.catalog.final", 
    version: "12.8.1", // 👈 Bumped to force update
    name: "SojuStream (Final)",
    description: "K-Drama Menus • Global Search • Strict Filter",
    resources: ["catalog", "meta"],
    types: ["movie", "series"],
    catalogs: [
        // 🔍 UNIFIED SEARCH (Both use the same ID 'soju_search')
        { 
            type: "movie", 
            id: "soju_search", 
            name: "🔍 Soju Search", 
            extra: [{ name: "search", isRequired: true }] 
        },
        { 
            type: "series", 
            id: "soju_search", 
            name: "🔍 Soju Search", 
            extra: [{ name: "search", isRequired: true }] 
        },
        // 📂 CATALOGS (Strictly Korean)
        { type: "movie", id: "kmovie_popular", name: "Popular K-Movies", extra: [{ name: "skip" }] },
        { type: "movie", id: "kmovie_new", name: "New K-Movies", extra: [{ name: "skip" }] },
        { type: "series", id: "kdrama_popular", name: "Popular K-Dramas", extra: [{ name: "skip" }] },
        { type: "series", id: "kdrama_new", name: "New K-Dramas", extra: [{ name: "skip" }] }
    ],
    idPrefixes: ["tmdb:"]
});

// 🛡️ STRICT SAFETY FILTER
function isSafeContent(item) {
    if (!item.poster_path) return false;
    const title = (item.title || item.name || "").toLowerCase();
    const overview = (item.overview || "").toLowerCase();
    
    const banList = ["erotic","sex","porn","xxx","18+","uncensored","nude","nudity","r-rated","adult only","av idol","jav","sexual","intercourse","carnal","orgasm","incest","taboo","rape","gangbang","fetish","hardcore","softcore","uncut","voluptuous","lingerie"];
    const tropeList = ["young mother","mother-in-law","sister-in-law","friend's mom","friend's mother","boarding house","massage shop","massage salon","private lesson","tutor","stepmother","stepmom","stepdaughter","stepson","stepparent","affair 2","affair 3"];

    if (banList.some(word => title.includes(word))) return false;
    if (tropeList.some(phrase => title.includes(phrase))) return false;
    if (banList.some(word => overview.includes(` ${word} `))) return false;
    return true;
}

builder.defineCatalogHandler(async function(args) {
    const skip = args.extra?.skip || 0;
    const page = Math.floor(skip / 20) + 1;
    
    // 🧠 SHARED BRAIN: If searching, ignore the type (Movie vs Series) for the cache key.
    // This allows one API call to feed both Stremio lists.
    const uniqueId = args.extra?.search ? "soju_search_shared" : args.id;
    const cacheKey = `${uniqueId}-${page}-${args.extra?.search || ''}`;

    if (CACHE.has(cacheKey)) {
        const cachedData = CACHE.get(cacheKey);
        if (Date.now() - cachedData.time < CACHE_TIME) {
            let results = cachedData.data;
            // ✂️ Slice the shared pie: Return only Movies OR Series based on what Stremio asked for
            if (args.id === 'soju_search') {
                results = results.filter(m => m.type === args.type); 
            }
            return { metas: results };
        }
    }

    const date = new Date().toISOString().split('T')[0];
    const baseParams = `api_key=${TMDB_KEY}&language=en-US&include_adult=false&with_original_language=ko&page=${page}`;
    let fetchUrl = "";
    
    // 🎨 VISUAL RULES:
    // 1. Catalogs: Show Genres. (Search = No Genres)
    const showGenre = !args.extra?.search; 
    // 2. Popular Catalog: Show Year.
    const showYear = args.id.includes('popular');

    if (args.extra?.search) {
        // 🌍 GLOBAL SEARCH: No language filter here. Finds everything.
        fetchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(args.extra.search)}&language=en-US&include_adult=false`;
    } else if (args.id === 'kmovie_popular') {
        fetchUrl = `https://api.themoviedb.org/3/discover/movie?${baseParams}&sort_by=vote_count.desc&vote_count.gte=50`;
    } else if (args.id === 'kmovie_new') {
        fetchUrl = `https://api.themoviedb.org/3/discover/movie?${baseParams}&sort_by=primary_release_date.desc&primary_release_date.lte=${date}&vote_count.gte=10`;
    } else if (args.id === 'kdrama_popular') {
        fetchUrl = `https://api.themoviedb.org/3/discover/tv?${baseParams}&sort_by=vote_count.desc&vote_count.gte=50`;
    } else if (args.id === 'kdrama_new') {
        fetchUrl = `https://api.themoviedb.org/3/discover/tv?${baseParams}&sort_by=first_air_date.desc&first_air_date.lte=${date}&vote_count.gte=5`;
    }

    try {
        const response = await axios.get(fetchUrl, { timeout: 8000 });
        let items = response.data.results || [];

        // 🛡️ STRICT FILTER: Always active
        items = items.filter(isSafeContent);

        const metas = items.map(item => {
            const year = (item.release_date || item.first_air_date || "").substring(0, 4);
            const genreList = (item.genre_ids || []).map(id => GENRES[id]).filter(Boolean).slice(0, 2);
            
            // 📝 DESCRIPTION BUILDER: This puts [Year] Action/Drama into the text
            let descPrefix = "";
            if (showYear && year) descPrefix += `[${year}] `;
            if (showGenre && genreList.length > 0) descPrefix += `${genreList.join('/')}`;
            if (descPrefix) descPrefix += "\n\n";

            return {
                id: `tmdb:${item.id}`,
                type: item.media_type === 'movie' || (!item.media_type && args.type === 'movie') ? 'movie' : 'series',
                name: item.title || item.name, 
                releaseInfo: year, // 👈 Native Stremio Year
                genres: genreList, // 👈 Native Stremio Genres
                description: `${descPrefix}${item.overview || ""}`, // 👈 Visible Text Filter
                poster: `https://image.tmdb.org/t/p/w342${item.poster_path}`,
                posterShape: 'poster'
            };
        });

        // 💾 Save to Shared Cache
        CACHE.set(cacheKey, { time: Date.now(), data: metas });

        if (args.id === 'soju_search') {
            return { metas: metas.filter(m => m.type === args.type) };
        }

        return { metas };
    } catch (e) { 
        console.error("Catalog Error:", e.message);
        return { metas: [] }; 
    }
});

// --- META HANDLER ---
builder.defineMetaHandler(async function(args) {
    if (!args.id.startsWith("tmdb:")) return { meta: {} };
    const tmdbId = args.id.split(":")[1];
    const type = args.type === 'series' ? 'tv' : 'movie';
    try {
        const meta = (await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`)).data;
        return { meta: {
            id: args.id, type: args.type, name: meta.title || meta.name,
            poster: `https://image.tmdb.org/t/p/w500${meta.poster_path}`,
            background: meta.backdrop_path ? `https://image.tmdb.org/t/p/original${meta.backdrop_path}` : null,
            description: meta.overview,
            releaseInfo: (meta.release_date || meta.first_air_date || "").substring(0, 4),
            genres: (meta.genres || []).map(g => g.name),
            videos: args.type === 'series' ? (await axios.get(`https://api.themoviedb.org/3/tv/${tmdbId}/season/1?api_key=${TMDB_KEY}`)).data.episodes.map(ep => ({
                id: `tmdb:${tmdbId}:${ep.season_number}:${ep.episode_number}`,
                title: ep.name || `Episode ${ep.episode_number}`,
                released: new Date(ep.air_date).toISOString(),
                episode: ep.episode_number, season: ep.season_number
            })) : []
        }};
    } catch (e) { return { meta: {} }; }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });