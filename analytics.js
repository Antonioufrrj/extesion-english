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

function buildCharts(vocabData, exposureData) {
    var allDays = Array.from(new Set(
        Object.keys(vocabData).concat(Object.keys(exposureData))
    )).sort();

    if (allDays.length === 0) return;

    var labels        = allDays;
    var vocabValues   = allDays.map(d => (vocabData[d] && vocabData[d].known != null) ? vocabData[d].known : null);
    var exposureValues = allDays.map(d => (exposureData[d] && exposureData[d].seconds) ? exposureData[d].seconds : 0);

    var tooltipDefaults = { backgroundColor: "#1a1a1a", borderColor: "#333", borderWidth: 1 };
    var scaleDefaults = {
        x: { ticks: { color: "#666", font: { size: 11 } }, grid: { color: "#1e1e1e" } },
        y: { ticks: { color: "#666", font: { size: 11 } }, grid: { color: "#1e1e1e" } }
    };

    // Gráfico vocabulário
    new Chart(document.getElementById("chart-vocab"), {
        type: "line",
        data: {
            labels: labels,
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

    // Gráfico exposição diária
    new Chart(document.getElementById("chart-exposure"), {
        type: "bar",
        data: {
            labels: labels,
            datasets: [{
                data: exposureValues,
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

    // Tabela — mais recente primeiro
    var container = document.getElementById("table-container");
    var rows = allDays.slice().reverse().map(function(d) {
        var v    = vocabData[d];
        var e    = exposureData[d];
        var known = (v && v.known != null) ? v.known + " palavras" : "—";
        var secs  = (e && e.seconds) ? e.seconds : 0;
        return "<tr><td>" + d + "</td>" +
               "<td class='badge-green'>" + known + "</td>" +
               "<td class='badge-time'>" + formatSeconds(secs) + "</td></tr>";
    }).join("");

    container.innerHTML =
        "<table><thead><tr>" +
        "<th>Data</th><th>Vocabulário</th><th>Exposição</th>" +
        "</tr></thead><tbody>" + rows + "</tbody></table>";
}

/* =============== EXPORTAR MÉTRICAS =============== */

function exportMetrics(items) {
    var data = { colors: {}, frequencies: {}, vocab_history: {}, exposure_history: {} };
    Object.keys(items).forEach(function(key) {
        if (key.startsWith("lr_color_"))    data.colors[key.replace("lr_color_", "")] = items[key];
        else if (key.startsWith("lr_freq_")) data.frequencies[key.replace("lr_freq_", "")] = items[key];
        else if (key.startsWith("lr_vocab_")) data.vocab_history[key.replace("lr_vocab_", "")] = items[key];
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
                if (s === "green" || s === "yellow") { batch["lr_color_" + w.toLowerCase()] = s; counts.colors++; }
            });
        }
        if (data.frequencies) {
            Object.entries(data.frequencies).forEach(([w, c]) => {
                if (typeof c === "number" && c > 0) { batch["lr_freq_" + w.toLowerCase()] = c; counts.freq++; }
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
        document.getElementById("table-container").innerHTML =
            "<div class='empty'>Nenhum dado registrado ainda.<br>Assista vídeos em inglês para começar a acumular métricas.</div>";
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
});
