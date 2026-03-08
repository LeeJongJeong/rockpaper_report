(function () {
    'use strict';

    function createAnalyticsCore(deps) {
        const {
            CONFIG,
            FILTER_COLUMNS,
            PRODUCT_GROUP_RULES,
            parseDate,
            formatDateStr,
            getCachedFilteredValue,
            getContractWorkHours,
            getContractWorkHoursForRange,
            getRawData,
            getFilterState,
            getDateRange,
            getActiveFilterFromDate,
            getActiveFilterToDate,
            getCompensationEntries,
            getComparisonMode,
            getComparablePeriodCache,
            setComparablePeriodCache,
            normalizeComparisonMode,
            getComparisonModeLabel,
            safeInlineText
        } = deps;

        function getCompensationEntriesForRange(startDate, endDate) {
            const from = startDate || null;
            const to = endDate || null;
            const entries = getCompensationEntries();
            return entries.filter(entry => {
                const pStart = entry.periodStart;
                const pEnd = entry.periodEnd;
                if (!(pStart instanceof Date) || !(pEnd instanceof Date)) return true;
                if (from && pEnd < from) return false;
                if (to && pStart > to) return false;
                return true;
            });
        }

        function getCompensationTopEngineers(startDate, endDate, topN = 3) {
            const rows = getCompensationEntriesForRange(startDate, endDate);
            if (!rows.length) return { list: [], total: 0 };

            const totals = {};
            for (let i = 0; i < rows.length; i++) {
                const entry = rows[i];
                const name = String(entry.engineer || '').trim();
                if (!name) continue;
                const value = entry.compensationHours;
                if (!Number.isFinite(value) || value <= 0) continue;
                totals[name] = (totals[name] || 0) + value;
            }

            const list = Object.entries(totals)
                .sort((a, b) => b[1] - a[1])
                .filter(([, value]) => Number.isFinite(value) && value > 0);
            const total = list.reduce((sum, [, value]) => sum + value, 0);
            return {
                list: list.slice(0, topN).map(([engineer, compensationHours]) => ({ engineer, compensationHours })),
                total
            };
        }

        function buildDateOnly(date) {
            return (date instanceof Date && !isNaN(date.getTime()))
                ? new Date(date.getFullYear(), date.getMonth(), date.getDate())
                : null;
        }

        function shiftDateByDays(date, days) {
            const base = buildDateOnly(date);
            if (!base) return null;
            base.setDate(base.getDate() + days);
            return base;
        }

        function shiftDateByMonths(date, months) {
            const base = buildDateOnly(date);
            if (!base) return null;
            const targetMonthIndex = base.getMonth() + months;
            const monthStart = new Date(base.getFullYear(), targetMonthIndex, 1);
            const lastDay = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
            return new Date(monthStart.getFullYear(), monthStart.getMonth(), Math.min(base.getDate(), lastDay));
        }

        function getRangeSpanDays(startDate, endDate) {
            const start = buildDateOnly(startDate);
            const end = buildDateOnly(endDate);
            if (!start || !end) return 0;
            return Math.max(1, Math.floor((Math.max(start, end) - Math.min(start, end)) / 86400000) + 1);
        }

        function formatDateRangeLabel(startDate, endDate) {
            if (!(startDate instanceof Date) || !(endDate instanceof Date)) return '-';
            return `${formatDateStr(startDate)} ~ ${formatDateStr(endDate)}`;
        }

        function buildCurrentFilterSignature() {
            const activeFilterFromDate = getActiveFilterFromDate();
            const activeFilterToDate = getActiveFilterToDate();
            const filterState = getFilterState();
            const rawData = getRawData();
            const fromStr = activeFilterFromDate ? formatDateStr(activeFilterFromDate) : '';
            const toStr = activeFilterToDate ? formatDateStr(activeFilterToDate) : '';
            const parts = FILTER_COLUMNS.map(fc => {
                const fs = filterState[fc.key];
                const selected = fs ? [...fs.selected].sort().join('|') : '';
                return `${fc.key}:${selected}`;
            });
            return [rawData.length, fromStr, toStr, normalizeComparisonMode(getComparisonMode()), parts.join(';;')].join('##');
        }

        function rowMatchesSelectedFilters(row) {
            const filterState = getFilterState();
            for (let i = 0; i < FILTER_COLUMNS.length; i++) {
                const fc = FILTER_COLUMNS[i];
                const fs = filterState[fc.key];
                if (!fs || fs.selected.size === fs.options.length) continue;
                const value = String(row[fc.key] || '').trim();
                if (!fs.selected.has(value)) return false;
            }
            return true;
        }

        function collectComparablePeriodData(startDate, endDate) {
            const from = buildDateOnly(startDate);
            const to = buildDateOnly(endDate);
            if (!from || !to) return [];
            const fromStr = formatDateStr(from);
            const toStr = formatDateStr(to);
            const rows = [];
            const rawData = getRawData();
            for (let i = 0; i < rawData.length; i++) {
                const row = rawData[i];
                if (!row._dateStr || row._dateStr < fromStr || row._dateStr > toStr) continue;
                if (!rowMatchesSelectedFilters(row)) continue;
                rows.push(row);
            }
            return rows;
        }

        function getComparablePeriodContext() {
            const key = buildCurrentFilterSignature();
            const cached = getComparablePeriodCache();
            if (cached.key === key && cached.value) {
                return cached.value;
            }

            const dateRange = getDateRange();
            let currentStart = buildDateOnly(getActiveFilterFromDate() || dateRange.min);
            let currentEnd = buildDateOnly(getActiveFilterToDate() || dateRange.max);
            if (currentStart && currentEnd && currentStart > currentEnd) {
                const temp = currentStart;
                currentStart = currentEnd;
                currentEnd = temp;
            }

            const mode = normalizeComparisonMode(getComparisonMode());
            let value = { currentRange: null, previousRange: null, previousData: [], mode: mode, modeLabel: getComparisonModeLabel(mode) };
            if (currentStart && currentEnd) {
                const spanDays = getRangeSpanDays(currentStart, currentEnd);
                let previousStart = null;
                let previousEnd = null;

                if (mode === 'previous_week') {
                    previousStart = shiftDateByDays(currentStart, -7);
                    previousEnd = shiftDateByDays(currentEnd, -7);
                } else if (mode === 'previous_month') {
                    previousStart = shiftDateByMonths(currentStart, -1);
                    previousEnd = shiftDateByMonths(currentEnd, -1);
                } else if (mode === 'previous_year') {
                    previousStart = shiftDateByMonths(currentStart, -12);
                    previousEnd = shiftDateByMonths(currentEnd, -12);
                } else {
                    previousEnd = shiftDateByDays(currentStart, -1);
                    previousStart = shiftDateByDays(previousEnd, -(spanDays - 1));
                }

                if (previousStart && previousEnd && previousStart > previousEnd) {
                    const temp = previousStart;
                    previousStart = previousEnd;
                    previousEnd = temp;
                }

                value = {
                    currentRange: { start: currentStart, end: currentEnd, spanDays },
                    previousRange: previousStart && previousEnd ? { start: previousStart, end: previousEnd, spanDays: getRangeSpanDays(previousStart, previousEnd) } : null,
                    previousData: previousStart && previousEnd ? collectComparablePeriodData(previousStart, previousEnd) : [],
                    mode: mode,
                    modeLabel: getComparisonModeLabel(mode)
                };
            }

            setComparablePeriodCache({ key, value });
            return value;
        }

        function summarizeEntityTransition(currentNames, previousNames) {
            const currentSet = currentNames instanceof Set ? currentNames : new Set(currentNames || []);
            const previousSet = previousNames instanceof Set ? previousNames : new Set(previousNames || []);
            let retainedCount = 0;
            let newCount = 0;
            currentSet.forEach(name => {
                if (previousSet.has(name)) retainedCount++;
                else newCount++;
            });
            return {
                retainedCount,
                newCount,
                retainedRatio: currentSet.size > 0 ? (retainedCount / currentSet.size) * 100 : 0,
                newRatio: currentSet.size > 0 ? (newCount / currentSet.size) * 100 : 0
            };
        }

        function buildDeltaHtml(current, previous, options) {
            const opts = options || {};
            const decimals = Number.isInteger(opts.decimals) ? opts.decimals : 1;
            const unit = opts.unit || '';
            const lowerIsBetter = !!opts.lowerIsBetter;
            const mode = opts.mode || 'relative';
            const currentNum = Number(current);
            const previousNum = Number(previous);
            const compareLabel = safeInlineText(getComparisonModeLabel());

            if (!Number.isFinite(currentNum) || !Number.isFinite(previousNum)) {
                return `<span style="color:var(--gray-500);">${compareLabel} 비교 없음</span>`;
            }

            const zeroThreshold = Math.pow(10, -(decimals + 1));
            const colorForDelta = delta => {
                const favorable = lowerIsBetter ? delta < 0 : delta > 0;
                return favorable ? '#059669' : '#DC2626';
            };

            if (mode === 'pp') {
                const delta = currentNum - previousNum;
                if (Math.abs(delta) < zeroThreshold) {
                    return `<span style="color:var(--gray-500);">${compareLabel}과 동일</span>`;
                }
                const sign = delta > 0 ? '+' : '-';
                return `<span style="color:${colorForDelta(delta)};">${compareLabel} 대비 ${sign}${Math.abs(delta).toFixed(decimals)}%p</span>`;
            }

            if (previousNum === 0) {
                if (currentNum === 0) {
                    return `<span style="color:var(--gray-500);">${compareLabel}과 동일</span>`;
                }
                return `<span style="color:#2563EB;">${compareLabel} 0${unit} -> ${currentNum.toFixed(decimals)}${unit}</span>`;
            }

            const delta = currentNum - previousNum;
            if (Math.abs(delta) < zeroThreshold) {
                return `<span style="color:var(--gray-500);">${compareLabel}과 동일</span>`;
            }
            const sign = delta > 0 ? '+' : '-';
            const pct = Math.abs((delta / previousNum) * 100);
            return `<span style="color:${colorForDelta(delta)};">${compareLabel} 대비 ${sign}${Math.abs(delta).toFixed(decimals)}${unit} (${sign}${pct.toFixed(1)}%)</span>`;
        }

        function buildAnalyticsSummary(data, options) {
            const opts = options || {};
            const range = opts.range || {};
            const engMap = opts.engMap || aggregateEngineers(data);
            const custMap = opts.custMap || aggregateCustomers(data);
            const engEntries = Object.entries(engMap).sort((a, b) => b[1].count - a[1].count);
            const custEntries = Object.entries(custMap).sort((a, b) => b[1].count - a[1].count);
            const productSet = new Set();
            let totalHours = 0;
            let billableHours = 0;
            let externalCount = 0;
            let internalCount = 0;

            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                totalHours += Number(row._hoursNum) || 0;
                if (row._isBillable) billableHours += Number(row._hoursNum) || 0;
                if (row._isInternal) internalCount++;
                else externalCount++;
                const product = String(row['제품명'] || '').trim();
                if (product) productSet.add(product);
            }

            const start = range.start instanceof Date ? range.start : null;
            const end = range.end instanceof Date ? range.end : null;
            const spanDays = Number(range.spanDays) || (start && end ? getRangeSpanDays(start, end) : (data.length ? 1 : 0));
            const contractHoursPerEngineer = start && end ? getContractWorkHoursForRange(start, end) : getContractWorkHours();
            const totalWorkingHours = engEntries.length * contractHoursPerEngineer;
            const avgUtilPct = totalWorkingHours > 0 ? (billableHours / totalWorkingHours) * 100 : 0;
            const overTargetEngineers = engEntries.filter(([, metric]) => contractHoursPerEngineer > 0 && ((metric.billableHours / contractHoursPerEngineer) * 100) >= CONFIG.UTIL.TARGET).length;
            const underDangerEngineers = engEntries.filter(([, metric]) => contractHoursPerEngineer > 0 && ((metric.billableHours / contractHoursPerEngineer) * 100) < CONFIG.UTIL.DANGER).length;
            const utilValues = engEntries.map(([, metric]) => contractHoursPerEngineer > 0 ? (metric.billableHours / contractHoursPerEngineer) * 100 : 0);
            const maxUtilPct = utilValues.length ? Math.max(...utilValues) : 0;
            const minUtilPct = utilValues.length ? Math.min(...utilValues) : 0;
            const top3EngineerShare = billableHours > 0
                ? (engEntries.slice(0, 3).reduce((sum, [, metric]) => sum + metric.billableHours, 0) / billableHours) * 100
                : 0;
            const top3CustomerShare = data.length > 0
                ? (custEntries.slice(0, 3).reduce((sum, [, metric]) => sum + metric.count, 0) / data.length) * 100
                : 0;
            const repeatCustomerCount = custEntries.filter(([, metric]) => metric.count > 1).length;
            const singleEngineerCustomers = custEntries.filter(([, metric]) => metric.engs.size === 1).length;
            const avgEngineersPerCustomer = custEntries.length
                ? custEntries.reduce((sum, [, metric]) => sum + metric.engs.size, 0) / custEntries.length
                : 0;
            const avgHoursPerCustomer = custEntries.length ? totalHours / custEntries.length : 0;
            const topEngineer = engEntries.slice().sort((a, b) => b[1].billableCount - a[1].billableCount)[0] || null;
            const topCustomer = custEntries[0] || null;

            return {
                dataCount: data.length,
                totalHours,
                billableHours,
                externalCount,
                internalCount,
                activeEngineerCount: engEntries.length,
                activeCustomerCount: custEntries.length,
                activeProductCount: productSet.size,
                days: spanDays || 0,
                avgPerDay: spanDays > 0 ? data.length / spanDays : 0,
                avgUtilPct,
                totalWorkingHours,
                contractHoursPerEngineer,
                overTargetEngineers,
                underDangerEngineers,
                top3EngineerShare,
                top3CustomerShare,
                repeatCustomerCount,
                repeatCustomerRatio: custEntries.length > 0 ? (repeatCustomerCount / custEntries.length) * 100 : 0,
                singleEngineerCustomers,
                singleEngineerCustomerRatio: custEntries.length > 0 ? (singleEngineerCustomers / custEntries.length) * 100 : 0,
                avgEngineersPerCustomer,
                avgHoursPerCustomer,
                maxUtilPct,
                minUtilPct,
                utilSpread: maxUtilPct - minUtilPct,
                topEngineer,
                topCustomer,
                engineerSet: new Set(engEntries.map(([name]) => name)),
                customerSet: new Set(custEntries.map(([name]) => name))
            };
        }

        function aggregateCounts(data, ...keys) {
            const result = {};
            keys.forEach(key => { result[key] = {}; });
            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                keys.forEach(key => {
                    const value = String(row[key] || '').trim();
                    if (value) result[key][value] = (result[key][value] || 0) + 1;
                });
            }
            return result;
        }

        function aggregateByDate(data) {
            return getCachedFilteredValue('aggregateByDate', function () {
                const map = {};
                for (let i = 0; i < data.length; i++) {
                    const dateStr = data[i]._dateStr;
                    if (dateStr) map[dateStr] = (map[dateStr] || 0) + 1;
                }
                return map;
            }, data);
        }

        function aggregateByKeyAndDate(data, key) {
            return getCachedFilteredValue(`aggregateByKeyAndDate:${key}`, function () {
                const map = {};
                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    const groupKey = String(row[key] || '').trim();
                    const dateStr = row._dateStr;
                    if (groupKey && dateStr) {
                        if (!map[groupKey]) map[groupKey] = {};
                        map[groupKey][dateStr] = (map[groupKey][dateStr] || 0) + 1;
                    }
                }
                return map;
            }, data);
        }

        function crossTab(data, key1, key2) {
            return getCachedFilteredValue(`crossTab:${key1}:${key2}`, function () {
                const map = {};
                for (let i = 0; i < data.length; i++) {
                    const value1 = String(data[i][key1] || '').trim();
                    const value2 = String(data[i][key2] || '').trim();
                    if (value1 && value2) {
                        if (!map[value1]) map[value1] = {};
                        map[value1][value2] = (map[value1][value2] || 0) + 1;
                    }
                }
                return map;
            }, data);
        }

        function topNWithOther(countObj, n, otherLabel = '기타') {
            const entries = Object.entries(countObj).sort((a, b) => b[1] - a[1]);
            if (entries.length <= n) return { labels: entries.map(entry => entry[0]), values: entries.map(entry => entry[1]) };
            const top = entries.slice(0, n);
            const otherSum = entries.slice(n).reduce((sum, entry) => sum + entry[1], 0);
            return {
                labels: [...top.map(entry => entry[0]), otherLabel],
                values: [...top.map(entry => entry[1]), otherSum]
            };
        }

        function uniqueCount(data, key) {
            const values = new Set();
            for (let i = 0; i < data.length; i++) {
                const value = String(data[i][key] || '').trim();
                if (value) values.add(value);
            }
            return values.size;
        }

        function uniqueCountByKey(data, groupKey, countKey) {
            const map = {};
            for (let i = 0; i < data.length; i++) {
                const group = String(data[i][groupKey] || '').trim();
                const value = String(data[i][countKey] || '').trim();
                if (group && value) {
                    if (!map[group]) map[group] = new Set();
                    map[group].add(value);
                }
            }
            const result = {};
            Object.keys(map).forEach(key => { result[key] = map[key].size; });
            return result;
        }

        function calcHours(row) {
            const start = row._date instanceof Date ? row._date : parseDate(row['작업시작일시']);
            const end = row._endDate instanceof Date ? row._endDate : parseDate(row['작업종료일시']);
            if (!(start instanceof Date) || !(end instanceof Date)) return 0;
            if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
            let hours = (end - start) / (1000 * 60 * 60);
            if (!(hours > 0 && hours < 24)) return 0;
            const startHours = start.getHours();
            const startMinutes = start.getMinutes();
            const endHours = end.getHours();
            const endMinutes = end.getMinutes();
            if ((startHours === 9 && startMinutes === 0 && endHours === 18 && endMinutes === 0) ||
                (startHours === 8 && startMinutes === 30 && endHours === 17 && endMinutes === 30)) {
                hours -= 1;
            }
            return hours;
        }

        function isInternal(type) {
            return /내부|셀프|교육/.test(type);
        }

        function isBillable(type) {
            return /기술지원|점검지원|Presales|presales|비상대기|현장실습|고객사교육/.test(type);
        }

        function typeCategoryOf(type) {
            if (/내부업무/.test(type)) return '내부업무';
            if (/셀프/.test(type)) return '셀프스터디';
            if (/교육/.test(type)) return '교육';
            if (/점검/.test(type)) return '점검지원';
            if (/Presales|presales/.test(type)) return 'Presales';
            if (/기술지원/.test(type)) return '기술지원';
            return '기타';
        }

        function visitTypeOf(type) {
            if (/\[방문\]/.test(type)) return '방문';
            if (/\[원격\]/.test(type)) return '원격';
            return '기타(내부)';
        }

        function productGroupOf(prod) {
            if (!prod) return '기타';
            for (const rule of PRODUCT_GROUP_RULES) {
                if (rule.re.test(prod)) return rule.group;
            }
            const cleaned = prod.replace(/\s*[\[\(].*?[\]\)]\s*/g, '').trim();
            const token = cleaned.split(/[\/,]/)[0].trim();
            return token || '기타';
        }

        function aggregateEngineers(data) {
            return getCachedFilteredValue('aggregateEngineers', function () {
                const map = {};
                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    const engineer = String(row['엔지니어'] || '').trim();
                    if (!engineer) continue;
                    if (!map[engineer]) map[engineer] = { count: 0, hours: 0, billableHours: 0, billableCount: 0, billableCusts: new Set(), custs: new Set(), prods: new Set(), types: {}, dept: '', dates: new Set(), internal: 0, external: 0 };
                    const metric = map[engineer];
                    metric.count++;
                    const rowHours = Number(row._hoursNum) || 0;
                    metric.hours += rowHours;
                    metric.dept = String(row['부서명'] || '').trim() || metric.dept;
                    const customer = String(row['고객사명'] || '').trim();
                    if (customer) metric.custs.add(customer);
                    const product = String(row['제품명'] || '').trim();
                    if (product) metric.prods.add(product);
                    const type = String(row['지원유형'] || '').trim();
                    if (type) metric.types[type] = (metric.types[type] || 0) + 1;
                    if (row._dateStr) metric.dates.add(row._dateStr);
                    if (row._isInternal) metric.internal++; else metric.external++;
                    if (row._isBillable) {
                        metric.billableHours += rowHours;
                        metric.billableCount++;
                        if (customer) metric.billableCusts.add(customer);
                    }
                }
                return map;
            }, data);
        }

        function aggregateCustomers(data) {
            return getCachedFilteredValue('aggregateCustomers', function () {
                const map = {};
                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    const customer = String(row['고객사명'] || '').trim();
                    if (!customer) continue;
                    if (!map[customer]) map[customer] = { count: 0, hours: 0, prods: new Set(), engs: new Set(), types: {}, sales: new Set() };
                    const metric = map[customer];
                    metric.count++;
                    metric.hours += Number(row._hoursNum) || 0;
                    const product = String(row['제품명'] || '').trim();
                    if (product) metric.prods.add(product);
                    const engineer = String(row['엔지니어'] || '').trim();
                    if (engineer) metric.engs.add(engineer);
                    const type = String(row['지원유형'] || '').trim();
                    if (type) metric.types[type] = (metric.types[type] || 0) + 1;
                    const sales = String(row['담당영업'] || '').trim();
                    if (sales) metric.sales.add(sales);
                }
                return map;
            }, data);
        }

        function aggregateProducts(data) {
            return getCachedFilteredValue('aggregateProducts', function () {
                const map = {};
                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    const product = String(row['제품명'] || '').trim();
                    if (!product) continue;
                    if (!map[product]) map[product] = { count: 0, hours: 0, custs: new Set(), engs: new Set(), types: {} };
                    const metric = map[product];
                    metric.count++;
                    metric.hours += Number(row._hoursNum) || 0;
                    const customer = String(row['고객사명'] || '').trim();
                    if (customer) metric.custs.add(customer);
                    const engineer = String(row['엔지니어'] || '').trim();
                    if (engineer) metric.engs.add(engineer);
                    const type = String(row['지원유형'] || '').trim();
                    if (type) metric.types[type] = (metric.types[type] || 0) + 1;
                }
                return map;
            }, data);
        }

        function aggregateSales(data) {
            return getCachedFilteredValue('aggregateSales', function () {
                const map = {};
                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    const sales = String(row['담당영업'] || '').trim();
                    if (!sales) continue;
                    if (!map[sales]) map[sales] = { count: 0, hours: 0, custs: new Set(), engs: new Set(), prods: new Set(), types: {}, dates: new Set() };
                    const metric = map[sales];
                    metric.count++;
                    metric.hours += Number(row._hoursNum) || 0;
                    const customer = String(row['고객사명'] || '').trim();
                    if (customer) metric.custs.add(customer);
                    const engineer = String(row['엔지니어'] || '').trim();
                    if (engineer) metric.engs.add(engineer);
                    const product = String(row['제품명'] || '').trim();
                    if (product) metric.prods.add(product);
                    const type = String(row['지원유형'] || '').trim();
                    if (type) metric.types[type] = (metric.types[type] || 0) + 1;
                    if (row._dateStr) metric.dates.add(row._dateStr);
                }
                return map;
            }, data);
        }

        function aggregateByTeam(engMap, contractHoursPerEngineer = 0) {
            const teamMap = {};
            Object.values(engMap).forEach(metric => {
                const dept = metric.dept || '미지정';
                if (!teamMap[dept]) teamMap[dept] = { billableH: 0, workH: 0, totalH: 0, engCount: 0 };
                teamMap[dept].billableH += metric.billableHours;
                teamMap[dept].workH += contractHoursPerEngineer;
                teamMap[dept].totalH += metric.hours;
                teamMap[dept].engCount++;
            });
            return teamMap;
        }

        function getWeekKey(date) {
            const value = new Date(date);
            const day = value.getDay();
            const diff = (day === 0 ? -6 : 1 - day);
            value.setDate(value.getDate() + diff);
            const year = value.getFullYear();
            const month = String(value.getMonth() + 1).padStart(2, '0');
            const dayOfMonth = String(value.getDate()).padStart(2, '0');
            return `${year}-${month}-${dayOfMonth}`;
        }

        function getWeekLabel(mondayKey) {
            const [year, month, day] = mondayKey.split('-').map(Number);
            const monday = new Date(year, month - 1, day);
            const sunday = new Date(monday);
            sunday.setDate(sunday.getDate() + 6);
            const format = dt => `${dt.getMonth() + 1}/${dt.getDate()}`;
            return `${format(monday)}~${format(sunday)}`;
        }

        function aggregateByWeek(data) {
            return getCachedFilteredValue('aggregateByWeek', function () {
                const map = {};
                for (let i = 0; i < data.length; i++) {
                    if (!data[i]._date) continue;
                    const key = getWeekKey(data[i]._date);
                    map[key] = (map[key] || 0) + 1;
                }
                return map;
            }, data);
        }

        function movingAverage(values, n) {
            return values.map((_, i) => {
                const start = Math.max(0, i - n + 1);
                const slice = values.slice(start, i + 1);
                const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
                return Math.round(avg * 10) / 10;
            });
        }

        return {
            getCompensationEntriesForRange,
            getCompensationTopEngineers,
            buildDateOnly,
            shiftDateByDays,
            shiftDateByMonths,
            getRangeSpanDays,
            formatDateRangeLabel,
            buildCurrentFilterSignature,
            rowMatchesSelectedFilters,
            collectComparablePeriodData,
            getComparablePeriodContext,
            summarizeEntityTransition,
            buildDeltaHtml,
            buildAnalyticsSummary,
            aggregateCounts,
            aggregateByDate,
            aggregateByKeyAndDate,
            crossTab,
            topNWithOther,
            uniqueCount,
            uniqueCountByKey,
            calcHours,
            isInternal,
            isBillable,
            typeCategoryOf,
            visitTypeOf,
            productGroupOf,
            aggregateEngineers,
            aggregateCustomers,
            aggregateProducts,
            aggregateSales,
            aggregateByTeam,
            getWeekKey,
            getWeekLabel,
            aggregateByWeek,
            movingAverage
        };
    }

    window.DASH_ANALYTICS_CORE = {
        createAnalyticsCore
    };
})();
