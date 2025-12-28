/**
 * 🦑 LEVIATHAN PACK RESOLVER SYSTEM
 * ------------------------------------------------
 * Modulo proprietario per la gestione avanzata dei Season Packs.
 * Analizza deep-link, scansiona il cloud Debrid e risolve 
 * chirurgicamente l'episodio corretto nel DB locale.
 */

const axios = require('axios');

// Estensioni video supportate dal Core
const VIDEO_EXTENSIONS = /\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|ts|m2ts|mpg|mpeg)$/i;

// Pattern Regex Proprietari per il riconoscimento S/E
const SMART_EPISODE_PATTERNS = [
    // Standard: S01E04, s01e04, S1E04
    { pattern: /[sS](\d{1,2})[eE](\d{1,3})/, extract: (m) => ({ season: parseInt(m[1]), episode: parseInt(m[2]) }) },
    // X-Notation: 1x04, 01x04
    { pattern: /(?<!\w)(\d{1,2})[xX](\d{1,3})(?!\w)/, extract: (m) => ({ season: parseInt(m[1]), episode: parseInt(m[2]) }) },
    // Verbose: Season 1 Episode 04
    { pattern: /[sS]eason\s*(\d{1,2}).*?[eE]pisode\s*(\d{1,3})/i, extract: (m) => ({ season: parseInt(m[1]), episode: parseInt(m[2]) }) },
    // Italian Verbose: Stagione 1 Episodio 04
    { pattern: /[sS]tagione\s*(\d{1,2}).*?[eE]pisodio\s*(\d{1,3})/i, extract: (m) => ({ season: parseInt(m[1]), episode: parseInt(m[2]) }) },
    // Short: E04 (context aware)
    { pattern: /[^a-z]E(\d{1,3})[^0-9]/i, extract: (m, defaultSeason) => ({ season: defaultSeason, episode: parseInt(m[1]) }) },
    // Dash: - 04 - 
    { pattern: /[-–—]\s*(\d{1,3})\s*[-–—]/, extract: (m, defaultSeason) => ({ season: defaultSeason, episode: parseInt(m[1]) }) },
    // Ep Notation: Ep.04
    { pattern: /[eE]p\.?\s*(\d{1,3})(?!\d)/, extract: (m, defaultSeason) => ({ season: defaultSeason, episode: parseInt(m[1]) }) },
];

/**
 * Motore di parsing intelligente per S/E
 */
function parseSeasonEpisode(filename, defaultSeason = 1) {
    for (const { pattern, extract } of SMART_EPISODE_PATTERNS) {
        const match = filename.match(pattern);
        if (match) {
            return extract(match, defaultSeason);
        }
    }
    return null;
}

/**
 * Estrae la stagione target dal nome del pack
 */
function extractSeasonFromPackTitle(torrentTitle) {
    const patterns = [
        /[sS](\d{1,2})(?![eExX\d])/,
        /[sS]eason\s*(\d{1,2})/i,
        /[sS]tagione\s*(\d{1,2})/i,
    ];
    for (const pattern of patterns) {
        const match = torrentTitle.match(pattern);
        if (match) return parseInt(match[1]);
    }
    return null;
}

function isVideoFile(filename) {
    return VIDEO_EXTENSIONS.test(filename);
}

/**
 * Interfaccia diretta con Real-Debrid API
 */
async function fetchFilesFromRealDebrid(infoHash, rdKey) {
    const baseUrl = 'https://api.real-debrid.com/rest/1.0';
    const headers = { 'Authorization': `Bearer ${rdKey}` };

    try {
        console.log(`🦑 [LEVIATHAN-PACK] Scan started on RD: ${infoHash.substring(0, 8)}...`);
        const magnetLink = `magnet:?xt=urn:btih:${infoHash}`;

        // 1. Inserimento Magnet Temporaneo
        const addResponse = await axios.post(
            `${baseUrl}/torrents/addMagnet`,
            `magnet=${encodeURIComponent(magnetLink)}`,
            { headers, timeout: 30000 }
        );

        if (!addResponse.data || !addResponse.data.id) {
            console.error('❌ [LEVIATHAN-PACK] RD Add Failed');
            return null;
        }

        const torrentId = addResponse.data.id;

        // 2. Analisi Struttura File
        const infoResponse = await axios.get(
            `${baseUrl}/torrents/info/${torrentId}`,
            { headers, timeout: 30000 }
        );

        if (!infoResponse.data || !infoResponse.data.files) {
            console.error('❌ [LEVIATHAN-PACK] Empty File Structure');
            await axios.delete(`${baseUrl}/torrents/delete/${torrentId}`, { headers }).catch(() => { });
            return null;
        }

        const files = infoResponse.data.files.map(f => ({
            id: f.id,
            path: f.path,
            bytes: f.bytes,
            selected: f.selected
        }));

        // 3. Cleanup immediato
        console.log(`🧹 [LEVIATHAN-PACK] Cleaning up temp torrent ${torrentId}`);
        await axios.delete(`${baseUrl}/torrents/delete/${torrentId}`, { headers }).catch(err => {
            console.warn(`⚠️ [LEVIATHAN-PACK] Cleanup warning: ${err.message}`);
        });

        console.log(`✅ [LEVIATHAN-PACK] Structure retrieved: ${files.length} files`);
        return { torrentId, files };
    } catch (error) {
        console.error(`❌ [LEVIATHAN-PACK] RD API Exception: ${error.message}`);
        return null;
    }
}

/**
 * Interfaccia diretta con Torbox API
 */
async function fetchFilesFromTorbox(infoHash, torboxKey) {
    const baseUrl = 'https://api.torbox.app/v1/api';
    const headers = { 'Authorization': `Bearer ${torboxKey}` };

    try {
        console.log(`🦑 [LEVIATHAN-PACK] Scan started on Torbox: ${infoHash.substring(0, 8)}...`);
        const magnetLink = `magnet:?xt=urn:btih:${infoHash}`;

        // 1. Create
        const addResponse = await axios.post(
            `${baseUrl}/torrents/createtorrent`,
            { magnet: magnetLink },
            { headers, timeout: 30000 }
        );

        if (!addResponse.data?.data?.torrent_id) {
            console.error('❌ [LEVIATHAN-PACK] Torbox Add Failed');
            return null;
        }

        const torrentId = addResponse.data.data.torrent_id;
        await new Promise(resolve => setTimeout(resolve, 2000)); // Sync wait

        // 2. Fetch Info
        const infoResponse = await axios.get(
            `${baseUrl}/torrents/mylist`,
            { headers, params: { id: torrentId }, timeout: 30000 }
        );

        const torrent = infoResponse.data?.data?.find(t => t.id === torrentId);
        if (!torrent || !torrent.files) {
            console.error('❌ [LEVIATHAN-PACK] Empty Torbox Structure');
            await axios.get(`${baseUrl}/torrents/controltorrent`, {
                headers, params: { torrent_id: torrentId, operation: 'delete' }
            }).catch(() => { });
            return null;
        }

        const files = torrent.files.map((f, idx) => ({
            id: idx,
            path: f.name,
            bytes: f.size,
            selected: 1
        }));

        // 3. Cleanup
        console.log(`🧹 [LEVIATHAN-PACK] Cleaning up Torbox ID ${torrentId}`);
        await axios.get(`${baseUrl}/torrents/controltorrent`, {
            headers, params: { torrent_id: torrentId, operation: 'delete' }
        }).catch(() => { });

        return { torrentId, files };
    } catch (error) {
        console.error(`❌ [LEVIATHAN-PACK] Torbox API Exception: ${error.message}`);
        return null;
    }
}

/**
 * Analizza e indicizza i contenuti del pack nel DB Centrale
 */
async function processSeriesPackFiles(files, infoHash, seriesImdbId, targetSeason, dbHelper) {
    const videoFiles = files.filter(f => isVideoFile(f.path));
    const processedFiles = [];

    console.log(`🧠 [LEVIATHAN-AI] Analyzing ${videoFiles.length} video streams...`);

    for (const file of videoFiles) {
        const filename = file.path.split('/').pop();
        const parsed = parseSeasonEpisode(filename, targetSeason);

        if (parsed && parsed.season === targetSeason) {
            processedFiles.push({
                info_hash: infoHash,
                file_index: file.id,
                title: filename,
                size: file.bytes,
                imdb_id: seriesImdbId,
                imdb_season: parsed.season,
                imdb_episode: parsed.episode
            });
            // Log pulito per debug
            // console.log(`   -> S${parsed.season}E${parsed.episode} detected`);
        }
    }

    // Persistenza Dati
    if (processedFiles.length > 0 && dbHelper?.insertEpisodeFiles) {
        try {
            const inserted = await dbHelper.insertEpisodeFiles(processedFiles);
            console.log(`💾 [LEVIATHAN-DB] Indexed ${inserted} streams permanently.`);
        } catch (error) {
            console.error(`⚠️ [LEVIATHAN-DB] Indexing warning: ${error.message}`);
        }
    }

    return processedFiles;
}

function findEpisodeFile(files, targetEpisode) {
    return files.find(f => f.imdb_episode === targetEpisode) || null;
}

/**
 * Funzione Principale: Pack Resolver
 */
async function resolveSeriesPackFile(infoHash, config, seriesImdbId, season, episode, dbHelper) {
    console.log(`⚡ [LEVIATHAN-PACK] Resolving target S${season}E${episode} (Hash: ${infoHash.substring(0, 8)})...`);
    
    let totalPackSize = 0;

    // 1. Cache First: Controllo DB Locale
    if (dbHelper?.searchEpisodeFiles) {
        try {
            const dbFiles = await dbHelper.searchEpisodeFiles(seriesImdbId, season, episode);
            const matchingFile = dbFiles.find(f => f.info_hash === infoHash);
            
            if (matchingFile) {
                console.log(`🚀 [LEVIATHAN-FAST] Cache Hit! Stream ready: ${matchingFile.file_title}`);
                totalPackSize = matchingFile.torrent_size || 0;
                return {
                    fileIndex: matchingFile.file_index,
                    fileName: matchingFile.file_title,
                    fileSize: matchingFile.file_size,
                    totalPackSize: totalPackSize,
                    source: 'leviathan_cache'
                };
            }
        } catch (error) {
            console.warn(`⚠️ [LEVIATHAN-DB] Cache miss/error: ${error.message}`);
        }
    }

    // 2. Cloud Scan: Chiamata API
    let filesResult = null;
    if (config.rd_key) filesResult = await fetchFilesFromRealDebrid(infoHash, config.rd_key);
    else if (config.torbox_key) filesResult = await fetchFilesFromTorbox(infoHash, config.torbox_key);
    else {
        console.error('❌ [LEVIATHAN-PACK] Missing API Credentials');
        return null;
    }

    if (!filesResult?.files?.length) {
        console.error('❌ [LEVIATHAN-PACK] Cloud Scan Failed');
        return null;
    }

    const allVideoFiles = filesResult.files.filter(f => isVideoFile(f.path));
    totalPackSize = allVideoFiles.reduce((sum, f) => sum + (f.bytes || 0), 0);

    // 3. Elaborazione e Salvataggio
    const processedFiles = await processSeriesPackFiles(
        filesResult.files,
        infoHash,
        seriesImdbId,
        season,
        dbHelper
    );

    // 4. Selezione Target
    const targetFile = findEpisodeFile(processedFiles, episode);
    if (!targetFile) {
        console.log(`🚫 [LEVIATHAN-PACK] Target E${episode} not found in this pack.`);
        return null;
    }

    console.log(`🎯 [LEVIATHAN-PACK] Target Locked: ${targetFile.title}`);
    return {
        fileIndex: targetFile.file_index,
        fileName: targetFile.title,
        fileSize: targetFile.size,
        totalPackSize: totalPackSize,
        source: 'cloud_scan'
    };
}

function isSeasonPack(torrentTitle) {
    const packPatterns = [
        /[sS]\d{1,2}(?![eExX])/,
        /[sS]eason\s*\d+(?!\s*[eE]pisode)/i,
        /[sS]tagione\s*\d+(?!\s*[eE]pisodio)/i,
        /\b(?:complete|completa|full)\b/i,
        /\[?(?:S\d+)?\s*(?:E\d+-E?\d+|\d+-\d+)\\]?/,
    ];
    const singleEpisodePattern = /[sS]\d{1,2}[eExX]\d{1,3}(?!\s*[-–—]\s*[eExX]?\d)/;
    if (singleEpisodePattern.test(torrentTitle)) return false;
    return packPatterns.some(pattern => pattern.test(torrentTitle));
}

module.exports = {
    parseSeasonEpisode,
    extractSeasonFromPackTitle,
    isVideoFile,
    isSeasonPack,
    resolveSeriesPackFile
};
