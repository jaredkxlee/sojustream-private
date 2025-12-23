require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// 🔒 FLARESOLVERR CONFIGURATION
// Your Render Proxy URL
const FLARESOLVERR_URL = "https://soju-proxy.onrender.com/v1"; 

const builder = new addonBuilder({
    id: "org.sojustream.jared.v21",
    version: "21.0.0",
    name: "SojuStream (FlareSolverr)",
    description: "Bypasses Cloudflare using Real Browser",
    resources: ["catalog", "stream"], 
    types: ["series", "movie"],
    idPrefixes: ["tmdb:", "tt"],
    catalogs: [
        {
            id: "latest_updates",
            type: "series",
            name: "KissKH: Latest Updates",
            extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
        },
        {
            id: "top_kdrama",
            type: "series",
            name: "KissKH: Top K-Drama",
            extra: [{ name: "skip", isRequired: false }]
        }
    ]
});

// ✅ HELPER: Ask FlareSolverr to fetch the data
async function fetchWithFlare(targetUrl) {
    try {
        console.log(`[FlareSolverr] Command: GET ${targetUrl}`);
        
        const response = await axios.post(FLARESOLVERR_URL, {
            cmd: 'request.get',
            url: targetUrl,
            maxTimeout: 60000, // Wait up to 60s for Cloudflare to solve
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        // FlareSolverr returns the HTML/JSON in a special 'solution' object
        if (response.data.status === 'ok') {
            // KissKH returns JSON, but FlareSolverr returns it as a string in 'response'
            // We need to parse that string back into JSON
            try {
                // Sometimes it returns an HTML wrapper, we need to extract the JSON body
                const rawText = response.data.solution.response;
                // If it looks like JSON, parse it
                if (rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
                    return JSON.parse(rawText);
                } else {
                    // It might be the HTML of the Cloudflare challenge if it failed
                    console.error("[FlareSolverr] Returned HTML, not JSON. Challenge might have failed.");
                    return null;
                }
            } catch (e) {
                console.error("[FlareSolverr] Failed to parse JSON response:", e.message);
                return null;
            }
        } else {
            console.error(`[FlareSolverr] Error: ${response.data.message}`);
            return null;
        }

    } catch (e) {
        console.error(`[FlareSolverr] Connection Failed: ${e.message}`);
        return null;
    }
}

// --- 1. CATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    console.log(`[v21] Requesting ${args.id}`);
    const domain = "kisskh.do";
    const page = args.extra && args.extra.skip ? Math.floor(args.extra.skip / 20) + 1 : 1;
    let targetUrl = "";
    
    if (args.extra && args.extra.search) {
        targetUrl = `https://${domain}/api/DramaList/Search?q=${encodeURIComponent(args.extra.search)}&type=0`;
    } else {
        switch(args.id) {
            case "latest_updates":
                targetUrl = `https://${domain}/api/DramaList/List?page=${page}&type=0&sub=0&country=0&status=0&order=2`;
                break;
            case "top_kdrama":
                targetUrl = `https://${domain}/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=0&order=1`;
                break;
            default:
                return { metas: [] };
        }
    }

    const data = await fetchWithFlare(targetUrl);
    
    if (!data) return { metas: [] };
    
    const items = data.results || data.data || data;

    if (Array.isArray(items)) {
        console.log(`[v21] Success! Found ${items.length} items.`);
        return { metas: mapItems(items) };
    }
    
    return { metas: [] };
});

function mapItems(items) {
    return items.map(item => ({
        id: `tmdb:${item.id}`,
        type: "series",
        name: item.title,
        poster: item.thumbnail,
        description: "Watch on KissKH"
    }));
}

// --- 2. STREAM HANDLER ---
builder.defineStreamHandler(async (args) => {
    const streams = [];
    try {
        const parts = args.id.split(":");
        const tmdbId = parts[1];
        const episode = parts[3] || 1;

        // 1. Search KissKH (via FlareSolverr)
        // Note: For simplicity, we assume we have the title. In prod, fetch TMDB first.
        // For this snippet, let's assume we search by TMDB ID or just return empty if complex
        // (You would paste the TMDB fetching logic here like previous versions)
        
        // ... (Logic is same as before, just use 'fetchWithFlare' instead of 'axios.get')
        
    } catch (e) { console.error("Stream Error:", e.message); }
    return { streams };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 10000, host: "0.0.0.0" });