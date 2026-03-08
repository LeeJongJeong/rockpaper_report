(function () {
    'use strict';

    function createSalesTab(deps) {
        const {
            CONFIG,
            COLORS,
            safeInlineText,
            getFilteredData,
            aggregateSales,
            upsertChart,
            typeCategoryOf,
            stackedBarConfig,
            aggregateByKeyAndDate,
            lineChartConfig,
            crossTab,
            buildHeatmapHTML
        } = deps;

    function updateSalesTab() {
        const data = getFilteredData();
        const salesMap = aggregateSales(data);
        const salesEntries = Object.entries(salesMap).sort((a, b) => b[1].count - a[1].count);

        if (!salesEntries.length) {
            document.getElementById('salesKpiRow').innerHTML = '';
            document.getElementById('salesScorecard').innerHTML = '';
            document.getElementById('salesHeatmap').innerHTML = '<p style="color:var(--gray-400);text-align:center;padding:20px;">데이터 없음</p>';
            return;
        }

        // === KPI 미니 ===
        const totalSalesH = salesEntries.reduce((s, e) => s + e[1].hours, 0);
        const allCusts = new Set(salesEntries.flatMap(([, m]) => [...m.custs]));
        const topSales = salesEntries[0];
        const avgCustPerSales = (allCusts.size / salesEntries.length).toFixed(1);
        const heavyLoad = salesEntries.filter(([, m]) => m.custs.size > allCusts.size / salesEntries.length * 1.5).length;
        document.getElementById('salesKpiRow').innerHTML = `
                <div class="kpi-mini"><div class="kpi-mini-label">담당영업 수</div><div class="kpi-mini-value">${salesEntries.length}</div><div class="kpi-mini-sub">명</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">총 지원 건수</div><div class="kpi-mini-value">${data.length}</div><div class="kpi-mini-sub">건</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">총 투입시간</div><div class="kpi-mini-value">${totalSalesH.toFixed(0)}</div><div class="kpi-mini-sub">시간(h)</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">인당 평균 고객사</div><div class="kpi-mini-value">${avgCustPerSales}</div><div class="kpi-mini-sub">곳 / 인</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">최다 고객사 담당</div><div class="kpi-mini-value">${safeInlineText(topSales[0])}</div><div class="kpi-mini-sub">${topSales[1].custs.size}곳, ${topSales[1].count}건</div></div>
            `;

        // ① 포트폴리오 버블: X=고객사수, Y=건수, R=제품수
        const bubbleData = salesEntries.map((e, i) => ({
            label: e[0],
            data: [{ x: e[1].custs.size, y: e[1].count, r: Math.max(5, e[1].prods.size * 4) }],
            backgroundColor: COLORS[i % COLORS.length] + '99',
            borderColor: COLORS[i % COLORS.length], borderWidth: 1
        }));
        upsertChart('chartSalesBubble', {
            type: 'bubble', data: { datasets: bubbleData },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 10 } },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: 고객사 ${ctx.parsed.x}곳, ${ctx.parsed.y}건, 제품 ${Math.round(ctx.raw.r / 4)}종` } }
                },
                scales: {
                    x: { title: { display: true, text: '담당 고객사수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, beginAtZero: true, ticks: { stepSize: 1 } },
                    y: { title: { display: true, text: '지원 건수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, beginAtZero: true }
                }
            }
        });

        // ② 건수 vs 투입시간 이중축 (가로 막대)
        const salesNames = salesEntries.map(e => e[0]);
        upsertChart('chartSalesCountHours', {
            type: 'bar',
            data: {
                labels: salesNames,
                datasets: [
                    { label: '지원건수', data: salesNames.map(s => salesMap[s].count), backgroundColor: '#4F46E5CC', borderColor: '#4F46E5', borderWidth: 1, borderRadius: 4, yAxisID: 'y', order: 2 },
                    { label: '투입시간(h)', data: salesNames.map(s => Math.round(salesMap[s].hours * 10) / 10), type: 'line', borderColor: '#EF4444', backgroundColor: '#EF444422', pointRadius: 4, pointHoverRadius: 6, tension: 0.3, yAxisID: 'y1', order: 1, fill: true }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                plugins: {
                    legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 12 } },
                    tooltip: { callbacks: { afterBody: items => { const s = salesNames[items[0].dataIndex]; const cnt = salesMap[s].count; const hrs = salesMap[s].hours; return cnt > 0 ? `건당 평균: ${(hrs / cnt).toFixed(1)}h` : ''; } } }
                },
                scales: {
                    y: { ticks: { font: { size: 11 } }, grid: { display: false } },
                    x: { beginAtZero: true, title: { display: true, text: '건수', font: { size: 11 } }, ticks: { font: { size: 11 } } },
                    y1: { display: false, beginAtZero: true }
                }
            }
        });

        // ③ 담당영업별 지원유형 구성 스택바
        const catNames = ['기술지원', '점검지원', 'Presales', '내부업무', '셀프스터디', '교육', '기타'];
        const catColors = ['#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#9CA3AF'];
        const salesCatMap = {};
        for (let i = 0; i < data.length; i++) {
            const s = String(data[i]['담당영업'] || '').trim();
            const t = String(data[i]['지원유형'] || '').trim();
            if (!s || !t) continue;
            if (!salesCatMap[s]) salesCatMap[s] = {};
            const cat = data[i]._typeCategory || typeCategoryOf(t);
            salesCatMap[s][cat] = (salesCatMap[s][cat] || 0) + 1;
        }
        upsertChart('chartSalesTypeComp', stackedBarConfig(
            salesNames,
            catNames.map((cat, i) => ({
                label: cat, data: salesNames.map(s => (salesCatMap[s] || {})[cat] || 0),
                backgroundColor: catColors[i] + 'CC', borderColor: catColors[i], borderWidth: 1
            })),
            true, '건수', '담당영업'
        ));

        // ④ 담당영업별 고객사수 + 투입 엔지니어수 (가로 막대)
        upsertChart('chartSalesCustEng', {
            type: 'bar',
            data: {
                labels: salesNames,
                datasets: [
                    { label: '담당 고객사수', data: salesNames.map(s => salesMap[s].custs.size), backgroundColor: '#10B981CC', borderColor: '#10B981', borderWidth: 1, borderRadius: 4 },
                    { label: '투입 엔지니어수', data: salesNames.map(s => salesMap[s].engs.size), backgroundColor: '#8B5CF6CC', borderColor: '#8B5CF6', borderWidth: 1, borderRadius: 4 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                plugins: { legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 10 } } },
                scales: {
                    y: { ticks: { font: { size: 11 } }, grid: { display: false } },
                    x: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } }, title: { display: true, text: '수량', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } }
                }
            }
        });

        // ⑤ Top 5 담당영업 일별 추이 (라인)
        const salesDaily = aggregateByKeyAndDate(data, '담당영업');
        const allDates = [...new Set(data.filter(r => r._dateStr).map(r => r._dateStr))].sort();
        const top5Sales = salesEntries.slice(0, CONFIG.CHART_TOP_N.TREND).map(e => e[0]);
        upsertChart('chartSalesDaily', lineChartConfig(
            allDates,
            top5Sales.map((s, i) => ({
                label: s,
                data: allDates.map(d => (salesDaily[s] || {})[d] || 0),
                borderColor: COLORS[i % COLORS.length],
                tension: 0.3, pointRadius: 2, fill: false
            }))
        ));

        // ⑥ 담당영업 × 고객사 히트맵 (Top 10 고객사)
        const topCustsForHM = Object.entries(
            data.reduce((acc, r) => {
                const c = String(r['고객사명'] || '').trim();
                if (c) acc[c] = (acc[c] || 0) + 1;
                return acc;
            }, {})
        ).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
        const salesCustX = crossTab(data, '담당영업', '고객사명');
        let maxHMVal = 0;
        const hmMatrix = salesNames.map(s =>
            topCustsForHM.map(c => { const v = (salesCustX[s] || {})[c] || 0; if (v > maxHMVal) maxHMVal = v; return v; })
        );
        document.getElementById('salesHeatmap').innerHTML = buildHeatmapHTML(salesNames, topCustsForHM, hmMatrix, maxHMVal);

        // ⑦ 종합 스코어카드
        const totalAll = salesEntries.reduce((s, e) => s + e[1].count, 0);
        let scHtml = '<table class="scorecard-table"><thead><tr><th>담당영업</th><th>고객사수</th><th>건수</th><th>비율</th><th>총시간(h)</th><th>건당시간</th><th>제품수</th><th>투입엔지니어</th></tr></thead><tbody>';
        salesEntries.forEach(([name, m]) => {
            const pct = totalAll > 0 ? ((m.count / totalAll) * 100).toFixed(1) : 0;
            const perCase = m.count > 0 ? (m.hours / m.count).toFixed(1) : '-';
            scHtml += `<tr>
                    <td><strong>${safeInlineText(name)}</strong></td>
                    <td>${m.custs.size}곳</td>
                    <td><strong>${m.count}</strong></td>
                    <td>${pct}%</td>
                    <td>${m.hours.toFixed(1)}</td>
                    <td>${perCase}h</td>
                    <td>${m.prods.size}종</td>
                    <td>${m.engs.size}명</td>
                </tr>`;
        });
        scHtml += '</tbody></table>';
        document.getElementById('salesScorecard').innerHTML = scHtml;
    }

        return {
            updateSalesTab
        };
    }

    window.DASH_SALES_TAB = {
        createSalesTab
    };
})();
