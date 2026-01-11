const axios = require("axios");

const HEADERS_VIX = {
    'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    'Referer': "https://vixsrc.to/",
    'Origin': "https://vixsrc.to"
};

async function handleVixSynthetic(req, res) {
    const masterUrl = req.query.src;
    const forceMax = req.query.max === "1"; 
    const customReferer = req.query.referer; 

    if (!masterUrl) return res.status(400).send("Missing src");

    try {
        
        const requestHeaders = { ...HEADERS_VIX };
        if (customReferer) {
            requestHeaders['Referer'] = customReferer;
        }

        const response = await axios.get(masterUrl, { 
            headers: requestHeaders,
            timeout: 6000 
        });

        const manifest = response.data;
        const lines = manifest.split("\n");
        let filteredLines = [];

        // Inizio Ricostruzione Manifest
        filteredLines.push("#EXTM3U");
        if (manifest.includes("#EXT-X-VERSION")) filteredLines.push("#EXT-X-VERSION:3");

        // 1. Preserviamo Audio e Sottotitoli
        for (let line of lines) {
            if (line.startsWith("#EXT-X-MEDIA:TYPE=AUDIO") || line.startsWith("#EXT-X-MEDIA:TYPE=SUBTITLES")) {
                filteredLines.push(line);
            }
        }

        // 2. Analizziamo le Varianti Video
        let variants = [];
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
                const infoLine = lines[i];
                const urlLine = lines[i + 1];
                
                let resolution = 0;
                const resMatch = infoLine.match(/RESOLUTION=(\d+)x(\d+)/);
                if (resMatch) resolution = parseInt(resMatch[1]) * parseInt(resMatch[2]); 

                variants.push({ info: infoLine, url: urlLine, resolution: resolution || 0 });
            }
        }

        // 3. Logica di Selezione e Ricostruzione
        if (variants.length > 0) {
            // Ordiniamo per qualità
            variants.sort((a, b) => b.resolution - a.resolution);

            let selected = null;

            if (forceMax) {
                // Selettore 1080p: Prendi il primo (il più alto)
                selected = variants[0];
            } else {
                // Selettore 720p: Cerca risoluzione HD o fai fallback intelligente
                const target720 = variants.find(v => v.resolution > 400000 && v.resolution < 2000000 && v.resolution !== variants[0].resolution);
                
                if (target720) {
                    selected = target720;
                } else if (variants.length > 1) {
                    selected = variants[1];
                } else {
                    selected = variants[0];
                }
            }

            if (selected) {
                filteredLines.push(selected.info);
                filteredLines.push(selected.url);
            }
        } else {
            // Fallback diretto se la playlist non ha varianti
            const contentLines = lines.filter(l => !l.startsWith("#EXTM3U") && !l.startsWith("#EXT-X-VERSION"));
            filteredLines.push(...contentLines);
        }

        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.send(filteredLines.join("\n"));

    } catch (error) {
        // Loggare l'errore aiuta a capire se è un 403 (Forbidden)
        console.error("Vix Proxy Error:", error.message);
        res.status(500).send("Vix Proxy Error");
    }
}

module.exports = { handleVixSynthetic };
