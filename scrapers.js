require('dotenv').config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

// ====== CONFIG ======
const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || "https://soju-proxy.onrender.com/v1";
const TMDB_KEY = process.env.TMDB_KEY || "b80e5b1b965da72a2a23ba5680cb778a";
const SESSION_NAME = process.env.SESSION_NAME || "kisskh-persistent-v26";
const PORT = process.env.PORT || 10000;

// ====== CACHE ======
const CACHE = { expiry: {}, data: {} };

// ====== ADDON MANIFEST ======
const builder = new addonBuilder({
  id: "org.sojustream.jared.v26",
  version: "26.0.0",
  name: "SojuStream (v26 Korea Only)",
  description: "KissKH: Korea Only, Clean Posters, Hardened Streams",
  resources: ["catalog", "meta", "stream"],
  types: ["series", "movie"],
  idPrefixes: ["kisskh:"],
  catalogs: [
    { id: "latest_updates", type: "series", name: "KissKH: Latest K-Drama", extra: [{ name: "skip", isRequired: false }] },
    { id: "top_kdrama", type: "series", name: "KissKH: Top K-Drama", extra: [{ name: "skip", isRequired: false }] },
    { id: "upcoming_drama", type: "series", name: "KissKH: Upcoming K-Drama", extra: [{ name: "skip", isRequired: false }] }
  ]
});

// ====== SESSION BOOT ======
async function initSession() {
  try {
    console.log(`[v26] 🔥 Warming up FlareSolverr session...`);
    await axios.post(
      FLARESOLVERR_URL,
      { cmd: "sessions.create", session: SESSION_NAME },
      { headers: { "Content-Type": "application/json" }, timeout: 8000 }
    ).catch(() => {});
    console.log(`[v26] ✅ Session ready`);
  } catch (e) {
    console.log(`[v26] ⚠️ Session init warning: ${e.message}`);
  }
}
initSession();

// ====== FLARE FETCH (HTML or wrapped JSON) ======
async function fetchWithFlare(targetUrl, useCache = true, customTimeout = 25000) {
  if (useCache && CACHE.data[targetUrl] && Date.now() < CACHE.expiry[targetUrl]) {
    console.log(`[v26] ⚡ Cache hit: ${targetUrl.substring(0, 60)}...`);
    return CACHE.data[targetUrl];
  }

  try {
    console.log(`[v26] ⏳ Flare fetch: ${targetUrl}`);
    const response = await axios.post(
      FLARESOLVERR_URL,
      { cmd: "request.get", url: targetUrl, session: SESSION_NAME, maxTimeout: customTimeout },
      { headers: { "Content-Type": "application/json" }, timeout: customTimeout + 5000 }
    );

    if (response.data?.status === "ok") {
      const rawText = response.data.solution?.response || "";

      // Try to detect JSON quickly; otherwise return HTML
      let payload = null;
      const jsonStart = rawText.indexOf("{");
      const jsonEnd = rawText.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd !== -1) {
        try {
          payload = JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
        } catch {
          payload = { __html: rawText };
        }
      } else {
        payload = { __html: rawText };
      }

      if (useCache) {
        CACHE.data[targetUrl] = payload;
        CACHE.expiry[targetUrl] = Date.now() + (payload.__html ? 5 : 20) * 60 * 1000;
      }
      return payload;
    }

    console.error(`[v26] Flare error: ${response.data?.message || "unknown"}`);
    return null;
  } catch (e) {
    console.error(`[v26] ❌ Flare fetch error: ${e.message}`);
    return null;
  }
}

// ====== CATALOG (Korea only) ======
builder.defineCatalogHandler(async (args) => {
  const page = args.extra?.skip ? Math.floor(args.extra.skip / 20) + 1 : 1;

  let targetUrl = "";
  switch (args.id) {
    case "latest_updates":
      targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=0&order=2`;
      break;
    case "top_kdrama":
      targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=0&order=1`;
      break;
    case "upcoming_drama":
      targetUrl = `https://kisskh.do/api/DramaList/List?page=${page}&type=0&sub=0&country=2&status=3&order=2`;
      break;
    default:
      return { metas: [] };
  }

  try {
    // KissKH JSON endpoints are more reliable via direct Axios
    const res = await axios.get(targetUrl, { headers: { Accept: "application/json" }, timeout: 15000 });
    const items = res.data?.results || res.data?.data || res.data || [];
    if (Array.isArray(items)) {
      return {
        metas: items.map((item) => ({
          id: `kisskh:${item.id}`,
          type: "series",
          name: item.title,
          poster: item.thumbnail,
          description: item.status || "",
          posterShape: "landscape"
        }))
      };
    }
  } catch (e) {
    console.error(`[v26] Catalog error: ${e.message}`);
  }
  return { metas: [] };
});

// ====== META (TMDB clean posters + episodes) ======
builder.defineMetaHandler(async (args) => {
  if (!args.id.startsWith("kisskh:")) return { meta: {} };
  const kisskhId = args.id.split(":")[1];
  const detailUrl = `https://kisskh.do/api/DramaList/Drama/${kisskhId}?isMovie=false`;

  try {
    const res = await axios.get(detailUrl, { headers: { Accept: "application/json" }, timeout: 15000 });
    const data = res.data;
    if (!data) return { meta: { id: args.id, type: "series", name: "Loading Error. Try again." } };

    let cleanPoster = data.thumbnail;
    let cleanBackground = data.thumbnail;

    // Best-effort TMDB art
    try {
      const tmdbSearch = await axios.get(
        `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${encodeURIComponent(data.title)}`,
        { timeout: 2000 }
      );
      const best = tmdbSearch.data?.results?.[0];
      if (best?.poster_path) cleanPoster = `https://image.tmdb.org/t/p/w500${best.poster_path}`;
      if (best?.backdrop_path) cleanBackground = `https://image.tmdb.org/t/p/w1280${best.backdrop_path}`;
    } catch {
      // Ignore slow/failed TMDB
    }

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
        genres: data.genres ? data.genres.map((g) => g.name) : [],
        videos: episodes.map((ep) => ({
          id: `kisskh:${kisskhId}:${1}:${ep.number}`,
          title: `Episode ${ep.number}`,
          season: 1,
          episode: parseInt(ep.number) || 1,
          released: new Date().toISOString()
        }))
      }
    };
  } catch (e) {
    console.error(`[v26] Meta error: ${e.message}`);
    return { meta: { id: args.id, type: "series", name: "Error loading metadata." } };
  }
});

// ====== STREAM (hardened API + HTML fallback) ======
builder.defineStreamHandler(async (args) => {
  if (!args.id.startsWith("kisskh:")) return { streams: [] };

  console.log(`[v26] Stream request: ${args.id}`);
  const parts = args.id.split(":");
  const dramaId = parts[1];
  const episodeNum = parts[3];

  if (!dramaId || !episodeNum) return { streams: [] };

  try {
    // 1) Drama detail to resolve episode ID
    const detailUrl = `https://kisskh.do/api/DramaList/Drama/${dramaId}?isMovie=false`;
    const detailRes = await axios.get(detailUrl, { headers: { Accept: "application/json" }, timeout: 15000 });
    const data = detailRes.data;

    if (!data || !Array.isArray(data.episodes)) {
      console.error("[v26] Stream error: No episodes array in drama details.");
      return { streams: [] };
    }

    const targetEp = data.episodes.find((e) => String(e.number) === String(episodeNum));
    if (!targetEp) {
      console.error(`[v26] Stream error: Episode ${episodeNum} not found.`);
      return { streams: [] };
    }

    console.log(`[v26] Found episode ID: ${targetEp.id}. Trying API video...`);
    const videoApiUrl = `https://kisskh.do/api/ExternalLoader/VideoService/${targetEp.id}?device=2`;

    // 2) Try KissKH video API with headers
    let videoUrl = null;
    try {
      const videoRes = await axios.get(videoApiUrl, {
        headers: {
          Accept: "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest",
          Referer: `https://kisskh.do/Drama/${encodeURIComponent(data.title)}/Episode-${episodeNum}`,
          Origin: "https://kisskh.do",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
        },
        timeout: 25000
      });
      if (videoRes.data?.Video) {
        videoUrl = videoRes.data.Video;
        console.log(`[v26] ✅ Video link from API.`);
      }
    } catch (err) {
      console.log(`[v26] Video API error: ${err.message}`);
    }

    // 3) Fallback: scrape episode page via Flare and extract .m3u8/.mp4 or "Video"
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
      streams: [
        {
          name: "⚡ SojuStream",
          title: `Ep ${episodeNum} | ${data.title}`,
          url: videoUrl
        }
      ]
    };
  } catch (e) {
    console.error("[v26] Stream handler exception:", e.message);
    return { streams: [] };
  }
});

// ====== SERVE ======
serveHTTP(builder.getInterface(), { port: PORT, host: "0.0.0.0" });
console.log(`[v26] Addon running on http://localhost:${PORT}/manifest.json`);