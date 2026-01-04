function cleanFileNameForDisplay(filename) {
    
    let name = filename;

    
    name = name.replace(/\[[^\]]+\]/g, '').trim();

    
    name = name.replace(/\s{2,}/g, ' ');

    
    name = name.replace(/\(([^)]*?(BluRay|WEB|HDR|HEVC|x265|10bit|AAC)[^)]*?)\)/gi, '($1)');

    // Se non ha estensione, aggiunge .mkv
    if (!/\.\w{2,4}$/.test(name)) {
        name += '.mkv';
    }

    return name;
}

/**
 * Formatta il nome del servizio/addon
 */
function formatStreamName({ 
    addonName, 
    service, 
    cached, 
    quality, 
    hasError = false 
}) {
    const serviceAbbr = {
        'realdebrid': '[RD',
        'torbox': '[TB',
        'alldebrid': '[AD',
        'p2p': '[P2P'
    };
    const srv = serviceAbbr[service?.toLowerCase()] || '[P2P';
    const bolt = cached ? '⚡]' : ']';
    return `${srv}${bolt} ${addonName}${hasError ? ' ⚠️' : ''}`;
}

/**
 * Formatta il titolo dello stream a 3 righe
 */
function formatStreamTitle({ 
    title,       
    size,        
    language,    
    source,      
    seeders,     
    episodeTitle, 
    infoHash     
}) {
    const displaySeeders = seeders !== undefined && seeders !== null ? seeders : '-';
    const displayLang = language || '🌍';

    // --- CLEAN TITLE ---
    const cleanTitle = cleanFileNameForDisplay(title);

    // --- CLEAN PROVIDER ---
    let displaySource = source || 'Unknown Indexer';

    if (/corsaro/i.test(displaySource)) displaySource = 'ilCorSaRoNeRo';
    else displaySource = displaySource
        .replace(/TorrentGalaxy|tgx/i, 'TGx')
        .replace(/1337/i, '1337x');

    // --- RIGA 1: Nome file pulito ---
    const row1 = `📁 ${cleanTitle}`;

    // --- RIGA 2: Dimensione, seeders, lingua ---
    const row2 = `💾 ${size || 'Unknown'} • 👤 ${displaySeeders} • ${displayLang}`;

    // --- RIGA 3: Provider dedicato ---
    const row3 = `🔎 ${displaySource}`;

    return `${row1}\n${row2}\n${row3}`;
}

/**
 * Controlla se AIOStreams è abilitato
 */
function isAIOStreamsEnabled(config) {
    return config?.aiostreams_mode === true;
}

module.exports = {
    formatStreamName,
    formatStreamTitle,
    isAIOStreamsEnabled,
    cleanFileNameForDisplay
};
