require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

const TMDB_KEY = process.env.TMDB_KEY || "b80e5b1b965da72a2a23ba5680cb778a";

// 🚀 CACHE: Keep catalogs in memory for 2 hours
const CACHE = new Map();
const CACHE_TIME = 2 * 60 * 60 * 1000; 

// 🏷️ GENRE LIST (For the Dropdown Menu)
const GENRE_OY = [
    "Action", "Adventure", "Animation", "Comedy", "Crime", 
    "Documentary", "Drama", "Family", "Fantasy", "History", 
    "Horror", "Music", "Mystery", "Romance", "Sci-Fi", 
    "Thriller", "War", "Western"
];

// 🔢 MAP NAMES TO TMDB IDs
const GENRE_ID = {
    "Action": 28, "Adventure": 12, "Animation": 16, "Comedy": 35, "Crime": 80,
    "Documentary": 99, "Drama": 18, "Family": 10751, "Fantasy": 14, "History": 36,
    "Horror": 27, "Music": 10402, "Mystery": 9648, "Romance": 10749, "Sci-Fi": 878,
    "Thriller": 53, "War": 10752, "Western": 37, "TV Movie": 10770, "War & Politics": 10768,
    "Sci-Fi & Fantasy": 10765, "Kids": 10762, "Action & Adventure": 10759
};

const builder = new addonBuilder({
    id: "org.sojustream.catalog.nusearch", 
    version: "13.0.0", // 👈 Major update
    name: "SojuStream (Catalogs Only)",
    description: "K-Drama Menus • Genre Filters • No Search",
    resources: ["catalog", "meta"],
    types: ["movie", "series"],
    catalogs: [
        // 📂 CATALOGS WITH FILTERS ENABLED
        { 
            type: "movie", 
            id: "kmovie_popular", 
            name: "Popular K-Movies", 
            extra: [
                { name: "genre", options: GENRE_OY }, // 👈 This enables the Dropdown!
                { name: "skip" }
            ] 
        },
        { 
            type: "movie", 
            id: "kmovie_new", 
            name: "New K-Movies", 
            extra: [
                { name: "genre", options: GENRE_OY }, 
                { name: "skip" }
            ] 
        },
        { 
            type: "series", 
            id: "kdrama_popular", 
            name: "Popular K-Dramas", 
            extra: [
                { name: "genre", options: GENRE_OY }, 
                { name: "skip" }
            ] 
        },
        { 
            type: "series", 
            id: "kdrama_new", 
            name: "New K-Dramas", 
            extra: [
                { name: "genre", options: GENRE_OY }, 
                { name: "skip" }
            ] 
        }
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
    const genre = args.extra?.genre; // 👈 Capture the selected genre
    
    // Cache Key includes Genre now
    const cacheKey = `${args.id}-${page}-${genre || 'all'}`;

    if (CACHE.has(cacheKey)) {
        const cachedData = CACHE.get(cacheKey);
        if (Date.now() - cachedData.time < CACHE_TIME) return { metas: cachedData.data };
    }

    const date = new Date().toISOString().split('T')[0];
    let fetchUrl = `https://api.themoviedb.org/3/discover/${args.type === 'movie' ? 'movie' : 'tv'}?api_key=${TMDB_KEY}&language=en-US&include_adult=false&with_original_language=ko&page=${page}`;

    // 🧩 FILTER LOGIC: If user picked a genre, add it to TMDB request
    if (genre && GENRE_ID[genre]) {
        fetchUrl += `&with_genres=${GENRE_ID[genre]}`;
    }

    // Sort Logic
    if (args.id.includes('popular')) {
        fetchUrl += `&sort_by=vote_count.desc&vote_count.gte=20`;
    } else {
        fetchUrl += `&sort_by=primary_release_date.desc&primary_release_date.lte=${date}&vote_count.gte=5`;
    }

    try {
        const response = await axios.get(fetchUrl, { timeout: 10000 });
        let items = response.data.results || [];

        // 🛡️ STRICT FILTER
        items = items.filter(isSafeContent);

        const metas = items.map(item => {
            const year = (item.release_date || item.first_air_date || "").substring(0, 4);
            
            // Reverse Lookup Genre Names for Display
            const genreNames = (item.genre_ids || []).map(id => Object.keys(GENRE_ID).find(key => GENRE_ID[key] === id)).filterHB => Boolean(HB).slice(0, 2);

            // 📝 VISUAL TEXT (Year + Genre in Description)
            let descPrefix = "";
            if (year) descPrefix += `[${year}] `;
            if (genreNames.length > 0) descPrefix += `${genreNames.join('/')}`;
            if (descPrefix) descPrefix += "\n\n";

            return {
                id: `tmdb:${item.id}`,
                type: args.type,
                name: item.title || item.name, 
                releaseInfo: year,
                description: `${descPrefix}${item.overview || ""}`,
                poster: `https://image.tmdb.org/t/p/w342${item.poster_path}`,
                posterShape: 'poster'
            };
        });

        CACHE.set(cacheKey, { time: Date.now(), data: metas });
        return { metas };
    } catch (e) { 
        console.error("Fetch Error:", e.message);
        return { metas: [] }; 
    }
});

require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

const TMDB_KEY = process.env.TMDB_KEY || "b80e5b1b965da72a2a23ba5680cb778a";

// 🚀 CACHE: Keep catalogs in memory for 2 hours
const CACHE = new Map();
const CACHE_TIME = 2 * 60 * 60 * 1000; 

// 🏷️ GENRE LIST (For the Dropdown Menu)
const GENRE_OY = [
    "Action", "Adventure", "Animation", "Comedy", "Crime", 
    "Documentary", "Drama", "Family", "Fantasy", "History", 
    "Horror", "Music", "Mystery", "Romance", "Sci-Fi", 
    "Thriller", "War", "Western"
];

// 🔢 MAP NAMES TO TMDB IDs
const GENRE_ID = {
    "Action": 28, "Adventure": 12, "Animation": 16, "Comedy": 35, "Crime": 80,
    "Documentary": 99, "Drama": 18, "Family": 10751, "Fantasy": 14, "History": 36,
    "Horror": 27, "Music": 10402, "Mystery": 9648, "Romance": 10749, "Sci-Fi": 878,
    "Thriller": 53, "War": 10752, "Western": 37, "TV Movie": 10770, "War & Politics": 10768,
    "Sci-Fi & Fantasy": 10765, "Kids": 10762, "Action & Adventure": 10759
};

const builder = new addonBuilder({
    id: "org.sojustream.catalog.nusearch", 
    version: "13.0.1", // 👈 Fixed Version
    name: "SojuStream (Catalogs Only)",
    description: "K-Drama Menus • Genre Filters • No Search",
    resources: ["catalog", "meta"],
    types: ["movie", "series"],
    catalogs: [
        // 📂 CATALOGS WITH FILTERS ENABLED
        { 
            type: "movie", 
            id: "kmovie_popular", 
            name: "Popular K-Movies", 
            extra: [
                { name: "genre", options: GENRE_OY }, 
                { name: "skip" }
            ] 
        },
        { 
            type: "movie", 
            id: "kmovie_new", 
            name: "New K-Movies", 
            extra: [
                { name: "genre", options: GENRE_OY }, 
                { name: "skip" }
            ] 
        },
        { 
            type: "series", 
            id: "kdrama_popular", 
            name: "Popular K-Dramas", 
            extra: [
                { name: "genre", options: GENRE_OY }, 
                { name: "skip" }
            ] 
        },
        { 
            type: "series", 
            id: "kdrama_new", 
            name: "New K-Dramas", 
            extra: [
                { name: "genre", options: GENRE_OY }, 
                { name: "skip" }
            ] 
        }
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
    const genre = args.extra?.genre; 
    
    // Cache Key includes Genre now
    const cacheKey = `${args.id}-${page}-${genre || 'all'}`;

    if (CACHE.has(cacheKey)) {
        const cachedData = CACHE.get(cacheKey);
        if (Date.now() - cachedData.time < CACHE_TIME) return { metas: cachedData.data };
    }

    const date = new Date().toISOString().split('T')[0];
    let fetchUrl = `https://api.themoviedb.org/3/discover/${args.type === 'movie' ? 'movie' : 'tv'}?api_key=${TMDB_KEY}&language=en-US&include_adult=false&with_original_language=ko&page=${page}`;

    // 🧩 FILTER LOGIC
    if (genre && GENRE_ID[genre]) {
        fetchUrl += `&with_genres=${GENRE_ID[genre]}`;
    }

    // Sort Logic
    if (args.id.includes('popular')) {
        fetchUrl += `&sort_by=vote_count.desc&vote_count.gte=20`;
    } else {
        fetchUrl += `&sort_by=primary_release_date.desc&primary_release_date.lte=${date}&vote_count.gte=5`;
    }

    try {
        const response = await axios.get(fetchUrl, { timeout: 10000 });
        let items = response.data.results || [];

        // 🛡️ STRICT FILTER
        items = items.filter(isSafeContent);

        const metas = items.map(item => {
            const year = (item.release_date || item.first_air_date || "").substring(0, 4);
            
            // Reverse Lookup Genre Names for Display (Fixed syntax here)
            const genreNames = (item.genre_ids || []).map(id => Object.keys(GENRE_ID).find(key => GENRE_ID[key] === id)).filter(Boolean).slice(0, 2);

            // 📝 VISUAL TEXT (Year + Genre in Description)
            let descPrefix = "";
            if (year) descPrefix += `[${year}] `;
            if (genreNames.length > 0) descPrefix += `${genreNames.join('/')}`;
            if (descPrefix) descPrefix += "\n\n";

            return {
                id: `tmdb:${item.id}`,
                type: args.type,
                name: item.title || item.name, 
                releaseInfo: year,
                description: `${descPrefix}${item.overview || ""}`,
                poster: `https://image.tmdb.org/t/p/w342${item.poster_path}`,
                posterShape: 'poster'
            };
        });

        CACHE.set(cacheKey, { time: Date.now(), data: metas });
        return { metas };
    } catch (e) { 
        console.error("Fetch Error:", e.message);
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