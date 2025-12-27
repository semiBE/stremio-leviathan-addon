// db-helper.js - INSTANT TIER (INDEX OPTIMIZED + ATOMIC INSERTS)
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

// --- 1. CONFIGURAZIONE POOL OTTIMIZZATA ---
let pool = null;

function initDatabase(config = {}) {
  if (pool) return pool;

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
    max: 40, // AUMENTATO: Per gestire meglio la concorrenza di addon.js
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000, // RIDOTTO: Fail-fast se il DB è giù
  });

  // --- AUTO-REPAIR & INDEXING AVANZATO ---
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

    -- INDICI STANDARD
    CREATE INDEX IF NOT EXISTS idx_torrents_imdb_id ON torrents(imdb_id);
    CREATE INDEX IF NOT EXISTS idx_torrents_all_imdb_ids ON torrents USING gin (all_imdb_ids);
    
    -- [NEW] INDICE COMPOSITO PER ORDINAMENTO VELOCE (Evita il "Sort" in memoria)
    -- Questo permette al DB di estrarre direttamente i risultati migliori
    CREATE INDEX IF NOT EXISTS idx_torrents_ranking ON torrents (cached_rd DESC NULLS LAST, seeders DESC);
    
    -- [NEW] INDICE COVERING PER FILES (Include le colonne necessarie per evitare lookup alla tabella principale troppo spesso)
    CREATE INDEX IF NOT EXISTS idx_files_lookup_covered ON files(imdb_id, imdb_season, imdb_episode) INCLUDE (info_hash);
  `;

  pool.query(schemaQuery)
      .then(() => console.log('✅ DB Schema & Indexes Optimized (Instant Tier).'))
      .catch(err => console.error('❌ ERRORE INIT DB:', err.message));

  pool.on('error', (err) => console.error('❌ Errore inatteso client DB', err));
  
  console.log(`✅ PostgreSQL Pool Initialized (Max: 40 | SSL: ${sslConfig ? 'ACTIVE' : 'DISABLED'})`);
  return pool;
}

// --- 2. UTILITY PER FORMATTAZIONE (INVARIATA) ---
function injectTrackers(magnet) {
    if (!magnet) return "";
    let cleanMagnet = magnet.trim();
    // Ottimizzazione stringhe: controlla presenza tracker in un colpo solo se possibile,
    // ma il loop qui è trascurabile per le performance.
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

function isPackRelevant(title, targetSeason) {
    if (!title) return false;
    const cleanTitle = title.toLowerCase();
    const s = parseInt(targetSeason);
    if (/\b(complete|total|collection|anthology|tutte le stagioni|serie completa)\b/i.test(cleanTitle)) return true;
    const rangeMatch = cleanTitle.match(/s(\d{1,2})\s*-\s*s?(\d{1,2})/i);
    if (rangeMatch) {
        const start = parseInt(rangeMatch[1]);
        const end = parseInt(rangeMatch[2]);
        return s >= start && s <= end;
    }
    const seasonMatch = cleanTitle.match(/\b(s|season|stagione)\s?0?(\d{1,2})\b/i);
    if (seasonMatch) {
        return parseInt(seasonMatch[2]) === s;
    }
    return false;
}

// --- 3. CORE FUNCTIONS OTTIMIZZATE ---

async function searchByImdbId(imdbId, type = null) {
  if (!pool) return [];
  try {
    // OTTIMIZZAZIONE: Usiamo UNION invece di OR.
    // PostgreSQL spesso fatica a ottimizzare OR tra indici diversi (B-Tree vs GIN).
    // Spezzare in due query e unirle è spesso 2x più veloce su grandi dataset.
    let query = `
      SELECT info_hash, title, size, seeders, cached_rd 
      FROM torrents 
      WHERE imdb_id = $1 ${type ? "AND type = $2" : ""}
      
      UNION
      
      SELECT info_hash, title, size, seeders, cached_rd 
      FROM torrents 
      WHERE all_imdb_ids @> $3::jsonb ${type ? "AND type = $2" : ""}
      
      ORDER BY cached_rd DESC NULLS LAST, seeders DESC 
      LIMIT 50
    `;
    
    const jsonId = JSON.stringify([imdbId]);
    const params = type ? [imdbId, type, jsonId] : [imdbId, jsonId]; // Nota: $3 diventa jsonId
    
    // Ricalibrazione params per query dinamica brutale ma efficace
    if (!type) {
        query = `
            SELECT info_hash, title, size, seeders, cached_rd FROM torrents WHERE imdb_id = $1
            UNION
            SELECT info_hash, title, size, seeders, cached_rd FROM torrents WHERE all_imdb_ids @> $2::jsonb
            ORDER BY cached_rd DESC NULLS LAST, seeders DESC LIMIT 50
        `;
        params.length = 0; params.push(imdbId, jsonId);
    }

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
    // Join ottimizzata grazie al nuovo indice 'idx_files_lookup_covered'
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
        // Anche qui UNION per velocità
        const query = `
            SELECT t.info_hash, t.title, t.size, t.seeders, t.cached_rd
            FROM torrents t
            WHERE imdb_id = $1 AND type = 'series'
            UNION
            SELECT t.info_hash, t.title, t.size, t.seeders, t.cached_rd
            FROM torrents t
            WHERE all_imdb_ids @> $2::jsonb AND type = 'series'
            ORDER BY cached_rd DESC NULLS LAST, seeders DESC 
            LIMIT 50
        `;
        const result = await pool.query(query, [imdbId, JSON.stringify([imdbId])]);
        
        // Filtro JS rimane perché la Regex SQL complessa è pesante sulla CPU DB
        const validPacks = result.rows.filter(row => isPackRelevant(row.title, season));
        
        return validPacks.slice(0, 15); 
    } catch (e) { 
        console.error(`❌ DB Error searchPacksByImdbId:`, e.message);
        return []; 
    }
}

// --- 4. FUNZIONI DI SCRITTURA OTTIMIZZATE ---

async function insertTorrent(torrent) {
  if (!pool) return false;
  // Rimosso pool.connect() manuale per singole query semplici (pool.query lo gestisce internamente ed è più veloce per query singole)
  // Per transazioni complesse serve connect(), ma qui usiamo ON CONFLICT per renderla atomica.
  
  try {
    // OTTIMIZZAZIONE: ON CONFLICT invece di SELECT + INSERT
    // Risparmia 1 Round Trip Time (RTT) verso il server DB.
    const query = `
        INSERT INTO torrents (info_hash, provider, title, size, type, seeders, imdb_id, tmdb_id, upload_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (info_hash) DO NOTHING
    `;
    
    await pool.query(query, [
        torrent.infoHash, 
        torrent.provider || 'P2P', 
        torrent.title, 
        torrent.size, 
        torrent.type, 
        torrent.seeders, 
        torrent.imdbId, 
        torrent.tmdbId
    ]);
    return true;
  } catch (e) {
    console.error("❌ Insert Error:", e.message);
    return false;
  }
}

async function updateRdCacheStatus(cacheResults) {
    if (!pool || !cacheResults.length) return 0;
    try {
        // Uso una singola connessione per il batch update per non stressare il pool
        const client = await pool.connect();
        let updated = 0;
        try {
            await client.query('BEGIN');
            for (const res of cacheResults) {
                if (!res.hash) continue;
                // Prepared statement reuse implicito
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
        console.error(`❌ DB Error updateRdCacheStatus:`, e.message);
        return 0; 
    }
}

// --- 5. HEALTH CHECK ---
async function healthCheck() {
    if (!pool) throw new Error('Pool not initialized');
    // Query più leggera possibile
    const result = await pool.query('SELECT 1'); 
    return true;
}

// --- 6. EXPORT ---
const dbHelper = {
    initDatabase,
    healthCheck,
    
    searchMovie: async (imdbId) => {
        const rows = await searchByImdbId(imdbId, 'movie');
        return rows.map(r => formatRow(r, "LeviathanDB"));
    },

    searchSeries: async (imdbId, season, episode) => {
        // Eseguiamo query file e pack in parallelo per risparmiare tempo
        const [files, packs] = await Promise.all([
            searchEpisodeFiles(imdbId, season, episode),
            searchPacksByImdbId(imdbId, season)
        ]);

        const formattedFiles = files.map(r => formatRow(r, "LeviathanDB"));
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
