// ai_query.js

// Dizionario AI statico
const SEMANTIC_ALIASES = {
    // Serie Popolari
    "la casa di carta": ["money heist", "la casa de papel"],
    "il trono di spade": ["game of thrones"],
    "l'attacco dei giganti": ["attack on titan", "shingeki no kyojin"],
    "demon slayer": ["kimetsu no yaiba"],
    "jujutsu kaisen": ["sorcery fight"],
    "my hero academia": ["boku no hero academia"],
    "one piece": ["one piece ita"],
    // Film / Franchise complessi
    "fast and furious": ["fast & furious", "f9", "fast x"],
    "harry potter": ["hp"],
    // Correzioni comuni & Prequel
    "dr house": ["house md", "house m.d.", "dr. house"],
    "it welcome to derry": ["welcome to derry"],
    "it: welcome to derry": ["welcome to derry"]
};

function generateSmartQueries(meta) {
    const { title, originalTitle, year, season, episode, isSeries } = meta;
    
    // Normalizzazione base
    const cleanTitle = title.toLowerCase().trim();
    const cleanOriginal = originalTitle ? originalTitle.toLowerCase().trim() : "";
    
    // 1. Base Set: Titolo Italiano e Originale
    let titles = new Set();
    titles.add(title);
    if (originalTitle) titles.add(originalTitle);

    // 2. Espansione Semantica (AI Dictionary)
    [cleanTitle, cleanOriginal].forEach(t => {
        if (SEMANTIC_ALIASES[t]) {
            SEMANTIC_ALIASES[t].forEach(alias => titles.add(alias));
        }
    });

    // 3. Generazione Query Combinate
    let queries = new Set();
    const sStr = season ? String(season).padStart(2, "0") : "";
    const eStr = episode ? String(episode).padStart(2, "0") : "";

    titles.forEach(t => {
        if (isSeries) {
            // A. Query Specifiche per Episodio (Alta precisione)
            queries.add(`${t} S${sStr}E${eStr}`);     // Es: Serie S01E01
            queries.add(`${t} ${season}x${eStr}`);     // Es: Serie 1x01
            
            // B. Query Generiche per Stagione (FONDAMENTALE PER I PACK)
            // Aggiungiamo queste per trovare i "Season Pack" che contengono l'episodio
            queries.add(`${t} Stagione ${season}`);    // Es: Serie Stagione 1
            queries.add(`${t} Season ${season}`);      // Es: Serie Season 1
            queries.add(`${t} S${sStr}`);              // Es: Serie S01 (Cattura molti pack)

            // C. Varianti con Anno (utile per reboot o omonimie)
            if (year) {
                queries.add(`${t} ${year} S${sStr}E${eStr}`);
                queries.add(`${t} ${year} S${sStr}`);
            }
        } else {
            // Film
            queries.add(`${t} ${year}`);
            // Se il titolo non contiene già "ita", proviamo ad aggiungerlo per filtrare
            if (!t.toLowerCase().includes("ita")) queries.add(`${t} ITA`);
            queries.add(t); // Titolo secco come fallback
        }
    });

    // Ordiniamo: prima le query più specifiche (con E), poi i pack, per dare priorità ai file singoli
    return Array.from(queries).sort((a, b) => {
        const hasEpisodeA = a.includes("E" + eStr) || a.includes("x" + eStr);
        const hasEpisodeB = b.includes("E" + eStr) || b.includes("x" + eStr);
        if (hasEpisodeA && !hasEpisodeB) return -1;
        if (!hasEpisodeA && hasEpisodeB) return 1;
        return 0;
    });
}

module.exports = { generateSmartQueries };
