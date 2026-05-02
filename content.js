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

