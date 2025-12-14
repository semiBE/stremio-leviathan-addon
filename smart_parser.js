const FuzzySet = require("fuzzyset");

// ==========================================
// 1. LISTE  DI FILTRAGGIO
// ==========================================

// Token tecnici da rimuovere PRIMA del confronto
const ULTRA_JUNK_TOKENS = new Set([
    // Codec & Risoluzione
    "h264","x264","h265","x265","hevc","1080p","720p","4k","2160p",
    "1080i", "720i", "480p", "sd", "hd", "fhd", "uhd", "sdr", "hdr", "vision",
    // Sorgenti & Formati
    "web","web-dl","bluray","rip","webrip", "bdrip", "dvdrip", "hdrip", "brrip", 
    "tsrip", "camrip", "cam", "ts", "hdtv", "mkv", "mp4", "avi", "divx", "xvid",
    // Audio
    "ac3", "aac", "dts", "truehd", "atmos", "dd5.1", "ddp5.1", "7.1", "5.1", 
    "stereo", "dual audio", "dolby",
    // Lingua & Sottotitoli
    "ita", "eng", "multi", "sub", "subs included", "multi sub", "forced subs", 
    "hardcoded", "softsubs", "dub",
    // Edizioni & Extra
    "repack", "remux", "proper", "complete", "pack", "season", "stagione", 
    "episode", "episodio", "vol", "extended", "directors cut", "unrated", 
    "theatrical", "imax", "series",
    // Streaming Services
    "netflix", "amazon", "disney", "hulu", "hbo", "prime", "amzn", "dsnp", "nf",
    // Network & Distribuzione
    "torrent", "magnet", "ddl", "rarbg", "knaben"
]);

// Parole comuni da ignorare (Stop Words Potenziate)
const ULTRA_STOP_WORDS = new Set([
    // --- ITALIANO ---
    "il","lo","la","i","gli","le","l", 
    "un","uno","una",
    "di","a","da","in","con","su","per","tra","fra",
    "e","ed","o", "ma", "se", "che",
    "del","dello","della","dei","degli","delle","dell",
    "al","allo","alla","ai","agli","alle","all",
    "dal","dallo","dalla","dai","dagli","dalle","dall",
    "nel","nello","nella","nei","negli","nelle","nell",
    "sul","sullo","sulla","sui","sugli","sulle","sull",
    "col","coi",

    // --- INGLESE ---
    "the","a","an",
    "of","to","for","on","by","at","from","with","in","into","onto",
    "and","&","or","nor","but",
    "is","are","was","were","be","been", 
    "that","this","these","those",
    "my","your","his","her","its","our","their",
    "feat","ft","vs","versus", 

    // --- GENERICI ---
    "vol","pt","part","chapter", "capitolo"
]);

// Parole che indicano un contenuto diverso dall'originale
const ULTRA_FORBIDDEN_EXPANSIONS = new Set([
    "new","blood","resurrection","returns","reborn",
    "origins","legacy","revival","sequel",
    "redemption", "evolution", "dead city", "world beyond", "fear the",
    "remake", "reimagined", "extended edition", "fan edit", "bootleg", 
    "unaired", "pilot",
    "lisa", "bride", "son", "curse", "revenge"
]);

const FORBIDDEN_REGEX = [/fanfic/i, /parody/i, /spoof/i, /mock/i, /fake/i];

const ULTRA_SPINOFF_GRAPH = {
    "star wars": { spinoffs: ["mandalorian", "andor", "obi wan", "obi-wan", "ahsoka", "book of boba fett", "bad batch", "tales of the jedi", "visions", "resistance", "rebels", "clone wars", "acolyte", "skeleton crew"] },
    "star trek": { spinoffs: ["next generation", "tng", "deep space nine", "ds9", "voyager", "enterprise", "discovery", "picard", "strange new worlds", "lower decks", "prodigy", "short treks"] },
    "game of thrones": { spinoffs: ["house of the dragon", "snow", "knight of the seven kingdoms"] },
    "the walking dead": { spinoffs: ["dead city", "world beyond", "fear the walking dead", "daryl dixon", "ones who live", "tales of the walking dead"] },
    "doctor who": { spinoffs: ["torchwood", "sarah jane adventures", "class"] },
    "the boys": { spinoffs: ["gen v", "diabolical"] },
    "dune": { spinoffs: ["prophecy", "sisterhood"] },
    "the witcher": { spinoffs: ["blood origin", "nightmare of the wolf", "sirens of the deep"] },
    "vikings": { spinoffs: ["valhalla"] },
    "money heist": { spinoffs: ["berlin", "korea"] },
    "la casa de papel": { spinoffs: ["berlin", "corea"] },
    "bridgerton": { spinoffs: ["queen charlotte"] },
    "csi": { spinoffs: ["miami", "ny", "cyber", "vegas"] },
    "ncis": { spinoffs: ["los angeles", "new orleans", "hawaii", "sydney", "origins"] },
    "criminal minds": { spinoffs: ["suspect behavior", "beyond borders", "evolution"] },
    "law and order": { spinoffs: ["special victims unit", "svu", "criminal intent", "organized crime", "trial by jury", "la", "true crime"] },
    "chicago": { spinoffs: ["pd", "fire", "med", "justice"] },
    "fbi": { spinoffs: ["most wanted", "international"] },
    "911": { spinoffs: ["lone star"] },
    "rookies": { spinoffs: ["feds"] },
    "yellowstone": { spinoffs: ["1883", "1923", "6666", "1944"] },
    "breaking bad": { spinoffs: ["better call saul", "el camino"] },
    "dexter": { spinoffs: ["new blood", "original sin"] },
    "power": { spinoffs: ["book ii", "book 2", "ghost", "book iii", "book 3", "raising kanan", "book iv", "book 4", "force"] },
    "suits": { spinoffs: ["pearson", "la"] },
    "pretty little liars": { spinoffs: ["ravenswood", "perfectionists", "original sin", "summer school"] },
    "gossip girl": { spinoffs: ["2021"] },
    "dragon ball": { spinoffs: ["z", "super", "gt", "kai", "daima", "heroes"] },
    "naruto": { spinoffs: ["shippuden", "boruto", "rock lee"] },
    "one piece": { spinoffs: ["film red", "stampede", "gold", "strong world", "z"] },
    "saint seiya": { spinoffs: ["lost canvas", "omega", "soul of gold", "saintia sho", "knights of the zodiac"] },
    "jojo": { spinoffs: ["rohan"] },
    "pokemon": { spinoffs: ["horizons", "concierge", "generations", "evolutions"] },
    "90 day fiance": { spinoffs: ["happily ever after", "before the 90 days", "the other way", "single life", "pillow talk", "uk", "love in paradise"] },
    "rupaul": { spinoffs: ["all stars", "untucked", "uk", "canada", "down under", "italia", "espana", "philippines", "thailand", "vs the world", "global"] },
    "below deck": { spinoffs: ["mediterranean", "sailing yacht", "down under", "adventure"] },
    "real housewives": { spinoffs: ["beverly hills", "atlanta", "potomac", "salt lake city", "miami", "new york", "orange county", "new jersey", "dubai"] },
    "bachelor": { spinoffs: ["bachelorette", "paradise", "winter games", "golden"] },
    "american horror story": { spinoffs: ["american horror stories"] },
    "the conjuring": { spinoffs: ["annabelle", "nun", "curse of la llorona"] },
    "insidious": { spinoffs: ["chapter 2", "chapter 3", "last key", "red door"] }
};

// ==========================================
// 2. FUNZIONI DI SUPPORTO
// ==========================================

function romanToArabic(str) {
    const map = { i:1,v:5,x:10,l:50,c:100 };
    let total = 0, prev = 0;
    str = str.toLowerCase();
    for (let c of str.split("").reverse()) {
        const val = map[c] || 0;
        total += val < prev ? -val : val;
        prev = val;
    }
    return total;
}

function normalizeTitle(t) {
    if (!t) return "";
    return t.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") 
        .replace(/[':;-]/g, " ") 
        .replace(/[^a-z0-9\s]/g, " ") 
        .replace(/\b(ii|iii|iv|vi|vii|viii|ix|x)\b/gi, r => romanToArabic(r)) 
        .replace(/\s+/g, " ").trim();
}

function tokenize(str) {
    return normalizeTitle(str).split(/\s+/).filter(t => t.length > 0);
}

function extractEpisodeInfo(filename) {
    const upper = filename.toUpperCase();
    const sxeMatch = upper.match(/S(\d{1,2})(?:[._\s-]*E|x)(\d{1,3})/i);
    if (sxeMatch) return { season: parseInt(sxeMatch[1]), episode: parseInt(sxeMatch[2]) };
    
    const xMatch = upper.match(/(\d{1,2})X(\d{1,3})/i);
    if (xMatch) return { season: parseInt(xMatch[1]), episode: parseInt(xMatch[2]) };
    
    const itaMatch = upper.match(/STAGIONE\s*(\d{1,2}).*EPISODIO\s*(\d{1,3})/i);
    if (itaMatch) return { season: parseInt(itaMatch[1]), episode: parseInt(itaMatch[2]) };

    return null;
}

function extractYear(filename) {
    const match = filename.match(/\b(19|20)\d{2}\b/);
    return match ? parseInt(match[0]) : null;
}

function isUnwantedSpinoff(cleanMeta, cleanFile) {
    for (const [parent, data] of Object.entries(ULTRA_SPINOFF_GRAPH)) {
        if (cleanMeta.includes(parent)) {
            const isSearchingForSpinoff = data.spinoffs.some(s => cleanMeta.includes(s));
            if (!isSearchingForSpinoff) {
                for (const sp of data.spinoffs) {
                    if (cleanFile.includes(sp)) return true; 
                }
            }
        }
    }
    return false;
}

// ==========================================
// 3. FUNZIONE PRINCIPALE: SMART MATCH (ANCHOR LOGIC)
// ==========================================

function smartMatch(metaTitle, filename, isSeries = false, metaSeason = null, metaEpisode = null, metaYear = null) {
    if (!filename) return false;
    const fLower = filename.toLowerCase();
    
    if (FORBIDDEN_REGEX.some(r => r.test(fLower))) return false;
    if (fLower.includes("sample") || fLower.includes("trailer") || fLower.includes("bonus")) return false;

    const cleanMetaString = normalizeTitle(metaTitle);
    const cleanFileString = normalizeTitle(filename);

    if (isUnwantedSpinoff(cleanMetaString, cleanFileString)) return false;

    const fTokens = tokenize(filename).filter(t => !ULTRA_JUNK_TOKENS.has(t) && !ULTRA_STOP_WORDS.has(t));
    const mTokens = tokenize(metaTitle).filter(t => !ULTRA_STOP_WORDS.has(t));

    if (mTokens.length === 0) return false;

    // === FIX DEFINITIVO: TITOLI CORTI (Logica Anchor) ===
    // Se il titolo è "YOU", deve:
    // 1. Essere all'INIZIO dei token del file (Index 0).
    // 2. Non essere seguito da altre parole del titolo (evita "You Me Her").
    if (cleanMetaString.length <= 4) {
        
        // Controllo 1: I token del titolo devono corrispondere ESATTAMENTE ai primi token del file
        for (let i = 0; i < mTokens.length; i++) {
            if (fTokens[i] !== mTokens[i]) {
                // Se il primo token del file non è "you", ma "justified" o "i", SCARTA.
                return false; 
            }
        }

        // Controllo 2: Cosa c'è DOPO il titolo?
        // Se il file è "You Me Her S01...", fTokens sarà ["you", "me", "her", "s01"...]
        // Se il file è "You S01...", fTokens sarà ["you", "s01"...]
        if (fTokens.length > mTokens.length) {
            const nextToken = fTokens[mTokens.length]; // Il token subito dopo il titolo
            
            // Regex per capire se il prossimo token è "sicuro" (anno, stagione, formato)
            const isSeason = /^(s\d+|e\d+|\d+x\d+|stagione)$/i.test(nextToken);
            const isYear = /^(19|20)\d{2}$/.test(nextToken);
            const isTech = ULTRA_JUNK_TOKENS.has(nextToken); // (anche se li abbiamo filtrati, controllo sicurezza)

            // Se il token successivo è una parola generica (es. "me", "people", "don't"), ALLORA non è la serie "YOU".
            if (!isSeason && !isYear && !isTech) {
                // C'è un'alta probabilità che sia un titolo composto (es. "You Don't Mess with the Zohan")
                return false;
            }
        }
        
        // Se siamo arrivati qui, è "You" all'inizio, seguito da numeri o nulla. È buono.
    }
    // ====================================================

    const isCleanSearch = !mTokens.some(mt => ULTRA_FORBIDDEN_EXPANSIONS.has(mt));
    if (isCleanSearch) {
        if (fTokens.some(ft => ULTRA_FORBIDDEN_EXPANSIONS.has(ft))) return false;
    }

    // === LOGICA SERIE TV ===
    if (isSeries && metaSeason !== null) {
        const epInfo = extractEpisodeInfo(filename);
        if (epInfo) {
            if (epInfo.season !== metaSeason || epInfo.episode !== metaEpisode) return false;
            
            // Se è un titolo lungo (>4), usiamo ancora il fuzzy per tolleranza
            if (cleanMetaString.length > 4) {
                const fuz = FuzzySet([mTokens.join(" ")]).get(fTokens.join(" "));
                if (fuz && fuz[0][0] > 0.75) return true;
                
                let matchCount = 0;
                mTokens.forEach(mt => { if (fTokens.some(ft => ft.includes(mt))) matchCount++; });
                if (matchCount / mTokens.length >= 0.6) return true;
            } else {
                // Per titoli corti, se siamo qui, abbiamo già superato il check "Anchor" sopra.
                return true; 
            }
            return false;
        }

        const seasonMatch = filename.match(/(?:S|Season|Stagione|Stg)[._\s-]*(\d{1,2})(?!\d|E|x)/i);
        if (seasonMatch) {
             const foundSeason = parseInt(seasonMatch[1]);
             if (foundSeason !== metaSeason) return false;
             
             if (cleanMetaString.length > 4) {
                 const fuz = FuzzySet([mTokens.join(" ")]).get(fTokens.join(" "));
                 if (fuz && fuz[0][0] > 0.70) return true; 
                 let matchCount = 0;
                 mTokens.forEach(mt => { if (fTokens.includes(mt)) matchCount++; });
                 if (matchCount / mTokens.length >= 0.7) return true;
             } else {
                 return true; 
             }
        }
        return false;
    }

    // === LOGICA FILM ===
    if (metaYear) {
        const fileYear = extractYear(filename);
        if (fileYear) {
            if (Math.abs(fileYear - metaYear) >= 1) {
                const strictFuzzy = FuzzySet([cleanMetaString]).get(cleanFileString);
                if (!strictFuzzy || strictFuzzy[0][0] < 0.95) return false;
            }
        }
    }

    // Check Generale (Fuzzy/Partial) solo per titoli lunghi
    if (cleanMetaString.length > 4) {
        if (fTokens.length > 0 && mTokens.length > 0) {
            const firstMeta = mTokens[0];
            const firstFile = fTokens[0];
            if (firstFile !== firstMeta && !mTokens.includes(firstFile)) {
                const joinedFile = fTokens.join(" ");
                const joinedMeta = mTokens.join(" ");
                if (joinedFile.includes(joinedMeta)) return false;
            }
        }

        const cleanF = fTokens.join(" ");
        const cleanM = mTokens.join(" ");
        
        const fuzzyScore = FuzzySet([cleanM]).get(cleanF)?.[0]?.[0] || 0;
        if (fuzzyScore > 0.85) return true;

        let found = 0;
        fTokens.forEach(ft => {
            if (mTokens.some(mt => mt === ft || (mt.length > 3 && ft.includes(mt)))) found++;
        });
        
        const ratio = found / mTokens.length;
        if (ratio >= 0.90) return true; 
        
        return false;
    }

    // Se è corto e siamo arrivati qui, è true (ha passato il check Anchor iniziale)
    return true;
}

module.exports = { smartMatch };
