const axios = require("axios");

// Headers necessari per parlare con VixCloud
const HEADERS_VIX = {
    'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    'Referer': "https://vixsrc.to/",
    'Origin': "https://vixsrc.to"
};

/**
 * Gestisce la logica di filtraggio del manifest M3U8
 * Forza la risoluzione massima e mantiene le tracce audio.
 */
async function handleVixSynthetic(req, res) {
    const masterUrl = req.query.src;
    const forceMax = req.query.max === "1";

    if (!masterUrl) {
        return res.status(400).send("Errore: Parametro 'src' mancante.");
    }

    try {
        const response = await axios.get(masterUrl, { 
            headers: HEADERS_VIX,
            timeout: 6000 
        });

        let manifest = response.data;
        const lines = manifest.split("\n");
        let filteredLines = [];
        let foundBestVariant = false;

        // Header standard M3U8
        filteredLines.push("#EXTM3U");

        // 1. Estraiamo prima tutte le tracce Audio/Sub 
        for (let line of lines) {
            if (line.startsWith("#EXT-X-MEDIA:TYPE=AUDIO") || line.startsWith("#EXT-X-MEDIA:TYPE=SUBTITLES")) {
                filteredLines.push(line);
            }
        }

        // 2. Gestiamo le varianti Video
        if (forceMax) {
            // Logica 1080p: Prendiamo solo la prima variante disponibile (solitamente la top)
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith("#EXT-X-STREAM-INF") && !foundBestVariant) {
                    filteredLines.push(lines[i]);     // Riga info (Risoluzione/Bandwidth)
                    filteredLines.push(lines[i + 1]); // Riga URL del segmento
                    foundBestVariant = true;
                }
            }
        } else {
            // Logica 720p o Auto: Manteniamo il manifest originale ma pulito
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
                    filteredLines.push(lines[i]);
                    filteredLines.push(lines[i + 1]);
                }
            }
        }

        const finalManifest = filteredLines.join("\n");

        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.send(finalManifest);

    } catch (error) {
        console.error("❌ [VixProxy] Errore manifest:", error.message);
        res.status(500).send("Errore durante il proxy del manifest.");
    }
}

module.exports = { handleVixSynthetic };
