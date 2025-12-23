require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// 🔒 CONFIGURATION
const TMDB_KEY = process.env.TMDB_KEY;
const PROXY_URL = "https://jaredkx-soju-tunnel.hf.space"; 
const PROXY_PASS = process.env.PROXY_PASS; 

// The domains you found in your search
const DOMAINS = ["kisskh.do", "kisskh.cl", "kisskh.co"];

// Function to find which mirror is currently working
async function getActiveDomain() {
    for (const domain of DOMAINS) {
        try {
            const testUrl = `https://${domain}/api/DramaList/List?page=1&type=0&order=2`;
            await axios.get(testUrl, { 
                timeout: 2000, 
                headers: { "User-Agent": "Mozilla/5.0" } 
            });
            console.log(`✅ Using active domain: ${domain}`);
            return domain;
        } catch (e) {
            console.log(`⚠️ Mirror ${domain} failed, trying next...`);
        }
    }
    return "kisskh.do"; // Fallback to primary if all checks fail
}

const builder = new addonBuilder({
    id: "org.sojustream.mirror.v8", // Changed ID to force Stremio to refresh its cache
    version: "8.0.0",
    name: "SojuStream (Mirror-Link)",
    description: "Auto-switching domains for KissKH content",
    resources: ["catalog", "stream"], 
    types: ["series", "movie"],
    idPrefixes: ["tmdb:", "tt"],
    catalogs: [
        {
            id: "latest_updates",
            type: "series",
            name: "KissKH: Latest Updates",
            extra: [{ name: "search", isRequired: false }]
        }
    ]
});

// --- 1. CATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    const domain = await getActiveDomain();
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": `https://${domain}/`,
        "Origin": `https://${domain}`
    };

    let url = `https://${domain}/api/DramaList/List?page=1&type=0&order=2`;
    if (args.extra && args.extra.search) {
        url = `https://${domain}/api/DramaList/Search?q=${encodeURIComponent(args.extra.search)}&type=0`;
    }

    try {
        const response = await axios.get(url, { headers });
        const items = response.data.results || response.data;
        
        if (!Array.isArray(items)) return { metas: [] };

        return {
            metas: items.map(item => ({
                id: `tmdb:${item.id}`,
                type: "series",
                name: item.title,      // Maps KissKH title to Stremio name
                poster: item.thumbnail // Maps KissKH thumbnail to Stremio poster
            }))
        };
    } catch (e) { 
        console.error("Mirror Catalog Error:", e.message);
        return { metas: [] }; 
    }
});

// --- 2. STREAM HANDLER ---
builder.defineStreamHandler(async (args) => {
    const streams = [];
    try {
        const domain = await getActiveDomain();
        const parts = args.id.split(":");
        const tmdbId = parts[1];
        const episode = parts[3] || 1;

        const type = args.type === 'series' ? 'tv' : 'movie';
        const metaRes = await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}`);
        const title = metaRes.data.name || metaRes.data.title;

        const searchRes = await axios.get(`https://${domain}/api/DramaList/Search?q=${encodeURIComponent(title)}&type=0`, {
            headers: { "Referer": `https://${domain}/` }
        });

        if (searchRes.data && searchRes.data[0]) {
            const drama = searchRes.data[0];
            const detail = await axios.get(`https://${domain}/api/DramaList/Drama/${drama.id}?isMovie=${args.type === 'movie'}`);
            const targetEp = (detail.data.episodes || []).find(e => e.number == episode);
            
            if (targetEp) {
                const sInfo = await axios.get(`https://${domain}/api/ExternalLoader/VideoService/${targetEp.id}?device=2`);
                const videoUrl = sInfo.data.Video;
                const pHeaders = JSON.stringify({ "Referer": `https://${domain}/` });
                const proxiedUrl = `${PROXY_URL}/proxy/stream?url=${encodeURIComponent(videoUrl)}&api_password=${PROXY_PASS}&headers=${encodeURIComponent(pHeaders)}`;
                
                streams.push({
                    name: "⚡ Soju-Tunnel",
                    title: `1080p | ${title} | E${episode}`,
                    url: proxiedUrl
                });
            }
        }
    } catch (e) { console.error("Mirror Stream Error:", e.message); }
    return { streams };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 10000, host: "0.0.0.0" });