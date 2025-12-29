// db-helper.js - GOD TIER EDITION (JOIN FIX + DYNAMIC TRACKERS)
const { Pool } = require('pg');
const axios = require('axios');

// --- 1. GESTIONE TRACKER DINAMICI ---
const TRACKERS_URL = 'https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt';

// Lista di fallback iniziale
let ACTIVE_TRACKERS = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.demonoid.ch:6969/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.therarbg.to:6969/announce",
    "udp://opentracker.i2p.rocks:6969/announce"
];

// Funzione per aggiornare i tracker live
async function updateTrackers() {
    try {
        console.log("🔄 Aggiornamento Trackers da GitHub...");
        const response = await axios.get(TRACKERS_URL, { timeout: 5000 });
        const list = response.data.trim().split('\n\n').filter(Boolean);
        if (list.length > 0) {
            ACTIVE_TRACKERS = list;
            console.log(`✅ Trackers aggiornati: ${ACTIVE_TRACKERS.length} attivi.`);
        }
    } catch (e) {
        console.warn(`⚠️ Errore update tracker (uso fallback): ${e.message}`);
    }
}

// Avvia update subito e poi ogni 6 ore
updateTrackers();
setInterval(updateTrackers, 6 * 60 * 60 * 1000);

// --- 2. CONFIGURAZIONE DATABASE ---
let pool = null;

// Filtri Regex per contenuto Italiano
// Cerchiamo l'ITA sia nel nome del file (f.title) che del torrent (t.title)
const SQL_ITA_FILTER = `AND (t.title ~* '\\y(ita|italian|italy|multi|dual|corsaro)\\y' OR f.title ~* '\\y(ita|italian|italy|multi|dual|corsaro)\\y')`;
// Per i pack controlliamo il titolo del torrent padre
const SQL_ITA_FILTER_PACK = `AND (t.title ~* '\\y(ita|italian|italy|multi|dual|corsaro)\\y')`;

function initDatabase(config = {}) {
  if (pool) return pool;

  let sslConfig = false; 
  if (process.env.DB_SSL === 'true') {
      sslConfig = { rejectUnauthorized: false };
  }

  const poolConfig = process.env.DATABASE_URL 
    ? { connectionString: process.env.DATABASE_URL, ssl: sslConfig }
    : {
        host: config.host || process.env.DB_HOST || 'localhost',
        port: config.port || process.env.DB_PORT || 5432,
        database: config.database || process.env.DB_NAME || 'torrent_library',
        user: config.user || process.env.DB_USER || 'postgres',
        password: config.password || process.env.DB_PASSWORD,
        ssl: sslConfig 
      };

  pool = new Pool({
    ...poolConfig,
    max: 40,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000, 
  });
   
  console.log(`✅ DB Pool Initialized (Target: ${poolConfig.host})`);
  return pool;
}

// --- 3. UTILITY FORMATTAZIONE ---
function injectTrackers(magnet) {
    if (!magnet) return "";
    let cleanMagnet = magnet.trim();
    // Usa la lista dinamica ACTIVE_TRACKERS
    ACTIVE_TRACKERS.forEach(tr => {
        if (!cleanMagnet.includes(encodeURIComponent(tr))) {
            cleanMagnet += `&tr=${encodeURIComponent(tr)}`;
        }
    });
    return cleanMagnet;
}

function formatRow(row) {
    const displayTitle = row.file_title || row.title;
    const baseMagnet = `magnet:?xt=urn:btih:${row.info_hash}`;
    const fullMagnet = injectTrackers(baseMagnet);
    
    // Usa il provider dal DB o fallback a P2P
    const sourceName = row.provider || "P2P"; 
    
    return {
        title: displayTitle, 
        magnet: fullMagnet,
        info_hash: row.info_hash,
        size: parseInt(row.file_size || row.size) || 0,
        seeders: row.seeders || 0,
        source: `${sourceName}${row.cached_rd ? " ⚡" : ""}`, // Provider + Cache status
        isCached: row.cached_rd
    };
}

// Filtro intelligente per capire se il pack contiene la stagione richiesta
function isPackRelevant(title, targetSeason) {
    if (!title) return false;
    const cleanTitle = title.toLowerCase();
    const s = parseInt(targetSeason);
    
    // 1. Serie Complete / Antologie
    if (/\b(complete|total|collection|anthology|tutte le stagioni|serie completa)\b/i.test(cleanTitle)) return true;
    
    // 2. Range di Stagioni (es. S01-S05)
    const rangeMatch = cleanTitle.match(/s(\d{1,2})\s*-\s*s?(\d{1,2})/i);
    if (rangeMatch) {
        const start = parseInt(rangeMatch[1]);
        const end = parseInt(rangeMatch[2]);
        return s >= start && s <= end;
    }
    
    // 3. Stagione Singola (es. Season 1)
    const seasonMatch = cleanTitle.match(/\b(s|season|stagione)\s?0?(\d{1,2})\b/i);
    if (seasonMatch) {
        return parseInt(seasonMatch[2]) === s;
    }
    return false;
}

// --- 4. FUNZIONI DI RICERCA (JOIN FIX) ---

async function searchMovie(imdbId) {
  if (!pool) return [];
  try {
    // JOIN tra Files e Torrents per trovare i film tramite ID
    const query = `
      SELECT t.info_hash, t.provider, t.title, t.size, t.seeders, t.cached_rd
      FROM files f
      JOIN torrents t ON f.info_hash = t.info_hash
      WHERE f.imdb_id = $1
      ${SQL_ITA_FILTER}
      ORDER BY t.cached_rd DESC, t.seeders DESC
      LIMIT 50
    `;
    const result = await pool.query(query, [imdbId]);
    return result.rows.map(r => formatRow(r));
  } catch (error) {
    console.error(`❌ DB Error searchMovie:`, error.message);
    return [];
  }
}

async function searchEpisodeFiles(imdbId, season, episode) {
  if (!pool) return [];
  try {
    // Cerca file specifici (SxxExx)
    const query = `
      SELECT f.title as file_title, f.size as file_size, t.info_hash, t.provider, t.title as torrent_title, t.seeders, t.cached_rd
      FROM files f
      JOIN torrents t ON f.info_hash = t.info_hash
      WHERE f.imdb_id = $1 AND f.imdb_season = $2 AND f.imdb_episode = $3
      ${SQL_ITA_FILTER} 
      ORDER BY t.cached_rd DESC, t.seeders DESC
      LIMIT 30
    `;
    const result = await pool.query(query, [imdbId, season, episode]);
    return result.rows.map(r => formatRow(r));
  } catch (error) {
    console.error(`❌ DB Error searchEpisodeFiles:`, error.message);
    return [];
  }
}

async function searchPacksByImdbId(imdbId, season) {
    if (!pool) return [];
    try {
        // QUERY MAGICA PER I PACK:
        // Usa DISTINCT ON per prendere un solo risultato per hash (evita 20 righe per la stessa stagione)
        const query = `
            SELECT DISTINCT ON (t.info_hash) t.info_hash, t.provider, t.title, t.size, t.seeders, t.cached_rd
            FROM files f
            JOIN torrents t ON f.info_hash = t.info_hash
            WHERE f.imdb_id = $1 
            -- Accettiamo file con la stagione giusta O null (serie complete spesso hanno null nei file)
            AND (f.imdb_season = $2 OR f.imdb_season IS NULL) 
            ${SQL_ITA_FILTER_PACK}
            ORDER BY t.info_hash, t.seeders DESC 
            LIMIT 100
        `;
        
        const result = await pool.query(query, [imdbId, season]);
        
        // Applichiamo il filtro Smart Pack (isPackRelevant)
        const validPacks = result.rows.filter(row => isPackRelevant(row.title, season));
        
        return validPacks.slice(0, 15).map(r => {
             const formatted = formatRow(r);
             // Aggiungiamo il prefisso visuale
             formatted.title = `📦 [PACK] ${formatted.title}`;
             // FLAG ESSENZIALE per addon.js
             formatted.isPack = true; 
             return formatted;
        }); 

    } catch (e) { 
        console.error(`❌ DB Error searchPacksByImdbId:`, e.message);
        return []; 
    }
}

// --- 5. FUNZIONI DI SCRITTURA E CACHE ---

async function insertTorrent(torrent) {
    // Funzione placeholder: In questo setup il DB è popolato esternamente (es. Prowlarr/Radarr)
    // Se serve scrivere, va adattata alla struttura files/torrents separati
    return false; 
}

async function updateRdCacheStatus(cacheResults) {
    if (!pool || !cacheResults.length) return 0;
    try {
        const client = await pool.connect();
        let updated = 0;
        try {
            await client.query('BEGIN');
            for (const res of cacheResults) {
                if (!res.hash) continue;
                await client.query(
                    `UPDATE torrents SET cached_rd = $1, last_cached_check = NOW() WHERE info_hash = $2`, 
                    [res.cached, res.hash.toLowerCase()]
                );
                updated++;
            }
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
        return updated;
    } catch (e) { 
        console.error(`❌ DB Error updateCache:`, e.message);
        return 0; 
    }
}

async function healthCheck() {
    if (!pool) throw new Error('Pool not initialized');
    await pool.query('SELECT 1'); 
    return true;
}

// --- EXPORT FINALE ---

const dbHelper = {
    initDatabase,
    healthCheck,
    
    searchMovie, // Usa la nuova JOIN
    
    searchSeries: async (imdbId, season, episode) => {
        // Eseguiamo in parallelo ricerca Episodi e ricerca Pack
        const [files, packs] = await Promise.all([
            searchEpisodeFiles(imdbId, season, episode),
            searchPacksByImdbId(imdbId, season)
        ]);

        if (files.length > 0 || packs.length > 0) {
            console.log(`🗄️ [DB HIT] ID:${imdbId} S:${season} E:${episode} -> Found ${files.length} files, ${packs.length} packs.`);
        }

        return [...files, ...packs];
    },

    insertTorrent,
    updateRdCacheStatus
};

module.exports = dbHelper;
