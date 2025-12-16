const axios = require("axios");
const TB_BASE = "https://api.torbox.app/v1/api"; 
const TB_TIMEOUT = 30000; // Timeout aumentato come nel file funzionante

// --- UTILS ---
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// 🗑️ Funzione di Pulizia
async function deleteTorrent(token, torrentId) {
    try {
        await axios.post(`${TB_BASE}/torrents/controltorrent`, {
            torrent_id: torrentId,
            operation: "delete"
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log(`🗑️ [TorBox] Torrent ${torrentId} eliminato.`);
    } catch (e) {
        // Ignora
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
            console.log(`🚀 [TorBox] Richiesto magnet...`);

            // 1. Aggiungi Magnet (CORREZIONE: Uso URLSearchParams come nel codice funzionante)
            const params = new URLSearchParams();
            params.append('magnet', magnet);
            params.append('allow_zip', 'false');

            const createRes = await axios.post(`${TB_BASE}/torrents/createtorrent`, params, { 
                headers: { 
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/x-www-form-urlencoded' // Fondamentale!
                },
                timeout: TB_TIMEOUT 
            });

            if (!createRes.data?.success || !createRes.data.data) {
                // Check se è già in cache dal messaggio (logica Torrentio)
                if (createRes.data?.detail && createRes.data.detail.includes("Found Cached")) {
                     console.log(`⚡ [TorBox] Cache Hit Immediato!`);
                } else {
                    console.log(`❌ [TorBox] Errore aggiunta magnet: ${JSON.stringify(createRes.data)}`);
                    return null;
                }
            }
            
            torrentId = createRes.data?.data?.torrent_id || createRes.data?.data?.id;

            // Fallback ID
            if (!torrentId) {
                console.log(`⚠️ [TorBox] ID non restituito, controllo lista...`);
                const listRes = await axios.get(`${TB_BASE}/torrents/mylist?bypass_cache=true`, {
                     headers: { Authorization: `Bearer ${key}` }
                });
                if (listRes.data?.data && listRes.data.data.length > 0) {
                     // Prende il primo della lista (il più recente)
                     torrentId = listRes.data.data[0].id; 
                }
            }

            if (!torrentId) {
                console.log(`❌ [TorBox] Nessun ID trovato.`);
                return null;
            }

            console.log(`✅ [TorBox] ID Torrent: ${torrentId}`);

            // 2. Polling Stato
            let torrentData = null;
            let attempts = 0;
            const MAX_ATTEMPTS = 10; 

            while (attempts < MAX_ATTEMPTS) {
                await sleep(1000); 

                const infoRes = await axios.get(`${TB_BASE}/torrents/mylist?bypass_cache=true&id=${torrentId}`, {
                    headers: { Authorization: `Bearer ${key}` },
                    timeout: TB_TIMEOUT
                });

                const item = infoRes.data?.data;
                torrentData = Array.isArray(item) ? item.find(t => t.id === torrentId) : item;

                if (torrentData) {
                    // Stati presi dal codice funzionante (download_present, download_finished)
                    const isReady = torrentData.download_present || 
                                    ['cached', 'completed', 'downloaded', 'ready'].includes((torrentData.download_state || '').toLowerCase());
                    
                    if (isReady) {
                        console.log(`✅ [TorBox] Torrent pronto!`);
                        break; 
                    }
                    // Se queued_id esiste, sta scaricando
                    if (torrentData.queued_id) {
                         console.log(`⏳ [TorBox] In coda...`);
                    }
                }
                attempts++;
            }

            // Verifica finale
            const isReadyFinal = torrentData && (
                torrentData.download_present || 
                ['cached', 'completed', 'downloaded', 'ready'].includes((torrentData.download_state || '').toLowerCase())
            );

            if (!isReadyFinal) {
                 console.log(`⚠️ [TorBox] Timeout o non pronto.`);
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
                console.log(`❌ [TorBox] Nessun file video valido.`);
                await deleteTorrent(key, torrentId);
                return null;
            }

            // 4. Request Link (Come nel codice funzionante: params in query string)
            const linkUrl = `${TB_BASE}/torrents/requestdl`;
            const linkRes = await axios.get(linkUrl, { 
                params: {
                    token: key,
                    torrent_id: torrentId,
                    file_id: fileId,
                    zip_link: 'false'
                },
                headers: { Authorization: `Bearer ${key}` },
                timeout: TB_TIMEOUT
            });

            if (linkRes.data?.success && linkRes.data?.data) {
                console.log(`🎉 [TorBox] Link generato!`);
                await deleteTorrent(key, torrentId); 
                return {
                    type: 'ready',
                    url: linkRes.data.data, 
                    filename: torrentData.name || "video.mp4",
                    size: torrentData.size || 0 
                };
            }
            
            console.log(`❌ [TorBox] Errore Link: ${JSON.stringify(linkRes.data)}`);
            await deleteTorrent(key, torrentId); 
            return null;

        } catch (e) {
            if (e.response) {
                 console.error(`💥 [TorBox] HTTP ${e.response.status}: ${JSON.stringify(e.response.data)}`);
            } else {
                 console.error(`💥 [TorBox] Errore: ${e.message}`);
            }
            if (torrentId) await deleteTorrent(key, torrentId);
            return null;
        }
    }
};

module.exports = TB;
