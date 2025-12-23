require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// 🔒 PROXY CONFIGURATION
const PROXY_URL = "https://jaredlkx:12345678@soju-proxy.onrender.com";
const proxyAgent = new HttpsProxyAgent(PROXY_URL);

const client = axios.create({
    timeout: 15000,
    httpsAgent: proxyAgent,
    httpAgent: proxyAgent,
    headers: {
        "Referer": "https://kisskh.do/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*"
    }
});

const builder = new addonBuilder({
    id: "org.sojustream.jared.debug",
    version: "1.0.0",
    name: "SojuStream (Debug Mode)",
    description: "Testing Proxy Connection",
    resources: ["catalog"], 
    types: ["series", "movie"],
    catalogs: [{ id: "debug_test", type: "series", name: "DEBUG: Test Connection" }]
});

// --- DIAGNOSTIC HANDLER ---
builder.defineCatalogHandler(async (args) => {
    console.log(`\n=== 🔍 STARTING DIAGNOSTIC TEST ===`);

    // TEST 1: Check if Proxy Works at all
    try {
        console.log(`[TEST 1] Pinging httpbin.org to check proxy...`);
        const ipCheck = await client.get('https://httpbin.org/ip');
        console.log(`[SUCCESS] Proxy is working! Your Proxy IP is: ${ipCheck.data.origin}`);
    } catch (e) {
        console.error(`[FAIL] Proxy Check Failed: ${e.message}`);
        if(e.response) console.error(`[FAIL] Response: ${JSON.stringify(e.response.data)}`);
        return { metas: [] };
    }

    // TEST 2: Check KissKH
    try {
        const targetUrl = "https://kisskh.do/api/DramaList/List?page=1&type=0&sub=0&country=0&status=0&order=2";
        console.log(`[TEST 2] Fetching KissKH...`);
        const response = await client.get(targetUrl);
        const items = response.data.results || response.data;
        console.log(`[SUCCESS] KissKH connected! Found ${items.length} items.`);
        return { metas: items.map(i => ({ id: `tt${i.id}`, type: "series", name: i.title })) };
    } catch (e) {
        console.error(`\n[CRITICAL ERROR] KissKH Rejected the Request:`);
        console.error(`Status Code: ${e.response?.status}`);
        console.error(`Error Body: ${JSON.stringify(e.response?.data)}`); // <--- THIS IS WHAT WE NEED
        console.error(`Headers: ${JSON.stringify(e.response?.headers)}`);
        return { metas: [] };
    }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 10000, host: "0.0.0.0" });