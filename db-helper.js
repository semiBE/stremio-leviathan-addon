// db-helper.js - GOD TIER ULTIMATE (SSL FIX + SMART PACK + AUTO-REPAIR)
const { Pool } = require('pg');

// Tracker List Statica 
const DEFAULT_TRACKERS = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.demonoid.ch:6969/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.therarbg.to:6969/announce",
    "udp://tracker.doko.moe:6969/announce",
    "udp://opentracker.i2p.rocks:6969/announce"
];

// --- 1. CONFIGURAZIONE POOL (CON FIX SSL + AUTO-REPAIR) ---
let pool = null;

function initDatabase(config = {}) {
  if (pool) return pool;

  // FIX SSL: Rileva se disabilitare SSL (es. locale o docker)
  let sslConfig = { rejectUnauthorized: false }; 
  const connString = process.env.DATABASE_URL || "";
  if (connString.includes('sslmode=disable')) {
      sslConfig = false; 
  }

  const poolConfig = process.env.DATABASE_URL 
    ? { connectionString: process.env.DATABASE_URL, ssl: sslConfig }
    : {
        host: config.host || process.env.DB_HOST || 'localhost',
        port: config.port || process.env.DB_PORT || 5432,
        database: config.database || process.env.DB_NAME || 'leviathan',
        user: config.user || process.env.DB_USER || 'postgres',
        password: config.password || process.env.DB_PASSWORD,
        ssl: sslConfig
      };

  pool = new Pool({
    ...poolConfig,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000, 
  });

  // --- AUTO-REPAIR: CREAZIONE TABELLE AUTOMATICA ---
  // Questo blocco risolve l'errore "relation does not exist"
  const schemaQuery = `
    CREATE TABLE IF NOT EXISTS torrents (
        info_hash TEXT PRIMARY KEY,
        provider TEXT DEFAULT 'P2P',
        title TEXT NOT NULL,
        size BIGINT,
        type TEXT,
        seeders INTEGER DEFAULT 0,
        imdb_id TEXT,
        tmdb_id TEXT,
        upload_date TIMESTAMP DEFAULT NOW(),
        cached_rd BOOLEAN DEFAULT FALSE,
        all_imdb_ids JSONB DEFAULT '[]'::jsonb,
        last_cached_check TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS files (
        id SERIAL PRIMARY KEY,
        info_hash TEXT REFERENCES torrents(info_hash) ON DELETE CASCADE,
        title TEXT,
        size BIGINT,
        imdb_id TEXT,
        imdb_season INTEGER,
        imdb_episode INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_torrents_imdb_id ON torrents(imdb_id);
    CREATE INDEX IF NOT EXISTS idx_torrents_all_imdb_ids ON torrents USING gin (all_imdb_ids);
    CREATE INDEX IF NOT EXISTS idx_files_lookup ON files(imdb_id, imdb_season, imdb_episode);
  `;

  // Eseguiamo la query di creazione tabelle all'avvio
  pool.query(schemaQuery)
      .then(() => console.log('✅ Tabelle DB verificate/create con successo (Auto-Repair).'))
      .catch(err => console.error('❌ ERRORE CREAZIONE TABELLE:', err.message));

  pool.on('error', (err) => console.error('❌ Errore inatteso client DB', err));
  
  console.log(`✅ PostgreSQL Pool Initialized (SSL: ${sslConfig ? 'ACTIVE' : 'DISABLED'})`);
  return pool;
}

// --- 2. UTILITY PER FORMATTAZIONE ---
function injectTrackers(magnet) {
    if (!magnet) return "";
    let cleanMagnet = magnet.trim();
    const trackersToAdd = DEFAULT_TRACKERS;
    
    trackersToAdd.forEach(tr => {
        if (!cleanMagnet.includes(encodeURIComponent(tr))) {
            cleanMagnet += `&tr=${encodeURIComponent(tr)}`;
        }
    });
    return cleanMagnet;
}

function formatRow(row, sourceTag = "LeviathanDB") {
    const displayTitle = row.file_title || row.title;
    const baseMagnet = row.info_hash ? `magnet:?xt=urn:btih:${row.info_hash}` : row.magnet;
    const fullMagnet = injectTrackers(baseMagnet);
    
    return {
        title: displayTitle, 
        magnet: fullMagnet,
        info_hash: row.info_hash,
        size: parseInt(row.file_size || row.size) || 0,
        seeders: row.seeders || 0,
        source: `${sourceTag}${row.cached_rd ? " ⚡" : ""}`,
        isCached: row.cached_rd
    };
}

// --- UTILITY INTERNA PER PACK (SMART FILTER) ---
function isPackRelevant(title, targetSeason) {
    if (!title) return false;
    const cleanTitle = title.toLowerCase();
    const s = parseInt(targetSeason);

    // 1. Caso "Serie Completa"
    if (/\b(complete|total|collection|anthology|tutte le stagioni|serie completa)\b/i.test(cleanTitle)) {
        return true;
    }
    // 2. Caso "Range di Stagioni"
    const rangeMatch = cleanTitle.match(/s(\d{1,2})\s*-\s*s?(\d{1,2})/i);
    if (rangeMatch) {
        const start = parseInt(rangeMatch[1]);
        const end = parseInt(rangeMatch[2]);
        return s >= start && s <= end;
    }
    // 3. Caso "Stagione Singola"
    const seasonMatch = cleanTitle.match(/\b(s|season|stagione)\s?0?(\d{1,2})\b/i);
    if (seasonMatch) {
        const foundSeason = parseInt(seasonMatch[2]);
        return foundSeason === s;
    }
    return false;
}

// --- 3. CORE FUNCTIONS ---

async function searchByImdbId(imdbId, type = null) {
  if (!pool) return [];
  try {
    let query = `
      SELECT info_hash, title, size, seeders, cached_rd 
      FROM torrents 
      WHERE (imdb_id = $1 OR all_imdb_ids @> $2::jsonb)
    `;
    const params = [imdbId, JSON.stringify([imdbId])];
    if (type) {
      query += ' AND type = $3';
      params.push(type);
    }
    query += ' ORDER BY cached_rd DESC NULLS LAST, seeders DESC LIMIT 50';
    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error(`❌ DB Error searchByImdbId:`, error.message);
    return [];
  }
}

async function searchEpisodeFiles(imdbId, season, episode) {
  if (!pool) return [];
  try {
    const query = `
      SELECT f.title as file_title, f.size as file_size, t.info_hash, t.title as torrent_title, t.seeders, t.cached_rd
      FROM files f
      JOIN torrents t ON f.info_hash = t.info_hash
      WHERE f.imdb_id = $1 AND f.imdb_season = $2 AND f.imdb_episode = $3
      ORDER BY t.cached_rd DESC NULLS LAST, t.seeders DESC
      LIMIT 30
    `;
    const result = await pool.query(query, [imdbId, season, episode]);
    return result.rows;
  } catch (error) {
    console.error(`❌ DB Error searchEpisodeFiles:`, error.message);
    return [];
  }
}

async function searchPacksByImdbId(imdbId, season) {
    if (!pool) return [];
    try {
        const query = `
            SELECT t.info_hash, t.title, t.size, t.seeders, t.cached_rd
            FROM torrents t
            WHERE (imdb_id = $1 OR all_imdb_ids @> $2::jsonb) AND type = 'series'
            ORDER BY cached_rd DESC NULLS LAST, seeders DESC LIMIT 50
        `;
        const result = await pool.query(query, [imdbId, JSON.stringify([imdbId])]);
        
        // APPLICAZIONE FILTRO SMART
        const validPacks = result.rows.filter(row => isPackRelevant(row.title, season));
        
        return validPacks.slice(0, 15); 
    } catch (e) { 
        console.error(`❌ DB Error searchPacksByImdbId:`, e.message);
        return []; 
    }
}

// --- 4. FUNZIONI DI SCRITTURA ---
async function insertTorrent(torrent) {
  if (!pool) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const check = await client.query('SELECT 1 FROM torrents WHERE info_hash = $1', [torrent.infoHash]);
    if (check.rowCount > 0) { 
        await client.query('ROLLBACK'); 
        return false; 
    }

    await client.query(
      `INSERT INTO torrents (info_hash, provider, title, size, type, seeders, imdb_id, tmdb_id, upload_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [torrent.infoHash, torrent.provider || 'P2P', torrent.title, torrent.size, torrent.type, torrent.seeders, torrent.imdbId, torrent.tmdbId]
    );
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("❌ Insert Error:", e.message);
    return false;
  } finally {
    client.release();
  }
}

async function updateRdCacheStatus(cacheResults) {
    if (!pool || !cacheResults.length) return 0;
    try {
        let updated = 0;
        for (const res of cacheResults) {
            if (!res.hash) continue;
            const q = `UPDATE torrents SET cached_rd = $1, last_cached_check = NOW() WHERE info_hash = $2`;
            const r = await pool.query(q, [res.cached, res.hash.toLowerCase()]);
            updated += r.rowCount;
        }
        return updated;
    } catch (e) { 
        console.error(`❌ DB Error updateRdCacheStatus:`, e.message);
        return 0; 
    }
}

// --- 5. HEALTH CHECK ---
async function healthCheck() {
    if (!pool) throw new Error('Pool not initialized');
    const result = await pool.query('SELECT NOW()');
    if (result.rows.length !== 1) throw new Error('DB health check failed');
    return true;
}

// --- 6. ADATTATORE PER ADDON.JS ---
const dbHelper = {
    initDatabase,
    healthCheck,
    
    searchMovie: async (imdbId) => {
        const rows = await searchByImdbId(imdbId, 'movie');
        return rows.map(r => formatRow(r, "LeviathanDB"));
    },

    searchSeries: async (imdbId, season, episode) => {
        const files = await searchEpisodeFiles(imdbId, season, episode);
        const formattedFiles = files.map(r => formatRow(r, "LeviathanDB"));

        const packs = await searchPacksByImdbId(imdbId, season);
        const formattedPacks = packs.map(r => {
            const formatted = formatRow(r, "LeviathanDB");
            formatted.title = `📦 [S${season} Pack] ${formatted.title}`;
            return formatted;
        });

        if (formattedFiles.length > 0 || formattedPacks.length > 0) {
            console.log(`🗄️ [DB HIT] ID:${imdbId} S:${season} E:${episode} -> Found ${formattedFiles.length} files, ${formattedPacks.length} packs.`);
        }

        return [...formattedFiles, ...formattedPacks];
    },

    insertTorrent,
    updateRdCacheStatus
};

module.exports = dbHelper;
