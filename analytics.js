/* =============== ANALYTICS PAGE — REGISTRO DIÁRIO =============== */

function formatSeconds(s) {
    if (!s || s === 0) return "0min";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + "h " + m + "min";
    return m + "min";
}

function formatSecondsShort(s) {
    if (!s || s === 0) return "0m";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + "h" + m + "m";
    return m + "m";
}

/* Retorna a segunda-feira da semana de uma data (YYYY-MM-DD) */
function getWeekStart(dateStr) {
    var d = new Date(dateStr + "T00:00:00");
    var day = d.getDay(); // 0=dom, 1=seg...
    var diff = (day === 0) ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
}

/* Últimos 7 dias como array YYYY-MM-DD, do mais antigo ao mais recente */
function lastSevenDays() {
    var days = [];
    for (var i = 6; i >= 0; i--) {
        var d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().slice(0, 10));
    }
    return days;
}

function buildCharts(vocabData, exposureData) {
    var allDays = Array.from(new Set(
        Object.keys(vocabData).concat(Object.keys(exposureData))
    )).sort();

    var tooltipDefaults = { backgroundColor: "#1a1a1a", borderColor: "#333", borderWidth: 1 };
    var scaleDefaults = {
        x: { ticks: { color: "#666", font: { size: 11 } }, grid: { color: "#1e1e1e" } },
        y: { ticks: { color: "#666", font: { size: 11 } }, grid: { color: "#1e1e1e" } }
    };

    /* ---- Gráfico vocabulário ---- */
    if (allDays.length > 0) {
        var vocabValues = allDays.map(d => (vocabData[d] && vocabData[d].known != null) ? vocabData[d].known : null);
        new Chart(document.getElementById("chart-vocab"), {
            type: "line",
            data: {
                labels: allDays,
                datasets: [{
                    data: vocabValues,
                    borderColor: "#00c896",
                    backgroundColor: "rgba(0,200,150,0.08)",
                    pointBackgroundColor: "#00c896",
                    pointRadius: 3,
                    tension: 0.3,
                    fill: true,
                    spanGaps: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { ...tooltipDefaults, callbacks: { label: ctx => " " + ctx.parsed.y + " palavras" } }
                },
                scales: {
                    x: scaleDefaults.x,
                    y: { ...scaleDefaults.y, ticks: { ...scaleDefaults.y.ticks, callback: v => v + " palavras" } }
                }
            }
        });
    } else {
        document.querySelector("#chart-vocab").closest(".chart-container").innerHTML =
            "<div class='empty'>Sem dados ainda</div>";
    }

    /* ---- Gráfico exposição — última semana (7 dias fixos) ---- */
    var week7 = lastSevenDays();
    var week7Values = week7.map(d => (exposureData[d] && exposureData[d].seconds) ? exposureData[d].seconds : 0);
    var week7Labels = week7.map(d => {
        var parts = d.split("-");
        return parts[2] + "/" + parts[1];
    });

    new Chart(document.getElementById("chart-exposure-week"), {
        type: "bar",
        data: {
            labels: week7Labels,
            datasets: [{
                data: week7Values,
                backgroundColor: "rgba(100,181,246,0.6)",
                borderColor: "#64b5f6",
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { ...tooltipDefaults, callbacks: { label: ctx => " " + formatSeconds(ctx.parsed.y) } }
            },
            scales: {
                x: scaleDefaults.x,
                y: { ...scaleDefaults.y, ticks: { ...scaleDefaults.y.ticks, callback: v => formatSecondsShort(v) } }
            }
        }
    });

    /* ---- Gráfico exposição — por semana ---- */
    var weeklyTotals = {};
    Object.keys(exposureData).forEach(function(d) {
        var ws = getWeekStart(d);
        if (!weeklyTotals[ws]) weeklyTotals[ws] = 0;
        weeklyTotals[ws] += (exposureData[d] && exposureData[d].seconds) ? exposureData[d].seconds : 0;
    });

    var weekKeys = Object.keys(weeklyTotals).sort();
    var weekLabels = weekKeys.map(function(ws) {
        var parts = ws.split("-");
        return "Sem " + parts[2] + "/" + parts[1];
    });
    var weekValues = weekKeys.map(k => weeklyTotals[k]);

    if (weekKeys.length > 0) {
        new Chart(document.getElementById("chart-exposure-weekly"), {
            type: "bar",
            data: {
                labels: weekLabels,
                datasets: [{
                    data: weekValues,
                    backgroundColor: "rgba(179,136,255,0.6)",
                    borderColor: "#b388ff",
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { ...tooltipDefaults, callbacks: { label: ctx => " " + formatSeconds(ctx.parsed.y) } }
                },
                scales: {
                    x: scaleDefaults.x,
                    y: { ...scaleDefaults.y, ticks: { ...scaleDefaults.y.ticks, callback: v => formatSecondsShort(v) } }
                }
            }
        });
    } else {
        document.querySelector("#chart-exposure-weekly").closest(".chart-container").innerHTML =
            "<div class='empty'>Sem dados ainda</div>";
    }
}

/* =============== ADICIONAR TEMPO MANUALMENTE =============== */

function setupAddTime() {
    // Define o campo de data com hoje como padrão
    var today = new Date().toISOString().slice(0, 10);
    document.getElementById("add-time-date").value = today;

    document.getElementById("btn-add-time").addEventListener("click", function() {
        var dateVal    = document.getElementById("add-time-date").value;
        var hoursVal   = parseInt(document.getElementById("add-time-hours").value) || 0;
        var minutesVal = parseInt(document.getElementById("add-time-minutes").value) || 0;
        var msgEl      = document.getElementById("add-time-msg");

        msgEl.className = "add-time-msg";
        msgEl.textContent = "";

        if (!dateVal) {
            msgEl.className = "add-time-msg error";
            msgEl.textContent = "Selecione um dia.";
            return;
        }
        if (hoursVal < 0 || minutesVal < 0 || minutesVal > 59 || hoursVal > 23) {
            msgEl.className = "add-time-msg error";
            msgEl.textContent = "Valores inválidos. Horas: 0–23, Minutos: 0–59.";
            return;
        }
        var addSeconds = (hoursVal * 3600) + (minutesVal * 60);
        if (addSeconds === 0) {
            msgEl.className = "add-time-msg error";
            msgEl.textContent = "Informe pelo menos 1 minuto.";
            return;
        }

        var key = "lr_exposure_" + dateVal;
        chrome.storage.local.get([key], function(items) {
            var existing = (items[key] && items[key].seconds) ? items[key].seconds : 0;
            var newVal   = existing + addSeconds;
            var obj = {};
            obj[key] = { seconds: newVal };
            chrome.storage.local.set(obj, function() {
                msgEl.textContent = "✓ Adicionado " + formatSeconds(addSeconds) + " em " + dateVal + ". Total do dia: " + formatSeconds(newVal);
                document.getElementById("add-time-hours").value   = "0";
                document.getElementById("add-time-minutes").value = "0";
                // Recarrega os dados após 1.2s para atualizar gráficos
                setTimeout(function() { location.reload(); }, 1200);
            });
        });
    });
}

/* =============== EXPORTAR MÉTRICAS =============== */

function exportMetrics(items) {
    var data = { colors: {}, frequencies: {}, vocab_history: {}, exposure_history: {} };
    Object.keys(items).forEach(function(key) {
        if (key.startsWith("lr_color_"))       data.colors[key.replace("lr_color_", "")] = items[key];
        else if (key.startsWith("lr_freq_"))   data.frequencies[key.replace("lr_freq_", "")] = items[key];
        else if (key.startsWith("lr_vocab_"))  data.vocab_history[key.replace("lr_vocab_", "")] = items[key];
        else if (key.startsWith("lr_exposure_")) data.exposure_history[key.replace("lr_exposure_", "")] = items[key];
    });
    var json = JSON.stringify(data, null, 2);
    var blob = new Blob([json], { type: "application/json" });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement("a");
    var today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = "youtube-highlighter-" + today + ".json";
    a.click();
    URL.revokeObjectURL(url);
}

/* =============== IMPORTAR MÉTRICAS =============== */

function importMetrics(jsonText) {
    try {
        var data = JSON.parse(jsonText);
        var batch = {};
        var counts = { colors: 0, freq: 0, vocab: 0, exposure: 0 };

        if (data.colors) {
            Object.entries(data.colors).forEach(([w, s]) => {
                const clean = w.toLowerCase()
                    .replace(/^[\u2018\u2019\u201c\u201d\u0060"']+/, "")
                    .replace(/[\u2018\u2019\u201c\u201d\u0060"']+$/, "")
                    .replace(/^[^a-z0-9\u00c0-\u024f]+/i, "")
                    .replace(/[^a-z0-9\u00c0-\u024f]+$/i, "");
                if (clean.length < 1) return;
                if (s === "green" || s === "yellow") { batch["lr_color_" + clean] = s; counts.colors++; }
            });
        }
        if (data.frequencies) {
            Object.entries(data.frequencies).forEach(([w, c]) => {
                const clean = w.toLowerCase()
                    .replace(/^[\u2018\u2019\u201c\u201d\u0060"']+/, "")
                    .replace(/[\u2018\u2019\u201c\u201d\u0060"']+$/, "")
                    .replace(/^[^a-z0-9\u00c0-\u024f]+/i, "")
                    .replace(/[^a-z0-9\u00c0-\u024f]+$/i, "");
                if (clean.length < 2 || !/[a-z\u00c0-\u024f]/i.test(clean)) return;
                if (typeof c === "number" && c > 0) { batch["lr_freq_" + clean] = c; counts.freq++; }
            });
        }
        if (data.vocab_history) {
            Object.entries(data.vocab_history).forEach(([d, v]) => {
                batch["lr_vocab_" + d] = v; counts.vocab++;
            });
        }
        if (data.exposure_history) {
            Object.entries(data.exposure_history).forEach(([d, e]) => {
                batch["lr_exposure_" + d] = e; counts.exposure++;
            });
        }

        chrome.storage.local.set(batch, function() {
            alert("Importado com sucesso!\n" +
                counts.colors + " cores · " + counts.freq + " frequências\n" +
                counts.vocab + " dias de vocabulário · " + counts.exposure + " dias de exposição");
            location.reload();
        });
    } catch (e) {
        alert("Erro ao importar: " + e.message);
    }
}

/* =============== CARREGAR DADOS =============== */

chrome.storage.local.get(null, function(items) {
    var vocabData    = {};
    var exposureData = {};
    var totalKnown   = 0;
    var totalExposure = 0;

    Object.keys(items).forEach(function(key) {
        if (key.startsWith("lr_vocab_")) {
            vocabData[key.replace("lr_vocab_", "")] = items[key];
        } else if (key.startsWith("lr_exposure_")) {
            var day = key.replace("lr_exposure_", "");
            exposureData[day] = items[key];
            totalExposure += (items[key] && items[key].seconds) ? items[key].seconds : 0;
        } else if (key.startsWith("lr_color_") && items[key] === "green") {
            totalKnown++;
        }
    });

    var dayCount = Array.from(new Set(
        Object.keys(vocabData).concat(Object.keys(exposureData))
    )).length;

    document.getElementById("stat-known").textContent    = totalKnown;
    document.getElementById("stat-exposure").textContent = formatSeconds(totalExposure);
    document.getElementById("stat-days").textContent     = dayCount;

    if (dayCount === 0) {
        document.querySelectorAll(".chart-container").forEach(function(c) {
            c.innerHTML = "<div class='empty'>Sem dados ainda</div>";
        });
    } else {
        buildCharts(vocabData, exposureData);
    }

    // Botões de export/import
    document.getElementById("btn-export").onclick = function() { exportMetrics(items); };

    var importFile = document.getElementById("import-file");
    document.getElementById("btn-import").onclick = function() { importFile.click(); };
    importFile.onchange = function(e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(ev) { importMetrics(ev.target.result); importFile.value = ""; };
        reader.readAsText(file);
    };

    // Campo de adicionar tempo
    setupAddTime();
});
