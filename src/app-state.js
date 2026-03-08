(function () {
    'use strict';

    function createAppState(options) {
        const defaultPerPage = Number((options || {}).tableDefaultPerPage) || 50;
        const state = {
            rawData: [],
            filteredData: [],
            columnNames: [],
            filterState: {},
            dateRange: { min: null, max: null },
            activeFilterFromDate: null,
            activeFilterToDate: null,
            charts: {},
            currentTab: 'overview',
            loadedFiles: [],
            drilldownState: {},
            contractWorkDays: 0,
            contractWorkHours: 0,
            compensationEntries: [],
            datePickers: { from: null, to: null },
            filterOutsideClickHandler: null,
            filteredComputationCache: { dataRef: null, store: {} },
            comparablePeriodCache: { key: null, value: null },
            comparisonMode: 'previous_period',
            tableState: {
                page: 1,
                perPage: defaultPerPage,
                sortCol: null,
                sortDir: 'asc',
                search: '',
                searchData: []
            },
            isDarkMode: false
        };

        return {
            state,
            getState: function () { return state; },
            getRawData: function () { return state.rawData; },
            setRawData: function (next) { state.rawData = next; },
            getFilteredData: function () { return state.filteredData; },
            setFilteredData: function (next) { state.filteredData = next; },
            getColumnNames: function () { return state.columnNames; },
            setColumnNames: function (next) { state.columnNames = next; },
            getFilterState: function () { return state.filterState; },
            setFilterState: function (next) { state.filterState = next; },
            getDateRange: function () { return state.dateRange; },
            getActiveFilterFromDate: function () { return state.activeFilterFromDate; },
            setActiveFilterFromDate: function (next) { state.activeFilterFromDate = next; },
            getActiveFilterToDate: function () { return state.activeFilterToDate; },
            setActiveFilterToDate: function (next) { state.activeFilterToDate = next; },
            getCharts: function () { return state.charts; },
            setCharts: function (next) { state.charts = next; },
            setChart: function (id, chart) { state.charts[id] = chart; },
            getCurrentTab: function () { return state.currentTab; },
            setCurrentTab: function (next) { state.currentTab = next; },
            getLoadedFiles: function () { return state.loadedFiles; },
            setLoadedFiles: function (next) { state.loadedFiles = next; },
            getDrilldownState: function () { return state.drilldownState; },
            setDrilldownState: function (next) { state.drilldownState = next; },
            getContractWorkDays: function () { return state.contractWorkDays; },
            setContractWorkDays: function (next) { state.contractWorkDays = next; },
            getContractWorkHours: function () { return state.contractWorkHours; },
            setContractWorkHours: function (next) { state.contractWorkHours = next; },
            getCompensationEntries: function () { return state.compensationEntries; },
            setCompensationEntries: function (next) { state.compensationEntries = next; },
            getDatePickers: function () { return state.datePickers; },
            getFilterOutsideClickHandler: function () { return state.filterOutsideClickHandler; },
            setFilterOutsideClickHandler: function (next) { state.filterOutsideClickHandler = next; },
            getFilteredComputationCache: function () { return state.filteredComputationCache; },
            setFilteredComputationCache: function (next) { state.filteredComputationCache = next; },
            getComparablePeriodCache: function () { return state.comparablePeriodCache; },
            setComparablePeriodCache: function (next) { state.comparablePeriodCache = next; },
            getComparisonMode: function () { return state.comparisonMode; },
            setComparisonMode: function (next) { state.comparisonMode = next; },
            getTableState: function () { return state.tableState; },
            getIsDarkMode: function () { return state.isDarkMode; },
            setIsDarkMode: function (next) { state.isDarkMode = next; }
        };
    }

    window.DASH_APP_STATE = {
        createAppState: createAppState
    };
})();
