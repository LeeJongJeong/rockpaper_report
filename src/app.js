(function () {
    'use strict';

    /* ============================================================
       전역 상태
       ============================================================ */
    let rawData = [];              // 원본 데이터 배열
    let filteredData = [];         // 필터 적용된 데이터
    let columnNames = [];          // 컬럼명 배열
    let filterState = {};          // 각 필터의 선택 상태
    let dateRange = { min: null, max: null };  // 날짜 범위
    let activeFilterFromDate = null; // 현재 적용된 날짜 필터 시작
    let activeFilterToDate = null;   // 현재 적용된 날짜 필터 종료
    let charts = {};               // Chart.js 인스턴스 캐시
    let currentTab = 'overview';   // 현재 활성 탭
    let loadedFiles = [];          // 병합된 파일 목록 [{ name, count, color }]
    let drilldownState = {};       // 차트 드릴다운 필터 상태 { 컬럼키: 값 }
    let contractWorkDays = 0;      // 현재 필터 기준 영업일(주말·공휴일 제외)
    let contractWorkHours = 0;     // 현재 필터 기준 소정근무(=영업일×8h)
    let compensationEntries = [];   // 근무-보상시간 통계 엔지니어별 보상시간 집계
    let datePickers = { from: null, to: null };
    let filterOutsideClickHandler = null;
    let filteredComputationCache = { dataRef: null, store: {} };
    let comparablePeriodCache = { key: null, value: null };
    let comparisonMode = 'previous_period';
    let tableState = {             // 테이블 상태
        page: 1,
        perPage: 50, // CONFIG.TABLE_DEFAULT_PER_PAGE
        sortCol: null,
        sortDir: 'asc',
        search: '',
        searchData: []
    };

    // 공통 설정/유틸 초기화 (별도 파일 분리)
    const APP_CONFIG = window.DASH_CONFIG || {};
    const APP_UTILS = window.DASH_UTILS || {};

    const CONFIG = APP_CONFIG.CONFIG || {
        UTIL: { DANGER: 60, TARGET: 80 },
        WORK_HOURS_PER_DAY: 8,
        HOLIDAYS: [],
        MOVING_AVG_DAYS: 7,
        FILE_MAX_MB: 200,
        TABLE_DEFAULT_PER_PAGE: 50,
        CHART_TOP_N: { PIE: 8, BAR: 10, RADAR: 5, TREND: 6 },
        DEBOUNCE_MS: 150
    };

    const FILTER_COLUMNS = APP_CONFIG.FILTER_COLUMNS || [
        { key: '부서명', label: '부서' },
        { key: '엔지니어', label: '엔지니어' },
        { key: '제품명', label: '제품' },
        { key: '지원유형', label: '지원유형' },
        { key: '고객사명', label: '고객사' },
        { key: '담당영업', label: '담당영업' }
    ];

    const COMPARISON_MODES = {
        previous_period: { label: '직전 동기간', description: '현재 선택한 기간과 길이가 같은 바로 이전 구간과 비교합니다.' },
        previous_week: { label: '전주 동일요일', description: '현재 기간을 7일 앞당긴 동일 요일 구간과 비교합니다.' },
        previous_month: { label: '전월 동일기간', description: '현재 기간을 한 달 앞당긴 동일 달력 구간과 비교합니다.' },
        previous_year: { label: '전년 동기', description: '현재 기간을 1년 앞당긴 동일 달력 구간과 비교합니다.' }
    };

    const COLORS = APP_CONFIG.COLORS || [
        '#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444',
        '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#06B6D4',
        '#6366F1', '#84CC16', '#D946EF', '#0D9488', '#E11D48',
        '#7C3AED', '#059669', '#DC2626', '#2563EB', '#CA8A04',
        '#9333EA', '#16A34A', '#DB2777', '#0284C7', '#EA580C'
    ];

    const DEPT_COLORS = APP_CONFIG.DEPT_COLORS || [
        '#2563EB', '#7C3AED', '#059669', '#DC2626', '#D97706',
        '#0891B2', '#BE185D', '#4338CA', '#0D9488', '#B45309',
        '#7E22CE', '#15803D', '#9333EA', '#0284C7', '#EA580C'
    ];
    const DEPT_BG_COLORS = APP_CONFIG.DEPT_BG_COLORS || [
        '#DBEAFE', '#F3E8FF', '#DCFCE7', '#FEE2E2', '#FEF3C7',
        '#CFFAFE', '#FCE7F3', '#E0E7FF', '#CCFBF1', '#FEF3C7',
        '#F3E8FF', '#DCFCE7', '#FAE8FF', '#E0F2FE', '#FFF7ED'
    ];
    const TABLE_COLUMNS = APP_CONFIG.TABLE_COLUMNS || ['작업시작일시', '작업종료일시', '작업시간(h)', '부서명', '엔지니어', '제품명', '지원유형', '고객사명', '지원내역', '지원도시', '담당영업'];
    const TABLE_COLUMN_TYPES = Object.assign({
        '작업시작일시': 'date',
        '작업종료일시': 'date',
        '작업시간(h)': 'number'
    }, APP_CONFIG.TABLE_COLUMN_TYPES || {});
    const PRODUCT_GROUP_RULES = APP_CONFIG.PRODUCT_GROUP_RULES || [];
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
    const dashboardUI = window.DASH_DASHBOARD_UI.createDashboardUI({
        Chart,
        COLORS,
        DEPT_COLORS,
        DEPT_BG_COLORS,
        formatNum,
        getCharts: () => charts,
        setChart: (id, chart) => { charts[id] = chart; }
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
        filteredComputationCache = { dataRef: filteredData, store: {} };
    }
    function resetComparablePeriodCache() {
        comparablePeriodCache = { key: null, value: null };
    }
    function normalizeComparisonMode(mode) {
        return Object.prototype.hasOwnProperty.call(COMPARISON_MODES, mode) ? mode : 'previous_period';
    }
    function getComparisonModeMeta(mode) {
        return COMPARISON_MODES[normalizeComparisonMode(mode || comparisonMode)] || COMPARISON_MODES.previous_period;
    }
    function getComparisonModeLabel(mode) {
        return getComparisonModeMeta(mode).label;
    }
    function updateComparisonModeControl() {
        const select = document.getElementById('comparisonMode');
        if (select) select.value = normalizeComparisonMode(comparisonMode);
    }
    function getCachedFilteredValue(key, producer, data) {
        if (data !== filteredData) return producer();
        if (filteredComputationCache.dataRef !== filteredData) {
            resetFilteredComputationCache();
        }
        if (!Object.prototype.hasOwnProperty.call(filteredComputationCache.store, key)) {
            filteredComputationCache.store[key] = producer();
        }
        return filteredComputationCache.store[key];
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
        getRawData: () => rawData,
        getFilterState: () => filterState,
        getDateRange: () => dateRange,
        getActiveFilterFromDate: () => activeFilterFromDate,
        getActiveFilterToDate: () => activeFilterToDate,
        getCompensationEntries: () => compensationEntries,
        getComparisonMode: () => comparisonMode,
        getComparablePeriodCache: () => comparablePeriodCache,
        setComparablePeriodCache: (nextCache) => { comparablePeriodCache = nextCache; },
        normalizeComparisonMode,
        getComparisonModeLabel,
        safeInlineText
    });


    const filterUI = window.DASH_FILTER_UI.createFilterUI({
        FILTER_COLUMNS,
        CONFIG,
        flatpickr,
        escapeAttr,
        safeInlineText,
        formatNum,
        debounce,
        getRawData: () => rawData,
        getFilteredData: () => filteredData,
        setFilteredData: (next) => { filteredData = next; },
        getFilterState: () => filterState,
        setFilterState: (next) => { filterState = next; },
        getDateRange: () => dateRange,
        getDatePickers: () => datePickers,
        getFilterOutsideClickHandler: () => filterOutsideClickHandler,
        setFilterOutsideClickHandler: (next) => { filterOutsideClickHandler = next; },
        getDrilldownState: () => drilldownState,
        setDrilldownState: (next) => { drilldownState = next; },
        setActiveFilterFromDate: (next) => { activeFilterFromDate = next; },
        setActiveFilterToDate: (next) => { activeFilterToDate = next; },
        resetFilteredComputationCache,
        resetComparablePeriodCache,
        updateContractHours,
        updateCurrentTab,
        updateDrilldownBanner,
        getComparisonModeLabel,
        formatDateStr
    });



    const tableUI = window.DASH_TABLE_UI.createTableUI({
        TABLE_COLUMNS,
        TABLE_COLUMN_TYPES,
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
        getFilteredData: () => filteredData,
        getTableState: () => tableState
    });

    const dataLoader = window.DASH_DATA_LOADER.createDataLoader({
        CONFIG,
        DEPT_COLORS,
        XLSX,
        parseDate,
        formatDateStr,
        showToast,
        showLoading,
        formatNum,
        updateComparisonModeControl,
        resetDeptColors,
        resetFilteredComputationCache,
        resetComparablePeriodCache,
        initializeFilters,
        initializeDatePicker,
        applyAllFilters: () => window.applyAllFilters(),
        updateHeaderFileInfo,
        isInternal: (...args) => analyticsCore.isInternal(...args),
        isBillable: (...args) => analyticsCore.isBillable(...args),
        typeCategoryOf: (...args) => analyticsCore.typeCategoryOf(...args),
        visitTypeOf: (...args) => analyticsCore.visitTypeOf(...args),
        productGroupOf: (...args) => analyticsCore.productGroupOf(...args),
        calcHours: (...args) => analyticsCore.calcHours(...args),
        getRawData: () => rawData,
        setRawData: (next) => { rawData = next; },
        getLoadedFiles: () => loadedFiles,
        setLoadedFiles: (next) => { loadedFiles = next; },
        getColumnNames: () => columnNames,
        setColumnNames: (next) => { columnNames = next; },
        getCompensationEntries: () => compensationEntries,
        setCompensationEntries: (next) => { compensationEntries = next; },
        setActiveFilterFromDate: (next) => { activeFilterFromDate = next; },
        setActiveFilterToDate: (next) => { activeFilterToDate = next; },
        setComparisonMode: (next) => { comparisonMode = next; },
        setFilteredData: (next) => { filteredData = next; },
        getDateRange: () => dateRange
    });

    const overviewTab = window.DASH_OVERVIEW_TAB.createOverviewTab({
        CONFIG,
        COLORS,
        formatNum,
        utilColor,
        safeInlineText,
        getFilteredData: () => filteredData,
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
        getActiveFilterFromDate: () => activeFilterFromDate,
        getActiveFilterToDate: () => activeFilterToDate,
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
        getFilteredData: () => filteredData,
        getComparablePeriodContext,
        aggregateEngineers,
        buildAnalyticsSummary,
        summarizeEntityTransition,
        buildDeltaHtml,
        upsertChart,
        makeDrilldownClick,
        getContractWorkDays: () => contractWorkDays,
        getDeptColor,
        buildDeptLegendHTML,
        getAllDeptNames,
        barChartConfig,
        aggregateByKeyAndDate,
        crossTab,
        buildHeatmapHTML,
        stackedBarConfig,
        lineChartConfig
    });

    const customerTab = window.DASH_CUSTOMER_TAB.createCustomerTab({
        CONFIG,
        COLORS,
        safeInlineText,
        escapeAttr,
        getFilteredData: () => filteredData,
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
        getFilteredData: () => filteredData,
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
        getFilteredData: () => filteredData,
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
        getFilteredData: () => filteredData,
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
            for (let i = 0; i < filteredData.length; i++) {
                const d = filteredData[i]._date;
                if (!d) continue;
                if (!start || d < start) start = d;
                if (!end || d > end) end = d;
            }
        }

        if (!start) start = dateRange.min;
        if (!end) end = dateRange.max;

        return { start, end };
    }

    function updateContractHours(fromDate, toDate) {
        const range = getFilterWorkRange(fromDate, toDate);
        const summary = CONTRACT_UTILS.summarizeContractHoursByRange(range.start, range.end, HOLIDAY_DATA, {
            workHoursPerDay: CONFIG.WORK_HOURS_PER_DAY
        });
        contractWorkDays = summary.totalWorkDays || 0;
        contractWorkHours = summary.totalWorkHours != null ? summary.totalWorkHours : (contractWorkDays * CONFIG.WORK_HOURS_PER_DAY);
    }

    function getContractWorkHours() {
        return contractWorkHours;
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
        const chipsEl = document.getElementById('headerFileChips');
        const rowEl = document.getElementById('headerRowCount');
        if (loadedFiles.length === 1) {
            chipsEl.innerHTML = `<span class="header-badge">${safeInlineText(loadedFiles[0].name)}</span>`;
        } else {
            chipsEl.innerHTML = loadedFiles.map(f => {
                const shortName = f.name.replace(/주간업무보고_/, '').replace(/\.xlsx?$/, '');
                return `<span class="file-chip">` +
                    `<span class="chip-dot" style="background:${f.color}"></span>` +
                    `${safeInlineText(shortName)} <span class="chip-count">${formatNum(f.count)}행</span></span>`;
            }).join('');
        }
        rowEl.textContent = `총 ${formatNum(rawData.length)}행`;
        document.getElementById('headerInfo').style.display = 'flex';
    }

    /* ============================================================
       필터 초기화 및 관리
       ============================================================ */

    /** ?? UI ?? ?? */
    function initializeFilters() {
        return filterUI.initializeFilters();
    }

    /** ?? ??? ??? */
    function setupFilterEvents() {
        return filterUI.setupFilterEvents();
    }

    /** ?? ?? ??? ???? */
    function updateFilterBtnText(key) {
        return filterUI.updateFilterBtnText(key);
    }

    /** ?? ??? ??? */
    function destroyDatePickers() {
        return filterUI.destroyDatePickers();
    }

    function initializeDatePicker() {
        return filterUI.initializeDatePicker();
    }

    /** ?? ?? */
    window.filterSelectAll = function (key) {
        return filterUI.filterSelectAll(key);
    };

    /** ?? ?? */
    window.filterDeselectAll = function (key) {
        return filterUI.filterDeselectAll(key);
    };

    /** ?? ?? ??? */
    window.clearAllFilters = function () {
        return filterUI.clearAllFilters();
    };

    /* ============================================================
       ?? ?? ? ??? ??? (?? pass)
       ============================================================ */

    /** ?? ??? ???? filteredData ?? */
    window.applyAllFilters = function () {
        return filterUI.applyAllFilters();
    };

    /** ?? ?? UI ???? */
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
    window.drillDownFilter = function (key, value) {
        if (!filterState[key]) return;
        filterState[key].selected = new Set([value]);
        document.querySelectorAll(`.filter-dropdown-list[data-key="${key}"] input[type="checkbox"]`).forEach(cb => {
            cb.checked = (cb.dataset.val === value);
        });
        updateFilterBtnText(key);
        drilldownState[key] = value;
        updateDrilldownBanner();
        applyAllFilters();
    };

    /** 특정 드릴다운 해제 */
    window.clearDrilldown = function (key) {
        if (!filterState[key]) return;
        filterState[key].selected = new Set(filterState[key].options);
        document.querySelectorAll(`.filter-dropdown-list[data-key="${key}"] input[type="checkbox"]`).forEach(cb => {
            cb.checked = true;
        });
        updateFilterBtnText(key);
        delete drilldownState[key];
        updateDrilldownBanner();
        applyAllFilters();
    };

    /** 모든 드릴다운 해제 */
    window.clearAllDrilldowns = function () {
        Object.keys(drilldownState).forEach(key => window.clearDrilldown(key));
    };

    /** 드릴다운 뱃지 배너 업데이트 */
    function updateDrilldownBanner() {
        let banner = document.getElementById('drilldownBanner');
        const entries = Object.entries(drilldownState);
        if (!entries.length) {
            if (banner) banner.style.display = 'none';
            return;
        }
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'drilldownBanner';
            banner.className = 'drilldown-banner';
            document.querySelector('.filter-bar').appendChild(banner);
        }
        const labelMap = {};
        FILTER_COLUMNS.forEach(fc => { labelMap[fc.key] = fc.label; });
        banner.style.display = 'flex';
        banner.innerHTML =
            `<span class="drilldown-banner-label"><i class="fas fa-mouse-pointer"></i> 차트 드릴다운:</span>` +
            entries.map(([key, val]) =>
                `<span class="drilldown-badge">` +
                `<span class="drilldown-key">${safeInlineText(labelMap[key] || key)}</span> <strong>${safeInlineText(val)}</strong>` +
                `<button onclick="clearDrilldown('${key}')" title="해제"><i class="fas fa-times"></i></button>` +
                `</span>`
            ).join('') +
            (entries.length > 1
                ? `<button class="btn-sm danger" onclick="clearAllDrilldowns()" style="padding:3px 10px;font-size:11px;"><i class="fas fa-times-circle"></i> 전체 해제</button>`
                : '');
    }

    /* ============================================================
       탭 관리
       ============================================================ */
    function setupTabs() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                const tab = this.dataset.tab;
                if (tab === currentTab) return;

                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                this.classList.add('active');
                document.getElementById('tab-' + tab).classList.add('active');
                currentTab = tab;

                // 탭 전환 시 해당 탭 업데이트
                updateCurrentTab();
            });
        });
    }

    /** 현재 탭만 업데이트 (성능 최적화) */
    function updateCurrentTab() {
        switch (currentTab) {
            case 'overview': updateOverviewTab(); break;
            case 'engineer': updateEngineerTab(); break;
            case 'product': updateProductTab(); break;
            case 'support': updateSupportTab(); break;
            case 'customer': updateCustomerTab(); break;
            case 'sales': updateSalesTab(); break;
            case 'detail': updateDetailTab(); break;
        }
    }

    /* ============================================================
       집계 유틸리티 (단일 pass)
       ============================================================ */

    /** 단일 pass로 여러 컬럼의 카운트 집계 */
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

    function lineChartConfig(labels, datasets, yTitle = '??', xTitle = '??') {
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
       TAB 2: ???? ?? (?? ???)
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

    /** ??? ?? */
    window.goPage = function (p) {
        return tableUI.goPage(p);
    };

    /** ?? ?? */
    window.sortTable = function (colIdx) {
        return tableUI.sortTable(colIdx);
    };

    /** ?? ???? (?? ??? ???) */
    window.exportToExcel = function () {
        return tableUI.exportToExcel();
    };
    /* ============================================================
       대시보드 리셋 (다른 파일 업로드)
       ============================================================ */
    window.resetDashboard = function () {
        // 차트 인스턴스 파괴
        Object.values(charts).forEach(c => { try { c.destroy(); } catch (e) { } });
        charts = {};
        rawData = [];
        filteredData = [];
        compensationEntries = [];
        activeFilterFromDate = null;
        activeFilterToDate = null;
        comparisonMode = 'previous_period';
        updateComparisonModeControl();
        loadedFiles = [];
        drilldownState = {};
        destroyDatePickers();
        resetFilteredComputationCache();
        resetComparablePeriodCache();
        resetDeptColors(); // 부서 색상 캐시 초기화
        const banner = document.getElementById('drilldownBanner');
        if (banner) banner.remove();

        document.getElementById('dashboard').classList.remove('active');
        document.getElementById('uploadSection').style.display = 'flex';
        document.getElementById('headerInfo').style.display = 'none';
        document.getElementById('fileInput').value = '';

        // 탭 리셋
        currentTab = 'overview';
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.tab-btn[data-tab="overview"]').classList.add('active');
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById('tab-overview').classList.add('active');
    };

    /* ============================================================
       다크 모드 로직
       ============================================================ */
    let isDarkMode = false;

    function applyChartTheme() {
        const textColor = isDarkMode ? '#9CA3AF' : '#6B7280';
        const gridColor = isDarkMode ? '#374151' : '#E5E7EB';

        Chart.defaults.color = textColor;
        if (Chart.defaults.scale && Chart.defaults.scale.grid) {
            Chart.defaults.scale.grid.color = gridColor;
        }

        Object.values(charts).forEach(chart => {
            if (chart.options.scales) {
                Object.values(chart.options.scales).forEach(scale => {
                    if (scale.ticks) scale.ticks.color = textColor;
                    if (scale.grid) scale.grid.color = gridColor;
                    if (scale.title) scale.title.color = textColor;
                });
            }
            if (chart.options.plugins && chart.options.plugins.legend && chart.options.plugins.legend.labels) {
                chart.options.plugins.legend.labels.color = textColor;
            }
            chart.update('none');
        });
    }

    window.toggleTheme = function () {
        isDarkMode = !isDarkMode;
        if (isDarkMode) {
            document.body.setAttribute('data-theme', 'dark');
            const icon = document.getElementById('themeIcon');
            if (icon) { icon.classList.remove('fa-moon'); icon.classList.add('fa-sun'); }
            localStorage.setItem('rockpaper-theme', 'dark');
        } else {
            document.body.removeAttribute('data-theme');
            const icon = document.getElementById('themeIcon');
            if (icon) { icon.classList.remove('fa-sun'); icon.classList.add('fa-moon'); }
            localStorage.setItem('rockpaper-theme', 'light');
        }
        applyChartTheme();
    };

    function initTheme() {
        const saved = localStorage.getItem('rockpaper-theme');
        if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            isDarkMode = true;
            document.body.setAttribute('data-theme', 'dark');
            const icon = document.getElementById('themeIcon');
            if (icon) { icon.classList.remove('fa-moon'); icon.classList.add('fa-sun'); }
        }
        applyChartTheme();
    }

    /* ============================================================
       필터 창 접기/펴기 로직
       ============================================================ */
    window.toggleFilterCollapsible = function () {
        const body = document.getElementById('filterCollapsibleBody');
        const icon = document.getElementById('filterToggleIcon');
        if (!body || !icon) return;

        if (body.classList.contains('open')) {
            body.classList.remove('open');
            icon.style.transform = 'rotate(180deg)';
        } else {
            body.classList.add('open');
            icon.style.transform = 'rotate(0deg)';
        }
    };

    /* ============================================================
       초기화
       ============================================================ */
    function init() {
        initTheme();
        setupDropzone();
        setupTabs();

        // 대시보드 내 "파일 추가" 버튼 (헤더)
        const addFileInput = document.getElementById('addFileInput');
        if (addFileInput) {
            addFileInput.addEventListener('change', function (e) {
                if (e.target.files.length > 0) handleFiles(e.target.files, true);
                this.value = '';
            });
        }

        // 테이블 검색 이벤트
        document.getElementById('tableSearch').addEventListener('input', debounce(function () {
            tableState.search = this.value;
            tableState.page = 1;
            applyTableSearchAndRender();
        }, 200));

        // 행 수 변경
        document.getElementById('rowsPerPage').addEventListener('change', function () {
            tableState.perPage = parseInt(this.value);
            tableState.page = 1;
            renderTable();
        });

        const comparisonModeEl = document.getElementById('comparisonMode');
        if (comparisonModeEl) {
            updateComparisonModeControl();
            comparisonModeEl.addEventListener('change', function () {
                const nextMode = normalizeComparisonMode(this.value);
                if (comparisonMode === nextMode) return;
                comparisonMode = nextMode;
                resetComparablePeriodCache();
                if (rawData.length) {
                    applyAllFilters();
                } else {
                    updateFilterSummary('', '');
                }
            });
        }
    }

    // DOM 준비 후 초기화
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

