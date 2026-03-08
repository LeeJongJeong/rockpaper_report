(function () {
    'use strict';

    function createOverviewTab(deps) {
        const {
            CONFIG,
            COLORS,
            formatNum,
            utilColor,
            safeInlineText,
            getFilteredData,
            getComparablePeriodContext,
            aggregateEngineers,
            buildAnalyticsSummary,
            summarizeEntityTransition,
            formatDateRangeLabel,
            buildDeltaHtml,
            aggregateByDate,
            movingAverage,
            upsertChart,
            lineChartConfig,
            aggregateByWeek,
            getWeekLabel,
            aggregateCounts,
            topNWithOther,
            pieChartConfig,
            barChartConfig,
            makeDrilldownClick,
            getDeptColor,
            aggregateByTeam,
            getCompensationTopEngineers,
            getActiveFilterFromDate,
            getActiveFilterToDate,
            isBillable,
            isInternal,
            getWeekKey,
            getContractWorkHours
        } = deps;

    function updateOverviewTab() {
        const data = getFilteredData();
        if (!data.length) {
            document.getElementById('kpi-total').textContent = '0';
            return;
        }

        const compareContext = getComparablePeriodContext();
        const ovEngMap = aggregateEngineers(data);
        const prevEngMap = aggregateEngineers(compareContext.previousData);
        const currentSummary = buildAnalyticsSummary(data, { range: compareContext.currentRange, engMap: ovEngMap });
        const previousSummary = buildAnalyticsSummary(compareContext.previousData, { range: compareContext.previousRange, engMap: prevEngMap });
        const customerTransition = summarizeEntityTransition(currentSummary.customerSet, previousSummary.customerSet);

        document.getElementById('kpi-total').textContent = formatNum(currentSummary.dataCount);
        document.getElementById('kpi-total-sub').innerHTML = buildDeltaHtml(currentSummary.dataCount, previousSummary.dataCount, { decimals: 0, unit: '건' });
        document.getElementById('kpi-engineers').textContent = formatNum(currentSummary.activeEngineerCount);
        document.getElementById('kpi-engineers-sub').innerHTML = `${buildDeltaHtml(currentSummary.activeEngineerCount, previousSummary.activeEngineerCount, { decimals: 0, unit: '명' })} · 목표가동 ${currentSummary.overTargetEngineers}명`;
        document.getElementById('kpi-customers').textContent = formatNum(currentSummary.activeCustomerCount);
        document.getElementById('kpi-customers-sub').innerHTML = `반복 ${customerTransition.retainedCount}곳 (${customerTransition.retainedRatio.toFixed(0)}%) · 신규 ${customerTransition.newCount}곳`;
        document.getElementById('kpi-products').textContent = formatNum(currentSummary.activeProductCount);
        document.getElementById('kpi-products-sub').innerHTML = `${buildDeltaHtml(currentSummary.activeProductCount, previousSummary.activeProductCount, { decimals: 0, unit: '종' })} · 상위 3고객 ${currentSummary.top3CustomerShare.toFixed(1)}%`;
        document.getElementById('kpi-period').textContent = compareContext.currentRange ? formatDateRangeLabel(compareContext.currentRange.start, compareContext.currentRange.end) : '-';
        document.getElementById('kpi-period-sub').innerHTML = compareContext.previousRange
            ? `${currentSummary.days}\uC77C / ${safeInlineText(compareContext.modeLabel)} ${safeInlineText(formatDateRangeLabel(compareContext.previousRange.start, compareContext.previousRange.end))}`
            : `${currentSummary.days}일`;
        document.getElementById('kpi-avg').textContent = currentSummary.avgPerDay.toFixed(1);
        document.getElementById('kpi-avg-sub').innerHTML = buildDeltaHtml(currentSummary.avgPerDay, previousSummary.avgPerDay, { decimals: 1, unit: '건/일' });

        const ovUtilEl = document.getElementById('kpi-util');
        ovUtilEl.textContent = currentSummary.activeEngineerCount > 0 ? `${currentSummary.avgUtilPct.toFixed(1)}%` : '-';
        ovUtilEl.style.color = currentSummary.activeEngineerCount > 0 ? utilColor(currentSummary.avgUtilPct) : '';
        document.getElementById('kpi-util-sub').innerHTML = currentSummary.activeEngineerCount > 0
            ? `가동${currentSummary.billableHours.toFixed(0)}h / 소정${currentSummary.totalWorkingHours}h · ${buildDeltaHtml(currentSummary.avgUtilPct, previousSummary.avgUtilPct, { decimals: 1, mode: 'pp' })}`
            : '<span style="color:var(--gray-500);">비교 없음</span>';

        const dailyMap = aggregateByDate(data);
        const sortedDates = Object.keys(dailyMap).sort();
        const dailyValues = sortedDates.map(d => dailyMap[d]);
        const ma7 = movingAverage(dailyValues, CONFIG.MOVING_AVG_DAYS);
        upsertChart('chartDailyLine', lineChartConfig(
            sortedDates,
            [
                {
                    label: '일별 지원 건수',
                    data: dailyValues,
                    borderColor: '#4F46E5', backgroundColor: 'rgba(79,70,229,0.08)',
                    fill: true, tension: 0.3, pointRadius: 2, pointHoverRadius: 5, borderWidth: 1.5
                },
                {
                    label: '7일 이동평균',
                    data: ma7,
                    borderColor: '#F97316', backgroundColor: 'transparent',
                    fill: false, tension: 0.4, pointRadius: 0, pointHoverRadius: 4,
                    borderWidth: 2.5, borderDash: [6, 3]
                }
            ],
            '건수', '날짜'
        ));

        const weeklyMap = aggregateByWeek(data);
        const weekKeys = Object.keys(weeklyMap).sort();
        const weekCounts = weekKeys.map(k => weeklyMap[k]);
        const weekLabels = weekKeys.map(getWeekLabel);
        const weekDelta = weekCounts.map((c, i) => {
            if (i === 0) return null;
            const prev = weekCounts[i - 1];
            return prev > 0 ? Math.round(((c - prev) / prev) * 1000) / 10 : null;
        });
        const wBarBg = weekDelta.map((d, i) => {
            if (i === 0 || d === null) return '#7C3AED99';
            if (d > 0) return '#10B98199';
            if (d < 0) return '#EF444499';
            return '#9CA3AF99';
        });
        const wBarBorder = wBarBg.map(c => c.replace('99', ''));

        const totalAvg = weekCounts.reduce((a, b) => a + b, 0) / (weekCounts.length || 1);
        const last4 = weekCounts.slice(-4);
        const last4Avg = last4.reduce((a, b) => a + b, 0) / (last4.length || 1);
        const trendDir = last4Avg > totalAvg ? '▲' : last4Avg < totalAvg ? '▼' : '━';
        const trendColor = last4Avg > totalAvg ? '#059669' : last4Avg < totalAvg ? '#DC2626' : '#6B7280';
        const summaryEl = document.getElementById('weeklyTrendSummary');
        if (summaryEl) {
            summaryEl.innerHTML =
                `전체 ${weekKeys.length}주 · 주평균 ${totalAvg.toFixed(1)}건 &nbsp;` +
                `<span style="color:${trendColor};font-weight:600;">${trendDir} 최근 4주 평균 ${last4Avg.toFixed(1)}건</span> &nbsp;` +
                buildDeltaHtml(currentSummary.dataCount, previousSummary.dataCount, { decimals: 0, unit: '건' });
        }

        upsertChart('chartWeeklyTrend', {
            type: 'bar',
            data: {
                labels: weekLabels,
                datasets: [
                    {
                        label: '주간 지원 건수',
                        data: weekCounts,
                        backgroundColor: wBarBg,
                        borderColor: wBarBorder,
                        borderWidth: 1.5, borderRadius: 5, maxBarThickness: 70,
                        yAxisID: 'y'
                    },
                    {
                        label: '전주 대비 증감(%)',
                        data: weekDelta,
                        type: 'line',
                        borderColor: '#F59E0B', backgroundColor: 'rgba(245,158,11,0.12)',
                        pointRadius: 5, pointHoverRadius: 7,
                        pointBackgroundColor: '#F59E0B',
                        pointBorderColor: 'white', pointBorderWidth: 1.5,
                        tension: 0.35, borderWidth: 2, spanGaps: true,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            font: { size: 11, family: 'Noto Sans KR' },
                            usePointStyle: true,
                            padding: 14,
                            generateLabels: (chart) => {
                                const items = Chart.defaults.plugins.legend.labels.generateLabels(chart);
                                return items.map(item => {
                                    if (item.text === '주간 지원 건수') {
                                        item.fillStyle = '#7C3AED';
                                        item.strokeStyle = '#7C3AED';
                                    } else if (item.text === '전주 대비 증감(%)') {
                                        item.fillStyle = '#F59E0B';
                                        item.strokeStyle = '#F59E0B';
                                    }
                                    return item;
                                });
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            afterBody: items => {
                                const i = items[0].dataIndex;
                                const d = weekDelta[i];
                                if (i === 0 || d === null) return ['전주 대비: 기준 주차'];
                                const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '━';
                                return [`전주 대비: ${arrow} ${Math.abs(d)}%`];
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { font: { size: 11 } },
                        title: { display: true, text: '주차', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1, font: { size: 11 } },
                        title: { display: true, text: '지원 건수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }
                    },
                    y1: {
                        position: 'right',
                        ticks: { callback: v => v + '%', font: { size: 11 } },
                        title: { display: true, text: '전주 대비 (%)', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });

        const counts = aggregateCounts(data, '제품명', '지원유형');
        const prodTop = topNWithOther(counts['제품명'], CONFIG.CHART_TOP_N.PIE);
        const prodPieCfg = pieChartConfig(prodTop.labels, prodTop.values);
        prodPieCfg.options.onClick = makeDrilldownClick('제품명');
        upsertChart('chartProductPie', prodPieCfg);

        const typeTop = topNWithOther(counts['지원유형'], CONFIG.CHART_TOP_N.BAR);
        const typeBarCfg = barChartConfig(typeTop.labels, typeTop.values, '지원유형', COLORS.slice(0, typeTop.labels.length), true, '건수', '지원유형');
        typeBarCfg.options.onClick = makeDrilldownClick('지원유형');
        upsertChart('chartTypeBar', typeBarCfg);

        const deptCounts = aggregateCounts(data, '부서명');
        const deptEntries = Object.entries(deptCounts['부서명']).sort((a, b) => b[1] - a[1]);
        const deptBarCfg = barChartConfig(
            deptEntries.map(e => e[0]), deptEntries.map(e => e[1]), '부서', deptEntries.map(e => getDeptColor(e[0]).color), false, '건수', '부서'
        );
        deptBarCfg.options.onClick = makeDrilldownClick('부서명', true);
        upsertChart('chartDeptBar', deptBarCfg);

        const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
        const dowCounts = [0, 0, 0, 0, 0, 0, 0];
        for (let i = 0; i < data.length; i++) {
            if (data[i]._dayOfWeek >= 0) dowCounts[data[i]._dayOfWeek]++;
        }
        upsertChart('chartDayOfWeek', {
            type: 'bar',
            data: {
                labels: dayNames,
                datasets: [{
                    label: '건수',
                    data: dowCounts,
                    backgroundColor: dayNames.map((_, i) => i === 0 || i === 6 ? '#EF4444CC' : '#4F46E5CC'),
                    borderColor: dayNames.map((_, i) => i === 0 || i === 6 ? '#EF4444' : '#4F46E5'),
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { stepSize: 1 }, title: { display: true, text: '건수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                    x: { grid: { display: false }, title: { display: true, text: '요일', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } }
                }
            }
        });

        const ovEngEntries = Object.entries(ovEngMap);
        const ovTeamMap = aggregateByTeam(ovEngMap, currentSummary.contractHoursPerEngineer);
        const ovTeamEntries = Object.entries(ovTeamMap).sort((a, b) => a[0].localeCompare(b[0]));
        const ovTeamNames = ovTeamEntries.map(e => e[0]);
        const ovTeamUtilPcts = ovTeamEntries.map(e => e[1].workH > 0 ? Math.round((e[1].billableH / e[1].workH) * 1000) / 10 : 0);
        const ovAvgUtil = currentSummary.avgUtilPct;
        upsertChart('chartOverviewUtil', {
            type: 'bar',
            data: {
                labels: [...ovTeamNames, '전체 평균'],
                datasets: [{
                    label: '가동률(%)',
                    data: [...ovTeamUtilPcts, Math.round(ovAvgUtil * 10) / 10],
                    backgroundColor: [...ovTeamNames.map(n => getDeptColor(n).color + 'CC'), '#059669CC'],
                    borderColor: [...ovTeamNames.map(n => getDeptColor(n).color), '#059669'],
                    borderWidth: 2, borderRadius: 6, maxBarThickness: 100
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            afterLabel: (ctx) => {
                                const idx = ctx.dataIndex;
                                if (idx < ovTeamEntries.length) {
                                    const te = ovTeamEntries[idx][1];
                                    return [`가동시간: ${te.billableH.toFixed(1)}h`, `소정근무: ${te.workH}h`, `엔지니어: ${te.engCount}명`];
                                }
                                return [`가동시간: ${currentSummary.billableHours.toFixed(1)}h`, `소정근무: ${currentSummary.totalWorkingHours}h`, `엔지니어: ${ovEngEntries.length}명`];
                            }
                        }
                    }
                },
                scales: {
                    x: { ticks: { font: { size: 13, weight: '600' } }, grid: { display: false }, title: { display: true, text: '팀(부서)', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                    y: { beginAtZero: true, max: Math.max(120, Math.ceil(Math.max(...ovTeamUtilPcts, ovAvgUtil) / 10) * 10 + 10), ticks: { callback: v => v + '%', font: { size: 11 } }, title: { display: true, text: '가동률(%)', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } }
                }
            }
        });

        const insights = generateInsights(data, ovEngMap, getCompensationTopEngineers(getActiveFilterFromDate(), getActiveFilterToDate()));
        renderInsightPanel(insights);
    }

    /* ============================================================
       자동 인사이트 생성
       ============================================================ */

    function generateInsights(data, engMap, compSummary) {
        const MAX_INSIGHTS = 15;
        const insights = [];
        const engEntries = Object.entries(engMap);
        if (!engEntries.length) return insights;

        const pushInsight = (insight) => {
            if (insights.length >= MAX_INSIGHTS) return false;
            insights.push(insight);
            return insights.length < MAX_INSIGHTS;
        };

        // 엔지니어 메트릭 단일 순회 집계
        const engUtils = [];
        let totalBillH = 0;
        let totalWorkH = 0;
        let totalBillableCount = 0;
        let totalHours = 0;
        let totalInternal = 0;
        let totalActDays = 0;
        let topBillable = engEntries[0];
        let topUtil = null;
        const insightContractWorkH = getContractWorkHours();
        totalWorkH = engEntries.length * insightContractWorkH;
        for (let i = 0; i < engEntries.length; i++) {
            const [name, m] = engEntries[i];
            const workH = insightContractWorkH;
            const util = workH > 0 ? (m.billableHours / workH) * 100 : 0;
            const utilEntry = { name, util, m };
            engUtils.push(utilEntry);

            totalBillH += m.billableHours;
            totalBillableCount += m.billableCount;
            totalHours += m.hours;
            totalInternal += m.internal;
            totalActDays += m.dates.size;

            if (m.billableCount > topBillable[1].billableCount) topBillable = engEntries[i];
            if (!topUtil || util > topUtil.util) topUtil = utilEntry;
        }
        const avgUtil = totalWorkH > 0 ? (totalBillH / totalWorkH) * 100 : 0;
        const compensation = compSummary && Array.isArray(compSummary.list) ? compSummary : { list: [], total: 0, count: 0 };

        // A0: \ucd1d \ubcf4\uc0c1\ubc1c\uc0dd\uc2dc\uac04 Top 3 \uc778\uc0ac\uc774\ud2b8
        if (compensation.list.length >= 1) {
            const top3 = compensation.list.slice(0, 3);
            const top3Sum = top3.reduce((sum, entry) => sum + entry.compensationHours, 0);
            const totalComp = compensation.total || 0;
            const avgComp = compensation.count ? totalComp / compensation.count : 0;
            const top1 = top3[0];
            const top1Ratio = avgComp > 0 ? (top1.compensationHours / avgComp) : 0;
            const topShare = totalComp > 0 ? (top3Sum / totalComp) * 100 : 0;
            const top3Names = top3.map((entry, idx) => `${idx + 1}. ${entry.engineer} (${entry.compensationHours.toFixed(1)}h)`).join(', ');
            const type = topShare >= 70 || top1Ratio >= 2 ? 'danger' : topShare >= 50 || top1Ratio >= 1.5 ? 'warning' : 'info';
            const extraInsight = topShare >= 70
                ? '\uc0c1\uc704 3\uc778 \ud3b8\uc911\uc774 \ub9e4\uc6b0 \ub192\uc2b5\ub2c8\ub2e4. \ub300\uccb4 \uc778\ub825\uacfc \uc5c5\ubb34 \ubd84\uc0b0\uc774 \ud544\uc694\ud569\ub2c8\ub2e4.'
                : topShare >= 50
                    ? '\ubcf4\uc0c1\ubc1c\uc0dd\uc2dc\uac04\uc774 \uc77c\ubd80 \uc778\ub825\uc5d0 \uc9d1\uc911\ub418\ub294 \uacbd\ud5a5\uc774 \uc788\uc2b5\ub2c8\ub2e4.'
                    : '\ubcf4\uc0c1\ubc1c\uc0dd\uc2dc\uac04 \ubd84\ud3ec\ub294 \ube44\uad50\uc801 \uc548\uc815\uc801\uc774\uc9c0\ub9cc \uc0c1\uc704 \uc778\ub825 \ucd94\uc774\ub294 \uacc4\uc18d \ubaa8\ub2c8\ud130\ub9c1\uc774 \ud544\uc694\ud569\ub2c8\ub2e4.';
            const desc = `Top 3: ${top3Names}. \uc804\uccb4 \ubcf4\uc0c1\ubc1c\uc0dd\uc2dc\uac04 ${totalComp.toFixed(1)}h \uc911 ${top3Sum.toFixed(1)}h (${topShare.toFixed(0)}%)\uac00 \uc0c1\uc704 3\uc778\uc5d0 \uc9d1\uc911\ub418\uc5b4 \uc788\uc2b5\ub2c8\ub2e4. 1\uc704 ${top1.engineer}\ub294 ${top1.compensationHours.toFixed(1)}h\ub85c \uc804\uccb4 \uc5d4\uc9c0\ub2c8\uc5b4 \ud3c9\uade0 \ub300\ube44 ${top1Ratio.toFixed(1)}\ubc30\uc785\ub2c8\ub2e4. ${extraInsight}`;
            if (!pushInsight({ type, icon: '\ud83d\udcb0', label: '\ucd1d \ubcf4\uc0c1\ubc1c\uc0dd\uc2dc\uac04', title: `${top1.engineer} \uc911\uc2ec Top 3 \ubcf4\uc0c1\ubc1c\uc0dd\uc2dc\uac04`, desc })) return insights;
        }

        // 1~3: 전체 가동률
        if (totalWorkH > 0) {
            const pct = avgUtil.toFixed(1);
            if (avgUtil < 60) {
                pushInsight({ type: 'danger', icon: '🔴', label: '가동률 경보', title: `전체 가동률 ${pct}% — 심각 수준`, desc: '전체 팀 가동률이 60% 미만입니다. 즉각적인 업무 재배분이 필요합니다.' });
            } else if (avgUtil < 80) {
                pushInsight({ type: 'warning', icon: '🟡', label: '가동률 주의', title: `전체 가동률 ${pct}% — 목표 미달`, desc: '전체 팀 가동률이 목표(80%) 이하입니다. 개선이 필요합니다.' });
            } else {
                pushInsight({ type: 'success', icon: '✅', label: '가동률 달성', title: `전체 평균 가동률 ${pct}% 달성`, desc: '팀 전체가 목표 가동률 80%를 초과 달성하고 있습니다.' });
            }
        }

        // 4: 가동률 현저히 낮은 엔지니어 (< 40% AND 팀평균-20%p↓)
        for (let i = 0; i < engUtils.length; i++) {
            const e = engUtils[i];
            if (e.util < 40 && (avgUtil - e.util) >= 20) {
                if (!pushInsight({ type: 'danger', icon: '⚠️', label: '개인 가동률 경보', title: `${e.name} — 가동률 ${e.util.toFixed(1)}%, 팀평균 대비 현저히 낮음`, desc: `팀 평균(${avgUtil.toFixed(1)}%)보다 ${(avgUtil - e.util).toFixed(1)}%p 낮습니다.` })) {
                    return insights;
                }
            }
        }

        // data 단일 순회로 공통 메트릭 집계
        const custEngMap = {};
        const prodEngMap = {};
        const custCounts = {};
        const weekMap = {};
        let billableCntH = 0;
        let inspectCntH = 0;
        let externalCntJ = 0;
        let noSalesCntJ = 0;
        let presalesCntL = 0;
        let billableTotalL = 0;
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const cust = row['고객사명'];
            const prod = row['제품명'];
            const eng = row['엔지니어'];
            if (cust && eng) {
                if (!custEngMap[cust]) custEngMap[cust] = new Set();
                custEngMap[cust].add(eng);
            }
            if (prod && eng) {
                if (!prodEngMap[prod]) prodEngMap[prod] = new Set();
                prodEngMap[prod].add(eng);
            }

            const custName = String(cust || '').trim();
            if (custName) custCounts[custName] = (custCounts[custName] || 0) + 1;

            if (row._date) {
                const weekKey = getWeekKey(row._date);
                weekMap[weekKey] = (weekMap[weekKey] || 0) + 1;
            }

            const supportType = String(row['지원유형'] || '');
            const isBill = isBillable(supportType);
            if (isBill) {
                billableCntH++;
                billableTotalL++;
                if (/점검지원/.test(supportType)) inspectCntH++;
                if (/[Pp]resales/.test(supportType)) presalesCntL++;
            }
            if (!isInternal(supportType)) {
                externalCntJ++;
                if (!String(row['담당영업'] || '').trim()) noSalesCntJ++;
            }

        }

        // 5: 단일 엔지니어 의존 고객사
        const singleEngCusts = Object.keys(custEngMap).filter(c => custEngMap[c].size === 1);
        if (singleEngCusts.length >= 1) {
            if (!pushInsight({ type: 'danger', icon: '🏢', label: '고객사 리스크', title: `${singleEngCusts.length}개 고객사 단일 엔지니어 의존 — 인력 리스크`, desc: `해당 엔지니어 부재 시 고객사 대응 공백이 발생할 수 있습니다.` })) return insights;
        }

        // 6: 단일 엔지니어 커버 제품 1~5종
        const singleEngProds = Object.keys(prodEngMap).filter(p => prodEngMap[p].size === 1);
        if (singleEngProds.length >= 1 && singleEngProds.length <= 5) {
            if (!pushInsight({ type: 'warning', icon: '🔧', label: '제품 커버리지 위험', title: `${singleEngProds.length}종 제품 단일 엔지니어 커버 — 커버리지 위험`, desc: '특정 제품이 한 명의 엔지니어에게만 의존되어 있어 지식 편중 위험이 있습니다.' })) return insights;
        }

        // 7: 최고 가동률 엔지니어 ≥ 80%
        if (topUtil && topUtil.util >= CONFIG.UTIL.TARGET) {
            if (!pushInsight({ type: 'success', icon: '🏆', label: '우수 가동률', title: `${topUtil.name} — 가동률 ${topUtil.util.toFixed(1)}%, 이번 기간 최고`, desc: '가장 높은 가동률을 기록한 엔지니어입니다.' })) return insights;
        }

        // 8: 최다 고객사 엔지니어 ≥ 3개사
        const engCustCount = {};
        for (const cust in custEngMap) {
            custEngMap[cust].forEach(eng => {
                engCustCount[eng] = (engCustCount[eng] || 0) + 1;
            });
        }
        const topCustEng = Object.entries(engCustCount).sort((a, b) => b[1] - a[1])[0];
        if (topCustEng && topCustEng[1] >= 3) {
            if (!pushInsight({ type: 'success', icon: '🌟', label: '핵심 역할', title: `${topCustEng[0]} — ${topCustEng[1]}개 고객사 지원, 핵심 역할`, desc: '가장 많은 고객사를 담당하는 엔지니어입니다.' })) return insights;
        }

        // A: 업무 집중 리스크 — 상위 1명이 전체 billableCount의 30%↑ 독점
        if (totalBillableCount > 0) {
            const topPct = (topBillable[1].billableCount / totalBillableCount) * 100;
            if (topPct >= 40) {
                if (!pushInsight({ type: 'danger', icon: '⚡', label: '업무 집중 위험', title: `${topBillable[0]} — 전체 고객 지원의 ${topPct.toFixed(0)}% 독점, 업무 집중 리스크`, desc: `핵심 인원 부재 시 전체 고객 대응에 심각한 공백이 발생할 수 있습니다.` })) return insights;
            } else if (topPct >= 30) {
                if (!pushInsight({ type: 'warning', icon: '⚡', label: '업무 집중 주의', title: `${topBillable[0]} — 전체 고객 지원의 ${topPct.toFixed(0)}% 담당, 편중 주의`, desc: `단일 엔지니어 의존도가 높습니다. 업무 분산을 검토하세요.` })) return insights;
            }
        }

        // B: 과부하 엔지니어 경보 — 투입시간이 팀 평균의 1.8배 초과
        const avgHours = engEntries.length > 0 ? totalHours / engEntries.length : 0;
        if (avgHours > 0) {
            for (let i = 0; i < engEntries.length; i++) {
                const [name, m] = engEntries[i];
                if (!(m.hours > avgHours * 1.8)) continue;
                const ratio = (m.hours / avgHours).toFixed(1);
                if (!pushInsight({ type: 'warning', icon: '🔥', label: '과부하 경보', title: `${name} — 투입시간 ${m.hours.toFixed(0)}h, 팀 평균(${avgHours.toFixed(0)}h)의 ${ratio}배 초과`, desc: '번아웃 리스크가 있습니다. 업무량 조정을 검토하세요.' })) return insights;
            }
        }

        // C: 내부업무 비율 과다 — 전체 건수 대비 내부 비율 40% 이상
        const totalAll = data.length;
        if (totalAll > 0) {
            const internalPct = (totalInternal / totalAll) * 100;
            if (internalPct >= 40) {
                if (!pushInsight({ type: 'warning', icon: '🏠', label: '내부업무 과다', title: `내부업무 비율 ${internalPct.toFixed(0)}% — 고객 대응 가용 인력 부족`, desc: '외부 고객 지원 여력이 부족합니다. 내부업무 비중을 재검토하세요.' })) return insights;
            }
        }

        // D: 고객사 쏠림 — 상위 3개 고객사가 전체의 60% 이상
        const custCountEntries = Object.entries(custCounts).sort((a, b) => b[1] - a[1]);
        if (custCountEntries.length >= 3 && totalAll > 0) {
            const top3Sum = custCountEntries.slice(0, 3).reduce((s, e) => s + e[1], 0);
            const top3Pct = (top3Sum / totalAll) * 100;
            if (top3Pct >= 60) {
                const top3Names = custCountEntries.slice(0, 3).map(e => e[0]).join(', ');
                if (!pushInsight({ type: 'warning', icon: '📊', label: '고객사 쏠림', title: `상위 3개 고객사가 전체 지원의 ${top3Pct.toFixed(0)}% 집중 — 포트폴리오 편중`, desc: `${top3Names}에 지원이 집중되어 있습니다. 고객 포트폴리오 다양화를 검토하세요.` })) return insights;
            }
        }

        // E: 주간 연속 하락 트렌드 — 최근 2주 연속 전주 대비 감소
        const weekKeys = Object.keys(weekMap).sort();
        if (weekKeys.length >= 3) {
            const last = weekMap[weekKeys[weekKeys.length - 1]];
            const prev = weekMap[weekKeys[weekKeys.length - 2]];
            const prev2 = weekMap[weekKeys[weekKeys.length - 3]];
            const delta1 = last - prev;
            const delta2 = prev - prev2;
            if (delta1 < 0 && delta2 < 0) {
                const pct1 = ((delta1 / prev) * 100).toFixed(0);
                const pct2 = ((delta2 / prev2) * 100).toFixed(0);
                if (!pushInsight({ type: 'warning', icon: '📉', label: '연속 하락 추세', title: `지원 건수 2주 연속 감소 — 이번 주 ${pct1}%, 지난주 ${pct2}%`, desc: '업무량 감소 추세가 지속되고 있습니다. 원인을 점검하세요.' })) return insights;
            }
        }

        // H: 점검지원 비율 저조 — 고객 지원 건 중 점검지원 < 15%
        if (billableCntH >= 10) {
            const inspPct = (inspectCntH / billableCntH) * 100;
            if (inspPct < 15) {
                if (!pushInsight({
                    type: 'info', icon: '🔍', label: '점검지원 저조',
                    title: `점검지원 비중 ${inspPct.toFixed(0)}% — 예방 점검 활동 강화 필요`,
                    desc: '장애 대응 위주의 반응형 지원 구조입니다. 정기 점검 일정 확대로 사전 예방을 강화하세요.'
                })) return insights;
            }
        }

        // I: 주간 지원 급증 — 최근 주가 직전 주 대비 40% 이상 증가
        if (weekKeys.length >= 2) {
            const lastWk = weekMap[weekKeys[weekKeys.length - 1]];
            const prevWk = weekMap[weekKeys[weekKeys.length - 2]];
            if (prevWk > 0) {
                const surgePct = ((lastWk - prevWk) / prevWk) * 100;
                if (surgePct >= 40) {
                    if (!pushInsight({
                        type: 'warning', icon: '📈', label: '지원 수요 급증',
                        title: `최근 주 지원 건수 ${surgePct.toFixed(0)}% 급증 (${prevWk}건 → ${lastWk}건)`,
                        desc: '단기 수요 급증이 감지되었습니다. 대응 여력 및 인력 배분을 즉시 점검하세요.'
                    })) return insights;
                }
            }
        }

        // J: 담당영업 미배정 — 외부 지원 건 중 담당영업 공백 ≥ 30%
        if (externalCntJ >= 5) {
            const noSalesPct = (noSalesCntJ / externalCntJ) * 100;
            if (noSalesPct >= 30) {
                if (!pushInsight({
                    type: 'warning', icon: '👤', label: '영업 커버리지 공백',
                    title: `외부 지원 ${noSalesCntJ}건(${noSalesPct.toFixed(0)}%) 담당영업 미배정`,
                    desc: '영업 담당자 미지정 고객 지원이 많습니다. 담당 영업 배정 현황을 재점검하세요.'
                })) return insights;
            }
        }

        // K: 저활동 엔지니어 — 활동일이 팀 평균의 50% 미만 (billable 건 보유 기준)
        const avgActDays = totalActDays / engEntries.length;
        if (avgActDays >= 5) {
            const lowActEngs = engEntries.filter(([, m]) => m.dates.size < avgActDays * 0.5 && m.billableCount > 0);
            if (lowActEngs.length > 0) {
                const nameStr = lowActEngs.slice(0, 3).map(([n]) => n).join(', ');
                if (!pushInsight({
                    type: 'info', icon: '🗓️', label: '저활동 엔지니어',
                    title: `${lowActEngs.length}명 활동일 팀 평균(${avgActDays.toFixed(0)}일)의 절반 미만`,
                    desc: `${nameStr} — 부분 참여, 휴가 또는 파견 상태일 수 있습니다. 가용 인력을 확인하세요.`
                })) return insights;
            }
        }

        // L: Presales 활성화 신호 — 고객지원 건 중 Presales ≥ 15%
        if (billableTotalL >= 10 && presalesCntL > 0) {
            const presalesPct = (presalesCntL / billableTotalL) * 100;
            if (presalesPct >= 15) {
                if (!pushInsight({
                    type: 'success', icon: '💼', label: 'Presales 활성',
                    title: `Presales 비중 ${presalesPct.toFixed(0)}% — 신규 영업 파이프라인 활발`,
                    desc: `${presalesCntL}건의 기술 기여 영업 활동이 진행 중입니다. 수주 전환율을 모니터링하세요.`
                })) return insights;
            }
        }

        return insights;
    }

    function renderInsightPanel(insights) {
        const panel = document.getElementById('insightPanel');
        const cards = document.getElementById('insightCards');
        const count = document.getElementById('insightCount');
        if (!panel || !cards || !count) return;
        if (!insights.length) {
            panel.style.display = 'none';
            return;
        }
        panel.style.display = '';
        count.textContent = `${insights.length}개 항목`;
        const severityLabel = {
            danger: '경보',
            warning: '주의',
            success: '양호',
            info: '정보'
        };
        cards.innerHTML = insights.map(ins => `
                <div class="insight-card ic-${ins.type}">
                    <div class="insight-head">
                        <span class="insight-status">${severityLabel[ins.type] || '정보'}</span>
                        <div class="insight-label">${safeInlineText(ins.label)}</div>
                        <span class="insight-icon">${safeInlineText(ins.icon || '')}</span>
                    </div>
                    <div class="insight-title">${safeInlineText(ins.title)}</div>
                    <div class="insight-desc">${safeInlineText(ins.desc)}</div>
                </div>
            `).join('');
    }


        return {
            updateOverviewTab
        };
    }

    window.DASH_OVERVIEW_TAB = {
        createOverviewTab
    };
})();
