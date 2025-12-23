require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// 🔒 CONFIGURATION
const TMDB_KEY = process.env.TMDB_KEY;
const PROXY_URL = "https://jaredlkx-soju-tunnel.hf.space"; 
const PROXY_PASS = process.env.PROXY_PASS; 

const builder = new addonBuilder({
    id: "org.sojustream.jared.v14", // 👈 New ID to prove it's the new code
    version: "14.0.0",
    name: "SojuStream (Debug & Fix)",
    description: "KissKH via MediaFlow",
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

// ✅ HELPER: SAFE URL BUILDER
function getProxiedUrl(targetUrl) {
    const headers = { 
        "Referer": "https://kisskh.do/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };

    const params = new URLSearchParams();
    params.append("url", targetUrl);
    params.append("api_password", PROXY_PASS);
    params.append("headers", JSON.stringify(headers));

    return `${PROXY_URL}/proxy/stream?${params.toString()}`;
}

// --- 1. CATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    console.log(`[v14] Requesting ${args.id}`); // 👈 Look for this "[v14]" in your logs
    const domain = "kisskh.do";
    let targetUrl = "";
    
    if (args.extra && args.extra.search) {
        targetUrl = `https://${domain}/api/DramaList/Search?q=${encodeURIComponent(args.extra.search)}&type=0`;
    } else {
        targetUrl = `https://${domain}/api/DramaList/List?page=1&type=0&sub=0&country=0&status=0&order=2`;
    }

    try {
        const proxiedUrl = getProxiedUrl(targetUrl);
        
        // LOGGING FOR DEBUGGING (Hides password)
        const debugUrl = proxiedUrl.replace(PROXY_PASS, "***");
        console.log(`[v14] Connecting to Proxy: ${debugUrl}`);

        const response = await axios.get(proxiedUrl, { timeout: 15000 });
        const items = response.data.results || response.data;

        if (!Array.isArray(items)) {
            console.error("[v14] Proxy returned invalid data:", JSON.stringify(response.data).substring(0, 100));
            return { metas: [] };
        }

        console.log(`[v14] Success! Found ${items.length} items.`);
        return {
            metas: items.map(item => ({
                id: `tmdb:${item.id}`,
                type: "series",
                name: item.title,
                poster: item.thumbnail,
                description: "Watch on KissKH"
            }))
        };

    } catch (e) {
        if (e.response) {
            // 422 = Proxy rejected format, 403 = Wrong Password, 500 = KissKH Error
            console.error(`[v14] Proxy Error ${e.response.status}:`, JSON.stringify(e.response.data));
        } else {
            console.error("[v14] Connection Error:", e.message);
        }
        return { metas: [] };
    }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 10000, host: "0.0.0.0" });