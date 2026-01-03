function formatStreamName({ 
    addonName, 
    service, 
    cached, 
    quality, // Da addon.js arriva: "1080p • 2.5GB • Source"
    hasError = false 
}) {
    // 1. Abbreviazioni dei servizi
    const serviceAbbr = {
        'realdebrid': '[RD',
        'torbox': '[TB',
        'alldebrid': '[AD',
        'p2p': '[P2P'
    };
    
    // Gestione icona cache
    const srv = serviceAbbr[service?.toLowerCase()] || '[P2P';
    const bolt = cached ? '⚡]' : ']';
    const prefix = `${srv}${bolt}`;
    
    // Indicatore errore
    const errorIndicator = hasError ? ' ⚠️' : '';

    // Se addonName è "Leviathan", lo mostriamo. 
    // La 'quality' passata da addon.js contiene già info utili (es. 4K • 10GB).
    // Risultato: [RD⚡] Leviathan • 1080p • 5.2GB
    return `${prefix} ${addonName} • ${quality}${errorIndicator}`;
}

/**
 * Titolo descrittivo - Layout Multi-riga
 * Qui usiamo il filename per garantire l'unicità
 */
function formatStreamTitle({ 
    title,       // NOTA: Da addon.js qui arriva il "Nome File Originale" (es. Avengers.2012.1080p.mkv)
    size,        // Stringa dimensione (es. 12.5 GB)
    language,    // Lingua (es. 🇮🇹 ITA)
    source,      // Fonte (es. ilCorsaroNero)
    seeders,     // Numero seeders
    episodeTitle, // Eventuale tag episodio (S01E01)
    infoHash     // Hash (passato da addon.js ma lo nascondiamo o mostriamo piccolo se vuoi)
}) {
    // Gestione dati mancanti
    const displaySeeders = seeders !== undefined && seeders !== null ? seeders : '-';
    const displayLang = language || '🌍';
    const displaySource = source || 'P2P';

    // RIGA 1: Il Nome File (Cruciale per evitare che Stremio unisca i risultati)
    // Aggiungiamo un'icona cartella per estetica
    const row1 = `📁 ${title}`;

    // RIGA 2: Dati Tecnici
    const row2 = `💾 ${size} • 👤 ${displaySeeders}`;

    // RIGA 3: Lingua e Fonte
    const row3 = `${displayLang} • ${displaySource}`;

    // Unione con newline
    return `${row1}\n${row2}\n${row3}`;
}

/**
 * Controllo se AIOStreams è abilitato
 */
function isAIOStreamsEnabled(config) {
    return config?.aiostreams_mode === true;
}

module.exports = {
    formatStreamName,
    formatStreamTitle,
    isAIOStreamsEnabled
};
