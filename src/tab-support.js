(function () {
    'use strict';

    function createSupportTab(deps) {
        const {
            safeInlineText,
            getFilteredData,
            visitTypeOf,
            typeCategoryOf,
            upsertChart,
            pieChartConfig,
            lineChartConfig,
            stackedBarConfig,
            crossTab,
            buildHeatmapHTML
        } = deps;

    function updateSupportTab() {
        const data = getFilteredData();
        if (!data.length) {
            document.getElementById('typeKpiRow').innerHTML = '';
            document.getElementById('typeScorecard').innerHTML = '';
            return;
        }

        // 사전 집계
        let totalInternal = 0, totalExternal = 0, totalVisit = 0, totalRemote = 0, totalOther = 0;
        let totalHoursAll = 0;
        const catCounts = {}, typeCounts = {}, typeHours = {}, typeEngs = {}, typeCusts = {};
        const catDates = {};
        data.forEach(r => {
            const t = String(r['지원유형'] || '').trim();
            if (!t) return;
            typeCounts[t] = (typeCounts[t] || 0) + 1;
            const h = Number(r._hoursNum) || 0;
            typeHours[t] = (typeHours[t] || 0) + h;
            totalHoursAll += h;
            const eng = String(r['엔지니어'] || '').trim();
            if (eng) { if (!typeEngs[t]) typeEngs[t] = new Set(); typeEngs[t].add(eng); }
            const cust = String(r['고객사명'] || '').trim();
            if (cust) { if (!typeCusts[t]) typeCusts[t] = new Set(); typeCusts[t].add(cust); }
            if (r._isInternal) totalInternal++; else totalExternal++;
            const vt = r._visitType || visitTypeOf(t);
            if (vt === '방문') totalVisit++; else if (vt === '원격') totalRemote++; else totalOther++;
            const cat = r._typeCategory || typeCategoryOf(t);
            catCounts[cat] = (catCounts[cat] || 0) + 1;
            if (r._dateStr) {
                if (!catDates[cat]) catDates[cat] = {};
                catDates[cat][r._dateStr] = (catDates[cat][r._dateStr] || 0) + 1;
            }
        });

        // === KPI 미니 ===
        const extPct = data.length > 0 ? ((totalExternal / data.length) * 100).toFixed(1) : 0;
        const visitPct = (totalVisit + totalRemote) > 0 ? ((totalVisit / (totalVisit + totalRemote)) * 100).toFixed(1) : 0;
        const uniqueTypes = Object.keys(typeCounts).length;
        const avgHPerCase = data.length > 0 ? (totalHoursAll / data.length).toFixed(1) : 0;
        document.getElementById('typeKpiRow').innerHTML = `
                <div class="kpi-mini"><div class="kpi-mini-label">지원유형 종류</div><div class="kpi-mini-value">${uniqueTypes}</div><div class="kpi-mini-sub">가지</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">외부 고객지원</div><div class="kpi-mini-value">${totalExternal}</div><div class="kpi-mini-sub">${extPct}% of 전체</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">방문 지원</div><div class="kpi-mini-value">${totalVisit}</div><div class="kpi-mini-sub">방문비율 ${visitPct}%</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">건당 평균시간</div><div class="kpi-mini-value">${avgHPerCase}h</div><div class="kpi-mini-sub">총 ${totalHoursAll.toFixed(0)}h</div></div>
            `;

        // ① 대분류 도넛
        const catEntries = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
        upsertChart('chartTypeCat', pieChartConfig(catEntries.map(e => e[0]), catEntries.map(e => e[1])));

        // ② 방문 vs 원격 파이
        upsertChart('chartTypeVisitRemote', {
            type: 'doughnut',
            data: {
                labels: ['방문', '원격', '기타(내부)'],
                datasets: [{
                    data: [totalVisit, totalRemote, totalOther],
                    backgroundColor: ['#4F46E5CC', '#0EA5E9CC', '#F59E0BCC'],
                    borderColor: ['#4F46E5', '#0EA5E9', '#F59E0B'], borderWidth: 2
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { font: { size: 12, family: 'Noto Sans KR' }, padding: 12, usePointStyle: true } },
                    tooltip: { callbacks: { label: ctx => { const total = ctx.dataset.data.reduce((a, b) => a + b, 0); return ` ${ctx.label}: ${ctx.parsed}건 (${((ctx.parsed / total) * 100).toFixed(1)}%)`; } } }
                }
            }
        });

        // ③ 지원유형별 건수 vs 투입시간 이중축 차트
        const typeEntries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
        const topTypeNames = typeEntries.slice(0, 12).map(e => e[0]);
        upsertChart('chartTypeCountHours', {
            type: 'bar',
            data: {
                labels: topTypeNames,
                datasets: [
                    { label: '건수', data: topTypeNames.map(t => typeCounts[t] || 0), backgroundColor: '#4F46E5CC', borderColor: '#4F46E5', borderWidth: 1, borderRadius: 4, yAxisID: 'y', order: 2 },
                    { label: '투입시간(h)', data: topTypeNames.map(t => Math.round((typeHours[t] || 0) * 10) / 10), type: 'line', borderColor: '#EF4444', backgroundColor: '#EF444422', pointRadius: 4, pointHoverRadius: 6, tension: 0.3, yAxisID: 'y1', order: 1, fill: true }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                plugins: {
                    legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 12 } },
                    tooltip: { callbacks: { afterBody: (items) => { const idx = items[0].dataIndex; const t = topTypeNames[idx]; const cnt = typeCounts[t] || 0; const hrs = typeHours[t] || 0; const perCase = cnt > 0 ? (hrs / cnt).toFixed(1) : '-'; return `건당 소요: ${perCase}h`; } } }
                },
                scales: {
                    y: { ticks: { font: { size: 11 } }, grid: { display: false } },
                    x: { beginAtZero: true, position: 'bottom', title: { display: true, text: '건수', font: { size: 11 } }, ticks: { font: { size: 11 } } },
                    y1: { display: false, beginAtZero: true }
                }
            }
        });

        // ④ 대분류별 일별 추이 (라인)
        const allDates = [...new Set(data.filter(r => r._dateStr).map(r => r._dateStr))].sort();
        const catColorMap = { '기술지원': '#4F46E5', '점검지원': '#0EA5E9', 'Presales': '#10B981', '내부업무': '#F59E0B', '셀프스터디': '#EC4899', '교육': '#8B5CF6', '기타': '#9CA3AF' };
        upsertChart('chartTypeTrend', lineChartConfig(
            allDates,
            catEntries.map(([cat]) => ({
                label: cat,
                data: allDates.map(d => (catDates[cat] || {})[d] || 0),
                borderColor: catColorMap[cat] || '#9CA3AF',
                tension: 0.3, pointRadius: 2, fill: false
            }))
        ));

        // ⑤ 부서별 업무유형 비중 (100% 스택바)
        const deptCatMap = {};
        data.forEach(r => {
            const dept = String(r['부서명'] || '').trim();
            const t = String(r['지원유형'] || '').trim();
            if (!dept || !t) return;
            const cat = r._typeCategory || typeCategoryOf(t);
            if (!deptCatMap[dept]) deptCatMap[dept] = {};
            deptCatMap[dept][cat] = (deptCatMap[dept][cat] || 0) + 1;
        });
        const depts = Object.keys(deptCatMap).sort();
        const catKeys = catEntries.map(e => e[0]);
        upsertChart('chartTypeDeptComp', stackedBarConfig(
            depts,
            catKeys.map((cat, i) => ({
                label: cat, data: depts.map(d => (deptCatMap[d] || {})[cat] || 0),
                backgroundColor: (catColorMap[cat] || '#9CA3AF') + 'CC',
                borderColor: catColorMap[cat] || '#9CA3AF', borderWidth: 1
            })),
            false
        ));

        // ⑥ 지원유형별 엔지니어 투입수 (인력 분산 분석)
        const typeEngCounts = typeEntries.slice(0, 12).map(([t]) => ({ name: t, engCnt: typeEngs[t] ? typeEngs[t].size : 0, custCnt: typeCusts[t] ? typeCusts[t].size : 0 }));
        upsertChart('chartTypeEngCount', {
            type: 'bar',
            data: {
                labels: typeEngCounts.map(e => e.name),
                datasets: [
                    { label: '투입 엔지니어수', data: typeEngCounts.map(e => e.engCnt), backgroundColor: '#4F46E5CC', borderColor: '#4F46E5', borderWidth: 1, borderRadius: 4 },
                    { label: '관련 고객사수', data: typeEngCounts.map(e => e.custCnt), backgroundColor: '#10B981CC', borderColor: '#10B981', borderWidth: 1, borderRadius: 4 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                plugins: { legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 10 } } },
                scales: {
                    y: { ticks: { font: { size: 11 } }, grid: { display: false }, title: { display: true, text: '지원유형', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                    x: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } }, title: { display: true, text: '수량', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } }
                }
            }
        });

        // ⑦ 히트맵: 지원유형 × 제품
        const allProdsForType = [...new Set(data.map(r => String(r['제품명'] || '').trim()).filter(Boolean))];
        const typeProdsX = crossTab(data, '지원유형', '제품명');
        let maxTH = 0;
        const thNames = typeEntries.map(e => e[0]);
        const thMatrix = thNames.map(t => allProdsForType.map(p => { const v = (typeProdsX[t] || {})[p] || 0; if (v > maxTH) maxTH = v; return v; }));
        document.getElementById('typeHeatmap').innerHTML = buildHeatmapHTML(thNames, allProdsForType, thMatrix, maxTH);

        // ⑧ 스코어카드 (확장: 고객사수, 건당시간 추가)
        const totalAll = typeEntries.reduce((s, e) => s + e[1], 0);
        let tscHtml = '<table class="scorecard-table"><thead><tr><th>지원유형</th><th>대분류</th><th>방문/원격</th><th>건수</th><th>비율</th><th>총시간(h)</th><th>건당시간</th><th>엔지니어</th><th>고객사</th></tr></thead><tbody>';
        typeEntries.forEach(([name, cnt]) => {
            const cat = typeCategoryOf(name);
            const vr = visitTypeOf(name);
            const pct = totalAll > 0 ? ((cnt / totalAll) * 100).toFixed(1) : 0;
            const hrs = typeHours[name] || 0;
            const perCase = cnt > 0 ? (hrs / cnt).toFixed(1) : '-';
            const engCnt = typeEngs[name] ? typeEngs[name].size : 0;
            const custCnt = typeCusts[name] ? typeCusts[name].size : 0;
            const vrBadge = vr === '방문' ? 'high' : vr === '원격' ? 'mid' : 'low';
            tscHtml += `<tr><td>${safeInlineText(name)}</td><td>${safeInlineText(cat)}</td><td><span class="sc-badge ${vrBadge}">${safeInlineText(vr)}</span></td><td><strong>${cnt}</strong></td><td>${pct}%</td><td>${hrs.toFixed(1)}</td><td>${perCase}h</td><td>${engCnt}명</td><td>${custCnt}곳</td></tr>`;
        });
        tscHtml += '</tbody></table>';
        document.getElementById('typeScorecard').innerHTML = tscHtml;
    }

        return {
            updateSupportTab
        };
    }

    window.DASH_SUPPORT_TAB = {
        createSupportTab
    };
})();
