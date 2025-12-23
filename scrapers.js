require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// 🔒 CONFIGURATION
const TMDB_KEY = process.env.TMDB_KEY;
const PROXY_URL = "https://jaredkx-soju-tunnel.hf.space"; 
const PROXY_PASS = process.env.PROXY_PASS; 

const builder = new addonBuilder({
    id: "org.sojustream.https.scrapers",
    version: "1.0.0",
    name: "SojuStream (HTTPS Links)",
    description: "KissKH Streams via Soju-Tunnel",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tmdb:"]
});

builder.defineStreamHandler(async function(args) {
    if (!args.id.startsWith("tmdb:")) return { streams: [] };

    const [prefix, tmdbId, season, episode] = args.id.split(":");
    const type = args.type === 'series' ? 'tv' : 'movie';
    
    try {
        // 1. Get Title from TMDB to use for searching
        const meta = (await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}`)).data;
        const title = meta.name || meta.title;

        // 2. Search KissKH API
        const searchRes = await axios.get(`https://kisskh.co/api/DramaList/Search?q=${encodeURIComponent(title)}&type=0`);
        const drama = searchRes.data[0]; // Take the first result
        if (!drama) return { streams: [] };

        // 3. Get Episode Details
        const isMovie = args.type === 'movie';
        const detail = await axios.get(`https://kisskh.co/api/DramaList/Drama/${drama.id}?isMovie=${isMovie}`);
        
        // Find the correct episode (defaults to 1 for movies)
        const targetEp = detail.data.episodes.find(e => e.number == (episode || 1));
        if (!targetEp) return { streams: [] };

        // 4. Get the Stream Link
        // Device=2 helps get the better m3u8 format
        const streamInfo = await axios.get(`https://kisskh.co/api/ExternalLoader/VideoService/${targetEp.id}?device=2`);
        const rawVideoUrl = streamInfo.data.Video;

        // 5. Wrap with Soju-Tunnel (MediaFlow Proxy)
        // This adds the "Referer" header so KissKH won't block the video
        const proxiedUrl = `${PROXY_URL}/proxy/stream?url=${encodeURIComponent(rawVideoUrl)}&api_password=${PROXY_PASS}&headers=${encodeURIComponent(JSON.stringify({"Referer": "https://kisskh.co/"}))}`;

        return {
            streams: [{
                name: "⚡ Soju-Tunnel",
                title: `KissKH | 1080p | ${title}`,
                url: proxiedUrl
            }]
        };

    } catch (e) {
        console.error("Scraper Error:", e.message);
        return { streams: [] };
    }
});

// Using port 7001 to keep it separate from the catalog
serveHTTP(builder.getInterface(), { port: process.env.PORT || 7001 });