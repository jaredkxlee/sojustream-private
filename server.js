cconst { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
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

// FLIXHQ: The engine that is working for you
const flixhq = new MOVIES.FlixHQ(); 

const builder = new addonBuilder({
    id: "org.community.sojustream.improved",
    version: "1.5.5",
    name: "SojuStream (Clean)",
    description: "K-Content • FlixHQ • English • No Porn",
    resources: ["catalog", "meta", "stream"], // <--- Added "meta" for better loading
    types: ["movie", "series"],
    catalogs: [
        // Clean Names (No Emojis)
        { type: "movie", id: "kmovie_trending", name: "Trending K-Movies", extra: [{ name: "search" }, { name: "skip" }] },
        { type: "movie", id: "kmovie_new", name: "Recent K-Movies", extra: [{ name: "search" }, { name: "skip" }] },
        { type: "movie", id: "kmovie_popular", name: "Popular K-Movies", extra: [{ name: "search" }, { name: "skip" }] },
        
        { type: "series", id: "kdrama_trending", name: "Trending K-Dramas", extra: [{ name: "search" }, { name: "skip" }] },
        { type: "series", id: "kdrama_new", name: "Recent K-Dramas", extra: [{ name: "search" }, { name: "skip" }] },
        { type: "series", id: "kdrama_popular", name: "Popular K-Dramas", extra: [{ name: "search" }, { name: "skip" }] }
    ],
    idPrefixes: ["tmdb:"]
});

// --- 1. CATALOG HANDLER (WITH SAFETY FILTER) ---
builder.defineCatalogHandler(async function(args) {
    const page = (args.extra && args.extra.skip ? (args.extra.skip / 20) + 1 : 1);
    const date = new Date().toISOString().split('T')[0];
    let fetchUrl = '';

    const baseParams = `api_key=${TMDB_KEY}&language=en-US&include_adult=false&with_original_language=ko&page=${page}`;

    // A. SEARCH
    if (args.extra && args.extra.search) {
        fetchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${args.extra.search}&language=en-US&include_adult=false`;
    }
    // B. CATALOGS
    else if (args.id === 'kmovie_trending') fetchUrl = `https://api.themoviedb.org/3/discover/movie?${baseParams}&sort_by=popularity.desc&vote_count.gte=20`;
    else if (args.id === 'kmovie_new') fetchUrl = `https://api.themoviedb.org/3/discover/movie?${baseParams}&sort_by=primary_release_date.desc&primary_release_date.lte=${date}&vote_count.gte=5`;
    else if (args.id === 'kmovie_popular') fetchUrl = `https://api.themoviedb.org/3/discover/movie?${baseParams}&sort_by=vote_count.desc`;
    else if (args.id === 'kdrama_trending') fetchUrl = `https://api.themoviedb.org/3/discover/tv?${baseParams}&sort_by=popularity.desc&first_air_date.gte=2022-01-01`;
    else if (args.id === 'kdrama_new') fetchUrl = `https://api.themoviedb.org/3/discover/tv?${baseParams}&sort_by=first_air_date.desc&first_air_date.lte=${date}&vote_count.gte=5`;
    else if (args.id === 'kdrama_popular') fetchUrl = `https://api.themoviedb.org/3/discover/tv?${baseParams}&sort_by=vote_count.desc`;

    try {
        const response = await axios.get(fetchUrl);
        let items = response.data.results || [];

        // 🛡️ IMPROVEMENT: Manual Safety Filter
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

// --- 2. META HANDLER (IMPROVEMENT: Fixes "Content Not Found") ---
builder.defineMetaHandler(async function(args) {
    if (!args.id.startsWith("tmdb:")) return { meta: {} };
    const tmdbId = args.id.split(":")[1];
    const type = args.type === 'movie' ? 'movie' : 'tv';

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
            }
        };
    } catch (e) { return { meta: {} }; }
});

// --- 3. STREAM HANDLER (FLIXHQ + YTS) ---
builder.defineStreamHandler(async function(args) {
    if (!args.id.startsWith("tmdb:")) return { streams: [] };
    const tmdbId = args.id.split(":")[1];

    let title = "", imdbId = "";
    try {
        const type = args.type === 'movie' ? 'movie' : 'tv';
        const meta = (await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?append_to_response=external_ids&api_key=${TMDB_KEY}&language=en-US`)).data;
        title = meta.title || meta.name;
        imdbId = meta.external_ids.imdb_id;
    } catch (e) { return { streams: [] }; }

    console.log(`🔍 Searching for: ${title}`);
    const streams = [];

    // ENGINE A: FLIXHQ
    try {
        const search = await flixhq.search(title);
        if (search.results.length > 0) {
            const match = search.results[0];
            const info = await flixhq.fetchMediaInfo(match.id);
            
            // Episode Logic: Default to Ep 1 if TV, or Movie ID if Movie
            let epId = (info.episodes && info.episodes.length > 0) ? info.episodes[0].id : match.id;
            
            if (epId) {
                const sources = await flixhq.fetchEpisodeSources(epId, match.id);
                const best = sources.sources.find(s => s.quality === 'auto' || s.quality === '1080p');
                if (best) streams.push({ title: `⚡ FlixHQ - ${title}`, url: best.url });
            }
        }
    } catch (e) { console.log("FlixHQ Error:", e.message); }

    // ENGINE B: YTS (Movies Only)
    if (args.type === 'movie' && imdbId && streams.length === 0) {
        try {
            const ytsResp = await axios.get(`https://yts.mx/api/v2/list_movies.json?query_term=${imdbId}`);
            if (ytsResp.data.data.movies) {
                const movie = ytsResp.data.data.movies[0];
                const torrent = movie.torrents.find(t => t.quality === "1080p") || movie.torrents[0];
                const magnet = `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURIComponent(movie.title)}`;
                const rdUrl = await resolveMagnet(magnet);
                if (rdUrl) streams.push({ title: `⚡ RD [YTS] - ${title}`, url: rdUrl });
            }
        } catch (e) {}
    }

    return { streams: streams };
});

// --- HELPER: REAL-DEBRID ---
async function resolveMagnet(magnet) {
    try {
        const headers = { 'Authorization': `Bearer ${RD_TOKEN}` };
        const add = await axios.post('https://api.real-debrid.com/rest/1.0/torrents/addMagnet', `magnet=${encodeURIComponent(magnet)}`, { headers });
        await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${add.data.id}`, 'files=all', { headers });
        const info = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${add.data.id}`, { headers });
        const unres = await axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link', `link=${info.data.links[0]}`, { headers });
        return unres.data.download; 
    } catch (e) { return null; }
}

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });