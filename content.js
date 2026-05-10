/* =============== COLOR_STORE (chrome.storage.local) =============== */

const colorCache = new Map();
const freqCache = new Map();

try {
    chrome.storage.local.get(null, function (items) {
        Object.keys(items).forEach(key => {
            if (key.startsWith("lr_color_")) {
                colorCache.set(key.replace("lr_color_", ""), items[key]);
            } else if (key.startsWith("lr_freq_")) {
                freqCache.set(key.replace("lr_freq_", ""), items[key]);
            }
        });
    });
} catch (e) {}

function setWordColor(word, state) {
    const key = "lr_color_" + word.toLowerCase();
    const w = word.toLowerCase();
    try {
        if (state === null) {
            colorCache.delete(w);
            chrome.storage.local.remove(key);
        } else {
            colorCache.set(w, state);
            chrome.storage.local.set({ [key]: state });
        }
    } catch (e) {}
}

/* =============== NORMALIZAÇÃO DE PALAVRAS =============== */

function normalizeWord(token) {
    return token
        .toLowerCase()
        .replace(/^[^a-záàâãéèêíïóôõöúüçñ\w]+/i, "")
        .replace(/[^a-záàâãéèêíïóôõöúüçñ\w]+$/i, "");
}

/* =============== FREQ STORE =============== */

let freqWriteTimer = null;
const freqPendingWrite = new Map();

function trackWordFrequency(word) {
    const w = word.toLowerCase();
    if (w.length < 2 || /^[^a-záàâãéèêíïóôõöúüçñ]+$/i.test(w)) return;
    if (colorCache.get(w) === "green") return;

    const current = freqCache.get(w) || 0;
    freqCache.set(w, current + 1);
    freqPendingWrite.set(w, freqCache.get(w));

    clearTimeout(freqWriteTimer);
    freqWriteTimer = setTimeout(() => {
        const batch = {};
        freqPendingWrite.forEach((count, word) => { batch["lr_freq_" + word] = count; });
        freqPendingWrite.clear();
        try { chrome.storage.local.set(batch); } catch (e) {}
    }, 2000);
}

/* =============== MÉTRICAS =============== */

function getTodayKey() {
    return new Date().toISOString().slice(0, 10);
}

function saveVocabSnapshot() {
    const dayKey = "lr_vocab_" + getTodayKey();
    try {
        chrome.storage.local.get(dayKey, function(result) {
            if (result[dayKey] !== undefined) return;
            const knownCount = [...colorCache.values()].filter(v => v === "green").length;
            chrome.storage.local.set({ [dayKey]: { date: getTodayKey(), known: knownCount } });
        });
    } catch (e) {}
}

let exposureTimer = null;
let exposureAccumMs = 0;
let lastTickTime = null;

function isEnglishVideo() {
    try {
        const scripts = document.querySelectorAll("script");
        for (const script of scripts) {
            const text = script.textContent;
            if (!text || !text.includes("ytInitialPlayerResponse")) continue;
            const match = text.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:\s*(?:var|const|let)\s|\s*<\/script>)/s);
            if (!match) continue;
            try {
                const data = JSON.parse(match[1]);
                const captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                if (captionTracks && captionTracks.length > 0) {
                    return captionTracks.some(t => (t.languageCode || "").toLowerCase().startsWith("en"));
                }
                const videoLang = (data?.microformat?.playerMicroformatRenderer?.defaultAudioLanguage || "").toLowerCase();
                if (videoLang) return videoLang.startsWith("en");
            } catch (e) { continue; }
        }
    } catch (e) {}
    return false;
}

function isVideoPlaying() {
    if (document.hidden) return false;
    const video = document.querySelector("video");
    if (!video) return false;
    return !video.paused && !video.ended && video.readyState >= 2;
}

function exposureTick() {
    if (!isVideoPlaying() || !isEnglishVideo()) { lastTickTime = null; return; }
    const now = Date.now();
    if (lastTickTime !== null) {
        const delta = now - lastTickTime;
        if (delta < 5000) exposureAccumMs += delta;
    }
    lastTickTime = now;
    if (exposureAccumMs >= 30000) flushExposure();
}

function flushExposure() {
    if (exposureAccumMs <= 0) return;
    const dayKey = "lr_exposure_" + getTodayKey();
    const secondsToAdd = Math.floor(exposureAccumMs / 1000);
    exposureAccumMs = exposureAccumMs % 1000;
    try {
        chrome.storage.local.get(dayKey, function(result) {
            const current = result[dayKey] || { date: getTodayKey(), seconds: 0 };
            current.seconds = (current.seconds || 0) + secondsToAdd;
            chrome.storage.local.set({ [dayKey]: current });
        });
    } catch (e) {}
}

function startExposureTracking() {
    if (exposureTimer) return;
    exposureTimer = setInterval(exposureTick, 1000);
    window.addEventListener("beforeunload", flushExposure);
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) { lastTickTime = null; flushExposure(); }
    });
}

startExposureTracking();
saveVocabSnapshot();

/* =============== EXPORTAR / IMPORTAR =============== */

function exportSavedWords() {
    try {
        chrome.storage.local.get(null, function(items) {
            const data = { colors: {}, frequencies: {}, vocab_history: {}, exposure_history: {} };
            Object.keys(items).forEach(key => {
                if (key.startsWith("lr_color_")) data.colors[key.replace("lr_color_", "")] = items[key];
                else if (key.startsWith("lr_freq_")) data.frequencies[key.replace("lr_freq_", "")] = items[key];
                else if (key.startsWith("lr_vocab_")) data.vocab_history[key.replace("lr_vocab_", "")] = items[key];
                else if (key.startsWith("lr_exposure_")) data.exposure_history[key.replace("lr_exposure_", "")] = items[key];
            });
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            const today = new Date().toISOString().slice(0, 10);
            a.href = url; a.download = `youtube-highlighter-${today}.json`; a.click();
            URL.revokeObjectURL(url);
        });
    } catch (e) { alert("Erro ao exportar: " + e.message); }
}

function importSavedWords(jsonText) {
    try {
        const data = JSON.parse(jsonText);
        if (!data.colors && !data.frequencies) { alert("Arquivo inválido."); return; }
        const batch = {};
        let colorCount = 0, freqCount = 0;
        if (data.colors) {
            Object.entries(data.colors).forEach(([word, state]) => {
                if (state === "green" || state === "yellow") {
                    const w = word.toLowerCase();
                    batch["lr_color_" + w] = state; colorCache.set(w, state); colorCount++;
                }
            });
        }
        if (data.frequencies) {
            Object.entries(data.frequencies).forEach(([word, count]) => {
                if (typeof count === "number" && count > 0) {
                    const w = word.toLowerCase();
                    const merged = Math.max(freqCache.get(w) || 0, count);
                    batch["lr_freq_" + w] = merged; freqCache.set(w, merged); freqCount++;
                }
            });
        }
        chrome.storage.local.set(batch, function() {
            const panel = document.getElementById("lr-player-panel");
            if (panel && panel.style.display !== "none") renderSavedWords();
            alert(`Importado!\n${colorCount} cores · ${freqCount} frequências`);
        });
    } catch (e) { alert("Erro ao importar: " + e.message); }
}

/* =============== CRIAR PAINEL DO PLAYER =============== */

function createPlayerPanel() {
    if (document.getElementById("lr-player-panel")) return;

    // ── Painel principal ──────────────────────────────────────────────────────
    const panel = document.createElement("div");
    panel.id = "lr-player-panel";
    panel.style.cssText = [
        "position: fixed",
        "left: 0",
        "right: 0",
        "bottom: 0",
        "height: 40vh",
        "background: #111",
        "color: white",
        "font-family: Arial, sans-serif",
        "z-index: 999999",
        "display: none",
        "flex-direction: column",
        "border-top: 2px solid #333",
    ].join(";");

    panel.innerHTML = `
        <div id="lr-tabs" style="display:flex;border-bottom:2px solid #333;flex-shrink:0;">
            <button class="lr-tab lr-tab-active" data-tab="legendas">Legendas</button>
            <button class="lr-tab" data-tab="salvas">Palavras Salvas</button>
        </div>
        <div id="lr-panel-legendas" class="lr-panel" style="flex:1;overflow-y:auto;padding:14px;display:block;">
            <div id="lr-transcript-status"></div>
            <div id="lr-text"></div>
        </div>
        <div id="lr-panel-salvas" class="lr-panel" style="flex:1;overflow-y:auto;padding:14px;display:none;">
            <div id="lr-saved-actions">
                <button id="lr-export-btn" title="Exportar palavras salvas como JSON">&#11015; Exportar</button>
                <button id="lr-import-btn" title="Importar palavras salvas de um arquivo JSON">&#11014; Importar</button>
                <button id="lr-analytics-btn" title="Abrir página de análise de progresso">&#128202; Análise</button>
                <input type="file" id="lr-import-file" accept=".json" style="display:none;">
            </div>
            <div id="lr-saved-words"></div>
        </div>
    `;

    document.body.appendChild(panel);

    // ── Tabs ──────────────────────────────────────────────────────────────────
    panel.querySelectorAll(".lr-tab").forEach(tab => {
        tab.onclick = () => {
            panel.querySelectorAll(".lr-tab").forEach(t => t.classList.remove("lr-tab-active"));
            tab.classList.add("lr-tab-active");
            const target = tab.dataset.tab;
            document.getElementById("lr-panel-legendas").style.display = target === "legendas" ? "block" : "none";
            document.getElementById("lr-panel-salvas").style.display   = target === "salvas"   ? "block" : "none";
            if (target === "salvas") renderSavedWords();
        };
    });

    // ── Export / Import / Analytics ───────────────────────────────────────────
    panel.querySelector("#lr-export-btn").onclick = exportSavedWords;

    const importFile = panel.querySelector("#lr-import-file");
    panel.querySelector("#lr-import-btn").onclick = () => importFile.click();
    importFile.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => { importSavedWords(ev.target.result); importFile.value = ""; };
        reader.readAsText(file);
    };

    panel.querySelector("#lr-analytics-btn").onclick = () => {
        window.open(chrome.runtime.getURL("analytics.html"), "_blank");
    };
}

function renderSavedWords() {
    const container = document.getElementById("lr-saved-words");
    if (!container) return;

    const entries = [];
    freqCache.forEach((count, word) => {
        if (colorCache.get(word) !== "green") entries.push({ word, count });
    });
    entries.sort((a, b) => b.count - a.count);
    const top20 = entries.slice(0, 20);

    container.innerHTML = "";
    if (top20.length === 0) {
        container.innerHTML = '<p style="color:#888;font-size:14px;">Nenhuma palavra registrada ainda.</p>';
        return;
    }

    top20.forEach(({ word, count }) => {
        const span = document.createElement("span");
        span.className = "lr-word lr-saved-word";
        span.dataset.lrWord = word;
        const colorState = colorCache.get(word);
        if (colorState === "green") span.classList.add("lr-green");
        else if (colorState === "yellow") span.classList.add("lr-yellow");
        span.onclick = (event) => {
            cycleWordColor(span, event);
            span.classList.remove("lr-green", "lr-yellow");
            const newState = colorCache.get(word);
            if (newState === "green") span.classList.add("lr-green");
            else if (newState === "yellow") span.classList.add("lr-yellow");
        };
        span.appendChild(document.createTextNode(word));
        const badge = document.createElement("sup");
        badge.className = "lr-freq-badge";
        badge.textContent = count;
        span.appendChild(badge);
        container.appendChild(span);
    });
}

/* =============== CICLO DE CORES =============== */

function cycleWordColor(el, event) {
    event.stopPropagation();
    let newState = null;
    if (el.classList.contains("lr-green")) newState = "yellow";
    else if (el.classList.contains("lr-yellow")) newState = null;
    else newState = "green";

    const word = el.dataset.lrWord;
    setWordColor(word, newState);

    document.querySelectorAll(`.lr-word[data-lr-word="${CSS.escape(word)}"]`).forEach(span => {
        span.classList.remove("lr-green", "lr-yellow");
        if (newState === "green") span.classList.add("lr-green");
        else if (newState === "yellow") span.classList.add("lr-yellow");
    });
}

/* =============== TRANSCRIÇÃO COMPLETA — DIRETO DO DOM DO YOUTUBE =============== */

let transcriptLines   = [];
let activeLineIndex   = -1;
let transcriptSyncTimer = null;
let transcriptLoaded  = false;

// Grupos de linhas para a legenda do vídeo (linhas próximas agrupadas)
// Cada grupo: { start, end, text, lineIndices[] }
let captionGroups = [];

function getVideoId() {
    const match = location.href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
}

/**
 * Extrai a URL da faixa de legenda do ytInitialPlayerResponse embutido na página.
 * Prefere legendas manuais em inglês; fallback para auto-geradas (asr) em inglês;
 * fallback final para qualquer faixa disponível.
 */
function getCaptionTrackUrl() {
    try {
        // ytInitialPlayerResponse está disponível como variável global na página
        // mas content scripts não têm acesso direto — lemos do script tag
        const scripts = document.querySelectorAll("script");
        for (const script of scripts) {
            const text = script.textContent;
            if (!text || !text.includes("captionTracks")) continue;

            let data = null;
            // Tenta extrair ytInitialPlayerResponse
            const match = text.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:\s*(?:var|const|let)\s|\s*<\/script>)/s);
            if (match) {
                try { data = JSON.parse(match[1]); } catch (e) { continue; }
            }
            if (!data) continue;

            const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            if (!tracks || tracks.length === 0) continue;

            // Prioridade: manual en > asr en > qualquer en > primeira disponível
            const manualEn = tracks.find(t => t.languageCode?.startsWith("en") && !t.kind);
            const asrEn    = tracks.find(t => t.languageCode?.startsWith("en") && t.kind === "asr");
            const anyEn    = tracks.find(t => t.languageCode?.startsWith("en"));
            const chosen   = manualEn || asrEn || anyEn || tracks[0];

            if (chosen?.baseUrl) return chosen.baseUrl;
        }
    } catch (e) {}
    return null;
}

/**
 * Busca e parseia a transcrição a partir da URL da faixa de legenda.
 * O YouTube serve as legendas em formato XML (timedtext).
 * Retorna array de { text, start, dur }.
 */
async function fetchTranscriptFromUrl(trackUrl) {
    // Solicitar formato JSON3 para facilitar o parse
    const url = trackUrl + "&fmt=json3";
    const response = await fetch(url);
    if (!response.ok) throw new Error("HTTP " + response.status);

    const data = await response.json();
    const lines = [];

    // Formato json3: { events: [{ tStartMs, dDurationMs, segs: [{utf8}] }] }
    for (const event of (data.events || [])) {
        if (!event.segs) continue;
        const text = event.segs
            .map(s => s.utf8 || "")
            .join("")
            .replace(/\n/g, " ")
            .replace(/^>>\s*/, "")
            .trim();
        if (!text || text === ">>") continue;

        lines.push({
            text,
            start: (event.tStartMs || 0) / 1000,
            dur:   (event.dDurationMs || 2000) / 1000,
        });
    }
    return lines;
}

/**
 * Agrupa linhas consecutivas cujo gap entre elas é menor que MAX_GAP segundos.
 * Limita cada grupo a MAX_WORDS palavras para evitar blocos muito grandes.
 * Cada grupo exibe no máximo 2 linhas visuais na legenda.
 */
function buildCaptionGroups() {
    const MAX_GAP   = 1.5;  // segundos — gap máximo para agrupar linhas
    const MAX_WORDS = 18;   // máximo de palavras por grupo
    captionGroups = [];

    if (transcriptLines.length === 0) return;

    let group = {
        start: transcriptLines[0].start,
        end:   transcriptLines[0].start + (transcriptLines[0].dur || 2),
        lines: [transcriptLines[0].text],
        lineIndices: [0]
    };

    for (let i = 1; i < transcriptLines.length; i++) {
        const prev = transcriptLines[i - 1];
        const curr = transcriptLines[i];
        const prevEnd = prev.start + (prev.dur || 2);
        const gap = curr.start - prevEnd;
        const groupWordCount = group.lines.join(" ").split(/\s+/).filter(Boolean).length;
        const currWordCount  = curr.text.split(/\s+/).filter(Boolean).length;

        const canMerge = gap <= MAX_GAP
            && (groupWordCount + currWordCount) <= MAX_WORDS
            && group.lines.length < 2;  // máximo 2 linhas visuais por grupo

        if (canMerge) {
            group.end  = curr.start + (curr.dur || 2);
            group.lines.push(curr.text);
            group.lineIndices.push(i);
        } else {
            captionGroups.push(group);
            group = {
                start: curr.start,
                end:   curr.start + (curr.dur || 2),
                lines: [curr.text],
                lineIndices: [i]
            };
        }
    }
    captionGroups.push(group);
}

async function loadFullTranscript() {
    if (!location.href.includes("/watch")) return;

    const status = document.getElementById("lr-transcript-status");
    if (status) { status.textContent = "Carregando transcrição..."; status.style.display = "block"; }

    // Aguarda até o ytInitialPlayerResponse estar disponível no DOM (máx 8s)
    let trackUrl = null;
    for (let attempt = 0; attempt < 16; attempt++) {
        trackUrl = getCaptionTrackUrl();
        if (trackUrl) break;
        await new Promise(r => setTimeout(r, 500));
    }

    if (!trackUrl) {
        // Sem faixa de legenda disponível — usar fallback do caption injector
        if (status) { status.textContent = ""; status.style.display = "none"; }
        initCaptionInjector();
        return;
    }

    try {
        const lines = await fetchTranscriptFromUrl(trackUrl);
        transcriptLines = lines.filter(l => l.text && l.text.trim().length > 0);

        if (status) { status.textContent = ""; status.style.display = "none"; }
        if (transcriptLines.length === 0) {
            initCaptionInjector();
            return;
        }

        transcriptLoaded = true;

        renderTranscript();
        startTranscriptSync();
        buildCaptionGroups();
        initCustomCaptions();

    } catch (e) {
        // Garantir que as legendas nativas não fiquem ocultas
        const hideStyle = document.getElementById("lr-hide-captions-style");
        if (hideStyle) hideStyle.remove();

        if (status) {
            status.textContent = "⚠ Erro ao carregar transcrição: " + (e.message || e);
            status.style.color = "#e57373";
            status.style.display = "block";
        }
        initCaptionInjector();
    }
}

/* =============== PAINEL — TRANSCRIÇÃO COMPLETA =============== */

function renderTranscript() {
    const container = document.getElementById("lr-text");
    if (!container) return;
    container.innerHTML = "";

    transcriptLines.forEach((line, index) => {
        const lineEl = document.createElement("div");
        lineEl.className = "lr-transcript-line";
        lineEl.dataset.index = index;

        const ts = document.createElement("span");
        ts.className = "lr-timestamp";
        ts.textContent = formatTimestamp(line.start);
        ts.title = "Ir para " + formatTimestamp(line.start);
        ts.onclick = (e) => { e.stopPropagation(); seekVideo(line.start); };
        lineEl.appendChild(ts);

        line.text.split(/(\s+)/).forEach(token => {
            if (token.trim() === "") {
                lineEl.appendChild(document.createTextNode(token));
                return;
            }
            const span = document.createElement("span");
            span.className = "lr-word";
            span.textContent = token;
            span.dataset.lrWord = normalizeWord(token);
            span.onclick = (event) => cycleWordColor(span, event);
            const state = colorCache.get(normalizeWord(token));
            if (state === "green") span.classList.add("lr-green");
            else if (state === "yellow") span.classList.add("lr-yellow");
            lineEl.appendChild(span);
        });

        container.appendChild(lineEl);
    });
}

function formatTimestamp(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function seekVideo(seconds) {
    const video = document.querySelector("video");
    if (video) video.currentTime = seconds;
}

function startTranscriptSync() {
    if (transcriptSyncTimer) return;
    transcriptSyncTimer = setInterval(syncTranscriptHighlight, 200);
}

function syncTranscriptHighlight() {
    const video = document.querySelector("video");
    if (!video || transcriptLines.length === 0) return;

    const currentTime = video.currentTime;
    let newIndex = -1;

    for (let i = 0; i < transcriptLines.length; i++) {
        const line = transcriptLines[i];
        if (line.start <= currentTime && currentTime < line.start + line.dur + 0.5) {
            newIndex = i;
        } else if (line.start > currentTime) {
            break;
        }
    }

    if (newIndex === activeLineIndex) return;
    activeLineIndex = newIndex;

    const container = document.getElementById("lr-text");
    if (!container) return;

    container.querySelectorAll(".lr-transcript-line.lr-line-active").forEach(el => {
        el.classList.remove("lr-line-active");
    });

    if (newIndex < 0) return;

    const activeEl = container.querySelector(`.lr-transcript-line[data-index="${newIndex}"]`);
    if (!activeEl) return;

    activeEl.classList.add("lr-line-active");

    // Auto-scroll — funciona no painel lateral próprio
    const sidePanel = document.getElementById("lr-side-panel");
    const legendasPanel = document.getElementById("lr-panel-legendas");
    if (sidePanel && sidePanel.style.display !== "none" &&
        legendasPanel && legendasPanel.style.display !== "none") {
        const panelRect = legendasPanel.getBoundingClientRect();
        const elRect = activeEl.getBoundingClientRect();
        const isVisible = elRect.top >= panelRect.top && elRect.bottom <= panelRect.bottom;
        if (!isVisible) activeEl.scrollIntoView({ block: "center", behavior: "smooth" });
    }
}

/* =============== LEGENDAS CUSTOMIZADAS SOBRE O VÍDEO =============== */

let customCaptionTimer = null;
let customCaptionIndex = -1;
let captionsEnabled    = true;

function initCustomCaptions() {
    hideYouTubeCaptions();
    createCustomCaptionBox();

    if (customCaptionTimer) clearInterval(customCaptionTimer);
    customCaptionTimer = setInterval(updateCustomCaption, 200);

    window.addEventListener("resize", repositionCaption);
    document.addEventListener("fullscreenchange", repositionCaption);
}

function repositionCaption() {
    const video = document.querySelector("video");
    const box = document.getElementById("lr-custom-caption");
    if (video && box && box.style.display !== "none") {
        positionCaptionBox(box, video);
    }
}

function hideYouTubeCaptions() {
    if (document.getElementById("lr-hide-captions-style")) return;
    const style = document.createElement("style");
    style.id = "lr-hide-captions-style";
    style.textContent = `.ytp-caption-window-container { display: none !important; }`;
    document.head.appendChild(style);
}

function createCustomCaptionBox() {
    if (document.getElementById("lr-custom-caption")) return;
    const box = document.createElement("div");
    box.id = "lr-custom-caption";
    document.body.appendChild(box);
}

function updateCustomCaption() {
    const video = document.querySelector("video");
    const box = document.getElementById("lr-custom-caption");
    if (!video || !box || captionGroups.length === 0) return;

    const currentTime = video.currentTime;

    let newIndex = -1;
    for (let i = 0; i < captionGroups.length; i++) {
        const g = captionGroups[i];
        if (g.start <= currentTime && currentTime < g.end + 0.3) {
            newIndex = i;
        } else if (g.start > currentTime) {
            break;
        }
    }

    if (newIndex < 0 || !captionsEnabled) {
        box.style.display = "none";
        if (newIndex < 0) customCaptionIndex = -1;
        return;
    }

    positionCaptionBox(box, video);

    if (newIndex === customCaptionIndex) return;
    customCaptionIndex = newIndex;

    const group = captionGroups[newIndex];
    box.style.display = "block";
    box.innerHTML = "";

    group.lines.forEach(lineText => {
        const lineDiv = document.createElement("div");
        lineDiv.className = "lr-caption-line";

        lineText.split(/(\s+)/).forEach(token => {
            if (token.trim() === "") {
                lineDiv.appendChild(document.createTextNode(token));
                return;
            }
            const span = document.createElement("span");
            span.className = "lr-word lr-caption-word";
            span.textContent = token;
            span.dataset.lrWord = normalizeWord(token);
            span.onclick = (event) => cycleWordColor(span, event);

            const state = colorCache.get(normalizeWord(token));
            if (state === "green") span.classList.add("lr-green");
            else if (state === "yellow") span.classList.add("lr-yellow");

            trackWordFrequency(normalizeWord(token));
            lineDiv.appendChild(span);
        });

        box.appendChild(lineDiv);
    });
}

function positionCaptionBox(box, video) {
    const rect = video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const left   = rect.left + (rect.width / 2);
    const bottom = window.innerHeight - rect.bottom + (rect.height * 0.16);

    box.style.left      = left + "px";
    box.style.bottom    = bottom + "px";
    box.style.transform = "translateX(-50%)";
    box.style.maxWidth  = Math.min(860, rect.width * 0.92) + "px";

    const baseFontSize = Math.max(12, Math.min(17, rect.height * 0.042));
    box.style.fontSize = baseFontSize + "px";
}

/* =============== PAINEL LATERAL PRÓPRIO =============== */
/*
 * Cria um painel lateral fixo à direita do player, igual ao Language Reactor.
 * Abre/fecha pelo botão ▼ no player.
 */

function createSidePanel() {
    if (document.getElementById("lr-side-panel")) return;

    const panel = document.createElement("div");
    panel.id = "lr-side-panel";
    panel.innerHTML = `
        <div id="lr-tabs">
            <button class="lr-tab lr-tab-active" data-tab="legendas">Legendas</button>
            <button class="lr-tab" data-tab="salvas">Palavras Salvas</button>
            <button id="lr-side-panel-close" title="Fechar">✕</button>
        </div>
        <div id="lr-panel-legendas" class="lr-panel">
            <div id="lr-transcript-status"></div>
            <div id="lr-text"></div>
        </div>
        <div id="lr-panel-salvas" class="lr-panel" style="display:none;">
            <div id="lr-saved-actions">
                <button id="lr-export-btn" title="Exportar palavras salvas como JSON">⬇ Exportar</button>
                <button id="lr-import-btn" title="Importar palavras salvas de um arquivo JSON">⬆ Importar</button>
                <button id="lr-analytics-btn" title="Abrir página de análise de progresso">📊 Análise</button>
                <input type="file" id="lr-import-file" accept=".json" style="display:none;">
            </div>
            <div id="lr-saved-words"></div>
        </div>
    `;
    document.body.appendChild(panel);

    // Tabs
    panel.querySelectorAll(".lr-tab").forEach(tab => {
        tab.onclick = () => {
            panel.querySelectorAll(".lr-tab").forEach(t => t.classList.remove("lr-tab-active"));
            tab.classList.add("lr-tab-active");
            const target = tab.dataset.tab;
            document.getElementById("lr-panel-legendas").style.display = target === "legendas" ? "block" : "none";
            document.getElementById("lr-panel-salvas").style.display   = target === "salvas"   ? "block" : "none";
            if (target === "salvas") renderSavedWords();
        };
    });

    // Fechar
    panel.querySelector("#lr-side-panel-close").onclick = () => {
        panel.style.display = "none";
        const secondary = document.querySelector("#secondary");
        if (secondary) secondary.style.marginTop = "";
    };

    // Export/Import/Analytics
    panel.querySelector("#lr-export-btn").onclick = exportSavedWords;
    const importFile = panel.querySelector("#lr-import-file");
    panel.querySelector("#lr-import-btn").onclick = () => importFile.click();
    importFile.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => { importSavedWords(ev.target.result); importFile.value = ""; };
        reader.readAsText(file);
    };
    panel.querySelector("#lr-analytics-btn").onclick = () => {
        window.open(chrome.runtime.getURL("analytics.html"), "_blank");
    };

    // Posicionar e reposicionar ao redimensionar ou rolar
    positionSidePanel();
    window.addEventListener("resize", positionSidePanel);
    window.addEventListener("scroll", positionSidePanel, { passive: true });
}

/**
 * Posiciona o painel fixo na coluna direita do YouTube.
 * - Altura = altura do player de vídeo
 * - Top = topo do player (fixo, não desce com scroll)
 * - Left = lado direito do player
 * - Width = largura do #secondary
 */
function positionSidePanel() {
    const panel = document.getElementById("lr-side-panel");
    if (!panel || panel.style.display === "none") return;

    // Usar o player como referência de altura e posição vertical
    const player = document.querySelector("#movie_player, .html5-video-player");
    const secondary = document.querySelector("#secondary");

    if (player && secondary) {
        const playerRect   = player.getBoundingClientRect();
        const secRect      = secondary.getBoundingClientRect();

        // Painel fixo — top baseado no player, não muda ao rolar
        panel.style.position = "fixed";
        panel.style.top      = playerRect.top + "px";
        panel.style.left     = secRect.left + "px";
        panel.style.width    = secRect.width + "px";
        panel.style.height   = (playerRect.height + 20) + "px";  // +20px extra
        panel.style.zIndex   = "2000";

        // Deslocar vídeos relacionados para baixo do painel + 4px de espaço
        secondary.style.marginTop = (playerRect.height + 20 + 4) + "px";
    }
}

function toggleSidePanel() {
    const panel = document.getElementById("lr-side-panel");
    if (!panel) return;
    const isOpen = panel.style.display !== "none";

    if (isOpen) {
        panel.style.display = "none";
        // Restaurar layout do YouTube
        const secondary = document.querySelector("#secondary");
        if (secondary) secondary.style.marginTop = "";
    } else {
        panel.style.display = "flex";
        // Pequeno delay para garantir que o painel está no DOM antes de medir
        requestAnimationFrame(() => positionSidePanel());
    }
}

let playerBtnInjected = false;

function injectPlayerButton() {
    if (playerBtnInjected) return;

    const timeDisplay = document.querySelector(".ytp-time-display");
    if (!timeDisplay) return;

    const btn = document.createElement("button");
    btn.id = "lr-player-btn";
    btn.className = "lr-player-btn-on";
    btn.title = "YouTube Highlighter";

    // Área de toggle ON/OFF
    const captionArea = document.createElement("span");
    captionArea.id = "lr-player-caption-area";
    captionArea.style.cssText = "display:inline-flex;align-items:center;gap:4px;";
    captionArea.innerHTML = `<span class="lr-player-icon">YH</span><span class="lr-player-state">ON</span>`;

    // Chevron — abre o painel nativo "In this video" do YouTube
    const chevron = document.createElement("span");
    chevron.id = "lr-player-chevron";
    chevron.textContent = "▼";
    chevron.title = "Abrir painel de legendas";
    chevron.style.cssText = [
        "display:inline-flex",
        "align-items:center",
        "font-size:9px",
        "padding:0 4px 0 6px",
        "cursor:pointer",
        "opacity:0.7",
        "border-left:1px solid rgba(255,255,255,0.25)",
        "margin-left:4px",
    ].join(";");

    btn.appendChild(captionArea);
    btn.appendChild(chevron);

    // Toggle ON/OFF da legenda
    captionArea.addEventListener("click", (e) => {
        e.stopPropagation();
        captionsEnabled = !captionsEnabled;
        btn.className = captionsEnabled ? "lr-player-btn-on" : "lr-player-btn-off";
        btn.querySelector(".lr-player-state").textContent = captionsEnabled ? "ON" : "OFF";
        const box = document.getElementById("lr-custom-caption");
        if (box) box.style.display = captionsEnabled ? "block" : "none";
        if (!captionsEnabled) customCaptionIndex = -1;
    });

    // Chevron — abre nosso painel lateral
    chevron.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSidePanel();
    });

    btn.addEventListener("click", (e) => e.stopPropagation());

    timeDisplay.insertAdjacentElement("afterend", btn);
    playerBtnInjected = true;
}

// Tentar injetar periodicamente até conseguir
const playerBtnTimer = setInterval(() => {
    if (playerBtnInjected) { clearInterval(playerBtnTimer); return; }
    injectPlayerButton();
}, 800);

/* =============== CAPTION INJECTOR FALLBACK =============== */
/* Usado apenas quando o servidor não está disponível */

function processSegment(segment) {
    if (!segment.isConnected || segment.textContent.trim() === "") return;
    const currentText = segment.textContent;
    if (segment.dataset.lrProcessed === "true" && segment.dataset.lrText !== currentText) {
        delete segment.dataset.lrProcessed;
    }
    if (segment.dataset.lrProcessed === "true") {
        segment.querySelectorAll(".lr-word").forEach(span => {
            const w = span.dataset.lrWord;
            if (!w) return;
            span.classList.remove("lr-green", "lr-yellow");
            const state = colorCache.get(w);
            if (state === "green") span.classList.add("lr-green");
            else if (state === "yellow") span.classList.add("lr-yellow");
        });
        return;
    }
    const tokens = currentText.split(/(\s+)/);
    segment.textContent = "";
    tokens.forEach(token => {
        if (token.trim() === "") {
            segment.appendChild(document.createTextNode(token));
        } else {
            const span = document.createElement("span");
            span.className = "lr-word";
            span.textContent = token;
            span.dataset.lrWord = normalizeWord(token);
            span.onclick = (event) => cycleWordColor(span, event);
            const state = colorCache.get(normalizeWord(token));
            if (state === "green") span.classList.add("lr-green");
            else if (state === "yellow") span.classList.add("lr-yellow");
            trackWordFrequency(normalizeWord(token));
            segment.appendChild(span);
        }
    });
    segment.dataset.lrProcessed = "true";
    segment.dataset.lrText = currentText;
}

function onCaptionMutation(mutations) {
    const toProcess = new Set();
    mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            if (node.matches(".ytp-caption-segment")) toProcess.add(node);
            node.querySelectorAll(".ytp-caption-segment").forEach(s => toProcess.add(s));
        });
    });
    toProcess.forEach(processSegment);
}

function initCaptionInjector() {
    const observerOptions = { childList: true, subtree: true };
    const captionObserver = new MutationObserver(onCaptionMutation);
    const container = document.querySelector(".ytp-caption-window-container");
    if (container) {
        captionObserver.observe(container, observerOptions);
    } else {
        const bodyObserver = new MutationObserver(function (_mutations) {
            const found = document.querySelector(".ytp-caption-window-container");
            if (found) {
                bodyObserver.disconnect();
                captionObserver.observe(found, observerOptions);
            }
        });
        bodyObserver.observe(document.body, observerOptions);
    }
}

/* =============== RECARREGAR AO TROCAR DE VÍDEO (SPA) =============== */

let lastVideoUrl = location.href;

function onVideoNavigate() {
    const currentUrl = location.href;
    if (currentUrl === lastVideoUrl) return;
    lastVideoUrl = currentUrl;
    if (!currentUrl.includes("/watch")) return;

    // Resetar estado
    transcriptLines = [];
    captionGroups = [];
    activeLineIndex = -1;
    transcriptLoaded = false;
    customCaptionIndex = -1;

    if (transcriptSyncTimer) { clearInterval(transcriptSyncTimer); transcriptSyncTimer = null; }
    if (customCaptionTimer)  { clearInterval(customCaptionTimer);  customCaptionTimer  = null; }

    const container = document.getElementById("lr-text");
    if (container) container.innerHTML = "";

    const box = document.getElementById("lr-custom-caption");
    if (box) { box.innerHTML = ""; box.style.display = "none"; }

    // Sempre restaurar legendas nativas do YouTube ao trocar de vídeo
    // Elas serão ocultadas novamente apenas se a transcrição carregar com sucesso
    const hideStyle = document.getElementById("lr-hide-captions-style");
    if (hideStyle) hideStyle.remove();

    loadFullTranscript();
}

setInterval(onVideoNavigate, 1000);

/* =============== INICIALIZAÇÃO =============== */

createSidePanel();
loadFullTranscript();
