const axios = require("axios");
const https = require("https");
const TB_BASE = "https://api.torbox.app/v1/api"; 
const TB_TIMEOUT = 60000; 

// --- CACHE IN MEMORIA ---
let globalListCache = { data: null, timestamp: 0 };

const httpsAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });
const COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36'
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Wrapper Richieste
async function tbRequest(method, endpoint, key, data = null, params = null) {
    let attempt = 0;
    const maxAttempts = 3;
    
    while (attempt < maxAttempts) {
        try {
            const config = {
                method, 
                url: `${TB_BASE}${endpoint}`,
                headers: { ...COMMON_HEADERS, 'Authorization': `Bearer ${key}` },
                timeout: TB_TIMEOUT, 
                params,
                httpsAgent
            };

            if (method === 'POST' && data) {
                const formData = new URLSearchParams();
                for (const k in data) formData.append(k, data[k]);
                config.data = formData;
                config.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            }

            return await axios(config);
        } catch (e) {
            const status = e.response?.status;
            if (status === 429) {
                console.warn(`🛑 [TorBox] Rate Limit (429). Attesa.`);
                return e.response || { status: 429, data: { success: false, detail: "Rate Limit" } };
            }
            if (e.code === 'ECONNABORTED' || status >= 500) {
                await sleep(1500 * (attempt + 1));
                attempt++;
                continue;
            }
            return e.response;
        }
    }
    return null;
}

// Recupera lista utente (con Cache)
async function getUserList(key, forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && globalListCache.data && (now - globalListCache.timestamp) < 60000) {
        return globalListCache.data;
    }
    const listRes = await tbRequest('GET', '/torrents/mylist', key, null, { bypass_cache: true });
    if (listRes?.data?.data) {
        globalListCache = { data: listRes.data.data, timestamp: now };
        return listRes.data.data;
    }
    return null;
}

async function freeUpSpace(key) {
    const list = await getUserList(key, true);
    if (!list || list.length === 0) return false;

    const sacrificialLamb = list
        .filter(t => ['completed', 'seeding', 'ready'].includes((t.download_state || '').toLowerCase()))
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))[0];

    if (sacrificialLamb) {
        console.log(`🗑️ [TorBox] Libero spazio eliminando: ${sacrificialLamb.name}`);
        await tbRequest('POST', '/torrents/controltorrent', key, { torrent_id: sacrificialLamb.id, operation: "delete" });
        globalListCache.data = null; 
        await sleep(1000); 
        return true;
    }
    return false;
}

// --- FUNZIONE MATCH FILE CHE ACCETTA ID 0 ---
function matchFile(files, season, episode) {
    if (!files || !files.length) return null;

    // Helper per estrarre ID in modo sicuro (anche se è 0)
    const getSafeId = (f) => {
        if (f.id !== undefined && f.id !== null) return f.id;
        if (f.file_id !== undefined && f.file_id !== null) return f.file_id;
        return null;
    };
    
    // Helper Size
    const getSafeSize = (f) => parseInt(f.size || 0);

    const isVideo = (name) => {
        const n = (name || "").trim();
        return /\.(mkv|mp4|avi|mov|wmv|flv|webm)$/i.test(n) && !/sample/i.test(n);
    };

    // 1. FILTRO VIDEO
    const videoFiles = files.filter(f => isVideo(f.name) || isVideo(f.short_name));
    const candidates = videoFiles.length > 0 ? videoFiles : files;

    // 2. RILEVAMENTO FILM (S0 E0)
    const isSeasonZero = !season || season == 0 || season == '0';
    const isEpisodeZero = !episode || episode == 0 || episode == '0';

    if (isSeasonZero && isEpisodeZero) {
        console.log("🎬 [Match] Modalità FILM (S0E0).");
        // Ordina per dimensione
        const bestFile = candidates.sort((a, b) => getSafeSize(b) - getSafeSize(a))[0];
        if (bestFile) {
            return getSafeId(bestFile); // Ritorna ID anche se è 0
        }
        return null;
    }

    // 3. LOGICA SERIE TV
    const s = parseInt(season);
    const e = parseInt(episode);
    const eStr = e.toString().padStart(2, '0');
    
    const regexes = [
        new RegExp(`S0*${s}.*?E0*${e}\\b`, 'i'),          
        new RegExp(`\\b${s}x0*${e}\\b`, 'i'),              
        new RegExp(`(^|\\D)${s}${eStr}(\\D|$)`),           
        new RegExp(`S0*${s}.*?E${e}\\b`, 'i'),             
        new RegExp(`(ep|episode)[^0-9]*0*${e}\\b`, 'i'),  
        new RegExp(`\\b${eStr}\\b`)                        
    ];

    for (const regex of regexes) {
        const found = candidates.find(f => {
            const n = (f.name || f.short_name || "").trim();
            return regex.test(n);
        });
        if (found) return getSafeId(found);
    }
    
    // Fallback
    const finalFallback = candidates.sort((a, b) => getSafeSize(b) - getSafeSize(a))[0];
    return getSafeId(finalFallback);
}

const TB = {
    checkCached: async (key, hashes) => {
        try {
            if (!hashes?.length) return [];
            const res = await tbRequest('GET', '/torrents/checkcached', key, null, { hash: hashes.join(','), format: 'list' });
            if (res?.data?.data) {
                const list = Array.isArray(res.data.data) ? res.data.data : Object.values(res.data.data);
                return list.map(item => (item.hash || item).toLowerCase());
            }
            return [];
        } catch (e) { return []; }
    },

    getStreamLink: async (key, magnet, season = null, episode = null, hash = null) => {
        try {
            let torrentId = null;
            let files = null;
            let targetHash = hash;

            if (!targetHash) {
                const match = magnet.match(/btih:([a-zA-Z0-9]+)/i);
                targetHash = match ? match[1].toLowerCase() : null;
            } else {
                targetHash = targetHash.toLowerCase();
            }

            // 1. CONTROLLO CACHE
            if (targetHash) {
                const userList = await getUserList(key);
                if (userList) {
                    const found = userList.find(t => t.hash && t.hash.toLowerCase() === targetHash);
                    if (found) {
                        torrentId = found.id;
                        files = found.files;
                    }
                }
            }

            // 2. AGGIUNTA
            if (!torrentId) {
                const postData = { magnet: magnet, seed: '1', allow_zip: 'false' };
                let createRes = await tbRequest('POST', '/torrents/createtorrent', key, postData);
                
                if (!createRes?.data?.success) {
                    const err = createRes?.data?.detail || "";
                    if (err.includes("limit") || err.includes("Active")) {
                         if (await freeUpSpace(key)) {
                             createRes = await tbRequest('POST', '/torrents/createtorrent', key, postData);
                         }
                    } else if (err.includes("exists") || err.includes("already")) {
                         const userList = await getUserList(key, true);
                         const found = userList?.find(t => t.hash && t.hash.toLowerCase() === targetHash);
                         if (found) {
                             torrentId = found.id;
                             files = found.files;
                         }
                    }
                }

                if (!torrentId && createRes?.data?.success) {
                    torrentId = createRes.data.data.torrent_id || createRes.data.data.id;
                    files = createRes.data.data.files;
                    globalListCache.data = null; 
                }

                if (!torrentId) throw new Error(`TorBox Add Failed: ${createRes?.data?.detail || "Unknown"}`);
            }

            // 3. RECUPERO FILE + FIX ID ZERO
            let targetFileId = matchFile(files, season, episode);

            if (targetFileId === null) { // Controllo rigoroso (perché 0 è valido!)
                 console.log(`⚠️ [TorBox] File non trovato subito. Scarico lista per ID: ${torrentId}`);
                 const infoRes = await tbRequest('GET', '/torrents/mylist', key, null, { bypass_cache: true, id: torrentId });
                 const tData = Array.isArray(infoRes?.data?.data) ? infoRes.data.data.find(t => t.id === torrentId) : infoRes?.data?.data;
                 
                 if (tData && tData.files) {
                     files = tData.files;
                     targetFileId = matchFile(files, season, episode);
                 }
            }

            
            if (targetFileId === null) {
                console.error(`❌ [Match Failed] Debug Dump Files:`);
                if (files) files.slice(0, 3).forEach(f => console.log(JSON.stringify(f)));
                throw new Error("File not found inside torrent");
            }

            // 4. LINK
            const linkRes = await tbRequest('GET', '/torrents/requestdl', key, null, {
                token: key,
                torrent_id: torrentId,
                file_id: targetFileId, 
                zip_link: 'false'
            });

            if (linkRes?.data?.success && linkRes.data.data) {
                return { url: linkRes.data.data };
            }
            
            throw new Error(`Link Request Failed: ${linkRes?.data?.detail || "Unknown"}`);

        } catch (e) {
            console.error(`💥 [TorBox] Play Error: ${e.message}`);
            return null;
        }
    }
};

module.exports = TB;
