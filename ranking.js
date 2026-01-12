const DEFAULT_CONFIG = {
  weights: {
    // --- PESI "NUCLEARI" (Gap Incolmabile) ---
    // 1080p = 20 Milioni | 720p = 100 punti
    // Nessun bonus lingua o fonte può colmare questa differenza.
    quality4K: 50000000,      // 50 Milioni
    quality1080p: 20000000,   // 20 Milioni
    quality720p: 100,         // 100 punti
    qualitySD: 0,

    // Lingua (Vince a PARITÀ di risoluzione)
    languageITA: 500000,      // 500k
    languageMULTI: 250000,
    
    // Bonus extra (briciole in confronto ai milioni)
    hevcBonus: 5000,          
    hdrBonus: 5000,           
    exactEpisodeBoost: 20000, 
    seasonPackBonus: 10000,   
    
    // Penalità
    camPenalty: -100000000,   // Penalità devastante per i CAM
    sizeMismatchPenalty: -5000,
    
    // Fonti & Seeders (Ora ininfluenti sulla posizione verticale)
    sourceCorsaroBonus: 5000, 
    seedersFactor: 1,       
    seedersTrustBoost: 100,
    
    ageDecayPerDay: -1,
    hashKnownBonus: 2000,
  },
  heuristics: {
    camRegex: /\b(cam|ts|telecine|telesync|camrip|cam\.|hdcam|hdtc)\b/i,
    packRegex: /\b(pack|complete|tutta|tutte|full ?season|season ?pack|stagione ?(completa)?)\b/i,
    
    // --- REGEX UNIFICATE CON ADDON.JS ---
    // Ora il Ranking usa le stesse identiche regole dell'interfaccia.
    // Se c'è la bandierina ITA, prende i punti ITA.
    itaPatterns: [
      /\b(ITA|ITALIAN|ITALY)\b/i,
      /\b(AUDIO|LINGUA)\s*[:\-]?\s*(ITA|IT)\b/i,
      /\b(AC-?3|AAC|DDP?|DTS|PCM|TRUEHD|ATMOS|MP3|WMA|FLAC).*(ITA|IT)\b/i,
      /\b(DD|DDP|AAC|DTS)\s*5\.1\s*(ITA|IT)\b/i,
      /\b(MULTI|DUAL|TRIPLE).*(ITA|IT)\b/i,
      /\b(SUB|SUBS|SOTTOTITOLI|SUB\.?ITA|SUB-?ITA)\b/i,
      /\b(H\.?264|H\.?265|X264|X265|HEVC|AVC|DIVX|XVID).*(ITA|IT)\b/i,
      /\b(iDN_CreW|CORSARO|MUX|WMS|TRIDIM|SPEEDVIDEO|EAGLE|TRL|MEA|LUX|DNA|LEST|GHIZZO|USAbit|Bric|Dtone|Gaiage|BlackBit|Pantry|Vics|Papeete)\b/i,
      /\b(STAGIONE|EPISODIO|SERIE COMPLETA|STAGIONE COMPLETA)\b/i
    ],
    
    multiPatterns: [/\b(MULTI|MULTILANG|MULTILANGUAGE|ITA.ENG|ITA-ENG)\b/i],
    minimalSizeBytes: 150 * 1024 * 1024 
  },
  trust: {
    sourceTrust: { "Corsaro": 1.0, "Knaben": 1.0 }, 
    groupReputation: { "FAKEGRP": -1.0 }
  },
  userReportsDB: {},
  misc: { nowTimestamp: () => Date.now() }
};

function normalizeNumber(n) { return parseFloat(n) || 0; }

function parseSizeToBytes(v) {
  if (!v) return 0;
  if (typeof v === "number") return v;
  const match = String(v).match(/([\d,.]+)\s*(B|KB|MB|GB|TB)/i);
  if (!match) return 0;
  const val = parseFloat(match[1].replace(",", "."));
  const unit = match[2].toUpperCase();
  const mult = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
  return Math.round(val * (mult[unit] || 1));
}

function computeScore(item, meta, config) {
  let score = 0;
  const title = (item.title || "").toLowerCase();
  // Usa source o provider se disponibile
  const source = (item.source || item.provider || "").toLowerCase(); 
  const reasons = [];

  // 1. Risoluzione (IL FATTORE DOMINANTE)
  if (/(2160p|4k|uhd)/i.test(title)) { score += config.weights.quality4K; reasons.push("4K"); }
  else if (/1080p/i.test(title)) { score += config.weights.quality1080p; reasons.push("1080p"); }
  else if (/720p/i.test(title)) { score += config.weights.quality720p; reasons.push("720p"); }
  else { score += config.weights.qualitySD; reasons.push("SD"); }

  // 2. Lingua (Sincronizzata con la UI)
  let isIta = false;
  // Se la fonte è Corsaro/Knaben è sempre ITA
  if (/corsaro|knaben/i.test(source)) isIta = true;
  else {
      // Controllo Regex completo
      for (const p of config.heuristics.itaPatterns) {
          if (p.test(item.title)) { isIta = true; break; }
      }
  }

  if (isIta) { score += config.weights.languageITA; reasons.push("ITA"); }
  else if (config.heuristics.multiPatterns.some(p => p.test(item.title))) {
      score += config.weights.languageMULTI; reasons.push("MULTI");
  }

  // 3. Codec & HDR
  if (/x265|h265|hevc/i.test(title)) { score += config.weights.hevcBonus; reasons.push("HEVC"); }
  if (/hdr|dolby|vision/i.test(title)) { score += config.weights.hdrBonus; reasons.push("HDR"); }

  // 4. Seeders
  const seeders = normalizeNumber(item.seeders);
  score += seeders * config.weights.seedersFactor;

  // 5. Penalità
  if (config.heuristics.camRegex.test(title)) score += config.weights.camPenalty;

  return { score, reasons };
}

function rankAndFilterResults(results = [], meta = {}, optConfig = {}) {
  // Unione configurazione
  const config = { ...DEFAULT_CONFIG, ...optConfig, weights: { ...DEFAULT_CONFIG.weights, ...optConfig.weights } };

  if (!Array.isArray(results)) return [];

  const scored = results.map(item => {
    // Filtro base dimensione
    const size = parseSizeToBytes(item.size || item.sizeBytes);
    if (size > 0 && size < config.heuristics.minimalSizeBytes) {
        item._score = -999999999; 
        return item;
    }
    
    const { score, reasons } = computeScore(item, meta, config);
    item._score = score;
    item._reasons = reasons;
    return item;
  });

  // Ordina Decrescente
  scored.sort((a, b) => b._score - a._score);
  return scored;
}

module.exports = { rankAndFilterResults, DEFAULT_CONFIG };
