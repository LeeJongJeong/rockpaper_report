(function () {
    'use strict';

    function createEngineerTab(deps) {
        const {
            CONFIG,
            COLORS,
            utilColor,
            safeInlineText,
            getFilteredData,
            getComparablePeriodContext,
            aggregateEngineers,
            buildAnalyticsSummary,
            summarizeEntityTransition,
            buildDeltaHtml,
            upsertChart,
            makeDrilldownClick,
            getContractWorkDays,
            getDeptColor,
            buildDeptLegendHTML,
            getAllDeptNames,
            barChartConfig,
            aggregateByKeyAndDate,
            crossTab,
            buildHeatmapHTML,
            stackedBarConfig,
            lineChartConfig,
            getCompensationTopEngineers,
            getActiveFilterFromDate,
            getActiveFilterToDate
        } = deps;

    function updateEngineerTab() {
        const data = getFilteredData();
        const compareContext = getComparablePeriodContext();
        const engMap = aggregateEngineers(data);
        const engEntries = Object.entries(engMap).sort((a, b) => b[1].count - a[1].count);

        if (!engEntries.length) {
            document.getElementById('engKpiRow').innerHTML = '';
            document.getElementById('engHeatmap').innerHTML = '<p style="color:var(--gray-400);text-align:center;padding:20px;">데이터 없음</p>';
            document.getElementById('engScorecard').innerHTML = '';
            return;
        }

        const prevEngMap = aggregateEngineers(compareContext.previousData);
        const currentSummary = buildAnalyticsSummary(data, { range: compareContext.currentRange, engMap: engMap });
        const previousSummary = buildAnalyticsSummary(compareContext.previousData, { range: compareContext.previousRange, engMap: prevEngMap });
        const engineerTransition = summarizeEntityTransition(currentSummary.engineerSet, previousSummary.engineerSet);
        const engContractWorkH = currentSummary.contractHoursPerEngineer;
        const prevEngContractWorkH = previousSummary.contractHoursPerEngineer;
        const topCompensation = getCompensationTopEngineers(getActiveFilterFromDate(), getActiveFilterToDate(), 1).list[0] || null;

        document.getElementById('engKpiRow').innerHTML = `
                <div class="kpi-mini"><div class="kpi-mini-label">\ucd1d \uc5d4\uc9c0\ub2c8\uc5b4</div><div class="kpi-mini-value">${currentSummary.activeEngineerCount}</div><div class="kpi-mini-sub">${buildDeltaHtml(currentSummary.activeEngineerCount, previousSummary.activeEngineerCount, { decimals: 0, unit: '\uba85' })} \u00b7 \uc720\uc9c0 ${engineerTransition.retainedCount}\uba85</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">\ucd1d \ud22c\uc785\uc2dc\uac04</div><div class="kpi-mini-value">${currentSummary.totalHours.toFixed(1)}h</div><div class="kpi-mini-sub">${buildDeltaHtml(currentSummary.totalHours, previousSummary.totalHours, { decimals: 1, unit: 'h' })}</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">\ud3c9\uade0 \uac00\ub3d9\ub960</div><div class="kpi-mini-value" style="color:${utilColor(currentSummary.avgUtilPct)}">${currentSummary.avgUtilPct.toFixed(1)}%</div><div class="kpi-mini-sub">${buildDeltaHtml(currentSummary.avgUtilPct, previousSummary.avgUtilPct, { decimals: 1, mode: 'pp' })}</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">\uc678\ubd80\uc9c0\uc6d0 \ube44\uc728</div><div class="kpi-mini-value">${currentSummary.externalSupportRatio.toFixed(1)}%</div><div class="kpi-mini-sub">${buildDeltaHtml(currentSummary.externalSupportRatio, previousSummary.externalSupportRatio, { decimals: 1, mode: 'pp' })}</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">\uace0\uac1d\uc9c0\uc6d0 \ucd5c\ub2e4\ud65c\ub3d9</div><div class="kpi-mini-value">${safeInlineText((currentSummary.topEngineer && `\uD83D\uDC4D ${currentSummary.topEngineer[0]}`) || '\ub370\uc774\ud130 \uc5c6\uc74c')}</div><div class="kpi-mini-sub">${currentSummary.topEngineer ? `\uc9c0\uc6d0\uac74\uc218 ${currentSummary.topEngineer[1].billableCount}\uac74, \uc9c0\uc6d0\uc2dc\uac04 ${currentSummary.topEngineer[1].billableHours.toFixed(1)}h` : '\ub370\uc774\ud130 \uc5c6\uc74c'}</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">\ubcf4\uc0c1\ud734\uac00 \ucd5c\ub2e4\ubc1c\uc0dd</div><div class="kpi-mini-value">${safeInlineText((topCompensation && `\uD83D\uDE2B ${topCompensation.engineer}`) || '\ub370\uc774\ud130 \uc5c6\uc74c')}</div><div class="kpi-mini-sub">${topCompensation ? `\ubcf4\uc0c1\ud734\uac00 \ubc1c\uc0dd\uc2dc\uac04 ${topCompensation.compensationHours.toFixed(1)}h` : '\ub370\uc774\ud130 \uc5c6\uc74c'}</div></div>
            `;

        const bubbleData = engEntries.map((e, i) => ({
            label: e[0],
            data: [{ x: e[1].billableCount, y: Math.round(e[1].billableHours * 10) / 10, r: Math.max(5, e[1].billableCusts.size * 3) }],
            backgroundColor: COLORS[i % COLORS.length] + '99',
            borderColor: COLORS[i % COLORS.length],
            borderWidth: 1
        }));
        upsertChart('chartEngBubble', {
            type: 'bubble',
            data: { datasets: bubbleData },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 10 } },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.x}건, ${ctx.parsed.y}h, 고객사 ${Math.round(ctx.raw.r / 3)}곳` } }
                },
                scales: {
                    x: { title: { display: true, text: '고객업무 건수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, beginAtZero: true },
                    y: { title: { display: true, text: '고객업무 투입시간 (h)', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, beginAtZero: true }
                }
            }
        });

        const engByUtil = engEntries.map(([name, m]) => {
            const workingH = engContractWorkH;
            const utilPct = workingH > 0 ? (m.billableHours / workingH) * 100 : 0;
            return { name, billableH: m.billableHours, workingH, utilPct, dept: m.dept };
        }).sort((a, b) => b.utilPct - a.utilPct);
        const utilColors = engByUtil.map(e => utilColor(e.utilPct) + 'CC');
        const utilBorders = engByUtil.map(e => utilColor(e.utilPct));
        upsertChart('chartEngUtil', {
            type: 'bar',
            data: {
                labels: engByUtil.map(e => e.name),
                datasets: [{
                    label: '가동률(%)',
                    data: engByUtil.map(e => Math.round(e.utilPct * 10) / 10),
                    backgroundColor: utilColors,
                    borderColor: utilBorders,
                    borderWidth: 1,
                    borderRadius: 4,
                    maxBarThickness: 28
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                onClick: makeDrilldownClick('엔지니어', true),
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const e = engByUtil[ctx.dataIndex];
                                return [
                                    ` 가동률: ${e.utilPct.toFixed(1)}%`,
                                    ` 가동시간: ${e.billableH.toFixed(1)}h`,
                                    ` 소정근무: ${e.workingH}h (${getContractWorkDays()}일×${CONFIG.WORK_HOURS_PER_DAY}h)`
                                ];
                            }
                        }
                    },
                    annotation: undefined
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        max: Math.max(120, Math.ceil(Math.max(...engByUtil.map(e => e.utilPct)) / 10) * 10 + 10),
                        ticks: { callback: v => v + '%', font: { size: 11 } },
                        title: { display: true, text: '가동률 (%)', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }
                    },
                    y: { ticks: { font: { size: 11 } }, grid: { display: false }, title: { display: true, text: '엔지니어', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } }
                }
            }
        });

        const teamMap = {};
        engEntries.forEach(([, m]) => {
            const dept = m.dept || '미지정';
            if (!teamMap[dept]) teamMap[dept] = { billableH: 0, workingH: 0, engCount: 0, totalH: 0 };
            const tm = teamMap[dept];
            tm.billableH += m.billableHours;
            tm.workingH += engContractWorkH;
            tm.totalH += m.hours;
            tm.engCount++;
        });
        const teamEntries = Object.entries(teamMap).sort((a, b) => a[0].localeCompare(b[0]));
        const teamNames = teamEntries.map(e => e[0]);
        const teamUtilPcts = teamEntries.map(e => e[1].workingH > 0 ? Math.round((e[1].billableH / e[1].workingH) * 1000) / 10 : 0);
        const teamUtilLegendEl = document.getElementById('teamUtilLegend');
        if (teamUtilLegendEl) teamUtilLegendEl.innerHTML = buildDeptLegendHTML(teamNames);
        upsertChart('chartTeamUtil', {
            type: 'bar',
            data: {
                labels: teamNames,
                datasets: [
                    {
                        label: '가동률(%)',
                        data: teamUtilPcts,
                        backgroundColor: teamNames.map(n => getDeptColor(n).color + 'CC'),
                        borderColor: teamNames.map(n => getDeptColor(n).color),
                        borderWidth: 2, borderRadius: 6, maxBarThickness: 80,
                        yAxisID: 'y'
                    },
                    {
                        label: '가동시간(h)',
                        data: teamEntries.map(e => Math.round(e[1].billableH * 10) / 10),
                        type: 'line',
                        borderColor: '#EF4444', backgroundColor: '#EF444422',
                        pointRadius: 6, pointHoverRadius: 8, tension: 0,
                        yAxisID: 'y1', order: 0
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 12 } },
                    tooltip: {
                        callbacks: {
                            afterBody: (items) => {
                                const idx = items[0].dataIndex;
                                const te = teamEntries[idx][1];
                                return [
                                    `소정근무: ${te.workingH}h`,
                                    `엔지니어: ${te.engCount}명`,
                                    `총투입시간: ${te.totalH.toFixed(0)}h`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    x: { ticks: { font: { size: 13, weight: '600' } }, grid: { display: false }, title: { display: true, text: '팀(부서)', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                    y: { beginAtZero: true, title: { display: true, text: '가동률(%)', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, ticks: { callback: v => v + '%', font: { size: 11 } } },
                    y1: { beginAtZero: true, position: 'right', title: { display: true, text: '가동시간(h)', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, ticks: { font: { size: 11 } }, grid: { drawOnChartArea: false } }
                }
            }
        });

        const maxVals = { count: 0, hours: 0, custs: 0, prods: 0, dates: 0 };
        engEntries.forEach(([, m]) => {
            if (m.count > maxVals.count) maxVals.count = m.count;
            if (m.hours > maxVals.hours) maxVals.hours = m.hours;
            if (m.custs.size > maxVals.custs) maxVals.custs = m.custs.size;
            if (m.prods.size > maxVals.prods) maxVals.prods = m.prods.size;
            if (m.dates.size > maxVals.dates) maxVals.dates = m.dates.size;
        });
        const radarTop5 = engEntries.slice(0, CONFIG.CHART_TOP_N.RADAR);
        upsertChart('chartEngRadar', {
            type: 'radar',
            data: {
                labels: ['지원건수', '투입시간', '고객사수', '제품다양성', '활동일수'],
                datasets: radarTop5.map(([name, m], i) => ({
                    label: name,
                    data: [
                        maxVals.count > 0 ? (m.count / maxVals.count * 100).toFixed(0) : 0,
                        maxVals.hours > 0 ? (m.hours / maxVals.hours * 100).toFixed(0) : 0,
                        maxVals.custs > 0 ? (m.custs.size / maxVals.custs * 100).toFixed(0) : 0,
                        maxVals.prods > 0 ? (m.prods.size / maxVals.prods * 100).toFixed(0) : 0,
                        maxVals.dates > 0 ? (m.dates.size / maxVals.dates * 100).toFixed(0) : 0
                    ],
                    borderColor: COLORS[i % COLORS.length],
                    backgroundColor: COLORS[i % COLORS.length] + '22',
                    borderWidth: 2,
                    pointBackgroundColor: COLORS[i % COLORS.length],
                    pointRadius: 3
                }))
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 10 } },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.r}%` } }
                },
                scales: {
                    r: { beginAtZero: true, max: 100, ticks: { stepSize: 25, font: { size: 10 } }, pointLabels: { font: { size: 12, family: 'Noto Sans KR' } } }
                }
            }
        });

        const engNames = engEntries.map(e => e[0]);
        upsertChart('chartEngIntExt', {
            type: 'bar',
            data: {
                labels: engNames,
                datasets: [
                    { label: '외부 고객지원', data: engEntries.map(e => e[1].external), backgroundColor: '#4F46E5CC', borderColor: '#4F46E5', borderWidth: 1 },
                    { label: '내부 업무', data: engEntries.map(e => e[1].internal), backgroundColor: '#F59E0BCC', borderColor: '#F59E0B', borderWidth: 1 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                plugins: {
                    legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true } },
                    tooltip: { callbacks: { label: ctx => { const total = ctx.chart.data.datasets.reduce((s, ds) => s + (ds.data[ctx.dataIndex] || 0), 0); const pct = total > 0 ? ((ctx.parsed.x / total) * 100).toFixed(0) : 0; return ` ${ctx.dataset.label}: ${ctx.parsed.x}건 (${pct}%)`; } } }
                },
                scales: { x: { stacked: true, ticks: { font: { size: 11 } }, title: { display: true, text: '건수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } }, y: { stacked: true, ticks: { font: { size: 11 } }, grid: { display: false }, title: { display: true, text: '엔지니어', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } } }
            }
        });

        const engByHours = engEntries.sort((a, b) => b[1].hours - a[1].hours);
        const hourColors = engByHours.map(e => getDeptColor(e[1].dept).color + 'CC');
        const engHoursLegendEl = document.getElementById('engHoursLegend');
        if (engHoursLegendEl) engHoursLegendEl.innerHTML = buildDeptLegendHTML(getAllDeptNames(data));
        upsertChart('chartEngHours', barChartConfig(
            engByHours.map(e => e[0]),
            engByHours.map(e => Math.round(e[1].hours * 10) / 10),
            '투입시간(h)', hourColors, true, '시간(h)', '엔지니어'
        ));
        engEntries.sort((a, b) => b[1].count - a[1].count);

        const engDaily = aggregateByKeyAndDate(data, '엔지니어');
        const allDatesEng = [...new Set(data.filter(r => r._dateStr).map(r => r._dateStr))].sort();
        const top6Eng = engEntries.slice(0, CONFIG.CHART_TOP_N.TREND).map(e => e[0]);
        upsertChart('chartEngDaily', lineChartConfig(
            allDatesEng,
            top6Eng.map((name, i) => ({
                label: name, data: allDatesEng.map(d => (engDaily[name] || {})[d] || 0),
                borderColor: COLORS[i % COLORS.length], tension: 0.3, pointRadius: 2
            })),
            '건수', '날짜'
        ));

        const allProds = [...new Set(data.map(r => String(r['제품명'] || '').trim()).filter(Boolean))];
        const engProd = crossTab(data, '엔지니어', '제품명');
        const engNamesForStack = engEntries.map(e => e[0]);
        upsertChart('chartEngProduct', stackedBarConfig(
            engNamesForStack,
            allProds.slice(0, 12).map((p, i) => ({
                label: p, data: engNamesForStack.map(n => (engProd[n] || {})[p] || 0),
                backgroundColor: COLORS[i % COLORS.length] + 'CC', borderColor: COLORS[i % COLORS.length], borderWidth: 1
            })),
            true, '건수', '엔지니어'
        ));

        const allTypes = [...new Set(data.map(r => String(r['지원유형'] || '').trim()).filter(Boolean))];
        const engTypeX = crossTab(data, '엔지니어', '지원유형');
        let maxHM = 0;
        const hmNames = engEntries.map(e => e[0]);
        const hmMatrix = hmNames.map(eng => allTypes.map(t => { const v = (engTypeX[eng] || {})[t] || 0; if (v > maxHM) maxHM = v; return v; }));
        document.getElementById('engHeatmap').innerHTML = buildHeatmapHTML(hmNames, allTypes, hmMatrix, maxHM);

        let scHtml = '<table class="scorecard-table"><thead><tr><th>엔지니어</th><th>부서</th><th>건수</th><th>시간(h)</th><th>건당시간</th><th>활동일</th><th>건/일</th><th>고객사</th><th>제품수</th><th>가동시간</th><th>소정근무</th><th>가동률</th><th>직전 대비</th><th>업무강도</th></tr></thead><tbody>';
        engEntries.forEach(([name, m]) => {
            const daysActive = m.dates.size || 1;
            const perDay = (m.count / daysActive).toFixed(1);
            const perCase = m.count > 0 ? (m.hours / m.count).toFixed(1) : '-';
            const deptColorInfo = getDeptColor(m.dept);
            const billH = m.billableHours;
            const workH = engContractWorkH;
            const utilPctEng = workH > 0 ? (billH / workH) * 100 : 0;
            const utilBadge = utilPctEng >= CONFIG.UTIL.TARGET ? 'low' : utilPctEng >= CONFIG.UTIL.DANGER ? 'mid' : 'high';
            const intensity = m.hours / daysActive;
            const intBadge = intensity >= 10 ? 'high' : intensity >= 7 ? 'mid' : 'low';
            const intLabel = intensity >= 10 ? '과부하' : intensity >= 7 ? '적정' : '여유';
            const prevM = prevEngMap[name] || null;
            let compareText = compareContext.previousData.length ? '신규' : '비교없음';
            let compareBadge = compareContext.previousData.length ? 'mid' : 'low';
            if (prevM) {
                const prevUtil = prevEngContractWorkH > 0 ? (prevM.billableHours / prevEngContractWorkH) * 100 : 0;
                const countDelta = m.count - prevM.count;
                const utilDelta = utilPctEng - prevUtil;
                compareText = `${countDelta >= 0 ? '+' : ''}${countDelta}건 / ${utilDelta >= 0 ? '+' : ''}${utilDelta.toFixed(1)}%p`;
                compareBadge = utilDelta > 2 || countDelta > 0 ? 'low' : utilDelta < -2 || countDelta < 0 ? 'high' : 'mid';
            }
            scHtml += `<tr><td>${safeInlineText(name)}</td><td><span class="sc-dept" style="background:${deptColorInfo.bg};color:${deptColorInfo.color}">${safeInlineText(m.dept)}</span></td><td><strong>${m.count}</strong></td><td>${m.hours.toFixed(1)}</td><td>${perCase}h</td><td>${daysActive}</td><td>${perDay}</td><td>${m.custs.size}</td><td>${m.prods.size}</td><td>${billH.toFixed(1)}h</td><td>${workH}h</td><td><span class="sc-badge ${utilBadge}">${utilPctEng.toFixed(1)}%</span></td><td><span class="sc-badge ${compareBadge}">${safeInlineText(compareText)}</span></td><td><span class="sc-badge ${intBadge}">${intLabel} (${intensity.toFixed(1)}h/일)</span></td></tr>`;
        });
        scHtml += '</tbody></table>';
        document.getElementById('engScorecard').innerHTML = scHtml;
    }

        return {
            updateEngineerTab
        };
    }

    window.DASH_ENGINEER_TAB = {
        createEngineerTab
    };
})();
