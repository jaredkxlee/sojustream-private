const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// =========================================================================
// 🔒 SECURE CONFIGURATION (Keys from Render Environment)
// =========================================================================

const TMDB_KEY = process.env.TMDB_KEY; 
const RD_TOKEN = process.env.RD_TOKEN;     

// =========================================================================

const builder = new addonBuilder({
    id: "org.sojustream.debridonly",
    version: "10.0.1",
    name: "SojuStream (Platinum)",
    description: "K-Content • YTS + Nyaa • Real-Debrid • 100% Reliable",
    resources: ["catalog", "meta", "stream"], 
    types: ["movie", "series"],
    catalogs: [
        { type: "movie", id: "kmovie_popular", name: "Popular K-Movies", extra: [{ name: "search" }, { name: "skip" }] },
        { type: "movie", id: "kmovie_new", name: "New K-Movies", extra: [{ name: "search" }, { name: "skip" }] },
        { type: "series", id: "kdrama_popular", name: "Popular K-Dramas", extra: [{ name: "search" }, { name: "skip" }] },
        { type: "series", id: "kdrama_new", name: "New K-Dramas", extra: [{ name: "search" }, { name: "skip" }] }
    ],
    idPrefixes: ["tmdb:"]
});

// --- 1. CATALOG HANDLER (Uses TMDB) ---
builder.defineCatalogHandler(async function(args) {
    const page = (args.extra && args.extra.skip ? (args.extra.skip / 20) + 1 : 1);
    const date = new Date().toISOString().split('T')[0];
    
    // Safety Check
    if (!TMDB_KEY) {
        console.log("❌ Error: TMDB_KEY is missing in Render Environment Variables.");
        return { metas: [] };
    }

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
        } else {
            result.videos = [{ id: `tmdb:${tmdbId}`, title: meta.title, released: new Date(meta.release_date).toISOString() }];
        }
        return { meta: result };
    } catch (e) { return { meta: {} }; }
});

// --- 3. STREAM HANDLER (NO CONSUMET! YTS + NYAA ONLY) ---
builder.defineStreamHandler(async function(args) {
    if (!args.id.startsWith("tmdb:")) return { streams: [] };

    const parts = args.id.split(":");
    const tmdbId = parts[1];
    const season = parts[2] ? parseInt(parts[2]) : null;
    const episode = parts[3] ? parseInt(parts[3]) : null;

    let title = "", imdbId = "";
    try {
        const type = args.type === 'movie' ? 'movie' : 'tv';
        const meta = (await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?append_to_response=external_ids&api_key=${TMDB_KEY}&language=en-US`)).data;
        title = meta.title || meta.name;
        imdbId = meta.external_ids.imdb_id;
    } catch (e) { return { streams: [] }; }

    console.log(`🔍 Searching for: ${title} (S${season}E${episode})`);
    const streams = [];

    // === STRATEGY 1: YTS (Perfect for Movies) ===
    if (!season && imdbId) {
        try {
            const ytsResp = await axios.get(`https://yts.mx/api/v2/list_movies.json?query_term=${imdbId}`);
            if (ytsResp.data.data.movies && ytsResp.data.data.movies.length > 0) {
                const movie = ytsResp.data.data.movies[0];
                const torrent = movie.torrents.find(t => t.quality === "1080p") || movie.torrents[0];
                const magnet = `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURIComponent(movie.title)}`;
                const rdUrl = await resolveMagnet(magnet);
                if (rdUrl) streams.push({ title: `🚀 RD [YTS] 1080p - ${title}`, url: rdUrl });
            }
        } catch (e) { console.log("YTS Error:", e.message); }
    }

    // === STRATEGY 2: NYAA.SI (Perfect for K-Dramas) ===
    if (season) {
        try {
            // Queries: "Title S01E01" AND "Title 01" (Covering both naming styles)
            const queries = [
                `${title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`,
                `${title} ${String(episode).padStart(2, '0')}` 
            ];

            for (const q of queries) {
                // Read Nyaa RSS Feed directly (No scraping, no blocking)
                const nyaaUrl = `https://nyaa.si/?page=rss&q=${encodeURIComponent(q)}&c=0_0&f=0`;
                const rss = (await axios.get(nyaaUrl)).data;
                
                // Extract Magnets
                const magnets = [...rss.matchAll(/<link>(magnet:.*?)<\/link>/g)];
                
                if (magnets.length > 0) {
                    const magnet = magnets[0][1].replace(/&amp;/g, '&').replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '');
                    const rdUrl = await resolveMagnet(magnet);
                    if (rdUrl) {
                        streams.push({ title: `🚀 RD [Nyaa] - ${q}`, url: rdUrl });
                        break; // Stop if we found a working link
                    }
                }
            }
        } catch (e) { console.log("Nyaa Error:", e.message); }
    }

    return { streams: streams };
});

// --- HELPER: Real-Debrid Unrestrict ---
async function resolveMagnet(magnet) {
    try {
        const headers = { 'Authorization': `Bearer ${RD_TOKEN}` };
        // 1. Add Magnet
        const add = await axios.post('https://api.real-debrid.com/rest/1.0/torrents/addMagnet', `magnet=${encodeURIComponent(magnet)}`, { headers });
        // 2. Select All Files
        await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${add.data.id}`, 'files=all', { headers });
        // 3. Get Link Info
        const info = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${add.data.id}`, { headers });
        // 4. Unrestrict First Link
        if (info.data.links && info.data.links.length > 0) {
            const unres = await axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link', `link=${info.data.links[0]}`, { headers });
            return unres.data.download;
        }
    } catch (e) { return null; }
}

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });