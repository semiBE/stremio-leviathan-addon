function formatStreamName({ addonName, service, cached, quality, size, hasError = false }) {
    // Mappatura servizi
    const serviceAbbr = {
        'realdebrid': 'RD',
        'torbox': 'TB',
        'alldebrid': 'AD',
        'p2p': 'P2P'
    };
    const abbr = serviceAbbr[service.toLowerCase()] || 'P2P';

    if (abbr === 'P2P') {
        return `${addonName} P2P\n${quality || 'Unknown'}`;
    }

    const cacheSymbol = cached ? '⚡' : '⏳';
    const errorIndicator = hasError ? ' ⚠️' : '';
    
    // --- FIX CRITICO PER RAGGRUPPAMENTO ---
    // Aggiungiamo Size e Quality direttamente nel NOME (prima riga).
    // Se la prima riga è diversa, Stremio NON raggruppa i file.
    const sizeTag = size ? ` ${size}` : '';
    const qualityTag = quality ? ` ${quality}` : '';

    // Output es: "Leviathan RD⚡ 1080p 2.4GB"
    return `${addonName} ${abbr}${cacheSymbol}${qualityTag}${sizeTag}${errorIndicator}`;
}

/**
 * Format stream title (Descrizione seconda riga)
 */
function formatStreamTitle({ title, size, language, source, seeders, isPack = false, episodeTitle }) {
    const lines = [];

    // Line 1: Titolo del file
    if (isPack) {
        lines.push(`🗳️ ${title}`);
        if (episodeTitle) lines.push(`📂 ${episodeTitle}`);
    } else {
        lines.push(`🎬 ${title}`);
    }

    // Line 2: Info extra (Lingua, Source)
    // Nota: Size e Quality sono già nel nome principale ora, ma li lasciamo anche qui per chiarezza
    const metaInfo = [];
    if (language) metaInfo.push(`🗣️ ${language}`);
    if (source) metaInfo.push(`🔗 ${source}`);
    if (seeders !== undefined && seeders !== null) metaInfo.push(`👥 ${seeders}`);
    
    if (metaInfo.length) lines.push(metaInfo.join(' | '));

    return lines.join('\n');
}

function isAIOStreamsEnabled(config) {
    return config.aiostreams_mode === true;
}

module.exports = {
    formatStreamName,
    formatStreamTitle,
    isAIOStreamsEnabled
};
