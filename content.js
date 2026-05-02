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


/* =============== CAPTION PARSER / PRINTER =============== */

/**
 * Parseia conteúdo XML no formato srv3 em CaptionBlocks.
 * O YouTube retorna atributos `start` e `dur` em SEGUNDOS (float).
 * Converte para milissegundos multiplicando por 1000.
 * Decodifica entidades HTML (&amp; &lt; &gt; &#39; etc.) do textContent.
 * @param {string} xmlContent
 * @returns {Array<{start:number, dur:number, text:string}>} ordenado por start; [] se malformado
 */
function parseSrv3(xmlContent) {
    try {
        const doc = new DOMParser().parseFromString(xmlContent, "text/xml");
        if (doc.querySelector("parsererror")) return [];
        const elements = doc.querySelectorAll("text");
        const blocks = [];
        elements.forEach(el => {
            const start = parseFloat(el.getAttribute("start")) * 1000;
            const dur = parseFloat(el.getAttribute("dur") || "0") * 1000;
            const text = el.textContent; // DOMParser já decodifica entidades HTML
            if (text.trim() !== "") {
                blocks.push({ start, dur, text });
            }
        });
        blocks.sort((a, b) => a.start - b.start);
        return blocks;
    } catch (e) {
        return [];
    }
}

/**
 * Parseia conteúdo WebVTT em CaptionBlocks.
 * Formato de timing: HH:MM:SS.mmm --> HH:MM:SS.mmm (ou MM:SS.mmm --> MM:SS.mmm)
 * @param {string} vttContent
 * @returns {Array<{start:number, dur:number, text:string}>} ordenado por start; [] se malformado
 */
function parseVtt(vttContent) {
    try {
        if (!vttContent.trimStart().startsWith("WEBVTT")) return [];

        /**
         * Converte string de tempo VTT para milissegundos.
         * Aceita HH:MM:SS.mmm ou MM:SS.mmm
         * @param {string} timeStr
         * @returns {number}
         */
        function vttTimeToMs(timeStr) {
            const parts = timeStr.split(":");
            let hours = 0, minutes = 0, seconds = 0;
            if (parts.length === 3) {
                hours = parseInt(parts[0], 10);
                minutes = parseInt(parts[1], 10);
                seconds = parseFloat(parts[2].replace(",", "."));
            } else {
                minutes = parseInt(parts[0], 10);
                seconds = parseFloat(parts[1].replace(",", "."));
            }
            return (hours * 3600 + minutes * 60 + seconds) * 1000;
        }

        const cueBlocks = vttContent.split(/\n\n+/);
        const blocks = [];
        const timingRegex = /(\d{1,2}:\d{2}[:.]\d{3})\s*-->\s*(\d{1,2}:\d{2}[:.]\d{3})/;

        cueBlocks.forEach(cue => {
            const lines = cue.split("\n");
            let timingLineIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                if (timingRegex.test(lines[i])) {
                    timingLineIndex = i;
                    break;
                }
            }
            if (timingLineIndex === -1) return;

            const match = lines[timingLineIndex].match(timingRegex);
            const start = vttTimeToMs(match[1]);
            const end = vttTimeToMs(match[2]);
            const dur = end - start;

            const textLines = lines.slice(timingLineIndex + 1);
            const text = textLines.join(" ").trim();

            if (text !== "") {
                blocks.push({ start, dur, text });
            }
        });

        blocks.sort((a, b) => a.start - b.start);
        return blocks;
    } catch (e) {
        return [];
    }
}

/**
 * Dispatcher: detecta o formato e delega ao parser correto.
 * Captura exceções e retorna [] sem lançar.
 * @param {string} content
 * @param {"srv3"|"vtt"} format
 * @returns {Array<{start:number, dur:number, text:string}>}
 */
function parseTranscript(content, format) {
    try {
        if (format === "srv3") return parseSrv3(content);
        if (format === "vtt") return parseVtt(content);
        return [];
    } catch (e) {
        return [];
    }
}

/**
 * Serializa CaptionBlocks para formato srv3 (XML).
 * Converte ms de volta para segundos (2 casas decimais).
 * Escapa entidades HTML no texto: & < > ' "
 * @param {Array<{start:number, dur:number, text:string}>} blocks
 * @returns {string}
 */
function printSrv3(blocks) {
    function escapeXml(str) {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    const elements = blocks.map(block => {
        const start = (block.start / 1000).toFixed(2);
        const dur = (block.dur / 1000).toFixed(2);
        const text = escapeXml(block.text);
        return `<text start="${start}" dur="${dur}">${text}</text>`;
    });

    return `<?xml version="1.0" encoding="utf-8" ?><transcript>${elements.join("")}</transcript>`;
}

/**
 * Serializa CaptionBlocks para formato WebVTT.
 * @param {Array<{start:number, dur:number, text:string}>} blocks
 * @returns {string}
 */
function printVtt(blocks) {
    /**
     * Converte milissegundos para string de tempo VTT: HH:MM:SS.mmm
     * @param {number} ms
     * @returns {string}
     */
    function msToVttTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const milliseconds = Math.round(ms % 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const hh = String(hours).padStart(2, "0");
        const mm = String(minutes).padStart(2, "0");
        const ss = String(seconds).padStart(2, "0");
        const mmm = String(milliseconds).padStart(3, "0");
        return `${hh}:${mm}:${ss}.${mmm}`;
    }

    const cues = blocks.map((block, index) => {
        const start = msToVttTime(block.start);
        const end = msToVttTime(block.start + block.dur);
        return `${index + 1}\n${start} --> ${end}\n${block.text}`;
    });

    return `WEBVTT\n\n${cues.join("\n\n")}\n\n`;
}


/* =============== TRANSCRIPT FETCHER =============== */

// Estado do Transcript_Fetcher
let transcriptBlocks = [];       // CaptionBlock[] carregados para o vídeo atual
let transcriptVideoId = null;    // videoId do vídeo atual
let autoScrollerTimer = null;    // ID do setInterval do Auto_Scroller

/**
 * Extrai dados necessários para a API Innertube lendo os <script> tags do DOM.
 * Usa múltiplas estratégias para encontrar o params de transcrição.
 */
function extractInnertubeData() {
    const scripts = Array.from(document.querySelectorAll("script"))
        .map(s => s.textContent)
        .filter(Boolean);

    let apiKey = null;
    let visitorData = null;
    let params = null;

    for (const text of scripts) {
        if (!apiKey) {
            const m = text.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
            if (m) apiKey = m[1];
        }
        if (!visitorData) {
            const m = text.match(/"visitorData"\s*:\s*"([^"]+)"/);
            if (m) visitorData = m[1];
        }
    }

    console.log("[LR] apiKey:", apiKey ? "found" : "NOT FOUND");
    console.log("[LR] visitorData:", visitorData ? "found" : "NOT FOUND");

    // Estratégia 1: getTranscriptEndpoint direto
    for (const text of scripts) {
        if (!text.includes("getTranscriptEndpoint")) continue;
        const m = text.match(/"getTranscriptEndpoint"\s*:\s*\{"params"\s*:\s*"([^"]+)"/);
        if (m) { params = m[1]; console.log("[LR] params via getTranscriptEndpoint"); break; }
    }

    // Estratégia 2: engagementPanel com transcriptSearchPanel
    if (!params) {
        for (const text of scripts) {
            if (!text.includes("transcriptSearchPanel")) continue;
            // Buscar params antes de transcriptSearchPanel
            const idx = text.indexOf("transcriptSearchPanel");
            const chunk = text.slice(Math.max(0, idx - 500), idx);
            const m = chunk.match(/"params"\s*:\s*"([^"]+)"\s*\}\s*$/);
            if (m) { params = m[1]; console.log("[LR] params via engagementPanel chunk"); break; }
        }
    }

    // Estratégia 3: serializedShareEntity no ytInitialData
    if (!params) {
        for (const text of scripts) {
            if (!text.includes("ytInitialData")) continue;
            const m = text.match(/ytInitialData\s*=\s*(\{.+?\});\s*(?:var|const|let|<\/script>)/s);
            if (!m) continue;
            try {
                const data = JSON.parse(m[1]);
                const panels = data?.engagementPanels || [];
                for (const panel of panels) {
                    const renderer = panel?.engagementPanelSectionListRenderer;
                    const content = renderer?.content?.transcriptRenderer ||
                                    renderer?.content?.transcriptSearchPanelRenderer;
                    if (content) {
                        // Procurar params em qualquer lugar dentro do panel
                        const panelStr = JSON.stringify(panel);
                        const pm = panelStr.match(/"params"\s*:\s*"([^"]{20,})"/);
                        if (pm) { params = pm[1]; console.log("[LR] params via ytInitialData JSON parse"); break; }
                    }
                }
            } catch(e) { /* continuar */ }
            if (params) break;
        }
    }

    // Estratégia 4: qualquer params longo próximo de "transcript"
    if (!params) {
        for (const text of scripts) {
            if (!text.includes("transcript")) continue;
            // Procurar padrão: "params":"XXXXX" onde X é base64 longo (>30 chars)
            const matches = [...text.matchAll(/"params"\s*:\s*"([A-Za-z0-9+/=%]{30,})"/g)];
            for (const m of matches) {
                // Verificar se está próximo da palavra "transcript"
                const idx = text.indexOf(m[0]);
                const context = text.slice(Math.max(0, idx - 200), idx + 200);
                if (context.toLowerCase().includes("transcript")) {
                    params = m[1];
                    console.log("[LR] params via strategy 4 (context search)");
                    break;
                }
            }
            if (params) break;
        }
    }

    console.log("[LR] params:", params ? params.slice(0, 30) + "..." : "NOT FOUND");

    if (!apiKey || !visitorData) return null;
    return { apiKey, visitorData, params };
}

/**
 * Busca a transcrição via API Innertube (/youtubei/v1/get_transcript).
 * Não requer &pot — funciona diretamente do contexto da extensão.
 *
 * @returns {Promise<Array<{start:number, dur:number, text:string}>>}
 */
async function fetchTranscriptInnertube() {
    const data = extractInnertubeData();
    if (!data) {
        throw new Error("NO_TRACKS");
    }

    const { apiKey, visitorData, params } = data;

    // Se não encontrou params, tentar construir a partir do videoId
    // O params é um protobuf base64 que encoda o videoId
    let transcriptParams = params;
    if (!transcriptParams) {
        const videoId = new URLSearchParams(location.search).get("v");
        if (!videoId) throw new Error("NO_TRACKS");
        // Construir params manualmente: protobuf com videoId
        // Campo 1 (varint): 1, Campo 2 (string): videoId
        // Encoding: \n + length + videoId em bytes
        const enc = new TextEncoder();
        const vidBytes = enc.encode(videoId);
        const inner = new Uint8Array([0x0a, vidBytes.length, ...vidBytes]);
        const outer = new Uint8Array([0x0a, inner.length, ...inner]);
        transcriptParams = btoa(String.fromCharCode(...outer));
        console.log("[LR] params construído manualmente para videoId:", videoId);
    }

    // Gerar SAPISIDHASH para autenticação
    // O YouTube exige Authorization: SAPISIDHASH timestamp_HASH
    async function getSapisidHash() {
        try {
            const cookies = document.cookie.split(";").map(c => c.trim());
            // Preferir __Secure-3PAPISID, fallback para SAPISID
            const sapisidCookie =
                cookies.find(c => c.startsWith("__Secure-3PAPISID=")) ||
                cookies.find(c => c.startsWith("SAPISID="));
            if (!sapisidCookie) return null;
            const sapisidValue = sapisidCookie.split("=").slice(1).join("=");
            const origin = "https://www.youtube.com";
            const timestamp = Math.floor(Date.now() / 1000);
            const toHash = `${timestamp} ${sapisidValue} ${origin}`;
            const msgBuffer = new TextEncoder().encode(toHash);
            const hashBuffer = await crypto.subtle.digest("SHA-1", msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
            return `SAPISIDHASH ${timestamp}_${hashHex}`;
        } catch (e) {
            console.log("[LR] getSapisidHash erro:", e.message);
            return null;
        }
    }

    const authHeader = await getSapisidHash();
    console.log("[LR] authHeader:", authHeader ? "generated" : "not available");

    const url = `https://www.youtube.com/youtubei/v1/get_transcript`;
    const body = {
        context: {
            client: {
                clientName: "WEB",
                clientVersion: "2.20240101",
                hl: "en",
                gl: "US",
                visitorData: visitorData
            }
        },
        params: transcriptParams
    };

    console.log("[LR] POST get_transcript, params:", transcriptParams.slice(0, 30) + "...");

    const headers = {
        "Content-Type": "application/json",
        "X-YouTube-Client-Name": "1",
        "X-YouTube-Client-Version": "2.20240101",
        "X-Goog-Visitor-Id": visitorData,
        "X-Origin": "https://www.youtube.com"
    };
    if (authHeader) headers["Authorization"] = authHeader;

    const response = await fetch(url, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(body)
    });

    console.log("[LR] get_transcript status:", response.status);

    if (!response.ok) {
        throw new Error("FETCH_FAILED: status " + response.status);
    }

    const json = await response.json();
    console.log("[LR] get_transcript response keys:", Object.keys(json));

    // Navegar pela estrutura da resposta Innertube
    const actions = json?.actions;
    if (!actions) {
        console.log("[LR] sem actions na resposta:", JSON.stringify(json).slice(0, 200));
        throw new Error("NO_TRACKS");
    }

    let segments = null;
    for (const action of actions) {
        const body = action?.updateEngagementPanelAction?.content
            ?.transcriptRenderer?.body
            ?.transcriptBodyRenderer?.cueGroups;
        if (body) { segments = body; break; }
    }

    if (!segments || segments.length === 0) {
        console.log("[LR] sem cueGroups, actions:", JSON.stringify(actions).slice(0, 300));
        throw new Error("NO_TRACKS");
    }

    console.log("[LR] cueGroups encontrados:", segments.length);

    // Converter cueGroups em CaptionBlocks
    const blocks = [];
    for (const group of segments) {
        const cues = group?.transcriptCueGroupRenderer?.cues;
        if (!cues) continue;
        for (const cue of cues) {
            const r = cue?.transcriptCueRenderer;
            if (!r) continue;
            const startMs = parseInt(r.startOffsetMs || "0", 10);
            const durMs   = parseInt(r.durationMs   || "0", 10);
            const text    = r.cue?.simpleText || "";
            if (text.trim()) blocks.push({ start: startMs, dur: durMs, text });
        }
    }

    blocks.sort((a, b) => a.start - b.start);
    return blocks;
}

/**
 * Ponto de entrada: busca a transcrição e renderiza no painel.
 * Usa a API Innertube que não requer o parâmetro &pot.
 * @returns {Promise<void>}
 */
async function loadTranscript() {
    try {
        showTranscriptLoading();

        let blocks;
        try {
            blocks = await fetchTranscriptInnertube();
        } catch (e) {
            if (e.message === "NO_TRACKS") {
                showTranscriptMessage("Este vídeo não possui legendas disponíveis.");
            } else if (e.message === "TIMEOUT") {
                showTranscriptMessage("Legendas não disponíveis para este vídeo.");
            } else {
                showTranscriptMessage("Erro ao carregar a transcrição: " + e.message);
            }
            return;
        }

        if (!blocks || blocks.length === 0) {
            showTranscriptMessage("Não foi possível interpretar o arquivo de legendas.");
            return;
        }

        transcriptBlocks = blocks;
        renderTranscript(transcriptBlocks);
        startAutoScroller();
    } catch (err) {
        showTranscriptMessage("Erro inesperado: " + err.message);
    }
}


/* =============== TRANSCRIPT PANEL =============== */

/**
 * Formata um timestamp em ms para exibição.
 * @param {number} ms - timestamp em milissegundos
 * @returns {string} "MM:SS" se ms < 3_600_000, "HH:MM:SS" caso contrário
 */
function formatTimestamp(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (ms < 3_600_000) {
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    } else {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
}

/**
 * Exibe o indicador de loading no Transcript_Panel.
 */
function showTranscriptLoading() {
    const container = document.getElementById("lr-transcript");
    if (!container) return;
    container.innerHTML = '<p style="color:#888;font-size:14px;">Carregando transcrição…</p>';
}

/**
 * Exibe uma mensagem de erro/informação no Transcript_Panel.
 * @param {string} message - texto a exibir
 */
function showTranscriptMessage(message) {
    const container = document.getElementById("lr-transcript");
    if (!container) return;
    container.innerHTML = '';
    const p = document.createElement("p");
    p.style.cssText = "color:#888;font-size:14px;";
    p.textContent = message;
    container.appendChild(p);
}

/**
 * Renderiza a lista de CaptionBlocks no painel #lr-transcript.
 * Cria Transcript_Words clicáveis e restaura estado do Color_Store.
 * @param {Array<{start:number, dur:number, text:string}>} blocks
 */
function renderTranscript(blocks) {
    const container = document.getElementById("lr-transcript");
    if (!container) return;
    container.innerHTML = "";

    blocks.forEach((block, i) => {
        // Elemento do bloco
        const blockEl = document.createElement("div");
        blockEl.className = "lr-block";
        blockEl.dataset.lrIndex = String(i);

        // Timestamp
        const tsEl = document.createElement("span");
        tsEl.className = "lr-timestamp";
        tsEl.textContent = formatTimestamp(block.start);

        // Parágrafo de texto com palavras clicáveis
        const textEl = document.createElement("p");
        textEl.className = "lr-block-text";

        const tokens = block.text.split(/(\s+)/);
        tokens.forEach(token => {
            if (token.trim() === "") {
                textEl.appendChild(document.createTextNode(token));
            } else {
                const span = document.createElement("span");
                span.className = "lr-word";
                span.textContent = token;
                span.dataset.lrWord = normalizeWord(token);
                span.onclick = (event) => cycleWordColor(span, event);

                // Restaurar cor do cache
                const state = colorCache.get(normalizeWord(token));
                if (state === "green") span.classList.add("lr-green");
                else if (state === "yellow") span.classList.add("lr-yellow");

                textEl.appendChild(span);
            }
        });

        // Divisor
        const divider = document.createElement("hr");
        divider.className = "lr-block-divider";

        blockEl.appendChild(tsEl);
        blockEl.appendChild(textEl);
        blockEl.appendChild(divider);
        container.appendChild(blockEl);
    });
}


/* =============== AUTO SCROLLER =============== */

/**
 * Identifica o Active_Block para um dado currentTime.
 * @param {Array<{start:number, dur:number, text:string}>} blocks - lista de CaptionBlocks
 * @param {number} currentMs - tempo atual do vídeo em milissegundos
 * @returns {number} índice do Active_Block, ou -1 se nenhum corresponder
 */
function findActiveBlock(blocks, currentMs) {
    for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].start <= currentMs && currentMs < blocks[i].start + blocks[i].dur) {
            return i;
        }
    }
    return -1;
}

/**
 * Inicia o polling de 800ms para identificar e destacar o Active_Block.
 * Deve ser chamado quando a Transcript_Tab é ativada.
 */
function startAutoScroller() {
    if (autoScrollerTimer !== null) return;

    let lastActiveIndex = -1;

    autoScrollerTimer = setInterval(() => {
        const video = document.querySelector("video");
        if (!video) return;

        const currentMs = video.currentTime * 1000;
        const activeIndex = findActiveBlock(transcriptBlocks, currentMs);

        if (activeIndex === lastActiveIndex) return;

        // Remover destaque do bloco anterior
        if (lastActiveIndex >= 0) {
            const prevEl = document.querySelector(`.lr-block[data-lr-index="${lastActiveIndex}"]`);
            if (prevEl) prevEl.classList.remove("lr-block-active");
        }

        if (activeIndex >= 0) {
            const activeEl = document.querySelector(`.lr-block[data-lr-index="${activeIndex}"]`);
            if (activeEl) {
                activeEl.classList.add("lr-block-active");
                activeEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
            // Atualizar lastActiveIndex apenas quando há um bloco ativo (req. 6.5)
            lastActiveIndex = activeIndex;
        }
        // Se activeIndex === -1 (silêncio entre legendas), não atualizar lastActiveIndex
        // para manter o último bloco destacado
    }, 800);
}

/**
 * Para o polling do Auto_Scroller.
 * Deve ser chamado quando a Transcript_Tab é desativada ou o painel é fechado.
 */
function stopAutoScroller() {
    if (autoScrollerTimer !== null) {
        clearInterval(autoScrollerTimer);
        autoScrollerTimer = null;
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


/* =============== DETECÇÃO DE NAVEGAÇÃO =============== */

// Monitorar mudanças de URL para detectar navegação entre vídeos
let lastVideoHref = location.href;

setInterval(() => {
    if (location.href !== lastVideoHref) {
        lastVideoHref = location.href;
        // Resetar estado da transcrição
        transcriptBlocks = [];
        transcriptVideoId = null;
        stopAutoScroller();
        // Limpar o painel de transcrição se existir
        const transcriptContainer = document.getElementById("lr-transcript");
        if (transcriptContainer) {
            transcriptContainer.innerHTML = "";
        }
    }
}, 1000);
