const axios = require("axios");

const HEADERS_VIX = {
    'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    'Referer': "https://vixsrc.to/",
    'Origin': "https://vixsrc.to"
};

async function handleVixSynthetic(req, res) {
    const masterUrl = req.query.src;
    const forceMax = req.query.max === "1";

    if (!masterUrl) return res.status(400).send("Missing src");

    try {
        const response = await axios.get(masterUrl, { 
            headers: HEADERS_VIX,
            timeout: 6000 
        });

        let manifest = response.data;
        const lines = manifest.split("\n");
        let filteredLines = [];
        let foundBestVariant = false;

        filteredLines.push("#EXTM3U");

        // FIX AUDIO: Estraiamo le tracce audio e i sottotitoli
        for (let line of lines) {
            if (line.startsWith("#EXT-X-MEDIA:TYPE=AUDIO") || line.startsWith("#EXT-X-MEDIA:TYPE=SUBTITLES")) {
                filteredLines.push(line);
            }
        }

        if (forceMax) {
            // Forza 1080p: isoliamo solo la prima variante video
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith("#EXT-X-STREAM-INF") && !foundBestVariant) {
                    filteredLines.push(lines[i]);
                    filteredLines.push(lines[i + 1]);
                    foundBestVariant = true;
                }
            }
        } else {
            // 720p: manteniamo le varianti ma garantiamo l'audio
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
                    filteredLines.push(lines[i]);
                    filteredLines.push(lines[i + 1]);
                }
            }
        }

        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.send(filteredLines.join("\n"));

    } catch (error) {
        console.error("❌ Error in VixProxy:", error.message);
        res.status(500).send("Vix Proxy Error");
    }
}

module.exports = { handleVixSynthetic };
