/**
 * AIOStreams Custom Formatter - Leviathan Edition
 * Layout a 3 righe con Provider su riga dedicata
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
    // Esempio output: [RD⚡] Leviathan
    return `${srv}${bolt} ${addonName}${hasError ? ' ⚠️' : ''}`;
}

/**
 * Titolo descrittivo - Layout Fisso 3 Righe
 */
function formatStreamTitle({ 
    title,       // Nome File
    size,        // Dimensione
    language,    // Lingua
    source,      // IL PROVIDER (Index)
    seeders,     
    episodeTitle, 
    infoHash     
}) {
    const displaySeeders = seeders !== undefined && seeders !== null 
        ? seeders : '-';
    const displayLang = language || '🌍';

    // --- LOGICA DI PULIZIA PROVIDER ---
    let displaySource = 'Unknown Indexer';

    if (source) {
        if (source.includes('•')) {
            const parts = source.split('•');
            // Prende l'ultima parte (il sito) e rimuove spazi
            displaySource = parts[parts.length - 1].trim();
        } else {
            displaySource = source;
        }
    }

    // --- RINOMINA SPECIFICA ---
    // Se il provider estratto è "1337", lo rinomina in "1337x"
    if (displaySource === '1337') {
        displaySource = '1337x';
    }
    // -------------------------

    // RIGA 1: Nome File
    let row1 = `📁 ${title}`;

    // RIGA 2: Dati Tecnici + Lingua
    const row2 = `💾 ${size} • 👤 ${displaySeeders} • ${displayLang}`;

    // RIGA 3: PROVIDER (DEDICATA)
    const row3 = `🔎 ${displaySource}`;

    return `${row1}\n${row2}\n${row3}`;
}

function isAIOStreamsEnabled(config) {
    return config?.aiostreams_mode === true;
}

module.exports = {
    formatStreamName,
    formatStreamTitle,
    isAIOStreamsEnabled
};
