const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assertEq(actual, expected, label) {
    if (actual !== expected) {
        throw new Error(`${label} | expected: ${expected}, actual: ${actual}`);
    }
}

function assert(condition, label) {
    if (!condition) throw new Error(label);
}

function toYmd(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function loadBrowserScript(relPath, context) {
    const fullPath = path.join(__dirname, relPath);
    const code = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(code, context, { filename: fullPath });
}

function createVmContext(extraGlobals) {
    const context = vm.createContext(Object.assign({
        window: {},
        console,
        Date,
        Set,
        Map,
        Math,
        setTimeout,
        clearTimeout
    }, extraGlobals || {}));
    context.window = context.window || {};
    context.window.console = console;
    return context;
}

function createAnalyticsCoreForComparisonTest() {
    const rawData = [
        { _dateStr: '2026-02-22', 엔지니어: 'A' },
        { _dateStr: '2026-02-25', 엔지니어: 'B' },
        { _dateStr: '2026-03-01', 엔지니어: 'A' },
        { _dateStr: '2026-03-05', 엔지니어: 'B' }
    ];
    const filterState = {
        엔지니어: { options: ['A', 'B'], selected: new Set(['A', 'B']) }
    };
    const dateRange = {
        min: new Date('2026-02-22T00:00:00'),
        max: new Date('2026-03-07T00:00:00')
    };
    let comparablePeriodCache = { key: null, value: null };
    let comparisonMode = 'previous_period';
    let activeFilterFromDate = new Date('2026-03-01T00:00:00');
    let activeFilterToDate = new Date('2026-03-07T00:00:00');

    const context = createVmContext();
    loadBrowserScript('analytics-core.js', context);
    return {
        core: context.window.DASH_ANALYTICS_CORE.createAnalyticsCore({
            CONFIG: {},
            FILTER_COLUMNS: [{ key: '엔지니어', label: '엔지니어' }],
            PRODUCT_GROUP_RULES: [],
            parseDate: value => new Date(value),
            formatDateStr: date => {
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                return `${y}-${m}-${d}`;
            },
            getCachedFilteredValue: (_key, producer) => producer(),
            getContractWorkHours: () => 0,
            getContractWorkHoursForRange: () => 0,
            getRawData: () => rawData,
            getFilterState: () => filterState,
            getDateRange: () => dateRange,
            getActiveFilterFromDate: () => activeFilterFromDate,
            getActiveFilterToDate: () => activeFilterToDate,
            getCompensationEntries: () => [],
            getComparisonMode: () => comparisonMode,
            getComparablePeriodCache: () => comparablePeriodCache,
            setComparablePeriodCache: next => { comparablePeriodCache = next; },
            normalizeComparisonMode: mode => mode,
            getComparisonModeLabel: mode => ({
                previous_period: '직전 동기간',
                previous_week: '전주 동일요일',
                previous_month: '전월 동일기간',
                previous_year: '전년 동기'
            })[mode],
            safeInlineText: value => String(value || '')
        }),
        setComparisonMode: next => { comparisonMode = next; },
        setActiveRange: (from, to) => {
            activeFilterFromDate = from;
            activeFilterToDate = to;
        }
    };
}

function createAnalyticsCoreForCompensationFilterTest() {
    const compensationEntries = [
        { engineer: 'A', dept: 'PS', compensationHours: 4, periodStart: new Date('2026-03-01T00:00:00'), periodEnd: new Date('2026-03-31T00:00:00') },
        { engineer: 'B', dept: 'IS', compensationHours: 12, periodStart: new Date('2026-03-01T00:00:00'), periodEnd: new Date('2026-03-31T00:00:00') },
        { engineer: 'C', dept: 'PS', compensationHours: 8, periodStart: new Date('2026-03-01T00:00:00'), periodEnd: new Date('2026-03-31T00:00:00') },
        { engineer: 'D', dept: 'PS', compensationHours: 20, periodStart: new Date('2026-02-01T00:00:00'), periodEnd: new Date('2026-02-28T00:00:00') },
        { engineer: 'C', dept: 'PS', compensationHours: 30, periodStart: null, periodEnd: null }
    ];
    const filterState = {
        '\uBD80\uC11C\uBA85': { options: ['PS', 'IS'], selected: new Set(['PS']) },
        '\uC5D4\uC9C0\uB2C8\uC5B4': { options: ['A', 'B', 'C'], selected: new Set(['A', 'C']) },
        '\uACE0\uAC1D\uC0AC\uBA85': { options: ['X', 'Y'], selected: new Set(['X']) }
    };
    const context = createVmContext();
    loadBrowserScript('analytics-core.js', context);
    return context.window.DASH_ANALYTICS_CORE.createAnalyticsCore({
        CONFIG: {},
        FILTER_COLUMNS: [
            { key: '\uBD80\uC11C\uBA85', label: '\uBD80\uC11C' },
            { key: '\uC5D4\uC9C0\uB2C8\uC5B4', label: '\uC5D4\uC9C0\uB2C8\uC5B4' },
            { key: '\uACE0\uAC1D\uC0AC\uBA85', label: '\uACE0\uAC1D\uC0AC' }
        ],
        PRODUCT_GROUP_RULES: [],
        parseDate: value => new Date(value),
        formatDateStr: date => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        },
        getCachedFilteredValue: (_key, producer) => producer(),
        getContractWorkHours: () => 0,
        getContractWorkHoursForRange: () => 0,
        getRawData: () => [],
        getFilterState: () => filterState,
        getDateRange: () => ({ min: new Date('2026-03-01T00:00:00'), max: new Date('2026-03-31T00:00:00') }),
        getActiveFilterFromDate: () => new Date('2026-03-01T00:00:00'),
        getActiveFilterToDate: () => new Date('2026-03-31T00:00:00'),
        getCompensationEntries: () => compensationEntries,
        getComparisonMode: () => 'previous_period',
        getComparablePeriodCache: () => ({ key: null, value: null }),
        setComparablePeriodCache() {},
        normalizeComparisonMode: mode => mode,
        getComparisonModeLabel: mode => mode,
        safeInlineText: value => String(value || '')
    });
}

function createTableUiForRegressionTest() {
    const tableState = {
        page: 3,
        perPage: 10,
        sortCol: 2,
        sortDir: 'desc',
        search: 'postgres',
        searchData: [{ id: 1 }]
    };
    const elements = {
        tableSearch: { value: 'postgres' },
        rowsPerPage: { value: '10' }
    };
    const document = {
        getElementById(id) {
            return elements[id] || null;
        }
    };
    const context = createVmContext({ document });
    loadBrowserScript('table-ui.js', context);
    return {
        tableUI: context.window.DASH_TABLE_UI.createTableUI({
            TABLE_COLUMNS: ['작업시간(h)', '작업시작일시', '담당영업'],
            TABLE_COLUMN_TYPES: {
                '작업시간(h)': 'number',
                '작업시작일시': 'date',
                '담당영업': 'text'
            },
            DEFAULT_PER_PAGE: 50,
            XLSX: { utils: {}, writeFile() {} },
            debounce: fn => fn,
            formatNum: value => String(value),
            formatDateStr: () => '2026-03-08',
            escapeAttr: value => String(value),
            escapeHtml: value => String(value),
            safeInlineText: value => String(value),
            parseMetricValue: value => Number(String(value).replace(/[^0-9.-]/g, '')),
            parseDate: value => new Date(value),
            showToast() {},
            getFilteredData: () => [],
            getTableState: () => tableState
        }),
        tableState,
        elements
    };
}

function createAppShellForRegressionTest() {
    const filterState = {
        엔지니어: { options: ['A', 'B'], selected: new Set(['A']) },
        고객사명: { options: ['X', 'Y'], selected: new Set(['X']) }
    };
    let drilldownState = { 엔지니어: 'A', 고객사명: 'X' };
    let applyCount = 0;
    const checkboxMap = {
        엔지니어: [{ checked: false }, { checked: false }],
        고객사명: [{ checked: false }, { checked: false }]
    };
    const document = {
        querySelectorAll(selector) {
            if (selector.includes('엔지니어')) return checkboxMap.엔지니어;
            if (selector.includes('고객사명')) return checkboxMap.고객사명;
            return [];
        },
        getElementById() { return null; },
        querySelector() { return { appendChild() {} }; }
    };
    const context = createVmContext({
        document,
        localStorage: { getItem() { return null; }, setItem() {} }
    });
    loadBrowserScript('app-shell.js', context);
    const shell = context.window.DASH_APP_SHELL.createAppShell({
        Chart: { defaults: {} },
        safeInlineText: value => String(value || ''),
        escapeAttr: value => String(value || ''),
        formatNum: value => String(value),
        FILTER_COLUMNS: [
            { key: '엔지니어', label: '엔지니어' },
            { key: '고객사명', label: '고객사' }
        ],
        state: {
            getCharts: () => ({}),
            setCharts() {},
            getRawData: () => [],
            setRawData() {},
            setFilteredData() {},
            setCompensationEntries() {},
            getLoadedFiles: () => [],
            setLoadedFiles() {},
            getDrilldownState: () => drilldownState,
            setDrilldownState: next => { drilldownState = next; },
            getFilterState: () => filterState,
            setActiveFilterFromDate() {},
            setActiveFilterToDate() {},
            getCurrentTab: () => 'overview',
            setCurrentTab() {},
            getIsDarkMode: () => false,
            setIsDarkMode() {},
            getComparisonMode: () => 'previous_period',
            setComparisonMode() {}
        },
        actions: {
            applyAllFilters: () => { applyCount += 1; },
            clearAllFilters() {},
            updateFilterSummary() {},
            updateFilterBtnText() {},
            destroyDatePickers() {},
            resetFilteredComputationCache() {},
            resetComparablePeriodCache() {},
            resetDeptColors() {},
            updateComparisonModeControl() {},
            setupDropzone() {},
            initTableControls() {},
            resetDetailTableState() {},
            normalizeComparisonMode: mode => mode,
            handleFiles() {}
        },
        tabRenderers: {
            overview() {}
        }
    });
    return {
        shell,
        getApplyCount: () => applyCount,
        getDrilldownState: () => drilldownState,
        filterState,
        checkboxMap
    };
}

function testComparablePeriodContext() {
    const fixture = createAnalyticsCoreForComparisonTest();
    const previousPeriod = fixture.core.getComparablePeriodContext();
    assertEq(previousPeriod.mode, 'previous_period', 'comparison mode defaults to previous_period');
    assertEq(toYmd(previousPeriod.previousRange.start), '2026-02-22', 'previous_period start');
    assertEq(toYmd(previousPeriod.previousRange.end), '2026-02-28', 'previous_period end');
    assertEq(previousPeriod.previousData.length, 2, 'previous_period previousData length');

    fixture.setComparisonMode('previous_week');
    const previousWeek = fixture.core.getComparablePeriodContext();
    assertEq(toYmd(previousWeek.previousRange.start), '2026-02-22', 'previous_week start');
    assertEq(toYmd(previousWeek.previousRange.end), '2026-02-28', 'previous_week end');

    fixture.setComparisonMode('previous_month');
    fixture.setActiveRange(new Date('2026-03-31T00:00:00'), new Date('2026-03-31T00:00:00'));
    const previousMonth = fixture.core.getComparablePeriodContext();
    assertEq(toYmd(previousMonth.previousRange.start), '2026-02-28', 'previous_month start clamps to month end');
    assertEq(toYmd(previousMonth.previousRange.end), '2026-02-28', 'previous_month end clamps to month end');
}

function testCompensationTopEngineersRespectsApplicableFilters() {
    const core = createAnalyticsCoreForCompensationFilterTest();
    const result = core.getCompensationTopEngineers(new Date('2026-03-01T00:00:00'), new Date('2026-03-31T00:00:00'));

    assertEq(result.list.length, 2, 'compensation top engineers keeps only applicable filtered entries');
    assertEq(result.list[0].engineer, 'C', 'compensation top engineers respects engineer and department filters');
    assertEq(result.list[1].engineer, 'A', 'compensation top engineers preserves remaining filtered engineer');
    assertEq(result.total, 12, 'compensation totals exclude filtered entries with unknown periods when date filters are active');
    assertEq(result.count, 2, 'compensation count only include filtered entries');
}

function testBuildAnalyticsSummaryOmitsTopEngineerWhenNoBillableSupport() {
    const context = createVmContext();
    loadBrowserScript('analytics-core.js', context);
    const core = context.window.DASH_ANALYTICS_CORE.createAnalyticsCore({
        CONFIG: { UTIL: { DANGER: 60, TARGET: 80 } },
        FILTER_COLUMNS: [],
        PRODUCT_GROUP_RULES: [],
        parseDate: value => new Date(value),
        formatDateStr: date => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        },
        getCachedFilteredValue: (_key, producer) => producer(),
        getContractWorkHours: () => 160,
        getContractWorkHoursForRange: () => 160,
        getRawData: () => [],
        getFilterState: () => ({}),
        getDateRange: () => ({ min: new Date('2026-03-01T00:00:00'), max: new Date('2026-03-02T00:00:00') }),
        getActiveFilterFromDate: () => new Date('2026-03-01T00:00:00'),
        getActiveFilterToDate: () => new Date('2026-03-02T00:00:00'),
        getCompensationEntries: () => [],
        getComparisonMode: () => 'previous_period',
        getComparablePeriodCache: () => ({ key: null, value: null }),
        setComparablePeriodCache() {},
        normalizeComparisonMode: mode => mode,
        getComparisonModeLabel: mode => mode,
        safeInlineText: value => String(value || '')
    });
    const engineerKey = '\uC5D4\uC9C0\uB2C8\uC5B4';
    const deptKey = '\uBD80\uC11C\uBA85';
    const customerKey = '\uACE0\uAC1D\uC0AC\uBA85';
    const productKey = '\uC81C\uD488\uBA85';
    const supportTypeKey = '\uC9C0\uC6D0\uC720\uD615';
    const internalType = '\uB0B4\uBD80\uC5C5\uBB34';
    const data = [
        { [engineerKey]: 'A', [deptKey]: 'PS', [customerKey]: '', [productKey]: 'Alpha', [supportTypeKey]: internalType, _hoursNum: 8, _isBillable: false, _isInternal: true, _dateStr: '2026-03-01' },
        { [engineerKey]: 'B', [deptKey]: 'IS', [customerKey]: '', [productKey]: 'Beta', [supportTypeKey]: internalType, _hoursNum: 6, _isBillable: false, _isInternal: true, _dateStr: '2026-03-02' }
    ];

    const summary = core.buildAnalyticsSummary(data, {
        range: {
            start: new Date('2026-03-01T00:00:00'),
            end: new Date('2026-03-02T00:00:00')
        }
    });

    assertEq(summary.topEngineer, null, 'buildAnalyticsSummary omits topEngineer when no billable support exists');
}

function testTableUiResetAndSort() {
    const fixture = createTableUiForRegressionTest();
    fixture.tableUI.resetDetailTableState();
    assertEq(fixture.tableState.page, 1, 'table reset page');
    assertEq(fixture.tableState.perPage, 50, 'table reset perPage');
    assertEq(fixture.tableState.sortCol, null, 'table reset sortCol');
    assertEq(fixture.tableState.sortDir, 'asc', 'table reset sortDir');
    assertEq(fixture.tableState.search, '', 'table reset search');
    assertEq(fixture.tableState.searchData.length, 0, 'table reset searchData');
    assertEq(fixture.elements.tableSearch.value, '', 'table reset search input');
    assertEq(fixture.elements.rowsPerPage.value, '50', 'table reset rows select');

    const ascHours = fixture.tableUI.compareTableRows(
        { _hoursNum: 3.5, '작업시간(h)': '3.5h' },
        { _hoursNum: 12, '작업시간(h)': '12.0h' },
        '작업시간(h)',
        1
    );
    assert(ascHours < 0, 'table numeric sort uses normalized hours');

    const descDate = fixture.tableUI.compareTableRows(
        { _date: new Date('2026-03-02T00:00:00'), '작업시작일시': '2026-03-02' },
        { _date: new Date('2026-03-01T00:00:00'), '작업시작일시': '2026-03-01' },
        '작업시작일시',
        -1
    );
    assert(descDate < 0, 'table date sort uses normalized dates');
}

function testClearAllDrilldownsAppliesOnce() {
    const fixture = createAppShellForRegressionTest();
    fixture.shell.clearAllDrilldowns();

    assertEq(fixture.getApplyCount(), 1, 'clearAllDrilldowns applies filters once');
    assertEq(Object.keys(fixture.getDrilldownState()).length, 0, 'clearAllDrilldowns clears state');
    assertEq(fixture.filterState.엔지니어.selected.size, 2, 'clearAllDrilldowns restores engineer options');
    assertEq(fixture.filterState.고객사명.selected.size, 2, 'clearAllDrilldowns restores customer options');
    assert(fixture.checkboxMap.엔지니어.every(cb => cb.checked), 'clearAllDrilldowns checks engineer boxes');
    assert(fixture.checkboxMap.고객사명.every(cb => cb.checked), 'clearAllDrilldowns checks customer boxes');
}

function run() {
    console.log('[dashboard-regression] regression check start');
    testComparablePeriodContext();
    testCompensationTopEngineersRespectsApplicableFilters();
    testBuildAnalyticsSummaryOmitsTopEngineerWhenNoBillableSupport();
    testTableUiResetAndSort();
    testClearAllDrilldownsAppliesOnce();
    console.log('[dashboard-regression] PASS');
}

try {
    run();
    process.exit(0);
} catch (err) {
    console.error('[dashboard-regression] FAIL', err.message);
    process.exit(1);
}
