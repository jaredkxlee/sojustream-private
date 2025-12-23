require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// 🔒 FLARESOLVERR CONFIGURATION
const FLARESOLVERR_URL = "https://soju-proxy.onrender.com/v1"; 

const builder = new addonBuilder({
    id: "org.sojustream.jared.v22",
    version: "22.0.0",
    name: "SojuStream (Session Fix)",
    description: "KissKH via FlareSolverr Sessions",
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

// ✅ HELPER: INTELLIGENT FLARESOLVERR REQUEST
async function fetchWithFlare(targetUrl) {
    const sessionName = 'kisskh-browser'; // We will reuse this browser tab
    
    try {
        console.log(`[FlareSolverr] Step 1: Ensuring Session '${sessionName}' exists...`);
        // 1. Create Session (Initialize the browser)
        // We ignore the error if it already exists
        await axios.post(FLARESOLVERR_URL, {
            cmd: 'sessions.create',
            session: sessionName
        }, { headers: { 'Content-Type': 'application/json' } }).catch(() => {});

        console.log(`[FlareSolverr] Step 2: Requesting Data via Session...`);
        // 2. Request using the persistent session
        const response = await axios.post(FLARESOLVERR_URL, {
            cmd: 'request.get',
            url: targetUrl,
            session: sessionName, // <--- THE MAGIC KEY
            maxTimeout: 60000,    // Wait up to 60s
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data.status === 'ok') {
            const rawText = response.data.solution.response;
            // Clean up any HTML wrapper (sometimes FlareSolverr wraps JSON in <html><body>...</body></html>)
            const jsonStart = rawText.indexOf('{');
            const jsonEnd = rawText.lastIndexOf('}');
            
            if (jsonStart !== -1 && jsonEnd !== -1) {
                const jsonString = rawText.substring(jsonStart, jsonEnd + 1);
                return JSON.parse(jsonString);
            } else {
                console.error("[FlareSolverr] Still got HTML. Cloudflare is very angry.");
                console.error("Preview:", rawText.substring(0, 100));
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
    console.log(`[v22] Requesting ${args.id}`);
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
    
    // KissKH sometimes wraps results in 'data', sometimes 'results'
    const items = data.results || data.data || data;

    if (Array.isArray(items)) {
        console.log(`[v22] Success! Found ${items.length} items.`);
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
    // Stream logic temporarily simplified to focus on catalog fix first
    return { streams };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 10000, host: "0.0.0.0" });