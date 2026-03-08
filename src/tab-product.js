(function () {
    'use strict';

    function createProductTab(deps) {
        const {
            COLORS,
            safeInlineText,
            getFilteredData,
            aggregateProducts,
            upsertChart,
            productGroupOf,
            pieChartConfig,
            typeCategoryOf,
            stackedBarConfig,
            buildDeptLegendHTML,
            getDeptColor,
            aggregateByKeyAndDate,
            lineChartConfig,
            crossTab,
            buildHeatmapHTML,
            getAllDeptNames
        } = deps;

    function updateProductTab() {
        const data = getFilteredData();
        const prodMap = aggregateProducts(data);
        const prodEntries = Object.entries(prodMap).sort((a, b) => b[1].count - a[1].count);

        if (!prodEntries.length) {
            document.getElementById('prodKpiRow').innerHTML = '';
            document.getElementById('prodHeatmap').innerHTML = '';
            document.getElementById('prodScorecard').innerHTML = '';
            return;
        }

        // === KPI 미니 ===
        const totalProdH = prodEntries.reduce((s, e) => s + e[1].hours, 0);
        const totalCust = new Set(); prodEntries.forEach(e => e[1].custs.forEach(c => totalCust.add(c)));
        const totalEngs = new Set(); prodEntries.forEach(e => e[1].engs.forEach(en => totalEngs.add(en)));
        const avgPerProd = (prodEntries.reduce((s, e) => s + e[1].count, 0) / prodEntries.length).toFixed(1);
        const singleEngProds = prodEntries.filter(e => e[1].engs.size <= 1).length;
        document.getElementById('prodKpiRow').innerHTML = `
                <div class="kpi-mini"><div class="kpi-mini-label">지원 제품 수</div><div class="kpi-mini-value">${prodEntries.length}</div><div class="kpi-mini-sub">종</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">총 투입시간</div><div class="kpi-mini-value">${totalProdH.toFixed(0)}</div><div class="kpi-mini-sub">시간(h)</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">제품당 평균</div><div class="kpi-mini-value">${avgPerProd}</div><div class="kpi-mini-sub">건/제품</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">연관 고객사</div><div class="kpi-mini-value">${totalCust.size}</div><div class="kpi-mini-sub">곳</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">⚠ 단일엔지니어 제품</div><div class="kpi-mini-value">${singleEngProds}</div><div class="kpi-mini-sub">종 (리스크)</div></div>
            `;

        // ① 포트폴리오 맵 버블: X=고객사수, Y=건수, R=엔지니어수
        const bubbleData = prodEntries.map((e, i) => ({
            label: e[0],
            data: [{ x: e[1].custs.size, y: e[1].count, r: Math.max(5, e[1].engs.size * 4) }],
            backgroundColor: COLORS[i % COLORS.length] + '99',
            borderColor: COLORS[i % COLORS.length], borderWidth: 1
        }));
        upsertChart('chartProdBubble', {
            type: 'bubble', data: { datasets: bubbleData },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 10 } },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: 고객사 ${ctx.parsed.x}곳, ${ctx.parsed.y}건, 엔지니어 ${Math.round(ctx.raw.r / 4)}명` } }
                },
                scales: {
                    x: { title: { display: true, text: '고객사 수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, beginAtZero: true },
                    y: { title: { display: true, text: '지원 건수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, beginAtZero: true }
                }
            }
        });

        // ② 제품군별 도넛
        const groupCounts = {};
        data.forEach(r => {
            const p = String(r['제품명'] || '').trim();
            if (!p) return;
            const g = productGroupOf(p);
            groupCounts[g] = (groupCounts[g] || 0) + 1;
        });
        const gEntries = Object.entries(groupCounts).sort((a, b) => b[1] - a[1]);
        upsertChart('chartProdGroup', pieChartConfig(gEntries.map(e => e[0]), gEntries.map(e => e[1])));

        // ③ 제품별 건수 vs 투입시간 이중축 차트 (건당시간 효율 분석)
        const topProdNames10 = prodEntries.slice(0, 10).map(e => e[0]);
        upsertChart('chartProdEfficiency', {
            type: 'bar',
            data: {
                labels: topProdNames10,
                datasets: [
                    { label: '지원건수', data: topProdNames10.map(p => prodMap[p].count), backgroundColor: '#4F46E5CC', borderColor: '#4F46E5', borderWidth: 1, borderRadius: 4, yAxisID: 'y', order: 2 },
                    { label: '투입시간(h)', data: topProdNames10.map(p => Math.round(prodMap[p].hours * 10) / 10), type: 'line', borderColor: '#EF4444', backgroundColor: '#EF444422', pointRadius: 4, pointHoverRadius: 6, tension: 0.3, yAxisID: 'y1', order: 1, fill: true }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 12 } },
                    tooltip: { callbacks: { afterBody: (items) => { const idx = items[0].dataIndex; const p = topProdNames10[idx]; const m = prodMap[p]; const perCase = m.count > 0 ? (m.hours / m.count).toFixed(1) : '-'; return `건당 소요: ${perCase}h`; } } }
                },
                scales: {
                    x: { ticks: { font: { size: 11 }, maxRotation: 45 }, grid: { display: false }, title: { display: true, text: '제품명', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                    y: { beginAtZero: true, position: 'left', title: { display: true, text: '건수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, ticks: { stepSize: 5, font: { size: 11 } } },
                    y1: { beginAtZero: true, position: 'right', title: { display: true, text: '시간(h)', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, ticks: { font: { size: 11 } }, grid: { drawOnChartArea: false } }
                }
            }
        });

        // ④ 제품별 지원유형 구성 (대분류 스택바)
        const catNames = ['기술지원', '점검지원', 'Presales', '내부업무', '셀프스터디', '교육', '기타'];
        const catColors = ['#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#9CA3AF'];
        const topProdNames = prodEntries.slice(0, 10).map(e => e[0]);
        const prodCatMap = {};
        data.forEach(r => {
            const p = String(r['제품명'] || '').trim();
            const t = String(r['지원유형'] || '').trim();
            if (!p || !t) return;
            if (!prodCatMap[p]) prodCatMap[p] = {};
            const cat = r._typeCategory || typeCategoryOf(t);
            prodCatMap[p][cat] = (prodCatMap[p][cat] || 0) + 1;
        });
        upsertChart('chartProdTypeComp', stackedBarConfig(
            topProdNames,
            catNames.map((cat, i) => ({
                label: cat, data: topProdNames.map(p => (prodCatMap[p] || {})[cat] || 0),
                backgroundColor: catColors[i] + 'CC', borderColor: catColors[i], borderWidth: 1
            })),
            true, '건수', '제품명'
        ));

        // ⑤ 제품별 부서 투입 비중 (동적 부서 색상)
        const prodDeptMap = {};
        data.forEach(r => {
            const p = String(r['제품명'] || '').trim();
            const d = String(r['부서명'] || '').trim();
            if (!p || !d) return;
            if (!prodDeptMap[p]) prodDeptMap[p] = {};
            prodDeptMap[p][d] = (prodDeptMap[p][d] || 0) + 1;
        });
        const depts = [...new Set(data.map(r => String(r['부서명'] || '').trim()).filter(Boolean))].sort();
        // 레전드 동적 생성
        const prodDeptLegendEl = document.getElementById('prodDeptLegend');
        if (prodDeptLegendEl) prodDeptLegendEl.innerHTML = buildDeptLegendHTML(depts);
        upsertChart('chartProdDept', stackedBarConfig(
            topProdNames,
            depts.map(d => ({
                label: d, data: topProdNames.map(p => (prodDeptMap[p] || {})[d] || 0),
                backgroundColor: getDeptColor(d).color + 'CC',
                borderColor: getDeptColor(d).color, borderWidth: 1
            })),
            true, '건수', '제품명'
        ));

        // ⑥ 일별 추이
        const prodDaily = aggregateByKeyAndDate(data, '제품명');
        const allDates = [...new Set(data.filter(r => r._dateStr).map(r => r._dateStr))].sort();
        const topProds = prodEntries.slice(0, 6).map(e => e[0]);
        upsertChart('chartProdDaily', lineChartConfig(
            allDates,
            topProds.map((name, i) => ({
                label: name, data: allDates.map(d => (prodDaily[name] || {})[d] || 0),
                borderColor: COLORS[i % COLORS.length], tension: 0.3, pointRadius: 2
            })),
            '건수', '날짜'
        ));

        // ⑦ 히트맵: 제품 × 엔지니어
        const allEngs = [...new Set(data.map(r => String(r['엔지니어'] || '').trim()).filter(Boolean))];
        const prodEngX = crossTab(data, '제품명', '엔지니어');
        let maxPH = 0;
        const phMatrix = prodEntries.map(([prod]) => allEngs.map(eng => { const v = (prodEngX[prod] || {})[eng] || 0; if (v > maxPH) maxPH = v; return v; }));
        document.getElementById('prodHeatmap').innerHTML = buildHeatmapHTML(prodEntries.map(e => e[0]), allEngs, phMatrix, maxPH);

        // ⑧ 스코어카드 (확장: 건당시간, 부서 비율 추가)
        const scDepts = getAllDeptNames(data);
        let pscHtml = '<table class="scorecard-table"><thead><tr><th>제품</th><th>제품군</th><th>건수</th><th>시간(h)</th><th>건당시간</th><th>고객사</th><th>엔지니어</th><th>부서별 비율</th><th>엔지니어 의존도</th></tr></thead><tbody>';
        prodEntries.forEach(([name, m]) => {
            const grp = productGroupOf(name);
            const perCase = m.count > 0 ? (m.hours / m.count).toFixed(1) : '-';
            const deptRatioStr = scDepts.map(d => {
                const cnt = (prodDeptMap[name] || {})[d] || 0;
                return cnt > 0 ? `${d.replace(/\s/g, '')}:${cnt}` : null;
            }).filter(Boolean).join(' / ') || '-';
            const depRisk = m.engs.size <= 1 ? 'high' : m.engs.size <= 2 ? 'mid' : 'low';
            const depLabel = m.engs.size <= 1 ? '⚠ 단일' : m.engs.size <= 2 ? '주의' : '양호';
            pscHtml += `<tr><td>${safeInlineText(name)}</td><td>${safeInlineText(grp)}</td><td><strong>${m.count}</strong></td><td>${m.hours.toFixed(1)}</td><td>${perCase}h</td><td>${m.custs.size}</td><td>${m.engs.size}명</td><td style="font-size:10px;white-space:nowrap">${safeInlineText(deptRatioStr)}</td><td><span class="sc-badge ${depRisk}">${depLabel} (${m.engs.size}명)</span></td></tr>`;
        });
        pscHtml += '</tbody></table>';
        document.getElementById('prodScorecard').innerHTML = pscHtml;
    }

        return {
            updateProductTab
        };
    }

    window.DASH_PRODUCT_TAB = {
        createProductTab
    };
})();
