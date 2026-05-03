/* =============== COLOR_STORE (chrome.storage.local) =============== */

// Cache em memória para aplicação síncrona imediata
const colorCache = new Map();

// Cache de frequência em memória
const freqCache = new Map();

// Carregar todo o Color_Store e freqCache no cache ao iniciar
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
    } catch (e) {
        // continuar sem persistência
    }
}

function getWordColor(word, callback) {
    const w = word.toLowerCase();
    // Retornar do cache síncrono primeiro
    if (colorCache.has(w)) {
        callback(colorCache.get(w));
        return;
    }
    const key = "lr_color_" + w;
    try {
        chrome.storage.local.get(key, function (result) {
            const state = result[key] || null;
            if (state) colorCache.set(w, state);
            callback(state);
        });
    } catch (e) {
        callback(null);
    }
}

/* =============== NORMALIZAÇÃO DE PALAVRAS =============== */

// Remove pontuação das bordas: "here." → "here", "'word'" → "word"
function normalizeWord(token) {
    return token
        .toLowerCase()
        .replace(/^[^a-záàâãéèêíïóôõöúüçñ\w]+/i, "")  // pontuação no início
        .replace(/[^a-záàâãéèêíïóôõöúüçñ\w]+$/i, "");  // pontuação no fim
}


/* =============== FREQ STORE =============== */

// Fila de palavras para escrita em lote (evita muitas escritas simultâneas)
let freqWriteTimer = null;
const freqPendingWrite = new Map();

function trackWordFrequency(word) {
    const w = word.toLowerCase();
    // Ignorar palavras muito curtas, pontuação ou marcadas em verde
    if (w.length < 2 || /^[^a-záàâãéèêíïóôõöúüçñ]+$/i.test(w)) return;
    if (colorCache.get(w) === "green") return;

    const current = freqCache.get(w) || 0;
    freqCache.set(w, current + 1);
    freqPendingWrite.set(w, freqCache.get(w));

    // Escrever em lote após 2s de inatividade
    clearTimeout(freqWriteTimer);
    freqWriteTimer = setTimeout(() => {
        const batch = {};
        freqPendingWrite.forEach((count, word) => {
            batch["lr_freq_" + word] = count;
        });
        freqPendingWrite.clear();
        try { chrome.storage.local.set(batch); } catch (e) {}
    }, 2000);
}


/* =============== MÉTRICAS =============== */

/**
 * Retorna a chave da semana atual no formato "YYYY-WNN"
 * ex: "2026-W18"
 */
function getCurrentWeekKey() {
    const now = new Date();
    const year = now.getFullYear();
    // Calcular número da semana ISO
    const startOfYear = new Date(year, 0, 1);
    const dayOfYear = Math.floor((now - startOfYear) / 86400000) + 1;
    const week = Math.ceil(dayOfYear / 7);
    return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * Retorna a data de início da semana atual no formato "YYYY-MM-DD"
 */
function getCurrentWeekDate() {
    const now = new Date();
    const day = now.getDay(); // 0=dom, 1=seg...
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // ajustar para segunda-feira
    const monday = new Date(now.setDate(diff));
    return monday.toISOString().slice(0, 10);
}

/**
 * Salva o snapshot semanal de vocabulário (palavras verdes).
 * Chamado uma vez por semana, na primeira vez que a extensão roda naquela semana.
 */
function saveVocabSnapshot() {
    const weekKey = "lr_vocab_" + getCurrentWeekKey();
    try {
        chrome.storage.local.get(weekKey, function(result) {
            if (result[weekKey] !== undefined) return; // já salvo esta semana
            const knownCount = [...colorCache.values()].filter(v => v === "green").length;
            const entry = { date: getCurrentWeekDate(), known: knownCount };
            chrome.storage.local.set({ [weekKey]: entry });
        });
    } catch (e) {}
}

// ── Tempo de exposição ──────────────────────────────────────────────────────

let exposureTimer = null;
let exposureAccumMs = 0;   // ms acumulados nesta sessão ainda não salvos
let lastTickTime = null;   // timestamp do último tick

/**
 * Detecta se o vídeo atual é em inglês lendo os metadados do ytInitialPlayerResponse.
 * Verifica o idioma do áudio principal (audioTracks) e das legendas disponíveis.
 * Retorna true apenas se o idioma do vídeo for inglês.
 */
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

                // 1. Verificar audioTracks (idioma do áudio principal)
                const audioTracks = data?.streamingData?.adaptiveFormats;
                if (audioTracks) {
                    for (const fmt of audioTracks) {
                        const lang = (fmt?.audioTrack?.id || "").toLowerCase();
                        if (lang.startsWith("en")) return true;
                    }
                }

                // 2. Verificar captionTracks (legendas disponíveis)
                const captionTracks = data?.captions
                    ?.playerCaptionsTracklistRenderer
                    ?.captionTracks;
                if (captionTracks && captionTracks.length > 0) {
                    // Se há legendas em inglês disponíveis, o vídeo é em inglês
                    const hasEnglish = captionTracks.some(t =>
                        (t.languageCode || "").toLowerCase().startsWith("en")
                    );
                    if (hasEnglish) return true;

                    // Se há legendas mas nenhuma em inglês, não é vídeo em inglês
                    return false;
                }

                // 3. Verificar o idioma declarado no playerMicroformat
                const videoLang = (data?.microformat
                    ?.playerMicroformatRenderer
                    ?.defaultAudioLanguage || "").toLowerCase();
                if (videoLang) return videoLang.startsWith("en");

            } catch (e) {
                continue;
            }
        }
    } catch (e) {}

    // Sem dados suficientes para determinar — não contar
    return false;
}

/**
 * Verifica se o vídeo está rodando (não pausado, não buffering, aba ativa).
 */
function isVideoPlaying() {
    if (document.hidden) return false; // aba inativa
    const video = document.querySelector("video");
    if (!video) return false;
    return !video.paused && !video.ended && video.readyState >= 2;
}

/**
 * Tick do timer de exposição — chamado a cada segundo.
 * Acumula tempo e salva em lote a cada 30s.
 */
function exposureTick() {
    if (!isVideoPlaying() || !isEnglishVideo()) {
        lastTickTime = null;
        return;
    }

    const now = Date.now();
    if (lastTickTime !== null) {
        const delta = now - lastTickTime;
        // Ignorar deltas muito grandes (ex: computador dormiu)
        if (delta < 5000) exposureAccumMs += delta;
    }
    lastTickTime = now;

    // Salvar a cada 30s acumulados
    if (exposureAccumMs >= 30000) {
        flushExposure();
    }
}

/**
 * Persiste o tempo acumulado no storage.
 */
function flushExposure() {
    if (exposureAccumMs <= 0) return;
    const weekKey = "lr_exposure_" + getCurrentWeekKey();
    const secondsToAdd = Math.floor(exposureAccumMs / 1000);
    exposureAccumMs = exposureAccumMs % 1000;

    try {
        chrome.storage.local.get(weekKey, function(result) {
            const current = result[weekKey] || { date: getCurrentWeekDate(), seconds: 0 };
            current.seconds = (current.seconds || 0) + secondsToAdd;
            chrome.storage.local.set({ [weekKey]: current });
        });
    } catch (e) {}
}

/**
 * Inicia o timer de exposição.
 */
function startExposureTracking() {
    if (exposureTimer) return;
    exposureTimer = setInterval(exposureTick, 1000);

    // Salvar ao fechar/navegar
    window.addEventListener("beforeunload", flushExposure);
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            lastTickTime = null;
            flushExposure();
        }
    });
}

// Iniciar tracking e snapshot semanal
startExposureTracking();
saveVocabSnapshot();


/* =============== EXPORTAR / IMPORTAR =============== */

/**
 * Exporta todas as palavras com cor e frequência para um arquivo JSON.
 */
function exportSavedWords() {
    try {
        chrome.storage.local.get(null, function(items) {
            const data = { colors: {}, frequencies: {}, vocab_history: {}, exposure_history: {} };

            Object.keys(items).forEach(key => {
                if (key.startsWith("lr_color_")) {
                    data.colors[key.replace("lr_color_", "")] = items[key];
                } else if (key.startsWith("lr_freq_")) {
                    data.frequencies[key.replace("lr_freq_", "")] = items[key];
                } else if (key.startsWith("lr_vocab_")) {
                    data.vocab_history[key.replace("lr_vocab_", "")] = items[key];
                } else if (key.startsWith("lr_exposure_")) {
                    data.exposure_history[key.replace("lr_exposure_", "")] = items[key];
                }
            });

            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.download = "youtube-highlighter-words.json";
            a.click();
            URL.revokeObjectURL(url);
        });
    } catch (e) {
        alert("Erro ao exportar: " + e.message);
    }
}

/**
 * Importa palavras de um JSON exportado anteriormente.
 * Mescla com os dados existentes (não apaga palavras já salvas).
 * @param {string} jsonText - conteúdo do arquivo JSON
 */
function importSavedWords(jsonText) {
    try {
        const data = JSON.parse(jsonText);

        if (!data.colors && !data.frequencies) {
            alert("Arquivo inválido: formato não reconhecido.");
            return;
        }

        const batch = {};
        let colorCount = 0;
        let freqCount = 0;

        if (data.colors) {
            Object.entries(data.colors).forEach(([word, state]) => {
                if (state === "green" || state === "yellow") {
                    const w = word.toLowerCase();
                    batch["lr_color_" + w] = state;
                    colorCache.set(w, state);
                    colorCount++;
                }
            });
        }

        if (data.frequencies) {
            Object.entries(data.frequencies).forEach(([word, count]) => {
                if (typeof count === "number" && count > 0) {
                    const w = word.toLowerCase();
                    const existing = freqCache.get(w) || 0;
                    const merged = Math.max(existing, count);
                    batch["lr_freq_" + w] = merged;
                    freqCache.set(w, merged);
                    freqCount++;
                }
            });
        }

        chrome.storage.local.set(batch, function() {
            // Re-renderizar a aba de palavras salvas se estiver visível
            const panel = document.getElementById("lr-panel-salvas");
            if (panel && panel.style.display !== "none") {
                renderSavedWords();
            }
            alert(`Importado com sucesso!\n${colorCount} cores · ${freqCount} frequências`);
        });

    } catch (e) {
        alert("Erro ao importar: " + e.message);
    }
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

    // Lógica das abas
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

    // Exportar palavras salvas
    sidebar.querySelector("#lr-export-btn").onclick = exportSavedWords;

    // Importar palavras salvas
    const importFile = sidebar.querySelector("#lr-import-file");
    sidebar.querySelector("#lr-import-btn").onclick = () => importFile.click();
    importFile.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            importSavedWords(ev.target.result);
            importFile.value = ""; // reset para permitir reimportar o mesmo arquivo
        };
        reader.readAsText(file);
    };

    // Abrir página de análise
    sidebar.querySelector("#lr-analytics-btn").onclick = () => {
        const url = chrome.runtime.getURL("analytics.html");
        window.open(url, "_blank");
    };

    // Painel fechado por padrão
    sidebar.style.display = "none";
}

function renderSavedWords() {
    const container = document.getElementById("lr-saved-words");
    if (!container) return;

    // Pegar top 20 do freqCache (excluindo palavras verdes)
    const entries = [];
    freqCache.forEach((count, word) => {
        if (colorCache.get(word) !== "green") {
            entries.push({ word, count });
        }
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

        // Aplicar cor atual
        const colorState = colorCache.get(word);
        if (colorState === "green") span.classList.add("lr-green");
        else if (colorState === "yellow") span.classList.add("lr-yellow");

        span.onclick = (event) => {
            cycleWordColor(span, event);
            // Atualizar visual do badge sem re-renderizar tudo
            span.classList.remove("lr-green", "lr-yellow");
            const newState = colorCache.get(word);
            if (newState === "green") span.classList.add("lr-green");
            else if (newState === "yellow") span.classList.add("lr-yellow");
        };

        const label = document.createTextNode(word);
        span.appendChild(label);

        const badge = document.createElement("sup");
        badge.className = "lr-freq-badge";
        badge.textContent = count;
        span.appendChild(badge);

        container.appendChild(span);
    });
}

createSidebar();
initCaptionInjector();


/* =============== GERAR TEXTO COMPLETO + DIVIDIR EM PALAVRAS =============== */

let lastDump = "";

function updateSidebar() {
    const segments = document.querySelectorAll(".ytp-caption-segment");
    let text = "";

    segments.forEach(seg => text += seg.textContent + " ");

    if (text.trim() === "" || text === lastDump) return;

    lastDump = text;

    const container = document.getElementById("lr-text");
    container.innerHTML = ""; // limpar

    const words = text.split(/(\s+)/); // mantém espaços

    words.forEach(w => {
        if (w.trim() === "") {
            container.appendChild(document.createTextNode(w));
            return;
        }

        const span = document.createElement("span");
        span.className = "lr-word";
        span.textContent = w;
        span.dataset.lrWord = normalizeWord(w);

        span.onclick = (event) => cycleWordColor(span, event);

        // Restaurar estado do cache síncrono
        const cachedState = colorCache.get(normalizeWord(w));
        if (cachedState === "green") span.classList.add("lr-green");
        else if (cachedState === "yellow") span.classList.add("lr-yellow");

        container.appendChild(span);
    });
}


/* =============== CICLO DE CORES =============== */

function cycleWordColor(el, event) {
    event.stopPropagation();

    let newState = null;
    if (el.classList.contains("lr-green")) {
        newState = "yellow";
    } else if (el.classList.contains("lr-yellow")) {
        newState = null;
    } else {
        newState = "green";
    }

    const word = el.dataset.lrWord;
    setWordColor(word, newState);

    // Atualizar todos os spans com a mesma palavra visíveis no DOM
    document.querySelectorAll(`.lr-word[data-lr-word="${CSS.escape(word)}"]`).forEach(span => {
        span.classList.remove("lr-green", "lr-yellow");
        if (newState === "green") span.classList.add("lr-green");
        else if (newState === "yellow") span.classList.add("lr-yellow");
    });
}


/* =============== CAPTION INJECTOR =============== */

function processSegment(segment) {
    // Ignorar se vazio ou desconectado do DOM
    if (!segment.isConnected || segment.textContent.trim() === "") return;

    const currentText = segment.textContent;

    // Se o texto mudou desde o último processamento, resetar a flag
    if (segment.dataset.lrProcessed === "true" && segment.dataset.lrText !== currentText) {
        delete segment.dataset.lrProcessed;
    }

    // Se já foi processado com o mesmo texto, apenas re-aplicar cores
    if (segment.dataset.lrProcessed === "true") {
        segment.querySelectorAll(".lr-word").forEach(span => {
            const w = span.dataset.lrWord; // já normalizado
            if (!w) return;
            span.classList.remove("lr-green", "lr-yellow");
            const state = colorCache.get(w);
            if (state === "green") span.classList.add("lr-green");
            else if (state === "yellow") span.classList.add("lr-yellow");
        });
        return;
    }

    const tokens = currentText.split(/(\s+)/);

    // Limpar conteúdo original
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

            // Aplicar cor do cache imediatamente (síncrono)
            const state = colorCache.get(normalizeWord(token));
            if (state === "green") span.classList.add("lr-green");
            else if (state === "yellow") span.classList.add("lr-yellow");

            // Contar frequência da palavra
            trackWordFrequency(normalizeWord(token));

            segment.appendChild(span);
        }
    });

    segment.dataset.lrProcessed = "true";
    segment.dataset.lrText = currentText;
}


/* =============== OBSERVER PARA ATUALIZAR =============== */

setInterval(updateSidebar, 800);


/* =============== CAPTION INJECTOR — OBSERVER =============== */

function onCaptionMutation(mutations) {
    const toProcess = new Set();

    mutations.forEach(mutation => {
        // Apenas nós adicionados — sem characterData para evitar loop
        mutation.addedNodes.forEach(node => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            if (node.matches(".ytp-caption-segment")) {
                toProcess.add(node);
            }
            node.querySelectorAll(".ytp-caption-segment").forEach(s => toProcess.add(s));
        });
    });

    toProcess.forEach(processSegment);
}

function initCaptionInjector() {
    // Apenas childList + subtree — sem characterData para evitar loop infinito
    const observerOptions = { childList: true, subtree: true };
    const captionObserver = new MutationObserver(onCaptionMutation);

    const container = document.querySelector(".ytp-caption-window-container");
    if (container) {
        captionObserver.observe(container, observerOptions);
    } else {
        // Container ainda não existe: aguardar via observer secundário no body
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

