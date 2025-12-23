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
    id: "org.sojustream.independent.final",
    version: "7.0.0",
    name: "SojuStream (Platinum)",
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

// --- 1. CATALOG HANDLER ---
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

        // 🛡️ NO PORN FILTER
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

// --- 2. META HANDLER ---
builder.defineMetaHandler(async function(args) {
    if (!args.id.startsWith("tmdb:")) return {wb: true}; 

    const tmdbId = args.id.split(":")[1];
    const type = args.type; 

    try {
        const url = `https://api.themoviedb.org/3/${type === 'series' ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`;
        const meta = (await axios.get(url)).data;

        const result = {
            id: args.id,
            type: type,
            name: meta.title || meta.name,
            poster: `https://image.tmdb.org/t/p/w500${meta.poster_path}`,
            background: meta.backdrop_path ? `https://image.tmdb.org/t/p/original${meta.backdrop_path}` : null,
            description: meta.overview,
            releaseInfo: (meta.release_date || meta.first_air_date || "").substring(0, 4),
            videos: [] 
        };

        if (type === 'series' || type === 'tv') {
            try {
                // Fetch Season 1 Episodes
                const s1Url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/1?api_key=${TMDB_KEY}&language=en-US`;
                const s1Data = (await axios.get(s1Url)).data;
                
                result.videos = s1Data.episodes.map(ep => ({
                    id: `tmdb:${tmdbId}:${ep.season_number}:${ep.episode_number}`,
                    title: ep.name || `Episode ${ep.episode_number}`,
                    released: new Date(ep.air_date).toISOString(),
                    thumbnail: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : null,
                    episode: ep.episode_number,
                    season: ep.season_number,
                }));
            } catch (e) {}
        } 
        else {
            result.videos = [{
                id: `tmdb:${tmdbId}`,
                title: meta.title,
                released: new Date(meta.release_date).toISOString()
            }];
        }
        return { meta: result };
    } catch (e) { return { meta: {} }; }
});

// --- 3. STREAM HANDLER (FLIXHQ) ---
builder.defineStreamHandler(async function(args) {
    if (!args.id.startsWith("tmdb:")) return { streams: [] };

    // Supports "tmdb:123" AND "tmdb:123:1:5"
    const parts = args.id.split(":");
    const tmdbId = parts[1];
    const season = parts[2] ? parseInt(parts[2]) : null;
    const episode = parts[3] ? parseInt(parts[3]) : null;

    let title = "";
    try {
        const type = args.type === 'movie' ? 'movie' : 'tv';
        const meta = (await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?append_to_response=external_ids&api_key=${TMDB_KEY}&language=en-US`)).data;
        title = meta.title || meta.name;
    } catch (e) { return { streams: [] }; }

    console.log(`🔍 Searching: ${title}`);
    const streams = [];

    try {
        const cleanTitle = title.replace(/[^a-zA-Z0-9 ]/g, " ");
        const search = await provider.search(cleanTitle);
        
        if (search.results.length > 0) {
            const match = search.results[0];
            const info = await provider.fetchMediaInfo(match.id);
            
            let targetEpId = null;
            if (season && episode) {
                const epObj = info.episodes.find(e => e.season === season && e.number === episode);
                if (epObj) targetEpId = epObj.id;
            } else {
                targetEpId = (info.episodes && info.episodes.length > 0) ? info.episodes[0].id : match.id;
            }
            
            if (targetEpId) {
                const sources = await provider.fetchEpisodeSources(targetEpId, match.id);
                const best = sources.sources.find(s => s.quality === 'auto' || s.quality === '1080p') || sources.sources[0];
                
                if (best) {
                    streams.push({
                        title: `⚡ FlixHQ - ${title} ${season ? `S${season}E${episode}` : ''}`,
                        url: best.url
                    });
                }
            }
        }
    } catch (e) { console.log("Stream Error:", e.message); }

    return { streams: streams };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });