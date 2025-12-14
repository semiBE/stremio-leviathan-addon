const axios = require("axios");
const TB_BASE = "https://api.torbox.app/v1";

// --- UTILS ---
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// --- HELPER MATCH FILE AVANZATO (Preso da RD Logic) ---
function matchFile(files, season, episode) {
    if (!files || !season || !episode) return null;

    const s = parseInt(season);
    const e = parseInt(episode);
    const sStr = s.toString().padStart(2, '0');
    const eStr = e.toString().padStart(2, '0');

    // Filtro file video validi
    const videoFiles = files.filter(f => {
        const name = (f.name || f.short_name).toLowerCase();
        const isVideo = /\.(mkv|mp4|avi|mov|wmv|flv|webm)$/i.test(name);
        const notSample = !/sample/i.test(name);
        return isVideo && notSample;
    });
    
    if (videoFiles.length === 0) return null;

    // Regex Prioritarie
    const regexStandard = new RegExp(`S0*${s}.*?E0*${e}\\b`, 'i');
    const regexX = new RegExp(`\\b${s}x0*${e}\\b`, 'i');
    const compactNum = `${s}${eStr}`; 
    const regexCompact = new RegExp(`(^|\\D)${compactNum}(\\D|$)`); // Es: 101 per S01E01
    const regexExplicitEp = new RegExp(`(ep|episode)[^0-9]*0*${e}\\b`, 'i');
    const regexAbsolute = new RegExp(`[ \\-\\[_]0*${e}[ \\-\\]_]`); // Anime logic

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
        try {
            // 1. Aggiungi Magnet
            const createRes = await axios.post(`${TB_BASE}/api/torrents/create`, {
                magnet: magnet,
                seed: 1,
                allow_zip: false
            }, { headers: { Authorization: `Bearer ${key}` }});

            if (!createRes.data.success || !createRes.data.data) return null;
            
            const torrentId = createRes.data.data.torrent_id;
            let torrentData = null;
            let attempts = 0;

            // 2. Polling Intelligente (Max 5 tentativi - aspetta che TorBox elabori il cache)
            while (attempts < 5) {
                await sleep(700); // Piccola pausa tra le richieste

                const infoRes = await axios.get(`${TB_BASE}/api/torrents/mylist?bypass_cache=true&id=${torrentId}`, {
                    headers: { Authorization: `Bearer ${key}` }
                });

                const item = infoRes.data.data;
                // Gestione risposta singola o array
                torrentData = Array.isArray(item) ? item.find(t => t.id === torrentId) : item;

                if (torrentData) {
                    const state = torrentData.download_state.toLowerCase();
                    // Accettiamo cached, completed, downloaded
                    if (['cached', 'completed', 'downloaded'].includes(state)) {
                        break; // Trovato e pronto!
                    }
                }
                attempts++;
            }

            // Se dopo i tentativi non è ancora pronto o non esiste
            if (!torrentData || !['cached', 'completed', 'downloaded'].includes(torrentData.download_state.toLowerCase())) {
                 return null; 
            }

            // 3. Seleziona File
            let fileId = null;
            if (season && episode && torrentData.files) {
                fileId = matchFile(torrentData.files, season, episode);
            }
            
            // Fallback: File più grande (per film)
            if (!fileId && torrentData.files) {
                const sorted = torrentData.files.sort((a, b) => b.size - a.size);
                if(sorted.length > 0) fileId = sorted[0].id;
            }

            if (!fileId) return null;

            // 4. Richiedi Link
            const linkRes = await axios.get(`${TB_BASE}/api/torrents/request_link?token=${key}&torrent_id=${torrentId}&file_id=${fileId}&zip_link=false`);

            if (linkRes.data.success) {
                return {
                    type: 'ready',
                    url: linkRes.data.data, 
                    filename: torrentData.name, 
                    size: 0 // TorBox a volte non passa la size nel link request, ma non è bloccante
                };
            }
            return null;

        } catch (e) {
            console.error("TB Error:", e.message);
            return null;
        }
    }
};

module.exports = TB;
