(function () {
    'use strict';

    function createCustomerTab(deps) {
        const {
            CONFIG,
            COLORS,
            safeInlineText,
            escapeAttr,
            getFilteredData,
            getComparablePeriodContext,
            aggregateCustomers,
            buildAnalyticsSummary,
            summarizeEntityTransition,
            buildDeltaHtml,
            upsertChart,
            typeCategoryOf,
            stackedBarConfig,
            aggregateByKeyAndDate,
            lineChartConfig,
            barChartConfig,
            crossTab,
            buildHeatmapHTML
        } = deps;

    function updateCustomerTab() {
        const data = getFilteredData();
        const compareContext = getComparablePeriodContext();
        const custMap = aggregateCustomers(data);
        const custEntries = Object.entries(custMap).sort((a, b) => b[1].count - a[1].count);

        if (!custEntries.length) {
            document.getElementById('custKpiRow').innerHTML = '';
            document.getElementById('custScorecard').innerHTML = '';
            return;
        }

        const prevCustMap = aggregateCustomers(compareContext.previousData);
        const currentSummary = buildAnalyticsSummary(data, { range: compareContext.currentRange, custMap: custMap });
        const previousSummary = buildAnalyticsSummary(compareContext.previousData, { range: compareContext.previousRange, custMap: prevCustMap });
        const customerTransition = summarizeEntityTransition(currentSummary.customerSet, previousSummary.customerSet);
        const topCust = custEntries[0];

        document.getElementById('custKpiRow').innerHTML = `
                <div class="kpi-mini"><div class="kpi-mini-label">지원 고객사</div><div class="kpi-mini-value">${currentSummary.activeCustomerCount}</div><div class="kpi-mini-sub">${buildDeltaHtml(currentSummary.activeCustomerCount, previousSummary.activeCustomerCount, { decimals: 0, unit: '곳' })}</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">반복 고객 비율</div><div class="kpi-mini-value">${customerTransition.retainedRatio.toFixed(1)}%</div><div class="kpi-mini-sub">직전에도 지원 ${customerTransition.retainedCount}곳</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">신규 고객</div><div class="kpi-mini-value">${customerTransition.newCount}</div><div class="kpi-mini-sub">전체의 ${customerTransition.newRatio.toFixed(1)}%</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">단일엔지니어 의존</div><div class="kpi-mini-value">${currentSummary.singleEngineerCustomerRatio.toFixed(1)}%</div><div class="kpi-mini-sub">${buildDeltaHtml(currentSummary.singleEngineerCustomerRatio, previousSummary.singleEngineerCustomerRatio, { decimals: 1, mode: 'pp', lowerIsBetter: true })}</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">Top3 고객 집중도</div><div class="kpi-mini-value">${currentSummary.top3CustomerShare.toFixed(1)}%</div><div class="kpi-mini-sub">${buildDeltaHtml(currentSummary.top3CustomerShare, previousSummary.top3CustomerShare, { decimals: 1, mode: 'pp', lowerIsBetter: true })}</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">최다지원고객</div><div class="kpi-mini-value">${safeInlineText(topCust[0])}</div><div class="kpi-mini-sub">지원 ${topCust[1].count}건 · ${topCust[1].hours.toFixed(1)}h</div></div>
            `;

        const topBubble = custEntries.slice(0, 20);
        const bubbleData = topBubble.map((e, i) => ({
            label: e[0],
            data: [{ x: e[1].count, y: e[1].prods.size, r: Math.max(5, e[1].engs.size * 4) }],
            backgroundColor: COLORS[i % COLORS.length] + '99',
            borderColor: COLORS[i % COLORS.length], borderWidth: 1
        }));
        upsertChart('chartCustBubble', {
            type: 'bubble', data: { datasets: bubbleData },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: 'top', labels: { font: { size: 10, family: 'Noto Sans KR' }, usePointStyle: true, padding: 8 } },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.x}건, 제품 ${ctx.parsed.y}종, 엔지니어 ${Math.round(ctx.raw.r / 4)}명` } }
                },
                scales: {
                    x: { title: { display: true, text: '지원 건수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, beginAtZero: true },
                    y: { title: { display: true, text: '사용 제품 수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, beginAtZero: true, ticks: { stepSize: 1 } }
                }
            }
        });

        const top15 = custEntries.slice(0, 15);
        const catNames = ['기술지원', '점검지원', 'Presales', '내부업무', '셀프스터디', '교육', '기타'];
        const catColors2 = ['#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#9CA3AF'];
        const custCatMap = {};
        data.forEach(r => {
            const c = String(r['고객사명'] || '').trim();
            const t = String(r['지원유형'] || '').trim();
            if (!c || !t) return;
            if (!custCatMap[c]) custCatMap[c] = {};
            const cat = r._typeCategory || typeCategoryOf(t);
            custCatMap[c][cat] = (custCatMap[c][cat] || 0) + 1;
        });
        const top15Names = top15.map(e => e[0]);
        upsertChart('chartCustTypeComp', stackedBarConfig(
            top15Names,
            catNames.map((cat, i) => ({
                label: cat, data: top15Names.map(c => (custCatMap[c] || {})[cat] || 0),
                backgroundColor: catColors2[i] + 'CC', borderColor: catColors2[i], borderWidth: 1
            })),
            true, '건수', '고객사'
        ));

        upsertChart('chartCustEfficiency', {
            type: 'bar',
            data: {
                labels: top15Names,
                datasets: [
                    { label: '지원건수', data: top15Names.map(c => custMap[c].count), backgroundColor: '#4F46E5CC', borderColor: '#4F46E5', borderWidth: 1, borderRadius: 4, yAxisID: 'y', order: 2 },
                    { label: '투입시간(h)', data: top15Names.map(c => Math.round(custMap[c].hours * 10) / 10), type: 'line', borderColor: '#EF4444', backgroundColor: '#EF444422', pointRadius: 4, pointHoverRadius: 6, tension: 0.3, yAxisID: 'y1', order: 1, fill: true }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                plugins: {
                    legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 12 } },
                    tooltip: { callbacks: { afterBody: (items) => { const idx = items[0].dataIndex; const c = top15Names[idx]; const m = custMap[c]; const perCase = m.count > 0 ? (m.hours / m.count).toFixed(1) : '-'; return `건당 소요: ${perCase}h | 엔지니어: ${m.engs.size}명 | 제품: ${m.prods.size}종`; } } }
                },
                scales: {
                    y: { ticks: { font: { size: 11 } }, grid: { display: false }, title: { display: true, text: '고객사', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                    x: { beginAtZero: true, position: 'bottom', title: { display: true, text: '건수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, ticks: { font: { size: 11 } } },
                    y1: { display: false, beginAtZero: true }
                }
            }
        });

        const custDaily = aggregateByKeyAndDate(data, '고객사명');
        const allDates = [...new Set(data.filter(r => r._dateStr).map(r => r._dateStr))].sort();
        const top5 = custEntries.slice(0, 5).map(e => e[0]);
        upsertChart('chartCustTrend', lineChartConfig(
            allDates,
            top5.map((name, i) => ({
                label: name, data: allDates.map(d => (custDaily[name] || {})[d] || 0),
                borderColor: COLORS[i % COLORS.length], tension: 0.3, pointRadius: 2
            })),
            '건수', '날짜'
        ));

        const salesMap = {};
        data.forEach(r => {
            const s = String(r['담당영업'] || '').trim();
            const c = String(r['고객사명'] || '').trim();
            if (!s) return;
            if (!salesMap[s]) salesMap[s] = { count: 0, custs: new Set(), hours: 0 };
            salesMap[s].count++;
            salesMap[s].hours += Number(r._hoursNum) || 0;
            if (c) salesMap[s].custs.add(c);
        });
        const salesEntries = Object.entries(salesMap).sort((a, b) => b[1].count - a[1].count);
        upsertChart('chartCustSales', {
            type: 'bar',
            data: {
                labels: salesEntries.map(e => e[0]),
                datasets: [
                    { label: '지원 건수', data: salesEntries.map(e => e[1].count), backgroundColor: '#4F46E5CC', borderColor: '#4F46E5', borderWidth: 1, borderRadius: 4, xAxisID: 'x' },
                    { label: '담당 고객사 수', data: salesEntries.map(e => e[1].custs.size), backgroundColor: '#10B981CC', borderColor: '#10B981', borderWidth: 1, borderRadius: 4, xAxisID: 'x1' }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                plugins: {
                    legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, pointStyle: 'circle' } },
                    tooltip: { callbacks: { afterBody: (items) => { const idx = items[0].dataIndex; const sm = salesEntries[idx][1]; return `총 시간: ${sm.hours.toFixed(1)}h`; } } }
                },
                scales: {
                    y: { ticks: { font: { size: 11 } }, grid: { display: false }, title: { display: true, text: '담당영업', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                    x: { position: 'bottom', beginAtZero: true, ticks: { font: { size: 11 } }, title: { display: true, text: '건수 / 고객사수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                    x1: { display: false, beginAtZero: true }
                }
            }
        });

        const top20 = custEntries.slice(0, 20);
        const riskColors = top20.map(e => {
            const n = e[1].engs.size;
            return n <= 1 ? '#EF4444CC' : n <= 2 ? '#F59E0BCC' : '#10B981CC';
        });
        upsertChart('chartCustEngRisk', barChartConfig(
            top20.map(e => e[0]),
            top20.map(e => e[1].engs.size),
            '투입 엔지니어 수', riskColors, true, '엔지니어 수(명)', '고객사'
        ));

        const allProdsForCust = [...new Set(data.map(r => String(r['제품명'] || '').trim()).filter(Boolean))];
        const custProdX = crossTab(data, '고객사명', '제품명');
        let maxCH = 0;
        const top20Names = top20.map(e => e[0]);
        const chMatrix = top20Names.map(c => allProdsForCust.map(p => { const v = (custProdX[c] || {})[p] || 0; if (v > maxCH) maxCH = v; return v; }));
        document.getElementById('custHeatmap').innerHTML = buildHeatmapHTML(top20Names, allProdsForCust, chMatrix, maxCH);

        let cscHtml = '<table class="scorecard-table"><thead><tr><th>고객사</th><th>건수</th><th>비중</th><th>시간(h)</th><th>건당시간</th><th>제품</th><th>엔지니어</th><th>담당영업</th><th>고객 상태</th><th>직전 대비</th><th>인력 리스크</th></tr></thead><tbody>';
        custEntries.slice(0, 30).forEach(([name, m]) => {
            const risk = m.engs.size <= 1 ? 'high' : m.engs.size <= 2 ? 'mid' : 'low';
            const riskLabel = m.engs.size <= 1 ? '위험' : m.engs.size <= 2 ? '주의' : '양호';
            const prodsStr = [...m.prods].slice(0, 3).join(', ') + (m.prods.size > 3 ? ` +${m.prods.size - 3}` : '');
            const salesStr = [...m.sales].join(', ');
            const perCase = m.count > 0 ? (m.hours / m.count).toFixed(1) : '-';
            const share = currentSummary.dataCount > 0 ? ((m.count / currentSummary.dataCount) * 100) : 0;
            const prevM = prevCustMap[name] || null;
            const lifecycleLabel = prevM ? '반복' : (compareContext.previousData.length ? '신규' : '비교없음');
            const lifecycleBadge = prevM ? 'low' : 'mid';
            let compareText = compareContext.previousData.length ? '신규' : '비교없음';
            let compareBadge = compareContext.previousData.length ? 'mid' : 'low';
            if (prevM) {
                const countDelta = m.count - prevM.count;
                const hoursDelta = m.hours - prevM.hours;
                compareText = `${countDelta >= 0 ? '+' : ''}${countDelta}건 / ${hoursDelta >= 0 ? '+' : ''}${hoursDelta.toFixed(1)}h`;
                compareBadge = countDelta > 0 || hoursDelta > 0 ? 'low' : countDelta < 0 || hoursDelta < 0 ? 'high' : 'mid';
            }
            cscHtml += `<tr><td>${safeInlineText(name)}</td><td><strong>${m.count}</strong></td><td>${share.toFixed(1)}%</td><td>${m.hours.toFixed(1)}</td><td>${perCase}h</td><td title="${escapeAttr([...m.prods].join(', '))}">${safeInlineText(prodsStr)}</td><td>${m.engs.size}명</td><td>${safeInlineText(salesStr)}</td><td><span class="sc-badge ${lifecycleBadge}">${safeInlineText(lifecycleLabel)}</span></td><td><span class="sc-badge ${compareBadge}">${safeInlineText(compareText)}</span></td><td><span class="sc-badge ${risk}">${riskLabel}</span></td></tr>`;
        });
        cscHtml += '</tbody></table>';
        document.getElementById('custScorecard').innerHTML = cscHtml;
    }

    /* ============================================================
       TAB 6: 지원내역 상세 테이블
       ============================================================ */

        return {
            updateCustomerTab
        };
    }

    window.DASH_CUSTOMER_TAB = {
        createCustomerTab
    };
})();
