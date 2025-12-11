// --- 1. CARICAMENTO VARIABILI D'AMBIENTE (.ENV) ---
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const axios = require("axios");
const Bottleneck = require("bottleneck");
const rateLimit = require("express-rate-limit");
const Redis = require("ioredis"); // IMPORTIAMO IL CLIENT REDIS

// --- IMPORTIAMO I MODULI INTERNI ---
const { generateSmartQueries } = require("./ai_query");
const { smartMatch } = require("./smart_parser");
const { rankAndFilterResults } = require("./ranking");
const { tmdbToImdb } = require("./id_converter");
const kitsuHandler = require("./kitsu_handler");
const RD = require("./debrid/realdebrid");
const AD = require("./debrid/alldebrid");
const TB = require("./debrid/torbox");
const { getManifest } = require("./manifest");

// --- CONFIGURAZIONE ---
const CONFIG = {
  CINEMETA_URL: "https://v3-cinemeta.strem.io",
  REAL_SIZE_FILTER: 80 * 1024 * 1024, // Filtra file < 80MB
  TIMEOUT_TMDB: 2000,
  SCRAPER_TIMEOUT: 6000, 
  MAX_RESULTS: 40, 
};

// --- CACHE SYSTEM CONFIGURATION (REDIS EDITION) ---
const CACHE_TTL = 15 * 60; // 15 Minuti (IN SECONDI per Redis)

// Inizializzazione Redis con gestione errori
let redis = null;
if (process.env.REDIS_URL) {
    redis = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: null,
        connectTimeout: 10000
    });

    redis.on("connect", () => console.log("✅ [REDIS] Connesso al database esterno!"));
    redis.on("error", (err) => console.error("❌ [REDIS] Errore connessione:", err.message));
} else {
    console.warn("⚠️ [REDIS] Variabile REDIS_URL mancante nel .env! La cache è disabilitata.");
}

// --- LIMITERS (Interni per API) ---
const LIMITERS = {
  scraper: new Bottleneck({ maxConcurrent: 40, minTime: 10 }), 
  rd: new Bottleneck({ maxConcurrent: 25, minTime: 40 }), 
};

// --- MOTORI DI RICERCA ---
const SCRAPER_MODULES = [
  require("./engines") 
];

const FALLBACK_SCRAPERS = [
  require("./external"),
];

const app = express();

// --- SICUREZZA & RATE LIMITING ---
app.set('trust proxy', 1); // Necessario per Render, Heroku, HF

// Limitatore: Max 300 richieste ogni 15 minuti per IP
const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, 
	max: 300, 
	standardHeaders: true, 
	legacyHeaders: false,
    message: "Troppe richieste da questo IP, riprova più tardi."
});

app.use(limiter);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// --- UTILITIES ---
const UNITS = ["B", "KB", "MB", "GB", "TB"];
function formatBytes(bytes) {
  if (!+bytes) return "0 B";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${UNITS[i]}`;
}

function parseSize(sizeStr) {
  if (!sizeStr) return 0;
  if (typeof sizeStr === "number") return sizeStr;
  const m = sizeStr.toString().match(/([\d.]+)\s*([KMGTP]?B)/i);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const mult = { TB: 1099511627776, GB: 1073741824, MB: 1048576, KB: 1024, B: 1 };
  return val * (mult[unit] || 1);
}

// ==========================================
//  HELPER DI FORMATTAZIONE & FILTRO


function isSafeForItalian(item) {
  if (!item || !item.title) return false;
  const t = item.title.toUpperCase();
  
  const itaPatterns = [
    /\bITA\b/, /\bITALIAN\b/, /\bITALY\b/,
    /MULTI.*ITA/, /DUAL.*ITA/, /AUDIO.*ITA/,
    /AC3.*ITA/, /AAC.*ITA/, /DTS.*ITA/, /TRUEHD.*ITA/,
    /SUB.*ITA/, /SUBS.*ITA/, /SOTTOTITOLI.*ITA/,
    /H\.?264.*ITA/, /H\.?265.*ITA/, /X264.*ITA/, /HEVC.*ITA/,
    /STAGIONE/, /EPISODIO/, /MUX/, /iDN_CreW/, /WMS/, /TRIDIM/, /SPEEDVIDEO/, /CORSARO/
  ];
  
  return itaPatterns.some(p => p.test(t));
}

function cleanFilename(filename) {
  if (!filename) return "";
  const yearMatch = filename.match(/(19|20)\d{2}/);
  let cleanTitle = filename;
  let year = "";
  if (yearMatch) {
    year = ` (${yearMatch[0]})`;
    cleanTitle = filename.substring(0, yearMatch.index);
  }
  
  cleanTitle = cleanTitle.replace(/[._]/g, " "); 
  const uiJunk = /\b(ita|eng|sub|h264|h265|x264|x265|hevc|1080p|720p|4k|2160p|bluray|web-?dl|rip|ac3|aac|dts|multi|truehd|remux|complete|pack)\b.*/yi;
  cleanTitle = cleanTitle.replace(uiJunk, "");
  
  return `${cleanTitle.trim()}${year}`;
}

function getEpisodeTag(filename) {
    const f = filename.toLowerCase();
    const matchEp = f.match(/s(\d+)[ex](\d+)/i);
    if (matchEp) return `🍿 S${matchEp[1]}E${matchEp[2]}`;
    const matchX = f.match(/(\d+)x(\d+)/i);
    if (matchX) return `🍿 S${matchX[1].padStart(2, '0')}E${matchX[2].padStart(2, '0')}`;
    if (/s(\d+)\b|stagione (\d+)|season (\d+)/i.test(f)) {
        const s = f.match(/s(\d+)|stagione (\d+)|season (\d+)/i);
        const num = s[1] || s[2] || s[3];
        return `📦 STAGIONE ${num}`;
    }
    return "";
}

function extractStreamInfo(title, source) {
  const t = String(title).toLowerCase();
  let q = "HD"; let qIcon = "📺";
  if (/2160p|4k|uhd/.test(t)) { q = "4K"; qIcon = "✨"; }
  else if (/1080p/.test(t)) { q = "1080p"; qIcon = "🌕"; }
  else if (/720p/.test(t)) { q = "720p"; qIcon = "🌗"; }
  else if (/480p|\bsd\b/.test(t)) { q = "SD"; qIcon = "🌑"; }

  const videoTags = []; const audioTags = [];
  if (/hdr/.test(t)) videoTags.push("HDR");
  if (/dolby|vision|\bdv\b/.test(t)) videoTags.push("DV");
  if (/imax/.test(t)) videoTags.push("IMAX");
  if (/h265|hevc|x265/.test(t)) videoTags.push("HEVC");
  
  if (/atmos/.test(t)) audioTags.push("Atmos");
  if (/dts:?x?|\bdts\b/.test(t)) audioTags.push("DTS");
  if (/dd\+|eac3/.test(t)) audioTags.push("DD+");
  if (/5\.1/.test(t)) audioTags.push("5.1");

  let lang = "🇬🇧 ENG"; 
  if (source === "Corsaro" || isSafeForItalian({ title })) {
      lang = "🇮🇹 ITA";
      if (/multi|mui/i.test(t)) lang = "🇮🇹 MULTI";
  } 
  else if (/multi|mui/i.test(t)) {
      lang = "🌐 MULTI"; 
  }

  let detailsParts = [];
  if (videoTags.length) detailsParts.push(`✨ ${videoTags.join(" ")}`);
  if (audioTags.length) detailsParts.push(`🔊 ${audioTags.join(" ")}`);
  
  return { quality: q, qIcon, info: detailsParts.join(" • "), lang };
}

function formatStreamTitleCinePro(fileTitle, source, size, seeders, serviceTag = "RD") {
    const { quality, qIcon, info, lang } = extractStreamInfo(fileTitle, source);
    const sizeStr = size ? `📦 ${formatBytes(size)}` : "📦 ❓"; 
    const seedersStr = seeders ? `👤 ${seeders}` : "";

    const name = `[${serviceTag} ${qIcon} ${quality}] ${source}`;
    const detailLines = [];

    let cleanName = cleanFilename(fileTitle)
        .replace(/s\d+e\d+/i, "")
        .replace(/s\d+/i, "")
        .trim();
    const epTag = getEpisodeTag(fileTitle);
    detailLines.push(`🎬 ${cleanName}${epTag ? ` ${epTag}` : ""} • ${quality}`);

    let sizeSeedLine = sizeStr;
    if (seedersStr) sizeSeedLine += ` • ${seedersStr}`;
    detailLines.push(sizeSeedLine);

    const langTag = lang.replace('🌐', '').replace('🇮🇹', 'IT').replace('🇬🇧', 'GB').trim();
    detailLines.push(`🔍 ${source} • 🗣️ ${langTag}`);

    if (info) {
        const tags = info.split(' • ');
        const videoTags = tags.filter(t => t.includes('✨')).map(t => t.replace('✨', ''));
        const audioTags = tags.filter(t => t.includes('🔊'));
        if (videoTags.length) detailLines.push(`🎞️ ${videoTags.join(' • ')}`);
        if (audioTags.length) detailLines.push(`🔊 ${audioTags.join(' • ')}`);
    }

    const fullTitle = detailLines.join('\n');
    return { name, title: fullTitle };
}

// ==========================================
// 🧠 CORE LOGIC
// ==========================================

async function getMetadata(id, type) {
  try {
    const allowedTypes = ["movie", "series"];
    if (!allowedTypes.includes(type)) return null;

    let tmdbId = id, s = 1, e = 1;
    if (type === "series" && id.includes(":")) [tmdbId, s, e] = id.split(":");
    
    const rawId = tmdbId.split(":")[0];
    const cleanId = rawId.match(/^(tt\d+|\d+)$/i)?.[0] || "";

    if (!cleanId) return null;

    const { data: cData } = await axios.get(`${CONFIG.CINEMETA_URL}/meta/${type}/${cleanId}.json`, { timeout: CONFIG.TIMEOUT_TMDB }).catch(() => ({ data: {} }));
    
    return cData?.meta ? {
      title: cData.meta.name,
      originalTitle: cData.meta.name, 
      year: cData.meta.year?.split("–")[0],
      imdb_id: cleanId, 
      isSeries: type === "series",
      season: parseInt(s),
      episode: parseInt(e)
    } : null;
  } catch (err) { 
      console.error("Metadata Error:", err.message);
      return null; 
  }
}

async function resolveDebridLink(config, item, showFake) {
    try {
        const service = config.service || 'rd';
        const apiKey = config.key || config.rd;
        
        if (!apiKey) return null;

        let streamData = null;

        if (service === 'rd') {
            streamData = await RD.getStreamLink(apiKey, item.magnet, item.season, item.episode);
        } else if (service === 'ad') {
            streamData = await AD.getStreamLink(apiKey, item.magnet, item.season, item.episode);
        } else if (service === 'tb') {
            streamData = await TB.getStreamLink(apiKey, item.magnet, item.season, item.episode);
        }

        if (!streamData || (streamData.type === "ready" && streamData.size < CONFIG.REAL_SIZE_FILTER)) return null;

        let serviceTag = "RD";
        if (service === 'ad') serviceTag = "AD";
        if (service === 'tb') serviceTag = "TB";

        const { name, title } = formatStreamTitleCinePro(streamData.filename || item.title, item.source, streamData.size || item.size, item.seeders, serviceTag);
        
        return { 
            name, 
            title, 
            url: streamData.url, 
            behaviorHints: { notWebReady: false, bingieGroup: `corsaro-${service}` } 
        };

    } catch (e) {
        if (showFake) return { name: `[P2P ⚠️]`, title: `${item.title}\n⚠️ Cache Assente`, url: item.magnet, behaviorHints: { notWebReady: true } };
        return null;
    }
}

// 🔥 GENERATE STREAM - FUNZIONE PRINCIPALE 🔥
async function generateStream(type, id, config, userConfStr) {
  if (!config.key && !config.rd) return { streams: [{ name: "⚠️ CONFIG", title: "Inserisci API Key nel configuratore" }] };
  
  let finalId = id; 
  
  if (id.startsWith("tmdb:")) {
      try {
          const parts = id.split(":");
          const tmdbId = parts[1];
          const imdbId = await tmdbToImdb(tmdbId, type);
          if (imdbId) {
              if (type === "series" && parts.length >= 4) {
                  const s = parts[2];
                  const e = parts[3];
                  finalId = `${imdbId}:${s}:${e}`; 
              } else {
                  finalId = imdbId; 
              }
          }
      } catch (err) { console.error("ID Convert Error:", err.message); }
  }

  if (id.startsWith("kitsu:")) {
      try {
          const parts = id.split(":");
          const kitsuId = parts[1];
          const kitsuEp = parts[2] ? parseInt(parts[2]) : 1;
          const kData = await kitsuHandler(kitsuId);
          if (kData && kData.imdbID) {
              if (kData.type === 'series' || type === 'series') {
                  const s = kData.season || 1; 
                  finalId = `${kData.imdbID}:${s}:${kitsuEp}`;
              } else {
                  finalId = kData.imdbID;
              }
          }
      } catch (err) { console.error("🦊 Kitsu Error:", err.message); }
  }

  const meta = await getMetadata(finalId, type); 
  if (!meta) return { streams: [] };
  
  const queries = generateSmartQueries(meta);
  const onlyIta = config.filters?.onlyIta !== false; // Default: SOLO ITA

  console.log(`\n🧠 [AI-CORE] Cerco "${meta.title}" (${meta.year}): ${queries.length} varianti.`);

  let promises = [];
  queries.forEach(q => {
    SCRAPER_MODULES.forEach(scraper => {
      if (scraper.searchMagnet) {
        promises.push(
          LIMITERS.scraper.schedule(() => 
            withTimeout(scraper.searchMagnet(q, meta.year, type, finalId), CONFIG.SCRAPER_TIMEOUT).catch(err => [])
          )
        );
      }
    });
  });

  let resultsRaw = (await Promise.all(promises)).flat();

  // 3. FILTERING
  resultsRaw = resultsRaw.filter(item => {
    if (!item?.magnet) return false;
    
    // Check Anno
    const fileYearMatch = item.title.match(/\b(19|20)\d{2}\b/);
    if (fileYearMatch) {
        const fileYear = parseInt(fileYearMatch[0]);
        const metaYear = parseInt(meta.year);
        if (Math.abs(fileYear - metaYear) > 1) return false;
    }

    // Check Semantico (Smart Parser)
    const isSemanticallySafe = smartMatch(meta.title, item.title, meta.isSeries, meta.season, meta.episode);
    if (!isSemanticallySafe) return false;

    // Check ITA (Rigido se richiesto)
    if (onlyIta && !isSafeForItalian(item)) return false;
    
    return true;
  });

  // Fallback se pochi risultati iniziali
  if (resultsRaw.length <= 5) {
    const extPromises = FALLBACK_SCRAPERS.map(fb => {
        return LIMITERS.scraper.schedule(async () => {
            try {
                
                return await withTimeout(fb.searchMagnet(queries[0], meta.year, type, finalId), CONFIG.SCRAPER_TIMEOUT);
            } catch (err) { return []; }
        });
    });

    try {
        let timeoutHandle;
        const timeoutPromise = new Promise(resolve => {
            timeoutHandle = setTimeout(() => { resolve([]); }, CONFIG.SCRAPER_TIMEOUT + 1500); 
        });
        const searchPromise = Promise.all(extPromises).then(res => { clearTimeout(timeoutHandle); return res; });
        const extResultsRaw = await Promise.race([searchPromise, timeoutPromise]);
        
        if (Array.isArray(extResultsRaw)) {
            const filteredExt = extResultsRaw.flat().filter(item => 
                smartMatch(meta.title, item.title, meta.isSeries, meta.season, meta.episode) &&
                (!onlyIta || isSafeForItalian(item))
            );
            resultsRaw = [...resultsRaw, ...filteredExt];
        }
    } catch (e) {}
  }

  // Deduplicazione
  const seen = new Set(); 
  let cleanResults = [];
  for (const item of resultsRaw) {
    if (!item || !item.magnet) continue;
    try {
        const hashMatch = item.magnet.match(/btih:([a-f0-9]{40})/i);
        const hash = hashMatch ? hashMatch[1].toUpperCase() : item.magnet;
        if (seen.has(hash)) continue;
        seen.add(hash);
        item._size = parseSize(item.size || item.sizeBytes);
        cleanResults.push(item);
    } catch (err) { continue; }
  }
  
  if (!cleanResults.length) return { streams: [{ name: "⛔", title: "Nessun risultato ITA trovato" }] };

  // Ranking
  const ranked = rankAndFilterResults(cleanResults, meta, config).slice(0, CONFIG.MAX_RESULTS);
  
  // Risoluzione Link Debrid
  const rdPromises = ranked.map(item => {
      item.season = meta.season;
      item.episode = meta.episode;
      return LIMITERS.rd.schedule(() => resolveDebridLink(config, item, config.filters?.showFake));
  });
  
  let streams = (await Promise.all(rdPromises)).filter(Boolean);

  //  FALLBACK ESTREMO
  if (streams.length === 0) {
    console.log(`⚠️ Tutti i link RD iniziali sono uncached/falliti. Attivo EXTERNAL.JS di emergenza...`);
    
    try {
        const externalEngine = require("./external");
        
        // Cerca usando la query più efficace 
        const fallbackRaw = await withTimeout(
            externalEngine.searchMagnet(queries[0], meta.year, type, finalId),
            CONFIG.SCRAPER_TIMEOUT + 1000
        );

        if (Array.isArray(fallbackRaw)) {
            const fallbackFiltered = fallbackRaw.filter(item => 
                smartMatch(meta.title, item.title, meta.isSeries, meta.season, meta.episode) &&
                (!onlyIta || isSafeForItalian(item))
            );

            // Deduplica rapida
            const newItems = fallbackFiltered.filter(item => {
                const hashMatch = item.magnet.match(/btih:([a-f0-9]{40})/i);
                const hash = hashMatch ? hashMatch[1].toUpperCase() : item.magnet;
                return !seen.has(hash);
            });

            console.log(`🔥 External Emergency Found: ${newItems.length} nuovi candidati.`);

            const fallbackRdPromises = newItems.map(item => {
                item.season = meta.season;
                item.episode = meta.episode;
                return LIMITERS.rd.schedule(() => resolveDebridLink(config, item, config.filters?.showFake));
            });

            const fallbackStreams = (await Promise.all(fallbackRdPromises)).filter(Boolean);
            streams = fallbackStreams; 
        }
    } catch (e) {
        console.error("External Fallback Error:", e.message);
    }
  }

  // Se ancora vuoto
  if (!streams.length) return { streams: [{ name: "⛔", title: "Nessun link cached trovato" }] };

  return { streams }; 
}

// --- ROUTES ---

// 1. Home Page
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// 2. Configurazione
app.get("/:conf/configure", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/configure", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// 3. Manifest
app.get("/manifest.json", (req, res) => { const manifest = getManifest(); res.setHeader("Access-Control-Allow-Origin", "*"); res.json(manifest); });
app.get("/:conf/manifest.json", (req, res) => { const manifest = getManifest(); res.setHeader("Access-Control-Allow-Origin", "*"); res.json(manifest); });

// 4. Catalog (Dummy)
app.get("/:conf/catalog/:type/:id/:extra?.json", async (req, res) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.json({metas:[]}); });

// 5. STREAMING CON REDIS CACHE (GOD TIER)
app.get("/:conf/stream/:type/:id.json", async (req, res) => { 
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "max-age=3600"); // Cache Browser

    const { conf, type, id } = req.params;
    // Chiave strutturata per Redis
    const cacheKey = `stream:${conf}:${type}:${id}`;

    try {
        // A. Controllo Cache Redis
        if (redis) {
            const cachedEntry = await redis.get(cacheKey);
            if (cachedEntry) {
                console.log(`⚡ [REDIS HIT] Servo "${id}" dalla cache remota.`);
                return res.json(JSON.parse(cachedEntry));
            }
        }

        // B. Generazione (Se non in cache)
        const result = await generateStream(type, id.replace(".json", ""), getConfig(conf), conf);

        // C. Salvataggio in Redis (solo se risultato valido)
        if (redis && result && result.streams && result.streams.length > 0 && result.streams[0].name !== "⛔") {
            // Salva con scadenza automatica 
            await redis.set(cacheKey, JSON.stringify(result), "EX", CACHE_TTL);
            console.log(`💾 [REDIS SAVE] Salvato "${id}" per ${CACHE_TTL}s.`);
        }

        res.json(result); 

    } catch (err) {
        console.error("🔥 [STREAM ERROR]:", err);
        // Risposta di emergenza in caso di crash
        res.status(500).json({ streams: [{ name: "⚠️ ERROR", title: "Errore interno server o database" }] });
    }
});

function getConfig(configStr) { try { return JSON.parse(Buffer.from(configStr, "base64").toString()); } catch { return {}; } }
function withTimeout(promise, ms) { return Promise.race([promise, new Promise(r => setTimeout(() => r([]), ms))]); }

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`🚀 Leviathan (AI-Core) v32 ITA (REDIS ENABLED) attivo su porta ${PORT}`));
