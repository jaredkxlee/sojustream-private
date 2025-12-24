require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

const TMDB_KEY = process.env.TMDB_KEY || "b80e5b1b965da72a2a23ba5680cb778a";

// 🚀 TURBO CACHE: Store results for 2 hours
const CACHE = new Map();
const CACHE_TIME = 2 * 60 * 60 * 1000;

// 🏷️ GENRE MAP
const GENRES = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 
    99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History", 
    27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 
    10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western", 10759: "Action/Adventure",
    10762: "Kids", 10765: "Sci-Fi/Fantasy", 10768: "War/Politics"
};

const builder = new addonBuilder({
    id: "org.sojustream.catalog.turbo",
    version: "12.4.1", 
    name: "SojuStream (Turbo)",
    description: "K-Drama/Movie • Unified Search • High Speed",
    resources: ["catalog", "meta"],
    types: ["movie", "series"],
    catalogs: [
        // 🔍 UNIFIED SEARCH (Reduces resources by combining 4 searches into 1)
        { 
            type: "movie", 
            id: "soju_search", 
            name: "🔍 Soju Search (Movies)", 
            extra: [{ name: "search", isRequired: true }] 
        },
        { 
            type: "series", 
            id: "soju_search", 
            name: "🔍 Soju Search (Series)", 
            extra: [{ name: "search", isRequired: true }] 
        },
        // 📂 REGULAR LISTS (No search bars here to save resources)
        { type: "movie", id: "kmovie_popular", name: "Popular K-Movies", extra: [{ name: "skip" }] },
        { type: "movie", id: "kmovie_new", name: "New K-Movies", extra: [{ name: "skip" }] },
        { type: "series", id: "kdrama_popular", name: "Popular K-Dramas", extra: [{ name: "skip" }] },
        { type: "series", id: "kdrama_new", name: "New K-Dramas", extra: [{ name: "skip" }] }
    ],
    idPrefixes: ["tmdb:"]
});

// 🛡️ STRICT CONTENT FILTER
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
    const cacheKey = `${args.id}-${page}-${args.extra?.search || ''}`;

    if (CACHE.has(cacheKey)) {
        const cached = CACHE.get(cacheKey);
        if (Date.now() - cached.time < CACHE_TIME) return { metas: cached.data };
    }

    const date = new Date().toISOString().split('T')[0];
    const baseParams = `api_key=${TMDB_KEY}&language=en-US&include_adult=false&with_original_language=ko&page=${page}`;
    let fetchUrl = "";
    
    const showYear = args.id.includes('popular') || args.id === 'soju_search';

    if (args.id === 'soju_search' && args.extra?.search) {
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
        const response = await axios.get(fetchUrl, { timeout: 5000 });
        let items = response.data.results || [];

        // 🇰🇷 STRICT KOREAN FILTER: 
        // We now filter manually to ensure the original language is Korean ('ko')
        items = items.filter(i => i.original_language === 'ko');

        // 🧹 UNIFIED SEARCH FILTERING: 
        if (args.id === 'soju_search') {
            if (args.type === 'movie') items = items.filter(i => i.media_type === 'movie');
            else if (args.type === 'series') items = items.filter(i => i.media_type === 'tv');
        }

        const safeItems = items.filter(isSafeContent);

        const metas = safeItems.map(item => {
            const year = (item.release_date || item.first_air_date || "").substring(0, 4);
            const genreList = (item.genre_ids || []).map(id => GENRES[id]).filter(Boolean).slice(0, 2);
            const rawTitle = item.title || item.name;

            const finalName = (showYear && year) ? `${rawTitle} (${year})` : rawTitle;
            
            return {
                id: `tmdb:${item.id}`,
                type: item.media_type === 'movie' || args.type === 'movie' ? 'movie' : 'series',
                name: finalName, 
                releaseInfo: showYear ? year : null, 
                genres: genreList,
                description: `${genreList.join(' / ')}\n\n${item.overview || ""}`, 
                poster: `https://image.tmdb.org/t/p/w342${item.poster_path}`,
                posterShape: 'poster'
            };
        });

        CACHE.set(cacheKey, { time: Date.now(), data: metas });
        return { metas };
    } catch (e) { return { metas: [] }; }
});

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