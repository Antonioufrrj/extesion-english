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

/**
 * Retorna a data atual no formato "YYYY-MM-DD" — chave do registro diário.
 */
function getTodayKey() {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Salva o snapshot diário de vocabulário (palavras verdes).
 * Chamado uma vez por dia, na primeira vez que a extensão roda naquele dia.
 */
function saveVocabSnapshot() {
    const dayKey = "lr_vocab_" + getTodayKey();
    try {
        chrome.storage.local.get(dayKey, function(result) {
            if (result[dayKey] !== undefined) return; // já salvo hoje
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
            const panel = document.getElementById("lr-panel-salvas");
            if (panel && panel.style.display !== "none") renderSavedWords();
            alert(`Importado!\n${colorCount} cores · ${freqCount} frequências`);
        });
    } catch (e) { alert("Erro ao importar: " + e.message); }
}

/* =============== CRIAR PAINEL =============== */

function createSidebar() {
    if (document.getElementById("lr-sidebar")) return;

    const sidebar = document.createElement("div");
    sidebar.id = "lr-sidebar";
    sidebar.innerHTML = `
        <div id="lr-tabs">
            <button class="lr-tab lr-tab-active" data-tab="legendas">Legendas</button>
            <button class="lr-tab" data-tab="salvas">Palavras Salvas</button>
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
    document.body.appendChild(sidebar);

    sidebar.querySelectorAll(".lr-tab").forEach(tab => {
        tab.onclick = () => {
            sidebar.querySelectorAll(".lr-tab").forEach(t => t.classList.remove("lr-tab-active"));
            tab.classList.add("lr-tab-active");
            const target = tab.dataset.tab;
            document.getElementById("lr-panel-legendas").style.display = target === "legendas" ? "block" : "none";
            document.getElementById("lr-panel-salvas").style.display = target === "salvas" ? "block" : "none";
            if (target === "salvas") renderSavedWords();
        };
    });

    const btn = document.createElement("div");
    btn.id = "lr-toggle-btn";
    btn.textContent = "≡";
    btn.onclick = () => {
        const bar = document.getElementById("lr-sidebar");
        const isOpen = bar.style.display !== "none";
        bar.style.display = isOpen ? "none" : "flex";
        btn.style.right = isOpen ? "8px" : "428px";
    };
    document.body.appendChild(btn);

    sidebar.querySelector("#lr-export-btn").onclick = exportSavedWords;

    const importFile = sidebar.querySelector("#lr-import-file");
    sidebar.querySelector("#lr-import-btn").onclick = () => importFile.click();
    importFile.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => { importSavedWords(ev.target.result); importFile.value = ""; };
        reader.readAsText(file);
    };

    sidebar.querySelector("#lr-analytics-btn").onclick = () => {
        window.open(chrome.runtime.getURL("analytics.html"), "_blank");
    };

    sidebar.style.display = "none";
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

/* =============== TRANSCRIÇÃO COMPLETA — SERVIDOR LOCAL =============== */

let transcriptLines   = [];
let activeLineIndex   = -1;
let transcriptSyncTimer = null;
let transcriptLoaded  = false;

// Grupos de linhas para a legenda do vídeo (linhas próximas agrupadas)
// Cada grupo: { start, end, text, lineIndices[] }
let captionGroups = [];

const TRANSCRIPT_SERVER = "http://localhost:5000";

function getVideoId() {
    const match = location.href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
}

/**
 * Agrupa sempre 2 linhas consecutivas por vez.
 * As duas linhas são exibidas separadas (uma em cima da outra) na legenda.
 */
function buildCaptionGroups() {
    captionGroups = [];
    if (transcriptLines.length === 0) return;

    for (let i = 0; i < transcriptLines.length; i += 2) {
        const a = transcriptLines[i];
        const b = transcriptLines[i + 1];

        if (b) {
            captionGroups.push({
                start: a.start,
                end:   b.start + (b.dur || 2),
                lines: [a.text, b.text],   // duas linhas separadas
                lineIndices: [i, i + 1]
            });
        } else {
            captionGroups.push({
                start: a.start,
                end:   a.start + (a.dur || 2),
                lines: [a.text],
                lineIndices: [i]
            });
        }
    }
}

async function loadFullTranscript() {
    const videoId = getVideoId();
    if (!videoId) return;

    const status = document.getElementById("lr-transcript-status");
    if (status) { status.textContent = "Carregando transcrição..."; status.style.display = "block"; }

    try {
        const response = await fetch(`${TRANSCRIPT_SERVER}/transcript?v=${videoId}&lang=en`);
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || "HTTP " + response.status);
        }

        const data = await response.json();
        transcriptLines = (data?.lines || []).filter(l => l.text && l.text.trim().length > 0);

        if (status) { status.textContent = ""; status.style.display = "none"; }
        if (transcriptLines.length === 0) return;

        transcriptLoaded = true;

        // Renderizar painel lateral com toda a transcrição
        renderTranscript();
        startTranscriptSync();

        // Agrupar linhas próximas para a legenda do vídeo
        buildCaptionGroups();

        // Substituir legendas do vídeo pelas nossas (linha completa de uma vez)
        initCustomCaptions();

    } catch (e) {
        if (status) {
            if (e.message.includes("fetch") || e.message.includes("Failed")) {
                status.textContent = "⚠ Inicie o servidor: python server.py";
                status.style.color = "#e57373";
            } else {
                status.textContent = "";
            }
            status.style.display = "block";
        }
        // Fallback: usar caption injector original do YouTube
        initCaptionInjector();
    }
}

/* =============== PAINEL LATERAL — TRANSCRIÇÃO COMPLETA =============== */

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

    const panel = document.getElementById("lr-panel-legendas");
    if (panel && panel.style.display !== "none") {
        const panelRect = panel.getBoundingClientRect();
        const elRect = activeEl.getBoundingClientRect();
        const isVisible = elRect.top >= panelRect.top && elRect.bottom <= panelRect.bottom;
        if (!isVisible) activeEl.scrollIntoView({ block: "center", behavior: "smooth" });
    }
}

/* =============== LEGENDAS CUSTOMIZADAS SOBRE O VÍDEO =============== */
/*
 * Quando a transcrição do backend está disponível:
 * 1. Esconde as legendas originais do YouTube (.ytp-caption-window-container)
 * 2. Cria nossa própria div de legenda sobre o vídeo
 * 3. Atualiza o texto a cada 200ms baseado no currentTime — linha completa de uma vez
 * 4. Cada palavra é clicável para ciclo de cores
 */

let customCaptionTimer = null;
let customCaptionIndex = -1;

function initCustomCaptions() {
    // Esconder legendas originais do YouTube
    hideYouTubeCaptions();

    // Criar nossa div de legenda customizada
    createCustomCaptionBox();

    // Iniciar loop de atualização
    if (customCaptionTimer) clearInterval(customCaptionTimer);
    customCaptionTimer = setInterval(updateCustomCaption, 200);

    // Reposicionar ao redimensionar janela ou entrar/sair de tela cheia
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
    // Injetar CSS para esconder o container de legendas do YouTube
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

    // Encontrar grupo ativo
    let newIndex = -1;
    for (let i = 0; i < captionGroups.length; i++) {
        const g = captionGroups[i];
        if (g.start <= currentTime && currentTime < g.end + 0.3) {
            newIndex = i;
        } else if (g.start > currentTime) {
            break;
        }
    }

    // Sem legenda ativa — esconder box
    if (newIndex < 0) {
        box.style.display = "none";
        customCaptionIndex = -1;
        return;
    }

    // Posicionar dentro do player
    positionCaptionBox(box, video);

    // Mesmo grupo — não re-renderizar, só reposicionar
    if (newIndex === customCaptionIndex) return;
    customCaptionIndex = newIndex;

    const group = captionGroups[newIndex];
    box.style.display = "block";
    box.innerHTML = "";

    // Renderizar cada linha em seu próprio div (duas linhas separadas)
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

/**
 * Posiciona a caixa de legenda dentro do player de vídeo.
 * Funciona tanto em tela normal quanto em tela cheia.
 * Âncora: 12% acima da borda inferior do vídeo, centralizado horizontalmente.
 */
function positionCaptionBox(box, video) {
    const rect = video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Centralizar horizontalmente dentro do player
    const left = rect.left + (rect.width / 2);

    // Posicionar a 15% acima da borda inferior do player (acima da barra de progresso)
    const bottom = window.innerHeight - rect.bottom + (rect.height * 0.15);

    box.style.left       = left + "px";
    box.style.bottom     = bottom + "px";
    box.style.transform  = "translateX(-50%)";
    box.style.maxWidth   = Math.min(860, rect.width * 0.92) + "px";

    // Fonte menor: entre 12px e 17px proporcional ao player
    const baseFontSize = Math.max(12, Math.min(17, rect.height * 0.042));
    box.style.fontSize = baseFontSize + "px";
}

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

    // Restaurar legendas do YouTube enquanto carrega
    const hideStyle = document.getElementById("lr-hide-captions-style");
    if (hideStyle) hideStyle.remove();

    loadFullTranscript();
}

setInterval(onVideoNavigate, 1000);

/* =============== INICIALIZAÇÃO =============== */

createSidebar();
loadFullTranscript();
