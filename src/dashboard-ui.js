(function () {
    'use strict';

    function createDashboardUI(deps) {
        const {
            Chart,
            COLORS,
            DEPT_COLORS,
            DEPT_BG_COLORS,
            formatNum,
            getCharts,
            setChart
        } = deps;

        let deptColorCache = {};
        let deptIndex = 0;

        function getDeptColor(deptName) {
            if (!deptColorCache[deptName]) {
                deptColorCache[deptName] = {
                    color: DEPT_COLORS[deptIndex % DEPT_COLORS.length],
                    bg: DEPT_BG_COLORS[deptIndex % DEPT_BG_COLORS.length]
                };
                deptIndex++;
            }
            return deptColorCache[deptName];
        }

        function resetDeptColors() {
            deptColorCache = {};
            deptIndex = 0;
        }

        function escapeHtml(value) {
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function escapeAttr(value) {
            return escapeHtml(value).replace(/\r?\n/g, ' ');
        }

        function safeInlineText(value) {
            return escapeHtml(String(value == null ? '' : value).replace(/\r?\n/g, ' '));
        }

        function getAllDeptNames(data) {
            return [...new Set(data.map(r => String(r['\uBD80\uC11C\uBA85'] || '').trim()).filter(Boolean))].sort();
        }

        function buildDeptLegendHTML(deptNames) {
            return deptNames.map(d => {
                const c = getDeptColor(d);
                return `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:8px;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c.color}"></span>${safeInlineText(d)}</span>`;
            }).join('');
        }

        function buildHeatmapHTML(rowLabels, colLabels, matrix, maxVal) {
            if (!rowLabels.length || !colLabels.length) {
                return '<p style="color:var(--gray-400);text-align:center;padding:20px;">\uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4</p>';
            }
            let html = '<table class="heatmap-table"><thead><tr><th></th>';
            colLabels.forEach(c => { html += `<th>${safeInlineText(c)}</th>`; });
            html += '<th>\uD569\uACC4</th></tr></thead><tbody>';
            rowLabels.forEach((rl, ri) => {
                html += `<tr><td>${safeInlineText(rl)}</td>`;
                let rowSum = 0;
                colLabels.forEach((_, ci) => {
                    const v = matrix[ri][ci] || 0;
                    rowSum += v;
                    const intensity = maxVal > 0 ? v / maxVal : 0;
                    const bg = v > 0 ? `rgba(79,70,229,${0.08 + intensity * 0.72})` : 'transparent';
                    const fg = intensity > 0.5 ? 'white' : 'var(--gray-700)';
                    const tooltip = v > 0 ? `\uC9C0\uC6D0 \uAC74\uC218(\uAC74): ${v}` : '\uC9C0\uC6D0 \uAC74\uC218(\uAC74): 0';
                    html += `<td><span class="hm-cell" style="background:${bg};color:${fg}" title="${tooltip}">${v || ''}</span></td>`;
                });
                html += `<td><strong title="\uC9C0\uC6D0 \uAC74\uC218(\uAC74): ${rowSum}">${rowSum}</strong></td></tr>`;
            });
            html += '</tbody></table>';
            return html;
        }

        function upsertChart(id, config) {
            const canvas = document.getElementById(id);
            if (!canvas) return null;
            const ctx = canvas.getContext('2d');
            const charts = getCharts();

            if (charts[id]) {
                const chart = charts[id];
                chart.data = config.data;
                if (config.options) Object.assign(chart.options, config.options);
                chart.update('none');
                return chart;
            }

            const chart = new Chart(ctx, config);
            setChart(id, chart);
            return chart;
        }

        function lineChartConfig(labels, datasets, yTitle = '\uAC74\uC218', xTitle = '\uB0A0\uC9DC') {
            return {
                type: 'line',
                data: { labels, datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 16 } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { maxTicksLimit: 15, font: { size: 11 } }, title: { display: !!xTitle, text: xTitle || '', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                        y: { beginAtZero: true, title: { display: true, text: yTitle, font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, ticks: { stepSize: 1, font: { size: 11 } } }
                    }
                }
            };
        }

        function barChartConfig(labels, data, label, color, horizontal = false, valTitle = '', catTitle = '') {
            return {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{ label, data, backgroundColor: Array.isArray(color) ? color : color + 'CC', borderColor: Array.isArray(color) ? color : color, borderWidth: 1, borderRadius: 4, maxBarThickness: 40 }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    indexAxis: horizontal ? 'y' : 'x',
                    plugins: { legend: { display: false } },
                    scales: {
                        [horizontal ? 'x' : 'y']: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } }, title: { display: !!valTitle, text: valTitle || '', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                        [horizontal ? 'y' : 'x']: { ticks: { font: { size: 11 } }, grid: { display: false }, title: { display: !!catTitle, text: catTitle || '', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } }
                    }
                }
            };
        }

        function pieChartConfig(labels, data, isDoughnut = true) {
            return {
                type: isDoughnut ? 'doughnut' : 'pie',
                data: {
                    labels,
                    datasets: [{
                        data,
                        backgroundColor: COLORS.slice(0, labels.length).map(c => c + 'CC'),
                        borderColor: COLORS.slice(0, labels.length),
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'right', labels: { font: { size: 11, family: 'Noto Sans KR' }, padding: 10, usePointStyle: true } },
                        tooltip: {
                            callbacks: {
                                label: function (ctx) {
                                    const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                    const pct = ((ctx.parsed / total) * 100).toFixed(1);
                                    return ` ${ctx.label}: ${formatNum(ctx.parsed)}\uAC74 (${pct}%)`;
                                }
                            }
                        }
                    }
                }
            };
        }

        function stackedBarConfig(labels, datasets, horizontal = false, valTitle = '', catTitle = '') {
            return {
                type: 'bar',
                data: { labels, datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    indexAxis: horizontal ? 'y' : 'x',
                    plugins: { legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 12 } } },
                    scales: {
                        x: { stacked: true, ticks: { font: { size: 11 } }, grid: { display: horizontal }, title: { display: !!(horizontal ? valTitle : catTitle), text: (horizontal ? valTitle : catTitle) || '', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                        y: { stacked: true, beginAtZero: true, ticks: { font: { size: 11 } }, grid: { display: !horizontal }, title: { display: !!(horizontal ? catTitle : valTitle), text: (horizontal ? catTitle : valTitle) || '', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } }
                    }
                }
            };
        }

        function rankTableHTML(entries, labelName) {
            if (!entries.length) {
                return '<p style="color:var(--gray-400);text-align:center;padding:20px;">\uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4</p>';
            }
            const total = entries.reduce((s, e) => s + e[1], 0);
            let html = `<table class="rank-table"><thead><tr><th>#</th><th>${safeInlineText(labelName)}</th><th>\uAC74\uC218</th><th>\uBE44\uC728</th><th>\uBC14</th></tr></thead><tbody>`;
            entries.forEach(([name, count], i) => {
                const pct = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
                const rc = i < 3 ? `rank-${i + 1}` : 'rank-other';
                const barColor = COLORS[i % COLORS.length];
                html += `<tr><td><span class="rank-num ${rc}">${i + 1}</span></td><td>${safeInlineText(name)}</td><td><strong>${formatNum(count)}</strong></td><td>${pct}%</td><td style="min-width:120px"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${barColor}"></div></div></td></tr>`;
            });
            html += '</tbody></table>';
            return html;
        }

        return {
            getDeptColor,
            resetDeptColors,
            escapeHtml,
            escapeAttr,
            safeInlineText,
            getAllDeptNames,
            buildDeptLegendHTML,
            buildHeatmapHTML,
            upsertChart,
            lineChartConfig,
            barChartConfig,
            pieChartConfig,
            stackedBarConfig,
            rankTableHTML
        };
    }

    window.DASH_DASHBOARD_UI = {
        createDashboardUI
    };
})();
