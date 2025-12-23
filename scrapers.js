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
    description: "KissKH & FlixHQ Streams via Soju-Tunnel",
    resources: ["stream"], // Only handles streams
    types: ["movie", "series"],
    idPrefixes: ["tmdb:"]
});

builder.defineStreamHandler(async function(args) {
    if (!args.id.startsWith("tmdb:")) return { streams: [] };

    const [prefix, tmdbId, season, episode] = args.id.split(":");
    const type = args.type === 'series' ? 'tv' : 'movie';
    
    // 1. Get Title for Search
    const meta = (await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}`)).data;
    const title = meta.name || meta.title;

    const streams = [];

    // 2. SCRAPER LOGIC (Placeholder for KissKH/FlixHQ search)
    // We will fill this with the actual scraping functions next
    const foundUrl = "https://example-source.com/video-file.m3u8"; 

    // 3. APPLY MEDIAFLOW PROXY
    // This adds the 'Referer' header so KissKH doesn't block you
    const proxiedUrl = `${PROXY_URL}/proxy/stream?url=${encodeURIComponent(foundUrl)}&api_password=${PROXY_PASS}&headers=${encodeURIComponent(JSON.stringify({"Referer": "https://kisskh.co/"}))}`;

    streams.push({
        name: "⚡ Soju-Tunnel",
        title: `KissKH | 1080p | ${title}`,
        url: proxiedUrl
    });

    return { streams };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7001 });