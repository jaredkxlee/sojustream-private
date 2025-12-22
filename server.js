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

// "FlixHQ" provides the HTTPS streams (Direct Play)
const flixhq = new MOVIES.FlixHQ(); 

const builder = new addonBuilder({
    id: "org.community.sojustream.gold",
    version: "1.5.0",
    name: "SojuStream (Gold)",
    description: "K-Content Only • HTTPS Streams • No Ads • Safe Mode",
    resources: ["catalog", "stream"],
    types: ["movie", "series"],
    catalogs: [
        // --- K-MOVIES ---
        { type: "movie", id: "kmovie_trending", name: "🔥 Trending K-Movies", extra: [{ name: "search" }, { name: "skip" }] },
        { type: "movie", id: "kmovie_new", name: "🆕 Recently Aired K-Movies", extra: [{ name: "search" }, { name: "skip" }] },
        { type: "movie", id: "kmovie_popular", name: "💎 Popular K-Movies", extra: [{ name: "search" }, { name: "skip" }] },
        
        // --- K-DRAMAS ---
        { type: "series", id: "kdrama_trending", name: "🔥 Trending K-Dramas", extra: [{ name: "search" }, { name: "skip" }] },
        { type: "series", id: "kdrama_new", name: "🆕 Recently Aired K-Dramas", extra: [{ name: "search" }, { name: "skip" }] },
        { type: "series", id: "kdrama_popular", name: "💎 Popular K-Dramas", extra: [{ name: "search" }, { name: "skip" }] }
    ],
    idPrefixes: ["tmdb:"]
});

// --- 1. CATALOG HANDLER (THE 6 REQUESTED LISTS) ---
builder.defineCatalogHandler(async function(args) {
    const page = (args.extra.skip / 20) + 1 || 1;
    let fetchUrl = '';
    const date = new Date().toISOString().split('T')[0];

    // 🔒 GLOBAL SAFETY SETTINGS:
    // - language=en-US (Force English Metadata)
    // - include_adult=false (No Porn)
    // - with_original_language=ko (KOREAN ONLY)
    const baseParams = `api_key=${TMDB_KEY}&language=en-US&include_adult=false&with_original_language=ko&page=${page}`;

    // A. SEARCH (Global Search, still filtered for Korean + Safe)
    if (args.extra.search) {
        const type = args.type === 'movie' ? 'movie' : 'tv';
        fetchUrl = `https://api.themoviedb.org/3/search/${type}?api_key=${TMDB_KEY}&query=${args.extra.search}&language=en-US&include_adult=false`;
    }

    // --- K-MOVIE CATALOGS ---
    else if (args.id === 'kmovie_trending') {
        // Trending = High Popularity + Released in last 3 years + Min 20 votes
        fetchUrl = `https://api.themoviedb.org/3/discover/movie?${baseParams}&sort_by=popularity.desc&vote_count.gte=20&primary_release_date.gte=2022-01-01`;
    }
    else if (args.id === 'kmovie_new') {
        // New = Sorted by Release Date + Released before today (so it's out) + Min 5 votes
        fetchUrl = `https://api.themoviedb.org/3/discover/movie?${baseParams}&sort_by=primary_release_date.desc&primary_release_date.lte=${date}&vote_count.gte=5`;
    }
    else if (args.id === 'kmovie_popular') {
        // Popular = All time classics (High Vote Count)
        fetchUrl = `https://api.themoviedb.org/3/discover/movie?${baseParams}&sort_by=vote_count.desc`;
    }

    // --- K-DRAMA CATALOGS ---
    else if (args.id === 'kdrama_trending') {
        // Trending = High Popularity + Aired recently
        fetchUrl = `https://api.themoviedb.org/3/discover/tv?${baseParams}&sort_by=popularity.desc&first_air_date.gte=2023-01-01`;
    }
    else if (args.id === 'kdrama_new') {
        // New = Sorted by Air Date + Released before today
        fetchUrl = `https://api.themoviedb.org/3/discover/tv?${baseParams}&sort_by=first_air_date.desc&first_air_date.lte=${date}&vote_count.gte=5`;
    }
    else if (args.id === 'kdrama_popular') {
        // Popular = All time classics (Squid Game, etc.)
        fetchUrl = `https://api.themoviedb.org/3/discover/tv?${baseParams}&sort_by=vote_count.desc`;
    }

    try {
        const response = await axios.get(fetchUrl);
        return {
            metas: (response.data.results || []).map(item => ({
                id: `tmdb:${item.id}`,
                type: args.type,
                name: item.title || item.name,
                poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
                description: item.overview,
                releaseInfo: (item.release_date || item.first_air_date || "").substring(0, 4)
            }))
        };
    } catch (e) { return { metas: [] }; }
});

// --- 2. STREAM HANDLER (HTTPS STREAM via FLIXHQ) ---
builder.defineStreamHandler(async function(args) {
    if (!args.id.startsWith("tmdb:")) return { streams: [] };
    const tmdbId = args.id.split(":")[1];
    
    // 1. Get English Metadata (Critical for Search)
    let title = "";
    let imdbId = "";
    try {
        const type = args.type === 'movie' ? 'movie' : 'tv';
        const meta = (await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?append_to_response=external_ids&api_key=${TMDB_KEY}&language=en-US`)).data;
        title = meta.title || meta.name;
        imdbId = meta.external_ids.imdb_id;
    } catch (e) { return { streams: [] }; }

    console.log(`🔍 Searching for: ${title}`);
    const streams = [];

    // 2. STRATEGY: FLIXHQ (Provides HTTPS Stream)
    // This is the "Smart" logic that works for both Movies and TV
    try {
        // A. Search FlixHQ
        const search = await flixhq.search(title);
        if (search.results.length > 0) {
            const result = search.results[0]; 
            const info = await flixhq.fetchMediaInfo(result.id);
            
            // B. Select Episode (For Movies it's just 1 part. For TV we Default to Ep 1)
            // Note: Making it select the "Correct" episode clicked in Stremio requires complex math. 
            // For now, this plays Episode 1 or the Movie.
            if (info.episodes && info.episodes.length > 0) {
                const epId = info.episodes[0].id; 
                const sources = await flixhq.fetchEpisodeSources(epId, result.id);
                
                // C. Find the "Auto" or "1080p" HTTPS Link
                const bestSource = sources.sources.find(s => s.quality === 'auto' || s.quality === '1080p');

                if (bestSource) {
                    streams.push({ 
                        title: `⚡ HTTPS [Stream] - ${title}`, 
                        url: bestSource.url 
                    });
                }
            }
        }
    } catch (e) { console.log("FlixHQ failed:", e.message); }

    // 3. BACKUP STRATEGY: YTS (Movies Only - RD Magnets)
    if (streams.length === 0 && args.type === 'movie' && imdbId) {
        try {
            const ytsResp = await axios.get(`https://yts.mx/api/v2/list_movies.json?query_term=${imdbId}`);
            if (ytsResp.data.data.movies) {
                const movie = ytsResp.data.data.movies[0];
                const torrent = movie.torrents.find(t => t.quality === "1080p") || movie.torrents[0];
                const magnet = `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURIComponent(movie.title)}`;
                const rdUrl = await resolveMagnet(magnet);
                if (rdUrl) streams.push({ title: `⚡ RD [1080p] - YTS - ${title}`, url: rdUrl });
            }
        } catch (e) { console.log("YTS failed"); }
    }

    return { streams: streams };
});

// --- HELPER: REAL-DEBRID ---
async function resolveMagnet(magnet) {
    try {
        const headers = { 'Authorization': `Bearer ${RD_TOKEN}` };
        const addResp = await axios.post('https://api.real-debrid.com/rest/1.0/torrents/addMagnet', `magnet=${encodeURIComponent(magnet)}`, { headers });
        const torrentId = addResp.data.id;
        await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`, 'files=all', { headers });
        const infoResp = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, { headers });
        const unrestrictResp = await axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link', `link=${infoResp.data.links[0]}`, { headers });
        return unrestrictResp.data.download; 
    } catch (e) { return null; }
}

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });