require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// 🔒 CONFIGURATION
const TMDB_KEY = process.env.TMDB_KEY;
const PROXY_URL = "https://jaredkx-soju-tunnel.hf.space"; 
const PROXY_PASS = process.env.PROXY_PASS; 

const builder = new addonBuilder({
    id: "org.sojustream.proxied.v11", // New ID to force fresh start
    version: "11.0.0",
    name: "SojuStream (Proxied Catalog)",
    description: "Asian Drama Mirror Catalog via MediaFlow Proxy",
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

// Helper: Wrap any URL in MediaFlow Proxy
function wrapWithProxy(targetUrl, domain) {
    const headers = JSON.stringify({ "Referer": `https://${domain}/`, "User-Agent": "Mozilla/5.0" });
    return `${PROXY_URL}/proxy/stream?url=${encodeURIComponent(targetUrl)}&api_password=${PROXY_PASS}&headers=${encodeURIComponent(headers)}`;
}

// --- 1. PROXIED CATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    const domain = "kisskh.do";
    let targetUrl = `https://${domain}/api/DramaList/List?page=1&pageSize=20&type=0&order=2`;
    
    if (args.extra && args.extra.search) {
        targetUrl = `https://${domain}/api/DramaList/Search?q=${encodeURIComponent(args.extra.search)}&type=0`;
    }

    try {
        // Fetch Catalog JSON THROUGH the proxy to avoid IP bans
        const proxiedApiUrl = wrapWithProxy(targetUrl, domain);
        const response = await axios.get(proxiedApiUrl);
        const items = response.data.results || response.data;

        if (!Array.isArray(items)) return { metas: [] };

        return {
            metas: items.map(item => ({
                id: `tmdb:${item.id}`,
                type: "series",
                name: item.title,
                poster: item.thumbnail
            }))
        };
    } catch (e) {
        console.error("Proxied Catalog Fail:", e.message);
        return { metas: [] };
    }
});

// --- 2. PROXIED STREAM HANDLER ---
builder.defineStreamHandler(async (args) => {
    const streams = [];
    const domain = "kisskh.do";
    try {
        const parts = args.id.split(":");
        const tmdbId = parts[1];
        const episode = parts[3] || 1;

        const type = args.type === 'series' ? 'tv' : 'movie';
        const metaRes = await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}`);
        const title = metaRes.data.name || metaRes.data.title;

        // Fetch Search Results through Proxy
        const searchUrl = `https://${domain}/api/DramaList/Search?q=${encodeURIComponent(title)}&type=0`;
        const searchRes = await axios.get(wrapWithProxy(searchUrl, domain));

        if (searchRes.data && searchRes.data[0]) {
            const drama = searchRes.data[0];
            const detailUrl = `https://${domain}/api/DramaList/Drama/${drama.id}?isMovie=${args.type === 'movie'}`;
            const detail = await axios.get(wrapWithProxy(detailUrl, domain));
            const targetEp = (detail.data.episodes || []).find(e => e.number == episode);
            
            if (targetEp) {
                const sUrl = `https://${domain}/api/ExternalLoader/VideoService/${targetEp.id}?device=2`;
                const sInfo = await axios.get(wrapWithProxy(sUrl, domain));
                
                streams.push({
                    name: "⚡ Soju-Tunnel",
                    title: `1080p | ${title} | E${episode}`,
                    url: wrapWithProxy(sInfo.data.Video, domain)
                });
            }
        }
    } catch (e) { console.error("Proxied Stream Fail:", e.message); }
    return { streams };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 10000, host: "0.0.0.0" });