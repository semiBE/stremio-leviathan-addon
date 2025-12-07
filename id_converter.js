const axios = require("axios");
const NodeCache = require("node-cache");

// --- ⚙️ CONFIGURAZIONE API ⚙️ ---
const CONFIG = {
    TMDB_KEY: '4b9dfb8b1c9f1720b5cd1d7efea1d845',
    TMDB_URL: 'https://api.themoviedb.org/3',
    TRAKT_CLIENT_ID: 'ad521cf009e68d4304eeb82edf0e5c918055eef47bf38c8d568f6a9d8d6da4d1',
    TRAKT_URL: 'https://api.trakt.tv',
    OMDB_KEY: 'cbd03c31', 
    OMDB_URL: 'http://www.omdbapi.com',
};

// --- 🧠 CACHE IN MEMORIA (RAM) ---
// Sostituisce SQLite per Vercel. 
// stdTTL: 7200 secondi (2 ore) di memoria prima che scada.
const idCache = new NodeCache({ stdTTL: 7200, checkperiod: 600 });

// --- ⚡ AXIOS CLIENTS ---
const tmdbClient = axios.create({ baseURL: CONFIG.TMDB_URL, timeout: 4000 });
const traktClient = axios.create({ 
    baseURL: CONFIG.TRAKT_URL, 
    timeout: 4000,
    headers: { 
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': CONFIG.TRAKT_CLIENT_ID 
    }
});
const omdbClient = axios.create({ baseURL: CONFIG.OMDB_URL, timeout: 4000 });

// ==========================================
// 🕵️‍♂️ LOGICA DI RICERCA ESTERNA
// ==========================================

async function searchTmdb(id, source = 'imdb_id') {
    try {
        const url = `/find/${id}?api_key=${CONFIG.TMDB_KEY}&external_source=${source}`;
        const { data } = await tmdbClient.get(url);
        
        let res = null;
        if (data.movie_results?.length) res = { ...data.movie_results[0], _type: 'movie' };
        else if (data.tv_results?.length) res = { ...data.tv_results[0], _type: 'series' };
        else if (data.tv_episode_results?.length) res = { ...data.tv_episode_results[0], _type: 'episode' };

        if (res) {
            return {
                tmdb: res.id,
                imdb: source === 'imdb_id' ? id : null,
                type: res._type === 'tv' ? 'series' : res._type,
                foundVia: 'tmdb'
            };
        }
    } catch (e) { /* Silent fail */ }
    return null;
}

async function getTmdbExternalIds(tmdbId, type) {
    try {
        const t = type === 'series' || type === 'tv' ? 'tv' : 'movie';
        const { data } = await tmdbClient.get(`/${t}/${tmdbId}/external_ids?api_key=${CONFIG.TMDB_KEY}`);
        return {
            imdb: data.imdb_id,
            tvdb: data.tvdb_id,
            foundVia: 'tmdb_ext'
        };
    } catch (e) { return {}; }
}

async function searchTrakt(id, type = 'imdb') {
    if (!CONFIG.TRAKT_CLIENT_ID) return null;
    try {
        const url = `/search/${type}/${id}?type=movie,show`;
        const { data } = await traktClient.get(url);
        
        if (data && data.length > 0) {
            const item = data[0];
            const meta = item.movie || item.show;
            return {
                trakt: meta.ids.trakt,
                slug: meta.ids.slug,
                tvdb: meta.ids.tvdb,
                imdb: meta.ids.imdb,
                tmdb: meta.ids.tmdb,
                type: item.type === 'show' ? 'series' : 'movie',
                foundVia: 'trakt'
            };
        }
    } catch (e) { }
    return null;
}

async function searchOmdb(imdbId) {
    if (!CONFIG.OMDB_KEY) return null;
    try {
        const { data } = await omdbClient.get(`/?i=${imdbId}&apikey=${CONFIG.OMDB_KEY}`);
        if (data && data.Response === 'True') {
            return {
                imdb: data.imdbID,
                type: data.Type === 'series' ? 'series' : 'movie',
                foundVia: 'omdb'
            };
        }
    } catch (e) { }
    return null;
}

// ==========================================
// 🛠️ FUNZIONE CORE (NO DB - SOLO API + RAM)
// ==========================================

async function resolveIds(id, typeHint = null) {
    const isImdb = id.toString().startsWith('tt');
    const cleanId = id.toString().split(':')[0]; // Rimuove :season:episode se presente

    // 1. 🧠 RAM CACHE CHECK
    const cached = idCache.get(cleanId);
    if (cached) {
        return { ...cached, foundVia: 'ram_cache' };
    }

    // 2. 🌍 LIVE SEARCH
    let identity = { 
        imdb: isImdb ? cleanId : null, 
        tmdb: !isImdb ? parseInt(cleanId) : null,
        tvdb: null,
        trakt: null,
        slug: null,
        type: typeHint
    };

    // A. TMDB Primary Search
    if (isImdb && !identity.tmdb) {
        const tmdbRes = await searchTmdb(cleanId, 'imdb_id');
        if (tmdbRes) {
            identity.tmdb = tmdbRes.tmdb;
            identity.type = identity.type || tmdbRes.type;
        }
    }

    // B. Expand details with TMDB External IDs
    if (identity.tmdb) {
        const ext = await getTmdbExternalIds(identity.tmdb, identity.type || 'movie');
        identity = { ...identity, ...ext };
    }

    // C. Trakt Fallback
    if ((!identity.tmdb || !identity.imdb) && CONFIG.TRAKT_CLIENT_ID) {
        const traktRes = await searchTrakt(cleanId, isImdb ? 'imdb' : 'tmdb');
        if (traktRes) {
            identity = { ...identity, ...traktRes };
        }
    }

    // D. OMDB Last Resort
    if (isImdb && !identity.tmdb && CONFIG.OMDB_KEY) {
        const omdbRes = await searchOmdb(cleanId);
        if (omdbRes) identity = { ...identity, ...omdbRes };
    }

    // 3. 🧠 SAVE TO RAM CACHE
    // Salviamo in cache sia con chiave IMDB che TMDB per trovarlo in entrambi i modi
    if (identity.imdb || identity.tmdb) {
        if (identity.imdb) idCache.set(identity.imdb, identity);
        if (identity.tmdb) idCache.set(identity.tmdb.toString(), identity);
    }

    return identity;
}

// ==========================================
// 🔌 EXPORT PUBBLICI
// ==========================================

async function tmdbToImdb(tmdbId, type) {
    const ids = await resolveIds(tmdbId, type);
    if (ids.imdb) {
        console.log(`✅ TMDb ${tmdbId} → IMDb ${ids.imdb} [via ${ids.foundVia || 'web'}]`);
        return ids.imdb;
    }
    return null;
}

async function imdbToTmdb(imdbId) {
    const ids = await resolveIds(imdbId);
    if (ids.tmdb) {
        console.log(`✅ IMDb ${imdbId} → TMDb ${ids.tmdb} [via ${ids.foundVia || 'web'}]`);
        return { tmdbId: ids.tmdb, type: ids.type };
    }
    return { tmdbId: null, type: null };
}

async function getAllIds(id) {
    return await resolveIds(id);
}

module.exports = {
    tmdbToImdb,
    imdbToTmdb,
    getAllIds
};
