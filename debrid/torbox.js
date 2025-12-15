const axios = require("axios");
const TB_BASE = "https://api.torbox.app/v1";
const TB_TIMEOUT = 10000; // Timeout massimo per la singola richiesta

// --- UTILS ---
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// 🗑️ Funzione di Pulizia Separata
async function deleteTorrent(token, torrentId) {
    try {
        // Usa l'endpoint DELETE con il token in query string
        const url = `${TB_BASE}/api/torrents/delete?token=${token}&id=${torrentId}`;
        await axios.delete(url, { timeout: 5000 }); // Timeout breve per la pulizia
    } catch (e) {
        // Fallimento silenzioso (non è vitale per l'utente, ma importante per il cleanup)
        console.error(`⚠️ Errore pulizia torrent ${torrentId}:`, e.message);
    }
}

// --- HELPER MATCH FILE AVANZATO (Logica ultra-resiliente) ---
function matchFile(files, season, episode) {
    if (!files || !season || !episode) return null;

    const s = parseInt(season);
    const e = parseInt(episode);
    const sStr = s.toString().padStart(2, '0');
    const eStr = e.toString().padStart(2, '0');

    // TorBox files structure: { id, short_name, name, size, ... }
    const videoFiles = files.filter(f => {
        const name = (f.name || f.short_name || '').toLowerCase();
        const isVideo = /\.(mkv|mp4|avi|mov|wmv|flv|webm)$/i.test(name);
        const notSample = !/sample/i.test(name);
        return isVideo && notSample;
    });
    
    if (videoFiles.length === 0) return null;

    // Regex Prioritarie
    const regexStandard = new RegExp(`S0*${s}.*?E0*${e}\\b`, 'i');
    const regexX = new RegExp(`\\b${s}x0*${e}\\b`, 'i');
    const compactNum = `${s}${eStr}`; 
    const regexCompact = new RegExp(`(^|\\D)${compactNum}(\\D|$)`);
    const regexExplicitEp = new RegExp(`(ep|episode)[^0-9]*0*${e}\\b`, 'i');
    const regexAbsolute = new RegExp(`[ \\-\\[_]0*${e}[ \\-\\]_]`);

    // Tentativi di Match
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
            const createRes = await axios.post(`${TB_BASE}/api/torrents/create`, {
                magnet: magnet,
                seed: 1,
                allow_zip: false
            }, { 
                headers: { Authorization: `Bearer ${key}` },
                timeout: 5000 // Timeout breve per l'aggiunta magnet
            });

            if (!createRes.data?.success || !createRes.data.data) return null;
            
            torrentId = createRes.data.data.torrent_id;
            let torrentData = null;
            let attempts = 0;
            const MAX_ATTEMPTS = 10; // Fino a 10 secondi di polling

            // 2. Polling Resiliente (Cerca nella mylist)
            while (attempts < MAX_ATTEMPTS) {
                // Aspetta 1.5s la prima volta, poi 1s
                await sleep(attempts === 0 ? 1500 : 1000); 

                const infoRes = await axios.get(`${TB_BASE}/api/torrents/mylist?bypass_cache=true&id=${torrentId}`, {
                    headers: { Authorization: `Bearer ${key}` },
                    timeout: 4000 // Timeout per la richiesta info
                });

                const item = infoRes.data?.data;
                // Gestione risposta singola o array
                torrentData = Array.isArray(item) ? item.find(t => t.id === torrentId) : item;

                if (torrentData) {
                    const state = torrentData.download_state?.toLowerCase();
                    // Accetta gli stati che indicano che il file è pronto per lo streaming
                    if (['cached', 'completed', 'downloaded', 'ready'].includes(state)) {
                        break; 
                    }
                    if (state === 'failed' || state === 'error') {
                        return null; 
                    }
                }
                attempts++;
            }

            // Se dopo i tentativi non è pronto
            if (!torrentData || !['cached', 'completed', 'downloaded', 'ready'].includes(torrentData.download_state?.toLowerCase())) {
                 if (torrentId) await deleteTorrent(key, torrentId);
                 return null; 
            }

            // 3. Seleziona File
            let fileId = null;
            if (season && episode && torrentData.files) {
                fileId = matchFile(torrentData.files, season, episode);
            }
            
            // Fallback: File più grande
            if (!fileId && torrentData.files) {
                const sorted = torrentData.files.sort((a, b) => b.size - a.size);
                if(sorted.length > 0) fileId = sorted[0].id;
            }

            if (!fileId) return null;

            // 4. Richiedi Link (Deve usare 'token' in query string per API v1)
            const linkRes = await axios.get(`${TB_BASE}/api/torrents/request_link?token=${key}&torrent_id=${torrentId}&file_id=${fileId}&zip_link=false`, { 
                timeout: TB_TIMEOUT 
            });

            if (linkRes.data?.success) {
                // ✅ PULIZIA: Elimina il torrent subito dopo aver ottenuto il link
                await deleteTorrent(key, torrentId); 

                return {
                    type: 'ready',
                    url: linkRes.data.data, 
                    filename: torrentData.name || torrentData.short_name,
                    size: torrentData.size || 0 
                };
            }
            
            // Se la richiesta link fallisce
            if (torrentId) await deleteTorrent(key, torrentId); 
            return null;

        } catch (e) {
            console.error("TB Error:", e.message);
            if (torrentId) await deleteTorrent(key, torrentId);
            return null;
        }
    }
};

module.exports = TB;
