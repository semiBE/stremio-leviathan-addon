const axios = require("axios");
const TB_BASE = "https://api.torbox.app/v1/api"; 
const TB_TIMEOUT = 30000;

// --- UTILS ---
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// --- WRAPPER ROBUSTO PER RICHIESTE API (Il segreto per evitare errori 429) ---
async function tbRequest(method, endpoint, key, data = null, params = null) {
    let attempt = 0;
    const maxAttempts = 5; // Proviamo fino a 5 volte

    while (attempt < maxAttempts) {
        try {
            const config = {
                method: method,
                url: `${TB_BASE}${endpoint}`,
                headers: { Authorization: `Bearer ${key}` },
                timeout: TB_TIMEOUT,
                params: params
            };

            if (method === 'POST' && data) {
                config.data = data;
                config.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            }

            const res = await axios(config);
            return res; // Ritorna la risposta grezza axios
        } catch (e) {
            const status = e.response?.status;
            const errMsg = e.response?.data?.detail || e.message;

            // Se è un errore 429 (Rate Limit) o 5xx (Server Error), aspettiamo e riproviamo
            if (status === 429 || (status >= 500 && status < 600)) {
                // Calcola un'attesa crescente: 2s, 4s, 6s... + un pizzico di casualità
                const waitTime = (2000 * (attempt + 1)) + Math.random() * 1000;
                console.log(`⚠️ [TorBox] Errore ${status} (${errMsg}). Attendo ${Math.round(waitTime/1000)}s... (Tentativo ${attempt+1}/${maxAttempts})`);
                await sleep(waitTime);
                attempt++;
                continue;
            }
            
            // Per altri errori (es. 401 Unauthorized), lanciamo l'errore subito
            throw e;
        }
    }
    throw new Error(`TorBox API Failed after ${maxAttempts} attempts`);
}

// 🗑️ Funzione di Pulizia
async function deleteTorrent(token, torrentId) {
    try {
        await tbRequest('POST', '/torrents/controltorrent', token, {
            torrent_id: torrentId,
            operation: "delete"
        });
        console.log(`🗑️ [TorBox] Torrent ${torrentId} eliminato.`);
    } catch (e) {
        // Ignora errori di pulizia
    }
}

// --- HELPER MATCH FILE (Invariato) ---
function matchFile(files, season, episode) {
    if (!files || !season || !episode) return null;

    const s = parseInt(season);
    const e = parseInt(episode);
    const sStr = s.toString().padStart(2, '0');
    const eStr = e.toString().padStart(2, '0');

    const videoFiles = files.filter(f => {
        const name = (f.name || f.short_name || '').toLowerCase();
        const isVideo = /\.(mkv|mp4|avi|mov|wmv|flv|webm)$/i.test(name);
        const notSample = !/sample/i.test(name);
        return isVideo && notSample;
    });
    
    if (videoFiles.length === 0) return null;

    const regexStandard = new RegExp(`S0*${s}.*?E0*${e}\\b`, 'i');
    const regexX = new RegExp(`\\b${s}x0*${e}\\b`, 'i');
    const compactNum = `${s}${eStr}`; 
    const regexCompact = new RegExp(`(^|\\D)${compactNum}(\\D|$)`);
    const regexExplicitEp = new RegExp(`(ep|episode)[^0-9]*0*${e}\\b`, 'i');
    const regexAbsolute = new RegExp(`[ \\-\\[_]0*${e}[ \\-\\]_]`);

    let found = videoFiles.find(f => regexStandard.test(f.name || f.short_name));
    if (!found) found = videoFiles.find(f => regexX.test(f.name || f.short_name));
    if (!found && s < 100) found = videoFiles.find(f => regexCompact.test(f.name || f.short_name));
    if (!found) found = videoFiles.find(f => regexExplicitEp.test(f.name || f.short_name));
    if (!found) found = videoFiles.find(f => regexAbsolute.test(f.name || f.short_name));

    return found ? found.id : null;
}

const TB = {
    getStreamLink: async (key, magnet, season = null, episode = null) => {
        let torrentId = null; 
        try {
            // 1. Aggiungi Magnet
            const params = new URLSearchParams();
            params.append('magnet', magnet);
            params.append('allow_zip', 'false');

            const createRes = await tbRequest('POST', '/torrents/createtorrent', key, params);

            if (!createRes.data?.success || !createRes.data.data) {
                if (createRes.data?.detail && createRes.data.detail.includes("Found Cached")) {
                     console.log(`⚡ [TorBox] Cache Hit Immediato!`);
                } else {
                    return null;
                }
            }
            
            torrentId = createRes.data?.data?.torrent_id || createRes.data?.data?.id;

            // Fallback ID
            if (!torrentId) {
                const listRes = await tbRequest('GET', '/torrents/mylist', key, null, { bypass_cache: true });
                if (listRes.data?.data && listRes.data.data.length > 0) {
                     torrentId = listRes.data.data[0].id; 
                }
            }

            if (!torrentId) return null;

            // 2. Polling Stato
            let torrentData = null;
            let attempts = 0;
            const MAX_ATTEMPTS = 10; 

            while (attempts < MAX_ATTEMPTS) {
                await sleep(1000); 

                const infoRes = await tbRequest('GET', '/torrents/mylist', key, null, { bypass_cache: true, id: torrentId });
                const item = infoRes.data?.data;
                torrentData = Array.isArray(item) ? item.find(t => t.id === torrentId) : item;

                if (torrentData) {
                    const isReady = torrentData.download_present || 
                                    ['cached', 'completed', 'downloaded', 'ready'].includes((torrentData.download_state || '').toLowerCase());
                    
                    if (isReady) break; 
                }
                attempts++;
            }

            if (!torrentData || !(torrentData.download_present || ['cached', 'completed', 'downloaded', 'ready'].includes((torrentData.download_state || '').toLowerCase()))) {
                 await deleteTorrent(key, torrentId);
                 return null; 
            }

            // 3. Seleziona File
            let fileId = null;
            if (season && episode && torrentData.files) {
                fileId = matchFile(torrentData.files, season, episode);
            } else if (torrentData.files) {
                const sorted = torrentData.files.sort((a, b) => b.size - a.size);
                if(sorted.length > 0) fileId = sorted[0].id;
            }

            if (!fileId) {
                await deleteTorrent(key, torrentId);
                return null;
            }

            // 4. Request Link
            const linkRes = await tbRequest('GET', '/torrents/requestdl', key, null, {
                token: key,
                torrent_id: torrentId,
                file_id: fileId,
                zip_link: 'false'
            });

            if (linkRes.data?.success && linkRes.data?.data) {
                // Non cancelliamo subito se il link non è permanente, ma TorBox solitamente permette delete dopo generazione
                // Per sicurezza con gli errori 429, cancelliamo in background senza await
                deleteTorrent(key, torrentId).catch(console.error);

                return {
                    type: 'ready',
                    url: linkRes.data.data, 
                    filename: torrentData.name || "video.mp4",
                    size: torrentData.size || 0 
                };
            }
            
            await deleteTorrent(key, torrentId); 
            return null;

        } catch (e) {
            console.error(`💥 [TorBox] Errore Fatale: ${e.message}`);
            if (torrentId) await deleteTorrent(key, torrentId);
            return null;
        }
    }
};

module.exports = TB;
