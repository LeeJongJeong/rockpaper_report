(function () {
    'use strict';

    const APP_CONFIG = window.DASH_CONFIG;
    const APP_UTILS = window.DASH_UTILS || {};

    if (!APP_CONFIG) {
        throw new Error('DASH_CONFIG is required. Load src/config.js before src/app.js.');
    }

    function getConfigValue(key) {
        if (!Object.prototype.hasOwnProperty.call(APP_CONFIG, key) || APP_CONFIG[key] == null) {
            throw new Error(`DASH_CONFIG.${key} is required.`);
        }
        return APP_CONFIG[key];
    }

    const CONFIG = getConfigValue('CONFIG');

    const appState = window.DASH_APP_STATE.createAppState({
        tableDefaultPerPage: CONFIG.TABLE_DEFAULT_PER_PAGE
    });
    const state = appState.getState();

    const FILTER_COLUMNS = getConfigValue('FILTER_COLUMNS');
    const COMPARISON_MODES = getConfigValue('COMPARISON_MODES');
    const COLORS = getConfigValue('COLORS');
    const DEPT_COLORS = getConfigValue('DEPT_COLORS');
    const DEPT_BG_COLORS = getConfigValue('DEPT_BG_COLORS');
    const TABLE_COLUMNS = getConfigValue('TABLE_COLUMNS');
    const TABLE_COLUMN_TYPES = getConfigValue('TABLE_COLUMN_TYPES');
    const PRODUCT_GROUP_RULES = getConfigValue('PRODUCT_GROUP_RULES');

    const {
        parseDate,
        formatDateStr,
        formatNum,
        utilColor,
        debounce,
        showToast,
        showLoading
    } = APP_UTILS;
    const APP_CONTRACT_UTILS = window.DASH_CONTRACT_UTILS || {};
    const CONTRACT_UTILS = {
        isNormalizedHolidayConfig: APP_CONTRACT_UTILS.isNormalizedHolidayConfig || function (config) {
            return !!(config
                && typeof config === 'object'
                && config.fixed instanceof Set
                && config.extras instanceof Set
                && config.extrasMonthDay instanceof Set
                && config.yearly instanceof Map
            );
        },
        normalizeHolidayConfig: APP_CONTRACT_UTILS.normalizeHolidayConfig || function (rawConfig) {
            if (CONTRACT_UTILS.isNormalizedHolidayConfig(rawConfig)) return rawConfig;
            const data = {
                fixed: new Set(),
                yearly: new Map(),
                extras: new Set(),
                extrasMonthDay: new Set(),
                includeSubstitute: false
            };

            const pad2 = function (v) {
                return String(v).padStart(2, '0');
            };
            const isMonthDay = function (v) { return /^\d{1,2}-\d{1,2}$/.test(String(v || '').trim()); };
            const isFullDate = function (v) { return /^\d{4}-\d{1,2}-\d{1,2}$/.test(String(v || '').trim()); };

            const addMonthDay = function (set, v) {
                const raw = String(v || '').trim();
                if (!isMonthDay(raw)) return;
                const p = raw.split('-').map(Number);
                if (!p[0] || !p[1] || p[0] < 1 || p[0] > 12 || p[1] < 1 || p[1] > 31) return;
                const mmdd = `${pad2(p[0])}-${pad2(p[1])}`;
                if (set) set.add(`${pad2(p[0])}-${pad2(p[1])}`);
            };

            const add = function (list, setOrMode) {
                if (!Array.isArray(list)) return;
                for (let i = 0; i < list.length; i++) {
                    const v = list[i];
                    if (v === undefined || v === null) continue;
                    const s = String(v).trim();
                    if (!s) continue;
                    if (setOrMode && setOrMode !== 'full' && isMonthDay(s)) {
                        addMonthDay(setOrMode, s);
                    } else if (isMonthDay(s)) {
                        continue;
                    } else if (isFullDate(s)) {
                        const parsed = parseDate(s);
                        if (parsed) data.extras.add(formatDateStr(parsed));
                    } else {
                        const parsed = parseDate(s);
                        if (parsed && /^\d{2,4}-\d{1,2}-\d{1,2}$/.test(formatDateStr(parsed))) {
                            data.extras.add(formatDateStr(parsed));
                        }
                    }
                }
            };

            if (!rawConfig) return data;
            if (Array.isArray(rawConfig)) {
                add(rawConfig, data.fixed);
                return data;
            }
            if (typeof rawConfig !== 'object') return data;

            add(rawConfig.fixed, data.fixed);
            if (rawConfig.yearly && typeof rawConfig.yearly === 'object') {
                Object.keys(rawConfig.yearly).forEach(y => {
                    const n = Number(y);
                    if (!Number.isInteger(n)) return;
                    if (!data.yearly.has(n)) data.yearly.set(n, new Set());
                    add(rawConfig.yearly[y], data.yearly.get(n));
                });
            }
            add(rawConfig.extras, 'full');
            add(rawConfig.extras, data.extrasMonthDay);
            data.includeSubstitute = !!rawConfig.includeSubstitute;
            return data;
        },
        buildHolidaySetForRange: APP_CONTRACT_UTILS.buildHolidaySetForRange || function (startDate, endDate, rawConfig) {
            const config = CONTRACT_UTILS.normalizeHolidayConfig(rawConfig);
            if (!(startDate instanceof Date) || !(endDate instanceof Date)) return new Set();
            let s = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
            let e = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
            if (s > e) {
                const t = s;
                s = e;
                e = t;
            }

            const set = new Set();
            const startKey = formatDateStr(s);
            const endKey = formatDateStr(e);
            const addWithSub = function (dt) {
                if (!(dt instanceof Date) || isNaN(dt.getTime())) return;
                set.add(formatDateStr(dt));
                if (!config.includeSubstitute) return;
                const dow = dt.getDay();
                if (dow !== 0 && dow !== 6) return;
                const sub = new Date(dt);
                sub.setDate(sub.getDate() + (dow === 6 ? 2 : 1));
                while (sub.getDay() === 0 || sub.getDay() === 6) sub.setDate(sub.getDate() + 1);
                set.add(formatDateStr(sub));
            };
            const addMonthDay = function (y, mmdd) {
                const p = String(mmdd || '').split('-').map(Number);
                if (!p[0] || !p[1]) return;
                addWithSub(new Date(y, p[0] - 1, p[1]));
            };

            for (let y = s.getFullYear(); y <= e.getFullYear(); y++) {
                config.fixed.forEach(mmdd => addMonthDay(y, mmdd));
                const yearly = config.yearly.get(y);
                if (yearly) yearly.forEach(mmdd => addMonthDay(y, mmdd));
                config.extrasMonthDay.forEach(mmdd => addMonthDay(y, mmdd));
            }
            config.extras.forEach(d => {
                if (d >= startKey && d <= endKey) set.add(d);
            });
            return set;
        },
        countBusinessDaysWithHolidaySet: APP_CONTRACT_UTILS.countBusinessDaysWithHolidaySet || function (startDate, endDate, holidaySet) {
            if (!(startDate instanceof Date) || !(endDate instanceof Date)) return 0;
            let s = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
            let e = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
            if (s > e) {
                const t = s;
                s = e;
                e = t;
            }
            let count = 0;
            const set = holidaySet instanceof Set ? holidaySet : new Set();
            const cursor = new Date(s);
            while (cursor <= e) {
                const dow = cursor.getDay();
                if (dow !== 0 && dow !== 6 && !set.has(formatDateStr(cursor))) count++;
                cursor.setDate(cursor.getDate() + 1);
            }
            return count;
        },
        summarizeContractHoursByRange: APP_CONTRACT_UTILS.summarizeContractHoursByRange || function (startDate, endDate, rawConfig, options) {
            const cfg = CONTRACT_UTILS.normalizeHolidayConfig(rawConfig);
            const workHoursPerDay = Number((options || {}).workHoursPerDay) || CONFIG.WORK_HOURS_PER_DAY;
            const set = CONTRACT_UTILS.buildHolidaySetForRange(startDate, endDate, cfg);
            if (!(startDate instanceof Date) || !(endDate instanceof Date)) return { totalWorkDays: 0, totalWorkHours: 0, byMonth: [] };
            const s = new Date(Math.min(startDate, endDate));
            const e = new Date(Math.max(startDate, endDate));
            let totalWorkDays = 0;
            const byMonth = [];
            let cursor = new Date(s.getFullYear(), s.getMonth(), 1);
            while (cursor <= e) {
                const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
                const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
                const cStart = monthStart > s ? monthStart : s;
                const cEnd = monthEnd < e ? monthEnd : e;
                if (cStart <= cEnd) {
                    const workDays = CONTRACT_UTILS.countBusinessDaysWithHolidaySet(cStart, cEnd, set);
                    const workHours = workDays * workHoursPerDay;
                    totalWorkDays += workDays;
                    byMonth.push({
                        key: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`,
                        monthStart: formatDateStr(monthStart),
                        monthEnd: formatDateStr(monthEnd),
                        workStart: formatDateStr(cStart),
                        workEnd: formatDateStr(cEnd),
                        workDays: workDays,
                        workHours: workHours
                    });
                }
                cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
            }
            return {
                totalWorkDays: totalWorkDays,
                totalWorkHours: totalWorkDays * workHoursPerDay,
                byMonth: byMonth
            };
        }
    };
    const HOLIDAY_DATA = CONTRACT_UTILS.normalizeHolidayConfig(CONFIG.HOLIDAYS);
    let ACTIVE_HOLIDAY_SET = new Set();
    let appShell = null;
    const dashboardUI = window.DASH_DASHBOARD_UI.createDashboardUI({
        Chart,
        COLORS,
        DEPT_COLORS,
        DEPT_BG_COLORS,
        formatNum,
        getCharts: () => state.charts,
        setChart: (id, chart) => { state.charts[id] = chart; }
    });

    function getDeptColor(deptName) {
        return dashboardUI.getDeptColor(deptName);
    }
    function resetDeptColors() {
        return dashboardUI.resetDeptColors();
    }
    function escapeHtml(value) {
        return dashboardUI.escapeHtml(value);
    }
    function escapeAttr(value) {
        return dashboardUI.escapeAttr(value);
    }
    function safeInlineText(value) {
        return dashboardUI.safeInlineText(value);
    }

    function resetFilteredComputationCache() {
        state.filteredComputationCache = { dataRef: state.filteredData, store: {} };
    }
    function resetComparablePeriodCache() {
        state.comparablePeriodCache = { key: null, value: null };
    }
    function normalizeComparisonMode(mode) {
        return Object.prototype.hasOwnProperty.call(COMPARISON_MODES, mode) ? mode : 'previous_period';
    }
    function getComparisonModeMeta(mode) {
        return COMPARISON_MODES[normalizeComparisonMode(mode || state.comparisonMode)] || COMPARISON_MODES.previous_period;
    }
    function getComparisonModeLabel(mode) {
        return getComparisonModeMeta(mode).label;
    }
    function updateComparisonModeControl() {
        const select = document.getElementById('comparisonMode');
        if (select) select.value = normalizeComparisonMode(state.comparisonMode);
    }
    function getCachedFilteredValue(key, producer, data) {
        if (data !== state.filteredData) return producer();
        if (state.filteredComputationCache.dataRef !== state.filteredData) {
            resetFilteredComputationCache();
        }
        if (!Object.prototype.hasOwnProperty.call(state.filteredComputationCache.store, key)) {
            state.filteredComputationCache.store[key] = producer();
        }
        return state.filteredComputationCache.store[key];
    }

    const analyticsCore = window.DASH_ANALYTICS_CORE.createAnalyticsCore({
        CONFIG,
        FILTER_COLUMNS,
        PRODUCT_GROUP_RULES,
        parseDate,
        formatDateStr,
        getCachedFilteredValue,
        getContractWorkHours,
        getContractWorkHoursForRange,
        getRawData: () => state.rawData,
        getFilterState: () => state.filterState,
        getDateRange: () => state.dateRange,
        getActiveFilterFromDate: () => state.activeFilterFromDate,
        getActiveFilterToDate: () => state.activeFilterToDate,
        getCompensationEntries: () => state.compensationEntries,
        getComparisonMode: () => state.comparisonMode,
        getComparablePeriodCache: () => state.comparablePeriodCache,
        setComparablePeriodCache: (nextCache) => { state.comparablePeriodCache = nextCache; },
        normalizeComparisonMode,
        getComparisonModeLabel,
        safeInlineText
    });


    const filterUIActions = {
        resetFilteredComputationCache,
        resetComparablePeriodCache,
        updateContractHours,
        updateCurrentTab,
        updateDrilldownBanner,
        getComparisonModeLabel
    };

    const filterUI = window.DASH_FILTER_UI.createFilterUI({
        FILTER_COLUMNS,
        CONFIG,
        flatpickr,
        escapeAttr,
        safeInlineText,
        formatNum,
        debounce,
        formatDateStr,
        state: appState,
        actions: filterUIActions
    });



    const tableUI = window.DASH_TABLE_UI.createTableUI({
        TABLE_COLUMNS,
        TABLE_COLUMN_TYPES,
        DEFAULT_PER_PAGE: CONFIG.TABLE_DEFAULT_PER_PAGE,
        XLSX,
        debounce,
        formatNum,
        formatDateStr,
        escapeAttr,
        escapeHtml,
        safeInlineText,
        parseMetricValue,
        parseDate,
        showToast,
        getFilteredData: () => state.filteredData,
        getTableState: () => state.tableState
    });

    const dataLoaderActions = {
        updateComparisonModeControl,
        resetDeptColors,
        resetFilteredComputationCache,
        resetComparablePeriodCache,
        initializeFilters,
        initializeDatePicker,
        applyAllFilters,
        updateHeaderFileInfo
    };

    const dataLoader = window.DASH_DATA_LOADER.createDataLoader({
        CONFIG,
        DEPT_COLORS,
        XLSX,
        parseDate,
        formatDateStr,
        showToast,
        showLoading,
        formatNum,
        isInternal: (...args) => analyticsCore.isInternal(...args),
        isBillable: (...args) => analyticsCore.isBillable(...args),
        typeCategoryOf: (...args) => analyticsCore.typeCategoryOf(...args),
        visitTypeOf: (...args) => analyticsCore.visitTypeOf(...args),
        productGroupOf: (...args) => analyticsCore.productGroupOf(...args),
        calcHours: (...args) => analyticsCore.calcHours(...args),
        state: appState,
        actions: dataLoaderActions
    });

    const overviewTab = window.DASH_OVERVIEW_TAB.createOverviewTab({
        CONFIG,
        COLORS,
        formatNum,
        utilColor,
        safeInlineText,
        getFilteredData: () => state.filteredData,
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
        getActiveFilterFromDate: () => state.activeFilterFromDate,
        getActiveFilterToDate: () => state.activeFilterToDate,
        isBillable,
        isInternal,
        getWeekKey,
        getContractWorkHours
    });

    const engineerTab = window.DASH_ENGINEER_TAB.createEngineerTab({
        CONFIG,
        COLORS,
        utilColor,
        safeInlineText,
        getFilteredData: () => state.filteredData,
        getComparablePeriodContext,
        aggregateEngineers,
        buildAnalyticsSummary,
        summarizeEntityTransition,
        buildDeltaHtml,
        upsertChart,
        makeDrilldownClick,
        getContractWorkDays: () => state.contractWorkDays,
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
        getActiveFilterFromDate: () => state.activeFilterFromDate,
        getActiveFilterToDate: () => state.activeFilterToDate
    });

    const customerTab = window.DASH_CUSTOMER_TAB.createCustomerTab({
        CONFIG,
        COLORS,
        safeInlineText,
        escapeAttr,
        getFilteredData: () => state.filteredData,
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
    });

    const salesTab = window.DASH_SALES_TAB.createSalesTab({
        CONFIG,
        COLORS,
        safeInlineText,
        getFilteredData: () => state.filteredData,
        aggregateSales,
        upsertChart,
        typeCategoryOf,
        stackedBarConfig,
        aggregateByKeyAndDate,
        lineChartConfig,
        crossTab,
        buildHeatmapHTML
    });

    const productTab = window.DASH_PRODUCT_TAB.createProductTab({
        COLORS,
        safeInlineText,
        getFilteredData: () => state.filteredData,
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
    });

    const supportTab = window.DASH_SUPPORT_TAB.createSupportTab({
        safeInlineText,
        getFilteredData: () => state.filteredData,
        visitTypeOf,
        typeCategoryOf,
        upsertChart,
        pieChartConfig,
        lineChartConfig,
        stackedBarConfig,
        crossTab,
        buildHeatmapHTML
    });

    function getAllDeptNames(data) {
        return dashboardUI.getAllDeptNames(data);
    }
    function buildDeptLegendHTML(deptNames) {
        return dashboardUI.buildDeptLegendHTML(deptNames);
    }

    function getHolidaySetForRange(startDate, endDate) {
        ACTIVE_HOLIDAY_SET = CONTRACT_UTILS.buildHolidaySetForRange(startDate, endDate, HOLIDAY_DATA);
        return ACTIVE_HOLIDAY_SET;
    }

    function countBusinessDays(startDate, endDate, holidaySet = ACTIVE_HOLIDAY_SET) {
        return CONTRACT_UTILS.countBusinessDaysWithHolidaySet(startDate, endDate, holidaySet);
    }

    function getFilterWorkRange(fromDate, toDate) {
        let start = fromDate || null;
        let end = toDate || null;

        if (!start || !end) {
            for (let i = 0; i < state.filteredData.length; i++) {
                const d = state.filteredData[i]._date;
                if (!d) continue;
                if (!start || d < start) start = d;
                if (!end || d > end) end = d;
            }
        }

        if (!start) start = state.dateRange.min;
        if (!end) end = state.dateRange.max;

        return { start, end };
    }

    function updateContractHours(fromDate, toDate) {
        const range = getFilterWorkRange(fromDate, toDate);
        const summary = CONTRACT_UTILS.summarizeContractHoursByRange(range.start, range.end, HOLIDAY_DATA, {
            workHoursPerDay: CONFIG.WORK_HOURS_PER_DAY
        });
        state.contractWorkDays = summary.totalWorkDays || 0;
        state.contractWorkHours = summary.totalWorkHours != null ? summary.totalWorkHours : (state.contractWorkDays * CONFIG.WORK_HOURS_PER_DAY);
    }

    function getContractWorkHours() {
        return state.contractWorkHours;
    }

    function getContractWorkHoursForRange(startDate, endDate) {
        const range = getFilterWorkRange(startDate, endDate);
        const summary = CONTRACT_UTILS.summarizeContractHoursByRange(range.start, range.end, HOLIDAY_DATA, {
            workHoursPerDay: CONFIG.WORK_HOURS_PER_DAY
        });
        return summary.totalWorkHours != null ? summary.totalWorkHours : ((summary.totalWorkDays || 0) * CONFIG.WORK_HOURS_PER_DAY);
    }

    /* ============================================================
       파일 업로드 및 파싱
       ============================================================ */

    /** 드래그앤드롭 이벤트 설정 */
    function setupDropzone() {
        const dz = document.getElementById('dropzone');
        const fi = document.getElementById('fileInput');

        ['dragenter', 'dragover'].forEach(evt => {
            dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.add('drag-over'); });
        });
        ['dragleave', 'drop'].forEach(evt => {
            dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.remove('drag-over'); });
        });
        dz.addEventListener('drop', e => {
            const files = e.dataTransfer.files;
            if (files.length > 0) handleFiles(files, false);
        });
        fi.addEventListener('change', e => {
            if (e.target.files.length > 0) handleFiles(e.target.files, false);
            fi.value = '';
        });
    }

    /* ============================================================
       복수 파일 병합 처리
       ============================================================ */

    /** 다중 파일 유효성 검사 및 처리 시작
     *  @param {FileList} fileList  업로드된 파일 목록
     *  @param {boolean}  appendMode  true = 기존 데이터에 추가, false = 전체 교체
     */
    function handleFiles(fileList, appendMode) {
        return dataLoader.handleFiles(fileList, appendMode);
    }

    /** 파일 목록을 순차적으로 읽어 rawData에 누적 */
    function processFilesSequentially(files, idx) {
        return dataLoader.processFilesSequentially(files, idx);
    }

    /** 보상 시간 숫자 파싱 */
    function parseMetricValue(v) {
        return dataLoader.parseMetricValue(v);
    }

    /** 보상 시트 필드명 정규화(공백/탭/개행 제거) */
    function normalizeMetricField(name) {
        return dataLoader.normalizeMetricField(name);
    }

    /** 보상 시트 필드 조회(공백 변형 대응) */
    function getCompSheetField(row, fieldName) {
        return dataLoader.getCompSheetField(row, fieldName);
    }

    /** 보상 시트 필드명 대체군 조회 */
    function getCompSheetFieldAny(row, candidates) {
        return dataLoader.getCompSheetFieldAny(row, candidates);
    }

    /** 근무-보상시간 통계 시트에서 엔지니어별 총 보상발생시간 추출 */
    function appendCompensationSheet(wb, fileName) {
        return dataLoader.appendCompensationSheet(wb, fileName);
    }

    /** 엑셀 파일 1개를 파싱해 rawData에 추가 (헤더 3행, 데이터 4행부터) */
    function appendExcelData(buffer, fileName) {
        return dataLoader.appendExcelData(buffer, fileName);
    }

    /** 모든 파일 로드 후 날짜 범위 재계산 및 UI 확정 */
    function finalizeDataLoad() {
        return dataLoader.finalizeDataLoad();
    }

    /** 헤더 파일 칩 & 행 수 업데이트 */
    function updateHeaderFileInfo() {
        return appShell.updateHeaderFileInfo();
    }

    function initializeFilters() {
        return filterUI.initializeFilters();
    }

    /** Bind filter events */
    function setupFilterEvents() {
        return filterUI.setupFilterEvents();
    }

    /** Update filter button label */
    function updateFilterBtnText(key) {
        return filterUI.updateFilterBtnText(key);
    }

    /** Destroy date pickers */
    function destroyDatePickers() {
        return filterUI.destroyDatePickers();
    }

    function initializeDatePicker() {
        return filterUI.initializeDatePicker();
    }

    /** Select all filter options */
    function filterSelectAll(key) {
        return filterUI.filterSelectAll(key);
    };

    /** Deselect all filter options */
    function filterDeselectAll(key) {
        return filterUI.filterDeselectAll(key);
    };

    /** Clear all filters */
    function clearAllFilters() {
        return filterUI.clearAllFilters();
    };

    /* ============================================================
       Filter apply and filtered data refresh (module pass)
       ============================================================ */

    /** Recompute filtered data from current filters */
    function applyAllFilters() {
        return filterUI.applyAllFilters();
    };

    /** Refresh filter summary UI */
    function updateFilterSummary(fromStr, toStr) {
        return filterUI.updateFilterSummary(fromStr, toStr);
    }
    function getCompensationEntriesForRange(startDate, endDate) {
        return analyticsCore.getCompensationEntriesForRange(startDate, endDate);
    }

    function getCompensationTopEngineers(startDate, endDate, topN = 3) {
        return analyticsCore.getCompensationTopEngineers(startDate, endDate, topN);
    }

    function buildDateOnly(date) {
        return analyticsCore.buildDateOnly(date);
    }

    function shiftDateByDays(date, days) {
        return analyticsCore.shiftDateByDays(date, days);
    }

    function shiftDateByMonths(date, months) {
        return analyticsCore.shiftDateByMonths(date, months);
    }

    function getRangeSpanDays(startDate, endDate) {
        return analyticsCore.getRangeSpanDays(startDate, endDate);
    }

    function formatDateRangeLabel(startDate, endDate) {
        return analyticsCore.formatDateRangeLabel(startDate, endDate);
    }

    function buildCurrentFilterSignature() {
        return analyticsCore.buildCurrentFilterSignature();
    }

    function rowMatchesSelectedFilters(row) {
        return analyticsCore.rowMatchesSelectedFilters(row);
    }

    function collectComparablePeriodData(startDate, endDate) {
        return analyticsCore.collectComparablePeriodData(startDate, endDate);
    }

    function getComparablePeriodContext() {
        return analyticsCore.getComparablePeriodContext();
    }

    function summarizeEntityTransition(currentNames, previousNames) {
        return analyticsCore.summarizeEntityTransition(currentNames, previousNames);
    }

    function buildDeltaHtml(current, previous, options) {
        return analyticsCore.buildDeltaHtml(current, previous, options);
    }

    function buildAnalyticsSummary(data, options) {
        return analyticsCore.buildAnalyticsSummary(data, options);
    }

    function makeDrilldownClick(filterKey, allowOther = false) {
        return (evt, elements, chart) => {
            if (!elements.length) return;
            const label = chart.data.labels[elements[0].index];
            if (label && (allowOther || label !== '기타')) drillDownFilter(filterKey, label);
        };
    }

    /** 차트 클릭 시 해당 값으로 필터를 단일 선택으로 설정 */
    function drillDownFilter(key, value) {
        return appShell.drillDownFilter(key, value);
    }

    function clearDrilldown(key) {
        return appShell.clearDrilldown(key);
    }

    function clearAllDrilldowns() {
        return appShell.clearAllDrilldowns();
    }

    function updateDrilldownBanner() {
        return appShell.updateDrilldownBanner();
    }

    function updateCurrentTab() {
        return appShell.updateCurrentTab();
    }

    function aggregateCounts(data, ...keys) {
        return analyticsCore.aggregateCounts(data, ...keys);
    }

    /** 일별 집계 */
    function aggregateByDate(data) {
        return analyticsCore.aggregateByDate(data);
    }

    function aggregateByKeyAndDate(data, key) {
        return analyticsCore.aggregateByKeyAndDate(data, key);
    }

    function crossTab(data, key1, key2) {
        return analyticsCore.crossTab(data, key1, key2);
    }

    function topNWithOther(countObj, n, otherLabel = '기타') {
        return analyticsCore.topNWithOther(countObj, n, otherLabel);
    }

    /** 유니크 카운트 */
    function uniqueCount(data, key) {
        return analyticsCore.uniqueCount(data, key);
    }

    /** 유니크 키별 유니크 값 수 */
    function uniqueCountByKey(data, groupKey, countKey) {
        return analyticsCore.uniqueCountByKey(data, groupKey, countKey);
    }

    /** 작업시간(h) 계산 */
    function calcHours(row) {
        return analyticsCore.calcHours(row);
    }

    function isInternal(type) {
        return analyticsCore.isInternal(type);
    }

    function isBillable(type) {
        return analyticsCore.isBillable(type);
    }

    /** 지원유형 → 대분류 5개 */
    function typeCategoryOf(type) {
        return analyticsCore.typeCategoryOf(type);
    }

    /** 지원유형 → 방문/원격/기타 분류 */
    function visitTypeOf(type) {
        return analyticsCore.visitTypeOf(type);
    }

    /** 제품 → 제품군 그룹핑 */
    function productGroupOf(prod) {
        return analyticsCore.productGroupOf(prod);
    }

    /** 엔지니어 종합 집계 (단일 pass) */
    function aggregateEngineers(data) {
        return analyticsCore.aggregateEngineers(data);
    }

    function aggregateCustomers(data) {
        return analyticsCore.aggregateCustomers(data);
    }

    function aggregateProducts(data) {
        return analyticsCore.aggregateProducts(data);
    }

    function aggregateSales(data) {
        return analyticsCore.aggregateSales(data);
    }

    function aggregateByTeam(engMap, contractHoursPerEngineer = 0) {
        return analyticsCore.aggregateByTeam(engMap, contractHoursPerEngineer);
    }

    /** Date → 해당 주 월요일 날짜 문자열(YYYY-MM-DD) */
    function getWeekKey(date) {
        return analyticsCore.getWeekKey(date);
    }

    /** 주 월요일 키 → "MM/DD~MM/DD" 레이블 */
    function getWeekLabel(mondayKey) {
        return analyticsCore.getWeekLabel(mondayKey);
    }

    /** 데이터를 주차별로 집계 → { weekKey: count } */
    function aggregateByWeek(data) {
        return analyticsCore.aggregateByWeek(data);
    }

    function movingAverage(values, n) {
        return analyticsCore.movingAverage(values, n);
    }

    /** 히트맵 HTML 생성기 */
    function buildHeatmapHTML(rowLabels, colLabels, matrix, maxVal) {
        return dashboardUI.buildHeatmapHTML(rowLabels, colLabels, matrix, maxVal);
    }

    function upsertChart(id, config) {
        return dashboardUI.upsertChart(id, config);
    }

    function lineChartConfig(labels, datasets, yTitle = '\uAC12', xTitle = '\uAD6C\uBD84') {
        return dashboardUI.lineChartConfig(labels, datasets, yTitle, xTitle);
    }

    function barChartConfig(labels, data, label, color, horizontal = false, valTitle = '', catTitle = '') {
        return dashboardUI.barChartConfig(labels, data, label, color, horizontal, valTitle, catTitle);
    }

    function pieChartConfig(labels, data, isDoughnut = true) {
        return dashboardUI.pieChartConfig(labels, data, isDoughnut);
    }

    function stackedBarConfig(labels, datasets, horizontal = false, valTitle = '', catTitle = '') {
        return dashboardUI.stackedBarConfig(labels, datasets, horizontal, valTitle, catTitle);
    }

    function rankTableHTML(entries, labelName) {
        return dashboardUI.rankTableHTML(entries, labelName);
    }

    function updateOverviewTab() {
        return overviewTab.updateOverviewTab();
    }

    /* ============================================================
       TAB 2: Engineer Analysis (module pass)
       ============================================================ */
    function updateEngineerTab() {
        return engineerTab.updateEngineerTab();
    }

    /* ============================================================
       TAB 3: 제품 분석 (전면 재설계)
       ============================================================ */
    function updateProductTab() {
        return productTab.updateProductTab();
    }

    /* ============================================================
       TAB 4: 지원유형 분석 (전면 재설계)
       ============================================================ */
    function updateSupportTab() {
        return supportTab.updateSupportTab();
    }

    /* ============================================================
       TAB 5: 고객사 분석 (전면 재설계)
       ============================================================ */
    function updateCustomerTab() {
        return customerTab.updateCustomerTab();
    }

    /* ============================================================
       TAB 7: 담당영업별 분석
       ============================================================ */
    function updateSalesTab() {
        return salesTab.updateSalesTab();
    }

    function updateDetailTab() {
        return tableUI.updateDetailTab();
    }

    function getTableSortValue(row, col) {
        return tableUI.getTableSortValue(row, col);
    }

    function compareTableRows(a, b, col, dir) {
        return tableUI.compareTableRows(a, b, col, dir);
    }

    /** Table search and render */
    function applyTableSearchAndRender() {
        return tableUI.applyTableSearchAndRender();
    }

    /** Table render with pagination */
    function renderTable() {
        return tableUI.renderTable();
    }

    function renderPagination(totalPages, currentPage) {
        return tableUI.renderPagination(totalPages, currentPage);
    }

    /** Go to table page */
    function goPage(p) {
        return tableUI.goPage(p);
    };

    /** Toggle table sort */
    function sortTable(colIdx) {
        return tableUI.sortTable(colIdx);
    };

    /** Export detail table (current filtered rows) */
    function exportToExcel() {
        return tableUI.exportToExcel();
    };
    /* ============================================================
       대시보드 리셋 (다른 파일 업로드)
       ============================================================ */
    function resetDashboard() {
        return appShell.resetDashboard();
    }


    appShell = window.DASH_APP_SHELL.createAppShell({
        Chart,
        safeInlineText,
        escapeAttr,
        formatNum,
        FILTER_COLUMNS,
        state: appState,
        actions: {
            applyAllFilters,
            clearAllFilters,
            updateFilterSummary,
            updateFilterBtnText,
            destroyDatePickers,
            resetFilteredComputationCache,
            resetComparablePeriodCache,
            resetDeptColors,
            updateComparisonModeControl,
            setupDropzone,
            initTableControls: () => tableUI.initTableControls(),
            resetDetailTableState: () => tableUI.resetDetailTableState(),
            normalizeComparisonMode,
            handleFiles
        },
        tabRenderers: {
            overview: updateOverviewTab,
            engineer: updateEngineerTab,
            product: updateProductTab,
            support: updateSupportTab,
            customer: updateCustomerTab,
            sales: updateSalesTab,
            detail: updateDetailTab
        }
    });

    function toggleTheme() {
        return appShell.toggleTheme();
    }

    function initTheme() {
        return appShell.initTheme();
    }

    function toggleFilterCollapsible() {
        return appShell.toggleFilterCollapsible();
    }

    function init() {
        return appShell.initApp();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

