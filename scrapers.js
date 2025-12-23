require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// 🔒 CONFIGURATION
const TMDB_KEY = process.env.TMDB_KEY;
const PROXY_URL = "https://jaredkx-soju-tunnel.hf.space"; 
const PROXY_PASS = process.env.PROXY_PASS; 

const builder = new addonBuilder({
    id: "org.sojustream.combined.scrapers",
    version: "2.0.0",
    name: "SojuStream (KissKH & FlixHQ)",
    description: "Multi-source HTTPS streams via MediaFlow Proxy",
    resources: ["stream"],
    types: ["movie", "series"],
    // ✅ Added "tt" to support default Stremio/IMDb IDs
    idPrefixes: ["tmdb:", "tt"] 
});

builder.defineStreamHandler(async function(args) {
    const streams = [];
    let tmdbId, season, episode;

    // 1. Parse IDs (Support both tt... and tmdb:...)
    if (args.id.startsWith("tt")) {
        // For IMDb IDs, we fetch the TMDB ID first to get the clean title
        const findUrl = `https://api.themoviedb.org/3/find/${args.id.split(':')[0]}?api_key=${TMDB_KEY}&external_source=imdb_id`;
        const findRes = await axios.get(findUrl);
        const result = findRes.data.movie_results[0] || findRes.data.tv_results[0];
        if (!result) return { streams: [] };
        tmdbId = result.id;
        const parts = args.id.split(":");
        season = parts[1] || 1;
        episode = parts[2] || 1;
    } else {
        const parts = args.id.split(":");
        tmdbId = parts[1];
        season = parts[2] || 1;
        episode = parts[3] || 1;
    }

    try {
        const type = args.type === 'series' ? 'tv' : 'movie';
        const meta = (await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}`)).data;
        const title = meta.name || meta.title;

        // --- SOURCE 1: KISSKH ---
        try {
            const searchRes = await axios.get(`https://kisskh.co/api/DramaList/Search?q=${encodeURIComponent(title)}&type=0`);
            if (searchRes.data && searchRes.data[0]) {
                const drama = searchRes.data[0];
                const detail = await axios.get(`https://kisskh.co/api/DramaList/Drama/${drama.id}?isMovie=${args.type === 'movie'}`);
                const ep = detail.data.episodes.find(e => e.number == episode);
                
                if (ep) {
                    const streamInfo = await axios.get(`https://kisskh.co/api/ExternalLoader/VideoService/${ep.id}?device=2`);
                    const proxiedUrl = `${PROXY_URL}/proxy/stream?url=${encodeURIComponent(streamInfo.data.Video)}&api_password=${PROXY_PASS}&headers=${encodeURIComponent(JSON.stringify({"Referer": "https://kisskh.co/"}))}`;
                    
                    streams.push({
                        name: "⚡ Soju-Tunnel (KissKH)",
                        title: `1080p | ${title} | E${episode}`,
                        url: proxiedUrl
                    });
                }
            }
        } catch (e) { console.error("KissKH Error:", e.message); }

        // --- SOURCE 2: FLIXHQ (Fallback logic) ---
        // Note: FlixHQ usually requires advanced scraping, but we can provide a 
        // proxied direct search link or placeholder for manual integration.
        streams.push({
            name: "⚡ Soju-Tunnel (FlixHQ)",
            title: `Auto-Search | ${title}`,
            externalUrl: `https://flixhq.to/search/${title.replace(/ /g, '-')}`
        });

    } catch (err) {
        console.error("General Scraper Error:", err.message);
    }

    return { streams };
});

// ✅ FIXED PORT BINDING FOR RENDER
// Listening on 0.0.0.0 on port 10000 ensures Render detects the port correctly
serveHTTP(builder.getInterface(), { 
    port: process.env.PORT || 10000, 
    host: "0.0.0.0" 
});