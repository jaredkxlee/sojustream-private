const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// =========================================================================
// 🔒 SECURE CONFIGURATION
// =========================================================================

const TMDB_KEY = process.env.TMDB_KEY; 

// =========================================================================

const builder = new addonBuilder({
    id: "org.sojustream.catalog.safe", // Updated ID to reflect safety changes
    version: "12.0.0",
    name: "SojuStream (Clean Catalog)",
    description: "K-Drama & Movie Menus • Strict Anti-Porn Filter • Uses Cinemeta for Links",
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

// 🛡️ STRICT CONTENT FILTER FUNCTION
function isSafeContent(item) {
    if (!item.poster_path) return false; // Drop items with no poster (usually junk)

    const title = (item.title || item.name || "").toLowerCase();
    const overview = (item.overview || "").toLowerCase();
    
    // 1. HARDCORE KEYWORDS (Instant Ban)
    // These words rarely appear in legitimate K-Drama titles/descriptions
    const banList = [
        "erotic", "sex", "porn", "xxx", "18+", "uncensored", "nude", "nudity", 
        "r-rated", "adult only", "av idol", "jav", "sexual", "intercourse", 
        "carnal", "orgasm", "incest", "taboo", "rape", "gangbang", "fetish",
        "hardcore", "softcore", "uncut", "voluptuous", "lingerie"
    ];

    // 2. "IPTV" EROTICA TROPES (The "Korean Pink Movie" Filter)
    // These specific phrases are extremely common in low-budget Korean adult films
    // but rare in mainstream content (e.g., "Boarding House 2", "Nice Sister-In-Law")
    const tropeList = [
        "young mother", "mother-in-law", "sister-in-law", "friend's mom", 
        "friend's mother", "boarding house", "massage shop", "massage salon", 
        "private lesson", "tutor", "plumber", "stepmother", "stepmom", 
        "stepdaughter", "stepson", "stepparent", "affair 2", "affair 3" 
    ];

    // Check Title
    if (banList.some(word => title.includes(word))) return false;
    if (tropeList.some(phrase =>KpRegexCheck(title,QmPhrase))) return false;

    // Check Overview (Be slightly more lenient to avoid false positives on legitimate "romance")
    if (banList.some(word => overview.includes(` ${word} `))) return false; // Check whole words only

    return true;
}

// Helper to check phrases simply
function KpRegexCheck(text, phrase) {
    return text.includes(phrase);
}

// --- 1. CATALOG HANDLER ---
builder.defineCatalogHandler(async function(args) {
    const page = (args.extra && args.extra.skip ? (args.extra.skip / 20) + 1 : 1);
    const date = new Date().toISOString().split('T')[0];
    
    if (!TMDB_KEY) return { metas: [] };

    const baseParams = `api_key=${TMDB_KEY}&language=en-US&include_adult=false&with_original_language=ko&page=${page}`;
    let fetchUrl = "";

    if (args.extra && args.extra.search) fetchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${args.extra.search}&language=en-US&include_adult=false`;
    else if (args.id === 'kmovie_popular') fetchUrl = `https://api.themoviedb.org/3/discover/movie?${baseParams}&sort_by=vote_count.desc&vote_count.gte=50`; // Increased vote threshold
    else if (args.id === 'kmovie_new') fetchUrl = `https://api.themoviedb.org/3/discover/movie?${baseParams}&sort_by=primary_release_date.desc&primary_release_date.lte=${date}&vote_count.gte=10`;
    else if (args.id === 'kdrama_popular') fetchUrl = `https://api.themoviedb.org/3/discover/tv?${baseParams}&sort_by=vote_count.desc&vote_count.gte=50`;
    else if (args.id === 'kdrama_new') fetchUrl = `https://api.themoviedb.org/3/discover/tv?${baseParams}&sort_by=first_air_date.desc&first_air_date.lte=${date}&vote_count.gte=5`;

    try {
        const response = await axios.get(fetchUrl);
        let items = response.data.results || [];

        // ✅ APPLY STRICT FILTER
        items = items.filter(isSafeContent);

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