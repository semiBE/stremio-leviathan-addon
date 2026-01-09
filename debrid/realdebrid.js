// rd.js — VERSIONE IBRIDA POTENZIATA (Leviathan Logic + Smart Matching)

const axios = require("axios");

const RD_TIMEOUT = 30000; // Ridotto per essere più reattivi nei check
const MAX_POLL = 10;
const POLL_DELAY = 1000;

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/* =========================
   FILE MATCHING INTELLIGENTE (Tuo codice originale)
========================= */
function matchFile(files, season, episode) {
    if (!files) return null;

    const videoFiles = files.filter(f => {
        const n = f.path.toLowerCase();
        return (
            /\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|ts|m2ts|mpg|mpeg)$/i.test(n) &&
            !n.includes("sample")
        );
    });

    if (!videoFiles.length) return null;
    
    // Se è un film o non ci sono dati s/e, prendi il più grande
    if (!season || !episode) {
        return videoFiles.sort((a,b) => b.bytes - a.bytes)[0].id;
    }

    const s = parseInt(season);
    const e = parseInt(episode);
    const s2 = s.toString().padStart(2, "0");
    const e2 = e.toString().padStart(2, "0");

    const rules = [
        new RegExp(`S0*${s}.*?E0*${e}\\b`, "i"),        // S01E01
        new RegExp(`\\b${s}x0*${e}\\b`, "i"),          // 1x01
        new RegExp(`(^|\\D)${s}${e2}(\\D|$)`),         // 101 / 215
        new RegExp(`(ep|episode)[^0-9]*0*${e}\\b`, "i"),
        new RegExp(`[ \\-\\[_]0*${e}[ \\-\\]_]`)       // anime assoluto
    ];

    for (const rx of rules) {
        const f = videoFiles.find(v => rx.test(v.path));
        if (f) return f.id;
    }

    // fallback finale: file più grande
    return videoFiles.sort((a,b) => b.bytes - a.bytes)[0].id;
}

/* =========================
   RD REQUEST ROBUSTA (Adattata per gestire errori 204 e json)
========================= */
async function rdRequest(method, url, token, data = null) {
    let attempt = 0;
    while (attempt < 3) {
        try {
            const config = {
                method,
                url,
                headers: { 
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: RD_TIMEOUT,
                data
            };

            const res = await axios(config);
            return res.data;
        } catch (e) {
            const st = e.response?.status;
            if (st === 403) return null; // Token invalido
            if (st === 404) return null; // Non trovato
            
            // Retry su 429 (Too Many Requests) o errori server 5xx
            if (st === 429 || st >= 500 || e.code === 'ECONNABORTED') {
                await sleep(1000 + Math.random() * 1000);
                attempt++;
                continue;
            }
            // Altri errori
            return null;
        }
    }
    return null;
}

/* =========================
   MODULO RD DEFINITIVO
========================= */
const RD = {

    deleteTorrent: async (token, id) => {
        try {
            await rdRequest(
                "DELETE",
                `https://api.real-debrid.com/rest/1.0/torrents/delete/${id}`,
                token
            );
        } catch {}
    },

    /**
     * LEVIATHAN CACHE CHECK
     * Verifica proattiva: Aggiunge -> Controlla -> Cancella.
     * Molto più affidabile di /instantAvailability.
     */
    checkCacheLeviathan: async (token, magnet, hash) => {
        let torrentId = null;
        try {
            // 1. Aggiungi Magnet
            const body = new URLSearchParams();
            body.append("magnet", magnet);
            
            const add = await rdRequest(
                "POST",
                "https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
                token,
                body
            );

            if (!add?.id) return { cached: false, hash };
            torrentId = add.id;

            // 2. Ottieni Info
            let info = await rdRequest(
                "GET",
                `https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`,
                token
            );

            if (!info) {
                await RD.deleteTorrent(token, torrentId);
                return { cached: false, hash };
            }

            // 3. Se serve selezione file, seleziona "all" per forzare il check
            if (info.status === "waiting_files_selection") {
                const sel = new URLSearchParams();
                sel.append("files", "all");
                
                await rdRequest(
                    "POST",
                    `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`,
                    token,
                    sel
                );

                // Rileggi info post-selezione
                info = await rdRequest(
                    "GET",
                    `https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`,
                    token
                );
            }

            // 4. Verifica stato "downloaded"
            const isCached = info?.status === "downloaded";
            
            // 5. Estrai metadati video principale (Bonus del metodo Leviathan)
            let mainFile = null;
            if (info?.files) {
                 const videoFiles = info.files.filter(f => 
                    /\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|ts|m2ts)$/i.test(f.path)
                ).sort((a, b) => b.bytes - a.bytes);
                
                if (videoFiles.length > 0) mainFile = videoFiles[0];
            }

            // 6. Pulizia immediata
            await RD.deleteTorrent(token, torrentId);

            return {
                hash,
                cached: isCached,
                filename: mainFile ? (mainFile.path.split('/').pop()) : null,
                filesize: mainFile ? mainFile.bytes : null
            };

        } catch (e) {
            if (torrentId) await RD.deleteTorrent(token, torrentId);
            return { cached: false, hash, error: e.message };
        }
    },

    /**
     * Vecchio metodo veloce (Opzionale, se vuoi fare un check rapido su tanti file)
     */
    checkInstantAvailability: async (token, hashes) => {
        try {
            const url = `https://api.real-debrid.com/rest/1.0/torrents/instantAvailability/${hashes.join("/")}`;
            return await rdRequest("GET", url, token) || {};
        } catch {
            return {};
        }
    },

    /* =========================
       STREAM LINK PRINCIPALE (Logica Preservata e Pulita)
    ========================= */
    getStreamLink: async (token, magnet, season = null, episode = null) => {
        let torrentId = null;

        try {
            /* 1️⃣ ADD MAGNET */
            const body = new URLSearchParams();
            body.append("magnet", magnet);

            const add = await rdRequest(
                "POST",
                "https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
                token,
                body
            );

            if (!add?.id) return null;
            torrentId = add.id;

            /* 2️⃣ INFO + POLLING */
            let info = null;
            // Un piccolo delay iniziale aiuta RD a processare il magnet
            await sleep(500); 

            for (let i = 0; i < MAX_POLL; i++) {
                info = await rdRequest(
                    "GET",
                    `https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`,
                    token
                );
                if (info?.status === "waiting_files_selection" || info?.status === "downloaded") {
                    break;
                }
                await sleep(POLL_DELAY);
            }

            if (!info || (info.status !== "waiting_files_selection" && info.status !== "downloaded")) {
                await RD.deleteTorrent(token, torrentId);
                return null;
            }

            /* 3️⃣ FILE SELECTION */
            if (info.status === "waiting_files_selection") {
                let fileId = "all";
                if (info.files) {
                    const m = matchFile(info.files, season, episode);
                    if (m) fileId = m;
                }

                const sel = new URLSearchParams();
                sel.append("files", fileId);

                await rdRequest(
                    "POST",
                    `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`,
                    token,
                    sel
                );

                // Polling post-selezione
                for (let i = 0; i < MAX_POLL; i++) {
                    await sleep(POLL_DELAY);
                    info = await rdRequest(
                        "GET",
                        `https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`,
                        token
                    );
                    if (info?.status === "downloaded") break;
                }
            }

            if (info.status !== "downloaded" || !info.links?.length) {
                await RD.deleteTorrent(token, torrentId);
                return null;
            }

            /* 4️⃣ IDENTIFICAZIONE LINK TARGET */
            const targetId = matchFile(info.files, season, episode);
            let link = info.links[0]; 

            if (targetId) {
                const selectedFiles = info.files.filter(f => f.selected === 1);
                const linkIndex = selectedFiles.findIndex(f => f.id === targetId);
                if (linkIndex !== -1 && info.links[linkIndex]) {
                    link = info.links[linkIndex];
                }
            }

            /* 5️⃣ UNRESTRICT */
            const uBody = new URLSearchParams();
            uBody.append("link", link);

            const un = await rdRequest(
                "POST",
                "https://api.real-debrid.com/rest/1.0/unrestrict/link",
                token,
                uBody
            );

            /* 🧹 DELETE FINALE */
            await RD.deleteTorrent(token, torrentId);

            if (!un?.download) return null;

            return {
                type: "ready",
                url: un.download,
                filename: un.filename,
                size: un.filesize
            };

        } catch (e) {
            if (torrentId) await RD.deleteTorrent(token, torrentId);
            console.error("RD Stream Error:", e.message);
            return null;
        }
    }
};

module.exports = RD;
