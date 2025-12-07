<div align="center" style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0d1117; padding: 40px 20px; border-radius: 20px; border: 1px solid #30363d;">

  <img src="https://api.iconify.design/game-icons:sea-dragon.svg?color=%2300dbff&width=120" style="filter: drop-shadow(0 0 25px rgba(0, 219, 255, 0.6)); margin-bottom: 10px;" />
  
  <h1 style="color: #fff; font-size: 4rem; margin: 10px 0 0 0; letter-spacing: -2px; text-transform: uppercase; font-weight: 800; line-height: 1;">
    LEVIATHAN
  </h1>
  <div style="width: 60px; height: 4px; background: #00dbff; margin: 15px auto; border-radius: 2px; box-shadow: 0 0 15px #00dbff;"></div>
  
  <p style="color: #8b949e; font-family: monospace; font-size: 1rem; letter-spacing: 3px; margin-bottom: 30px;">
    SYSTEM_V.3.5 // TORRENT_AGGREGATOR
  </p>

  <div style="margin-bottom: 30px;">
    <img src="https://img.shields.io/badge/NODE.JS-Active-1f6feb?style=for-the-badge&labelColor=232830" />
    <img src="https://img.shields.io/badge/REAL_DEBRID-Native-1f6feb?style=for-the-badge&labelColor=232830" />
    <img src="https://img.shields.io/badge/ALL_DEBRID-Active-1f6feb?style=for-the-badge&labelColor=232830" />
  </div>

  <div style="
    background: linear-gradient(135deg, rgba(31, 111, 235, 0.1) 0%, rgba(13, 17, 23, 0) 100%);
    border-left: 4px solid #00dbff;
    padding: 20px;
    max-width: 700px;
    margin: 0 auto 40px auto;
    text-align: left;
    border-radius: 0 10px 10px 0;
  ">
    <strong style="color: #00dbff; font-size: 1.1rem; display: block; margin-bottom: 8px; font-family: monospace;">
      > TARGET: ITALIAN_ECOSYSTEM
    </strong>
    <span style="color: #c9d1d9; line-height: 1.6;">
      L'architettura è stata ricalibrata per l'ecosistema italiano.
      Integrazione nativa di <b>validazione semantica</b> e bypass automatico dei <b>WAF</b>.
      Non è solo un motore di ricerca, è un protocollo di estrazione dati ad alta precisione.
    </span>
  </div>

  <div style="position: relative; padding: 30px 0;">
    
  <div style="
      position: absolute; 
      top: 50%; left: 50%; 
      transform: translate(-50%, -50%); 
      width: 300px; height: 100px; 
      background: radial-gradient(circle, rgba(0, 219, 255, 0.15) 0%, transparent 70%); 
      z-index: 0;">
    </div>

  <a href="https://leaviathan-leviathan.hf.space" target="_blank" style="text-decoration: none; position: relative; z-index: 1;">
      <div style="
        background: #00dbff;
        color: #0d1117;
        display: inline-block;
        padding: 18px 50px;
        font-family: sans-serif;
        font-weight: 900;
        font-size: 1.2rem;
        border-radius: 4px;
        box-shadow: 0 0 30px rgba(0, 219, 255, 0.4);
        text-transform: uppercase;
        border: 2px solid #fff;
        transition: transform 0.2s;
      ">
        ⚡ Inizializza Addon
      </div>
    </a>

  <div style="margin-top: 25px;">
      <a href="https://leaviathan-leviathan.hf.space" target="_blank" style="text-decoration: none;">
        <span style="
          background: #161b22;
          border: 1px solid #30363d;
          padding: 8px 16px;
          border-radius: 50px;
          font-family: monospace;
          color: #8b949e;
          font-size: 0.85rem;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        ">
          <span style="width: 8px; height: 8px; background: #2ea043; border-radius: 50%; box-shadow: 0 0 5px #2ea043;"></span>
          HOSTED ON <strong style="color: #fff;">HUGGING FACE</strong>
        </span>
      </a>
    </div>

  </div>

  <div style="color: #30363d; font-size: 2rem; margin-top: 20px;">•••</div>

</div>

---




## ⚡ Architettura del Sistema

> **Leviathan trascende il concetto di scraper tradizionale.** È un motore di aggregazione predittivo progettato per navigare ecosistemi torrent complessi, restituendo dataset puliti, validati e ordinati per rilevanza.

Il core, sviluppato in **Node.js**, orchestra scansioni parallele sui principali index mondiali e italiani. Utilizza una logica proprietaria per distinguere le sorgenti in base alla latenza di risposta, applicando timeout dinamici e tecniche di evasione anti-bot.

### 🔥 Release 2.0 Highlights

* 🚀 **Core Refactoring:** Motore riscritto per massimizzare stabilità e concorrenza.
* 🏎️ **Fast Lane Mode:** Gestione intelligente dei timeout per API ad alta velocità.
* 🇮🇹 **Strict ITA Validation:** Filtri regex chirurgici per l'eliminazione dei falsi positivi.
* 🛡️ **Cloudscraper Integration:** Ottimizzazione avanzata per il superamento dei controlli Cloudflare.
* 💉 **Magnet Injection:** Arricchimento automatico dei metadati con tracker UDP Tier-1.

---

## 🔱 Core Capabilities

> Il sistema si distingue per un approccio algoritmico proprietario che privilegia la **precisione semantica** sulla forza bruta.

### 1. 🇮🇹 ITA-Strict Validation Protocol
L'algoritmo `isItalianResult()` non esegue una semplice ricerca di stringhe. Applica un filtro **semantico** che analizza il payload per garantire la pertinenza.
* **Positive Matching:** Targetizza tag specifici come `AC3`, `DTS`, `MULTI`, `SUB-ITA`.
* **False Positive Kill-Switch:** Elimina automaticamente release `CAM`, `TS`, e fake files o re-encode di bassa qualità.
* **Risultato:** Dataset pulito al 99.9%. Se non è italiano, non passa.

### 2. ⚡ Adaptive Latency Architecture
Leviathan non tratta tutte le sorgenti allo stesso modo. Utilizza un'euristica predittiva per modulare i timeout:
* 🟢 **Fast Lane (3000ms):** Canale prioritario per API JSON e indici ottimizzati *(Knaben, TPB, Corsaro)*.
* 🔵 **Deep Scan (5000ms):** Scansione profonda per portali HTML complessi o protetti *(1337x, Galaxy)*.
* *Il sistema bilancia automaticamente velocità e completezza.*

### 3. 🛡️ Advanced WAF Evasion
Un layer di sicurezza integrato gestisce l'interazione con i sistemi di protezione perimetrale (Web Application Firewalls).
* **Cloudflare Bypass:** Risoluzione automatica delle challenge JS tramite `cloudscraper`.
* **Identity Rotation:** Rotazione dinamica degli `User-Agent` per simulare traffico organico.
* **Resilience:** Fallback intelligenti che scartano i nodi morti senza interrompere il ciclo di ricerca.

### 4. 🧬 Metadata Fusion & Tracker Injection
Non si limita a trovare il link. Lo potenzia.
* **Smart Parsing:** Normalizzazione regex per Stagioni/Episodi (`S01E01`, `1x01`) indipendentemente dal formato sorgente.
* **Magnet Boosting:** Inietta nel payload una lista curata di **Tracker UDP Tier-1** *(OpenTrackr, Quad, Lubitor)* per massimizzare la velocità di aggancio dei peer e ridurre il tempo di pre-buffering.

---

<div align="center">

## 🌐 LEVIATHAN NETWORK NODES

<br>

| **TARGET ENGINE** | **REGION** | **LATENCY** | **MODE** | **STATUS** |
| :--- | :---: | :---: | :---: | :---: |
| **Il Corsaro Nero** | 🇮🇹 ITA | ![](https://img.shields.io/badge/⏱️_3000ms-HQ-00eaff?style=flat-square&labelColor=black) | ![](https://img.shields.io/badge/⚡_Fast-Lane-00eaff?style=flat-square&labelColor=black) | 🟢 |
| **Knaben** | 🌍 GLB | ![](https://img.shields.io/badge/⏱️_3000ms-HQ-00eaff?style=flat-square&labelColor=black) | ![](https://img.shields.io/badge/🔌_API-JSON-blueviolet?style=flat-square&labelColor=black) | 🟢 |
| **The Pirate Bay** | 🌍 GLB | ![](https://img.shields.io/badge/⏱️_3000ms-HQ-00eaff?style=flat-square&labelColor=black) | ![](https://img.shields.io/badge/🔌_API-JSON-blueviolet?style=flat-square&labelColor=black) | 🟢 |
| **UIndex** | 🌍 GLB | ![](https://img.shields.io/badge/⏱️_4000ms-MED-yellow?style=flat-square&labelColor=black) | ![](https://img.shields.io/badge/🔹_Aggregator-Hybrid-blue?style=flat-square&labelColor=black) | 🟢 |
| **Nyaa** | 🇯🇵 JPN | ![](https://img.shields.io/badge/⏱️_5000ms-DEEP-orange?style=flat-square&labelColor=black) | ![](https://img.shields.io/badge/🐢_Deep-Scan-lightgrey?style=flat-square&labelColor=black) | 🟢 |
| **TorrentGalaxy** | 🌍 GLB | ![](https://img.shields.io/badge/⏱️_5000ms-DEEP-orange?style=flat-square&labelColor=black) | ![](https://img.shields.io/badge/🐢_Deep-Scan-lightgrey?style=flat-square&labelColor=black) | 🟢 |
| **BitSearch** | 🌍 GLB | ![](https://img.shields.io/badge/⏱️_5000ms-DEEP-orange?style=flat-square&labelColor=black) | ![](https://img.shields.io/badge/🐢_Deep-Scan-lightgrey?style=flat-square&labelColor=black) | 🟢 |
| **LimeTorrents** | 🌍 GLB | ![](https://img.shields.io/badge/⏱️_5000ms-DEEP-orange?style=flat-square&labelColor=black) | ![](https://img.shields.io/badge/🐢_Deep-Scan-lightgrey?style=flat-square&labelColor=black) | 🟢 |
| **GloTorrents** | 🌍 GLB | ![](https://img.shields.io/badge/⏱️_5000ms-DEEP-orange?style=flat-square&labelColor=black) | ![](https://img.shields.io/badge/🐢_Deep-Scan-lightgrey?style=flat-square&labelColor=black) | 🟢 |
| **1337x** | 🌍 GLB | ![](https://img.shields.io/badge/⏱️_5000ms-DEEP-orange?style=flat-square&labelColor=black) | ![](https://img.shields.io/badge/🛡️_Cloudflare-Protected-f38020?style=flat-square&labelColor=black) | 🟡 |

<br>
</div>



---

# 📦 Installazione

🔥 Metodo 1 — Clone & Docker Compose (Full Auto-Deploy)

Il modo più semplice, pulito e professionale per avviare Leviathan Core.

```bash

📂  Clona il repository:
git clone https://github.com/LUC4N3X/stremio-leviathan-addon

➡️  Entra nella cartella:
cd stremio-leviathan-addon

```
# 🐳 Avvia Leviathan tramite Docker Compose

```bash
docker compose up -d --build

```

> [!TIP]
> **Status Operativo:**
> * ✔️ **Full Auto:** Avvio completamente automatizzato senza intervento umano.
> * ✔️ **Zero Config:** Nessuna configurazione manuale complessa richiesta.
> * ✔️ **High Performance:** Ideale per Server VPS, NAS e ambienti Home Lab 24/7.


---

## ⚖️ Legal Disclaimer & Liability Warning

> [!WARNING]
> **LEGGERE ATTENTAMENTE PRIMA DELL'USO**
>
> **1. Natura del Software**
> **Leviathan** è un motore di ricerca e *web scraper* automatizzato. Funziona esclusivamente come aggregatore di metadati già disponibili pubblicamente sul World Wide Web.
> * **Nessun File Ospitato:** Leviathan **NON** ospita, carica o gestisce alcun file video, torrent o contenuto protetto sui propri server.
> * **Solo Indicizzazione:** Il software si limita a processare testo HTML e restituire Magnet Link (hash) trovati su siti di terze parti, agendo come un comune browser o motore di ricerca (es. Google).
>
> **2. Scopo Educativo**
> Questo progetto è stato sviluppato esclusivamente per fini di **ricerca, studio dell'architettura web, parsing HTML e test di automazione**. Il codice sorgente è fornito "così com'è" per dimostrare capacità tecniche.
>
> **3. Responsabilità dell'Utente**
> L'autore del repository e i contributori non hanno alcun controllo su come l'utente finale utilizzerà questo software.
> * L'utente si assume la **piena ed esclusiva responsabilità** legale per l'utilizzo di Leviathan.
> * È responsabilità dell'utente verificare la conformità con le leggi locali sul copyright e sulla proprietà intellettuale (es. DMCA, EU Copyright Directive).
>
> **4. Divieto di Pirateria**
> **Scaricare e condividere opere protette da diritto d'autore senza autorizzazione è un reato.** L'autore condanna fermamente la pirateria informatica e non incoraggia, supporta o facilita in alcun modo la violazione del copyright.
>
> **Se non accetti queste condizioni, disinstalla e cancella immediatamente questo software.**

---

<div align="center"> <sub>Engineered with ❤️ & ☕ by the LUC4N3X</sub> </div>
