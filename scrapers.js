require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

<<<<<<< HEAD
=======
// ⬇️ Add these two lines
>>>>>>> 689d87ce35c9569fbe4825c1b574d2ddeb294ebf
const { wrapper } = require('axios-cookiejar-support');
const tough = require('tough-cookie');
const jar = new tough.CookieJar();
const client = wrapper(axios.create({ jar }));

require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');

// 🔒 CONFIGURATION
const FLARESOLVERR_URL = "https://soju-proxy.onrender.com/v1"; 
const TMDB_KEY = "b80e5b1b965da72a2a23ba5680cb778a"; // Re-added for clean posters
const SESSION_NAME = 'kisskh-persistent-v26';

// 🚀 IN-MEMORY CACHE
const CACHE = { catalog: {}, meta: {}, expiry: {} };

const builder = new addonBuilder({
    id: "org.sojustream.jared.v26",
    version: "26.0.0",
    name: "SojuStream (v26 Korea Only)",
    description: "KissKH: Korea Only, Clean Posters attempts, Stream Debug",
    resources: ["catalog", "meta", "stream"], 
    types: ["series", "movie"],
    idPrefixes: ["kisskh:"], 
    catalogs: [
        {
            id: "latest_updates",
            type: "series",
            name: "KissKH: Latest K-Drama",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            id: "top_kdrama",
            type: "series",
            name: "KissKH: Top K-Drama",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            id: "upcoming_drama",
            type: "series",
            name: "KissKH: Upcoming K-Drama",
            extra: [{ name: "skip", isRequired: false }]
        }
        // Removed "most_popular" as requested
    ]
});

// ✅ HELPER: STARTUP SESSION
async function initSession() {
    try {
        console.log(`[v26] 🔥 Warming up FlareSolverr Session...`);
        await axios.post(FLARESOLVERR_URL, {
            cmd: 'sessions.create', session: SESSION_NAME
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 8000 }).catch(() => {});
        console.log(`[v26] ✅ Session Ready.`);
    } catch (e) { console.log(`[v26] ⚠️ Session Init Warning: ${e.message}`); }
}
initSession();

// ✅ HELPER: FETCH WITH FLARE & CACHE
async function fetchWithFlare(targetUrl, useCache = true, customTimeout = 25000) {
    if (useCache && CACHE[targetUrl] && Date.now() < CACHE.expiry[targetUrl]) {
        console.log(`[v26] ⚡ Cache hit: ${targetUrl.substring(20, 50)}...`);
        return CACHE[targetUrl];
    }

    try {
        console.log(`[v26] ⏳ Fetching: ${targetUrl}`);
        const response = await axios.post(FLARESOLVERR_URL, {
            cmd: 'request.get',
            url: targetUrl,
            session: SESSION_NAME,
            maxTimeout: customTimeout, // Allow longer for streams
        }, { headers: { 'Content-Type': 'application/json' }, timeout: customTimeout + 5000 });

        if (response.data.status === 'ok') {
            const rawText = response.data.solution.response;
            const jsonStart = rawText.indexOf('{');
            const jsonEnd = rawText.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1) {
                const data = JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
                if (useCache) {
                    CACHE[targetUrl] = data;
                    CACHE.expiry[targetUrl] = Date.now() + (20 * 60 * 1000); // 20 min cache
                }
                return data;
            }
        } else {
             console.error(`[v26] FlareSolverr Error: ${response.data.message}`);
        }
        return null;
    } catch (e) {
        console.error(`[v26] ❌ Fetch Error: ${e.message}`);
        return null;
    }
}

// --- 1. CATALOG HANDLER (Korea Only) ---
builder.defineCatalogHandler(async (args) => {
    const page = args.extra && args.extra.skip ? Math.floor(args.extra.skip / 20) + 1 : 1;
    let targetUrl = "";
    
    // 🔥 UPDATED APIs: Changed country=0 to country=2 (South Korea)
    switch(args.id) {
        case "latest_updates": targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=0&order=2`; break;
        case "top_kdrama": targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=0&order=1`; break;
        case "upcoming_drama": targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=3&order=2`; break;
        default: return { metas: [] };
    }

    const data = await fetchWithFlare(targetUrl);
    const items = data ? (data.results || data.data || data) : [];

    if (Array.isArray(items)) {
        return { metas: items.map(item => ({
            id: `kisskh:${item.id}`,
            type: "series",
            name: item.title,
            poster: item.thumbnail, // Keep raw thumbnail for speed in catalog
            description: item.status || "",
            posterShape: 'landscape'
        })) };
    }
    return { metas: [] };
});

// --- 2. META HANDLER (Attempt Clean Poster) ---
builder.defineMetaHandler(async (args) => {
    if (!args.id.startsWith("kisskh:")) return { meta: {} };
    const kisskhId = args.id.split(":")[1];
    const detailUrl = `https://kisskh.do/api/DramaList/Drama/${kisskhId}?isMovie=false`;
    
    const data = await fetchWithFlare(detailUrl); // Uses Cache
    if (!data) return { meta: { id: args.id, type: "series", name: "Loading Error. Try again." } };

    let cleanPoster = data.thumbnail;
    let cleanBackground = data.thumbnail;

    // 🔥 Try to get clean TMDB poster (Max 2 seconds wait)
    try {
        console.log(`[v26] Attempting TMDB match for clean poster: ${data.title}`);
        const tmdbSearch = await axios.get(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${encodeURIComponent(data.title)}`, { timeout: 2000 });
        if (tmdbSearch.data.results && tmdbSearch.data.results[0]) {
            const best = tmdbSearch.data.results[0];
            if (best.poster_path) cleanPoster = `https://image.tmdb.org/t/p/w500${best.poster_path}`;
            if (best.backdrop_path) cleanBackground = `https://image.tmdb.org/t/p/w1280${best.backdrop_path}`;
            console.log(`[v26] TMDB Match Found!`);
        }
    } catch(e) { console.log(`[v26] TMDB too slow or failed, using fallback.`); }

    const episodes = (data.episodes || []).sort((a, b) => parseInt(a.number) - parseInt(b.number));

    return {
        meta: {
            id: args.id,
            type: "series",
            name: data.title,
            poster: cleanPoster,
            background: cleanBackground,
            description: data.description || "",
            releaseInfo: data.releaseDate,
            genres: data.genres ? data.genres.map(g => g.name) : [],
            videos: episodes.map(ep => ({
                id: `kisskh:${kisskhId}:${1}:${ep.number}`,
                title: `Episode ${ep.number}`,
                season: 1,
                episode: parseInt(ep.number) || 1,
                released: new Date().toISOString()
            }))
        }
    };
});

// --- 3. STREAM HANDLER (Axios + headers + cookie jar) ---
builder.defineStreamHandler(async (args) => {
    if (!args.id.startsWith("kisskh:")) return { streams: [] };

    console.log(`[v26] Stream Request: ${args.id}`);
    const parts = args.id.split(":");
    const dramaId = parts[1];
    const episodeNum = parts[3]; 

    if (!dramaId || !episodeNum) return { streams: [] };

    try {
        // 1. Get Episode ID from Details
        const detailUrl = `https://kisskh.do/api/DramaList/Drama/${dramaId}?isMovie=false`;
        const detailRes = await client.get(detailUrl, { headers: { Accept: "application/json" }, timeout: 15000 });
        const data = detailRes.data;

        if (!data || !data.episodes) {
            console.error("[v26] Stream Error: Could not fetch drama details.");
            return { streams: [] };
        }

        const targetEp = data.episodes.find(e => String(e.number) === String(episodeNum));
        if (!targetEp) {
            console.error(`[v26] Stream Error: Episode ${episodeNum} not found in list.`);
            return { streams: [] };
        }

        console.log(`[v26] Found Ep ID: ${targetEp.id}. Fetching video link...`);
        const videoApiUrl = `https://kisskh.do/api/ExternalLoader/VideoService/${targetEp.id}?device=2`;

        // 2. Fetch Video Link with headers + cookie jar
        let videoUrl = null;
        try {
            const videoRes = await client.get(videoApiUrl, {
                headers: {
                    Accept: "application/json, text/plain, */*",
                    "X-Requested-With": "XMLHttpRequest",
                    Referer: `https://kisskh.do/Drama/${encodeURIComponent(data.title)}/Episode-${episodeNum}`,
                    Origin: "https://kisskh.do",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
                },
                timeout: 25000
            });
            if (videoRes.data?.Video) {
                videoUrl = videoRes.data.Video;
                console.log(`[v26] ✅ Video Link Found from API.`);
            }
        } catch (err) {
            console.log(`[v26] Video API error: ${err.message}`);
        }

        // 3. Fallback: scrape episode page via Flare if API fails
        if (!videoUrl) {
            console.log(`[v26] API returned no Video. Fallback to HTML scrape...`);
            const epPageUrl = `https://kisskh.do/Drama/${encodeURIComponent(data.title)}/Episode-${episodeNum}?id=${dramaId}&ep=${targetEp.id}&page=0&pageSize=100`;

            const htmlResult = await fetchWithFlare(epPageUrl, false, 40000);
            const html = htmlResult?.__html || "";

            const hlsMatch = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
            const mp4Match = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
            videoUrl = hlsMatch ? hlsMatch[0] : mp4Match ? mp4Match[0] : null;

            if (!videoUrl) {
                const jsonVideoMatch = html.match(/"Video"\s*:\s*"https?:\/\/[^"]+"/i);
                if (jsonVideoMatch) {
                    videoUrl = (jsonVideoMatch[0].match(/https?:\/\/[^"]+/i) || [null])[0];
                }
            }

            if (videoUrl) {
                console.log(`[v26] ✅ Fallback extracted video URL.`);
            } else {
                console.error(`[v26] ❌ No stream found after API and HTML fallback.`);
                return { streams: [] };
            }
        }

        return {
            streams: [{
                name: "⚡ SojuStream",
                title: `Ep ${episodeNum} | ${data.title}`,
                url: videoUrl
            }]
        };
    } catch (e) {
        console.error("Stream Error:", e.message);
        return { streams: [] };
    }
});

<<<<<<< HEAD
serveHTTP(builder.getInterface(), { port: process.env.PORT || 10000, host: "0.0.0.0" });
=======
serveHTTP(builder.getInterface(), { port: process.env.PORT || 10000, host: "0.0.0.0" });
>>>>>>> 689d87ce35c9569fbe4825c1b574d2ddeb294ebf
