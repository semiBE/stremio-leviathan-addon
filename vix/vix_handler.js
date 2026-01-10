const { requestHtml } = require("../engines"); 
const { imdbToTmdb } = require("../id_converter");

const VIX_BASE = "https://vixsrc.to"; 
const ADDON_BASE = "https://leviathanaddon.dpdns.org"; 

const HEADERS_BASE = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
    'Referer': `${VIX_BASE}/`, 
    'Origin': VIX_BASE
};

// Logica di estrazione dati (Kotlin-style)
function extractDataKotlinStyle(html) {
    try {
        const scriptMatch = html.match(/<script[^>]*>([\s\S]*?window\.masterPlaylist[\s\S]*?)<\/script>/);
        if (!scriptMatch) return null;
        
        const rawScript = scriptMatch[1].replace(/\n/g, "\t");
        const parts = rawScript.split(/window\.(?:\w+)\s*=\s*/).slice(1); 
        const keyRegex = /window\.(\w+)\s*=\s*/g;
        const keys = [];
        let m;
        while ((m = keyRegex.exec(rawScript)) !== null) keys.push(m[1]);

        if (!keys.length || keys.length !== parts.length) return null;

        const jsonProps = [];
        for (let i = 0; i < keys.length; i++) {
            let cleaned = parts[i]
                .replace(/;/g, '')
                .replace(/(\{|\[|,)\s*(\w+)\s*:/g, '$1 "$2":')
                .replace(/,(\s*[}\]])/g, '$1')
                .replace(/'/g, '"')
                .trim();
            jsonProps.push(`"${keys[i]}": ${cleaned}`);
        }

        const aggregated = `{\n${jsonProps.join(',\n')}\n}`;
        const parsed = JSON.parse(aggregated);
        const mp = parsed.masterPlaylist;
        if (!mp) return null;

        const paramsObj = mp.params || {};
        return {
            baseUrl: mp.url,
            token: paramsObj.token,
            expires: paramsObj.expires,
            canPlayFHD: parsed.canPlayFHD === true
        };
    } catch (e) {
        return null;
    }
}

function generateRichDescription(meta) {
    const lines = [];
    lines.push(`🎬 ${meta.title || "Video"}`); 
    lines.push(`🇮🇹 ITA • 🔊 AAC`);
    lines.push(`🎞️ HLS • Bitrate Variabile`);
    lines.push(`☁️ Web Stream • ⚡ Instant`);
    lines.push(`🌪️ StreamingCommunity`); 
    return lines.join("\n");
}

async function searchVix(meta, config) {
    // Controllo se Vix o SC sono abilitati
    if (!config.filters || (!config.filters.enableVix && !config.filters.enableSC)) return [];

    try {
        let tmdbId = meta.imdb_id;
        if (tmdbId.startsWith("tt")) {
            const converted = await imdbToTmdb(tmdbId);
            if (converted && converted.tmdbId) tmdbId = converted.tmdbId;
            else return [];
        }

        let targetUrl = meta.isSeries 
            ? `${VIX_BASE}/tv/${tmdbId}/${meta.season}/${meta.episode}/` 
            : `${VIX_BASE}/movie/${tmdbId}/`;
        
        const { data: html } = await requestHtml(targetUrl, { headers: HEADERS_BASE });
        const data = extractDataKotlinStyle(html);

        if (data && data.baseUrl) {
            const streams = [];
            const richTitle = generateRichDescription(meta);

            // Pulizia URL Base
            let cleanBase = data.baseUrl;
            cleanBase = cleanBase.replace(/[?&]b[:=]1/, '');
            
            const beforeQuery = cleanBase.split('?')[0];
            if (!/\.m3u8$/i.test(beforeQuery)) {
                 const partsF = cleanBase.split('?');
                 cleanBase = beforeQuery.replace(/\/$/, '') + '.m3u8' + (partsF[1] ? '?' + partsF.slice(1).join('?') : '');
            }

            const separator = cleanBase.includes('?') ? '&' : '?';
            const queryParams = `token=${encodeURIComponent(data.token)}&expires=${encodeURIComponent(data.expires)}`;
            const masterSourceBase = `${cleanBase}${separator}${queryParams}`;

            // PREPARAZIONE SORGENTE UNIVERSALE
            let universalSource = masterSourceBase;
            if (!universalSource.includes('h=1')) universalSource += "&h=1";
            universalSource = universalSource.replace(/[?&]b=1/, '');

            // --- NUOVA LOGICA DI FILTRO 3-VIE ---
            // Recupera la preferenza dall'index.html (all, 1080, 720)
            // Se non esiste, default a 'all'
            const qualityMode = config.filters.scQuality || 'all'; 

            const allow720 = qualityMode === 'all' || qualityMode === '720';
            const allow1080 = qualityMode === 'all' || qualityMode === '1080';

            // =================================================================
            // STREAM 1: 720p (Backup / Auto)
            // =================================================================
            if (allow720) {
                const synthetic720 = `${ADDON_BASE}/vixsynthetic.m3u8?src=${encodeURIComponent(universalSource)}&lang=it&max=0&multi=1`;

                streams.push({
                    name: `🌪️ StreamingCommunity\n📺 720p`, 
                    title: richTitle,
                    url: synthetic720,
                    behaviorHints: { 
                        notWebReady: false, 
                        bingieGroup: "vix-synthetic-720" 
                    }
                });
            }

            // =================================================================
            // STREAM 2: 1080p (Force FHD)
            // =================================================================
            if (data.canPlayFHD && allow1080) { 
                const synthetic1080 = `${ADDON_BASE}/vixsynthetic.m3u8?src=${encodeURIComponent(universalSource)}&lang=it&max=1&multi=1`;
                
                streams.push({
                    name: `🌪️ StreamingCommunity\n💎 1080p`,
                    title: richTitle,
                    url: synthetic1080,
                    behaviorHints: { 
                        notWebReady: false, 
                        bingieGroup: "vix-synthetic-1080" 
                    }
                });
            }

            // Invertiamo l'ordine solo se entrambi sono presenti e vogliamo il 1080p in alto
            // Se ne è rimasto solo uno a causa del filtro, l'ordine non importa
            return streams.reverse();
        }
        return [];
    } catch (e) { return []; }
}

module.exports = { searchVix };
