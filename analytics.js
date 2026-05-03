/* =============== ANALYTICS PAGE =============== */

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
    var allWeeks = Array.from(new Set(
        Object.keys(vocabData).concat(Object.keys(exposureData))
    )).sort();

    if (allWeeks.length === 0) return;

    var labels = allWeeks.map(function(w) {
        var entry = vocabData[w] || exposureData[w];
        return (entry && entry.date) ? entry.date : w;
    });

    var vocabValues = allWeeks.map(function(w) {
        return (vocabData[w] && vocabData[w].known != null) ? vocabData[w].known : null;
    });

    var exposureValues = allWeeks.map(function(w) {
        return (exposureData[w] && exposureData[w].seconds) ? exposureData[w].seconds : 0;
    });

    var chartDefaults = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: { backgroundColor: "#1a1a1a", borderColor: "#333", borderWidth: 1 }
        },
        scales: {
            x: { ticks: { color: "#666", font: { size: 11 } }, grid: { color: "#1e1e1e" } },
            y: { ticks: { color: "#666", font: { size: 11 } }, grid: { color: "#1e1e1e" } }
        }
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
                pointRadius: 4,
                tension: 0.3,
                fill: true,
                spanGaps: true
            }]
        },
        options: {
            responsive: chartDefaults.responsive,
            maintainAspectRatio: chartDefaults.maintainAspectRatio,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: "#1a1a1a",
                    borderColor: "#333",
                    borderWidth: 1,
                    callbacks: {
                        label: function(ctx) { return " " + ctx.parsed.y + " palavras"; }
                    }
                }
            },
            scales: {
                x: { ticks: { color: "#666", font: { size: 11 } }, grid: { color: "#1e1e1e" } },
                y: {
                    ticks: {
                        color: "#666",
                        font: { size: 11 },
                        callback: function(v) { return v + " palavras"; }
                    },
                    grid: { color: "#1e1e1e" }
                }
            }
        }
    });

    // Gráfico exposição
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
            responsive: chartDefaults.responsive,
            maintainAspectRatio: chartDefaults.maintainAspectRatio,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: "#1a1a1a",
                    borderColor: "#333",
                    borderWidth: 1,
                    callbacks: {
                        label: function(ctx) { return " " + formatSeconds(ctx.parsed.y); }
                    }
                }
            },
            scales: {
                x: { ticks: { color: "#666", font: { size: 11 } }, grid: { color: "#1e1e1e" } },
                y: {
                    ticks: {
                        color: "#666",
                        font: { size: 11 },
                        callback: function(v) { return formatSecondsShort(v); }
                    },
                    grid: { color: "#1e1e1e" }
                }
            }
        }
    });

    // Tabela
    var container = document.getElementById("table-container");
    var rows = allWeeks.slice().reverse().map(function(w) {
        var v = vocabData[w];
        var e = exposureData[w];
        var date  = (v && v.date) ? v.date : ((e && e.date) ? e.date : w);
        var known = (v && v.known != null) ? v.known + " palavras" : "—";
        var secs  = (e && e.seconds) ? e.seconds : 0;
        return "<tr><td>" + date + "</td><td>" + w + "</td>" +
               "<td class='badge-green'>" + known + "</td>" +
               "<td class='badge-time'>" + formatSeconds(secs) + "</td></tr>";
    }).join("");

    container.innerHTML =
        "<table><thead><tr>" +
        "<th>Data</th><th>Semana</th><th>Vocabulário</th><th>Exposição</th>" +
        "</tr></thead><tbody>" + rows + "</tbody></table>";
}

// Carregar dados do chrome.storage.local
chrome.storage.local.get(null, function(items) {
    var vocabData    = {};
    var exposureData = {};
    var totalKnown   = 0;
    var totalExposure = 0;

    Object.keys(items).forEach(function(key) {
        if (key.startsWith("lr_vocab_")) {
            var week = key.replace("lr_vocab_", "");
            vocabData[week] = items[key];
        } else if (key.startsWith("lr_exposure_")) {
            var week = key.replace("lr_exposure_", "");
            exposureData[week] = items[key];
            totalExposure += (items[key] && items[key].seconds) ? items[key].seconds : 0;
        } else if (key.startsWith("lr_color_") && items[key] === "green") {
            totalKnown++;
        }
    });

    var allWeekKeys = Array.from(new Set(
        Object.keys(vocabData).concat(Object.keys(exposureData))
    ));
    var weekCount = allWeekKeys.length;

    document.getElementById("stat-known").textContent    = totalKnown;
    document.getElementById("stat-exposure").textContent = formatSeconds(totalExposure);
    document.getElementById("stat-weeks").textContent    = weekCount;

    if (weekCount === 0) {
        document.getElementById("table-container").innerHTML =
            "<div class='empty'>Nenhum dado registrado ainda.<br>Assista vídeos em inglês para começar a acumular métricas.</div>";
        document.querySelectorAll(".chart-container").forEach(function(c) {
            c.innerHTML = "<div class='empty'>Sem dados ainda</div>";
        });
    } else {
        buildCharts(vocabData, exposureData);
    }
});
