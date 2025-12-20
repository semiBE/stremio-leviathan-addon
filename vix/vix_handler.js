const { requestHtml } = require("../engines"); 
const { imdbToTmdb } = require("../id_converter");

const VIX_BASE = "https://vixsrc.to"; 
const ADDON_BASE = "https://leviathanaddon.dpdns.org"; //

const HEADERS_BASE = {
    'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    'Referer': `${VIX_BASE}/`, 
    'Origin': VIX_BASE
};

function ensureM3u8Extension(url) {
    if (!url) return "";
    if (url.includes(".m3u8")) return url;
    if (url.includes("?")) {
        const parts = url.split("?");
        return `${parts[0]}.m3u8?${parts[1]}`;
    }
    return `${url}.m3u8`;
}

function extractVixParams(html) {
    try {
        const token = html.match(/['"]token['"]\s*:\s*['"](\w+)['"]/)?.[1];
        const expires = html.match(/['"]expires['"]\s*:\s*['"](\d+)['"]/)?.[1];
        const serverUrl = html.match(/url:\s*['"]([^'"]+)['"]/)?.[1];
        
        if (token && expires && serverUrl) {
            return {
                token,
                expires,
                serverUrl,
                canPlayFHD: html.includes("window.canPlayFHD = true") || /canPlayFHD\s*=\s*true/.test(html)
            };
        }
    } catch (e) { return null; }
    return null;
}

async function searchVix(meta, config) {
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
        const params = extractVixParams(html);

        if (params) {
            const streams = [];
            let baseUrl = ensureM3u8Extension(params.serverUrl);
            const separator = baseUrl.includes("?") ? "&" : "?";
            const commonParams = `token=${params.token}&expires=${params.expires}`;

            // Creiamo il Master URL 
            let masterUrl = `${baseUrl}${separator}${commonParams}`;
            if (params.canPlayFHD) masterUrl += "&h=1";
            else masterUrl += "&b=1";

            // 1. STREAM 1080p (SINTETICO)
            if (params.canPlayFHD) {
                // max=1 forza la risoluzione più alta (1080p)
                const url1080 = `${ADDON_BASE}/vixsynthetic.m3u8?src=${encodeURIComponent(masterUrl)}&lang=it&max=1&multi=1`;
                streams.push({
                    url: url1080,
                    name: "VixSRC 1080p 💎",
                    description: "FHD Synthetic (Con Audio)",
                    isFHD: true,
                    behaviorHints: { proxyHeaders: { "request": HEADERS_BASE } }
                });
            }

            // 2. STREAM 720p 
            
            const url720 = `${ADDON_BASE}/vixsynthetic.m3u8?src=${encodeURIComponent(masterUrl)}&lang=it&max=0&multi=1`;

            streams.push({
                url: url720,
                name: "VixSRC 720p",
                description: "HD Synthetic (Audio Fix)",
                isFHD: false,
                behaviorHints: { proxyHeaders: { "request": HEADERS_BASE } }
            });

            return streams;
        }
        return [];
    } catch (e) { return []; }
}

module.exports = { searchVix };
