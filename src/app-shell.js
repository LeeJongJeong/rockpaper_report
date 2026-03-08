(function () {
    'use strict';

    function createAppShell(deps) {
        const {
            Chart,
            safeInlineText,
            escapeAttr,
            formatNum,
            FILTER_COLUMNS,
            tabRenderers
        } = deps;
        const state = deps.state || {};
        const actions = deps.actions || {};
        let initialized = false;

        const getCharts = state.getCharts || deps.getCharts;
        const setCharts = state.setCharts || deps.setCharts;
        const getRawData = state.getRawData || deps.getRawData;
        const setRawData = state.setRawData || deps.setRawData;
        const setFilteredData = state.setFilteredData || deps.setFilteredData;
        const setCompensationEntries = state.setCompensationEntries || deps.setCompensationEntries;
        const getLoadedFiles = state.getLoadedFiles || deps.getLoadedFiles;
        const setLoadedFiles = state.setLoadedFiles || deps.setLoadedFiles;
        const getDrilldownState = state.getDrilldownState || deps.getDrilldownState;
        const setDrilldownState = state.setDrilldownState || deps.setDrilldownState;
        const getFilterState = state.getFilterState || deps.getFilterState;
        const setActiveFilterFromDate = state.setActiveFilterFromDate || deps.setActiveFilterFromDate;
        const setActiveFilterToDate = state.setActiveFilterToDate || deps.setActiveFilterToDate;
        const getCurrentTab = state.getCurrentTab || deps.getCurrentTab;
        const setCurrentTab = state.setCurrentTab || deps.setCurrentTab;
        const getIsDarkMode = state.getIsDarkMode || deps.getIsDarkMode;
        const setIsDarkMode = state.setIsDarkMode || deps.setIsDarkMode;
        const getComparisonMode = state.getComparisonMode || deps.getComparisonMode;
        const setComparisonMode = state.setComparisonMode || deps.setComparisonMode;

        const applyAllFilters = actions.applyAllFilters || deps.applyAllFilters;
        const clearAllFilters = actions.clearAllFilters || deps.clearAllFilters;
        const updateFilterSummary = actions.updateFilterSummary || deps.updateFilterSummary;
        const updateFilterBtnText = actions.updateFilterBtnText || deps.updateFilterBtnText;
        const destroyDatePickers = actions.destroyDatePickers || deps.destroyDatePickers;
        const resetFilteredComputationCache = actions.resetFilteredComputationCache || deps.resetFilteredComputationCache;
        const resetComparablePeriodCache = actions.resetComparablePeriodCache || deps.resetComparablePeriodCache;
        const resetDeptColors = actions.resetDeptColors || deps.resetDeptColors;
        const updateComparisonModeControl = actions.updateComparisonModeControl || deps.updateComparisonModeControl;
        const setupDropzone = actions.setupDropzone || deps.setupDropzone;
        const initTableControls = actions.initTableControls || deps.initTableControls;
        const normalizeComparisonMode = actions.normalizeComparisonMode || deps.normalizeComparisonMode;
        const handleFiles = actions.handleFiles || deps.handleFiles;

        function updateHeaderFileInfo() {
            const chipsEl = document.getElementById('headerFileChips');
            const rowEl = document.getElementById('headerRowCount');
            const loadedFiles = getLoadedFiles();
            const rawData = getRawData();
            if (loadedFiles.length === 1) {
                chipsEl.innerHTML = `<span class="header-badge">${safeInlineText(loadedFiles[0].name)}</span>`;
            } else {
                chipsEl.innerHTML = loadedFiles.map(f => {
                    const shortName = f.name.replace(/\uC8FC\uAC04\uC5C5\uBB34\uBCF4\uACE0_/, '').replace(/\.xlsx?$/, '');
                    return `<span class="file-chip">` +
                        `<span class="chip-dot" style="background:${f.color}"></span>` +
                        `${safeInlineText(shortName)} <span class="chip-count">${formatNum(f.count)}\uAC74</span></span>`;
                }).join('');
            }
            rowEl.textContent = `\uCD1D ${formatNum(rawData.length)}\uAC74`;
            document.getElementById('headerInfo').style.display = 'flex';
        }

        function drillDownFilter(key, value) {
            const filterState = getFilterState();
            if (!filterState[key]) return;
            filterState[key].selected = new Set([value]);
            document.querySelectorAll(`.filter-dropdown-list[data-key="${key}"] input[type="checkbox"]`).forEach(cb => {
                cb.checked = (cb.dataset.val === value);
            });
            updateFilterBtnText(key);
            const nextDrilldownState = Object.assign({}, getDrilldownState());
            nextDrilldownState[key] = value;
            setDrilldownState(nextDrilldownState);
            updateDrilldownBanner();
            applyAllFilters();
        }

        function clearDrilldown(key) {
            const filterState = getFilterState();
            if (!filterState[key]) return;
            filterState[key].selected = new Set(filterState[key].options);
            document.querySelectorAll(`.filter-dropdown-list[data-key="${key}"] input[type="checkbox"]`).forEach(cb => {
                cb.checked = true;
            });
            updateFilterBtnText(key);
            const nextDrilldownState = Object.assign({}, getDrilldownState());
            delete nextDrilldownState[key];
            setDrilldownState(nextDrilldownState);
            updateDrilldownBanner();
            applyAllFilters();
        }

        function clearAllDrilldowns() {
            Object.keys(getDrilldownState()).forEach(key => clearDrilldown(key));
        }

        function updateDrilldownBanner() {
            let banner = document.getElementById('drilldownBanner');
            const entries = Object.entries(getDrilldownState());
            if (!entries.length) {
                if (banner) banner.style.display = 'none';
                return;
            }
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'drilldownBanner';
                banner.className = 'drilldown-banner';
                banner.addEventListener('click', function (e) {
                    const button = e.target.closest('[data-drilldown-action]');
                    if (!button) return;
                    e.preventDefault();
                    if (button.dataset.drilldownAction === 'clear-one') clearDrilldown(button.dataset.key);
                    if (button.dataset.drilldownAction === 'clear-all') clearAllDrilldowns();
                });
                document.querySelector('.filter-bar').appendChild(banner);
            }
            const labelMap = {};
            FILTER_COLUMNS.forEach(fc => { labelMap[fc.key] = fc.label; });
            banner.style.display = 'flex';
            banner.innerHTML =
                `<span class="drilldown-banner-label"><i class="fas fa-mouse-pointer"></i> \uCC28\uD2B8 \uB4DC\uB9B4\uB2E4\uC6B4:</span>` +
                entries.map(([key, val]) =>
                    `<span class="drilldown-badge">` +
                    `<span class="drilldown-key">${safeInlineText(labelMap[key] || key)}</span> <strong>${safeInlineText(val)}</strong>` +
                    `<button type="button" data-drilldown-action="clear-one" data-key="${escapeAttr(key)}" title="\uD574\uC81C"><i class="fas fa-times"></i></button>` +
                    `</span>`
                ).join('') +
                (entries.length > 1
                    ? `<button class="btn-sm danger" type="button" data-drilldown-action="clear-all" style="padding:3px 10px;font-size:11px;"><i class="fas fa-times-circle"></i> \uC804\uCCB4 \uD574\uC81C</button>`
                    : '');
        }

        function setupTabs() {
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.addEventListener('click', function () {
                    const tab = this.dataset.tab;
                    if (tab === getCurrentTab()) return;

                    document.querySelectorAll('.tab-btn').forEach(node => node.classList.remove('active'));
                    document.querySelectorAll('.tab-content').forEach(node => node.classList.remove('active'));
                    this.classList.add('active');
                    document.getElementById('tab-' + tab).classList.add('active');
                    setCurrentTab(tab);
                    updateCurrentTab();
                });
            });
        }

        function updateCurrentTab() {
            const renderer = tabRenderers[getCurrentTab()];
            if (typeof renderer === 'function') renderer();
        }

        function applyChartTheme() {
            const isDarkMode = !!getIsDarkMode();
            const textColor = isDarkMode ? '#9CA3AF' : '#6B7280';
            const gridColor = isDarkMode ? '#374151' : '#E5E7EB';

            Chart.defaults.color = textColor;
            if (Chart.defaults.scale && Chart.defaults.scale.grid) {
                Chart.defaults.scale.grid.color = gridColor;
            }

            Object.values(getCharts()).forEach(chart => {
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

        function toggleTheme() {
            const nextIsDarkMode = !getIsDarkMode();
            setIsDarkMode(nextIsDarkMode);
            if (nextIsDarkMode) {
                document.body.setAttribute('data-theme', 'dark');
                const icon = document.getElementById('themeIcon');
                if (icon) {
                    icon.classList.remove('fa-moon');
                    icon.classList.add('fa-sun');
                }
                localStorage.setItem('rockpaper-theme', 'dark');
            } else {
                document.body.removeAttribute('data-theme');
                const icon = document.getElementById('themeIcon');
                if (icon) {
                    icon.classList.remove('fa-sun');
                    icon.classList.add('fa-moon');
                }
                localStorage.setItem('rockpaper-theme', 'light');
            }
            applyChartTheme();
        }

        function initTheme() {
            const saved = localStorage.getItem('rockpaper-theme');
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            const nextIsDarkMode = saved === 'dark' || (!saved && prefersDark);
            setIsDarkMode(nextIsDarkMode);
            if (nextIsDarkMode) {
                document.body.setAttribute('data-theme', 'dark');
                const icon = document.getElementById('themeIcon');
                if (icon) {
                    icon.classList.remove('fa-moon');
                    icon.classList.add('fa-sun');
                }
            }
            applyChartTheme();
        }

        function toggleFilterCollapsible() {
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
        }

        function resetDashboard() {
            Object.values(getCharts()).forEach(chart => {
                try { chart.destroy(); } catch (err) { }
            });
            setCharts({});
            setRawData([]);
            setFilteredData([]);
            if (setCompensationEntries) setCompensationEntries([]);
            if (setActiveFilterFromDate) setActiveFilterFromDate(null);
            if (setActiveFilterToDate) setActiveFilterToDate(null);
            if (setComparisonMode) setComparisonMode('previous_period');
            updateComparisonModeControl();
            if (setLoadedFiles) setLoadedFiles([]);
            setDrilldownState({});
            destroyDatePickers();
            resetFilteredComputationCache();
            resetComparablePeriodCache();
            resetDeptColors();
            const banner = document.getElementById('drilldownBanner');
            if (banner) banner.remove();

            document.getElementById('dashboard').classList.remove('active');
            document.getElementById('uploadSection').style.display = 'flex';
            document.getElementById('headerInfo').style.display = 'none';
            document.getElementById('fileInput').value = '';

            setCurrentTab('overview');
            document.querySelectorAll('.tab-btn').forEach(node => node.classList.remove('active'));
            document.querySelector('.tab-btn[data-tab="overview"]').classList.add('active');
            document.querySelectorAll('.tab-content').forEach(node => node.classList.remove('active'));
            document.getElementById('tab-overview').classList.add('active');
        }

        function bindStaticControls() {
            const themeToggleBtn = document.getElementById('themeToggleBtn');
            if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);

            const addFileBtn = document.getElementById('addFileBtn');
            const addFileInput = document.getElementById('addFileInput');
            if (addFileBtn && addFileInput) {
                addFileBtn.addEventListener('click', function () {
                    addFileInput.click();
                });
                addFileInput.addEventListener('change', function (e) {
                    if (e.target.files.length > 0) handleFiles(e.target.files, true);
                    this.value = '';
                });
            }

            const resetDashboardBtn = document.getElementById('resetDashboardBtn');
            if (resetDashboardBtn) resetDashboardBtn.addEventListener('click', resetDashboard);

            const fileSelectBtn = document.getElementById('fileSelectBtn');
            const fileInput = document.getElementById('fileInput');
            if (fileSelectBtn && fileInput) {
                fileSelectBtn.addEventListener('click', function () {
                    fileInput.click();
                });
            }

            const filterHeader = document.getElementById('filterHeader');
            if (filterHeader) filterHeader.addEventListener('click', toggleFilterCollapsible);

            const filterActions = document.getElementById('filterActions');
            if (filterActions) {
                filterActions.addEventListener('click', function (e) {
                    e.stopPropagation();
                });
            }

            const applyFiltersBtn = document.getElementById('applyFiltersBtn');
            if (applyFiltersBtn) applyFiltersBtn.addEventListener('click', applyAllFilters);

            const clearFiltersBtn = document.getElementById('clearFiltersBtn');
            if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', clearAllFilters);

            initTableControls();

            const comparisonModeEl = document.getElementById('comparisonMode');
            if (comparisonModeEl) {
                updateComparisonModeControl();
                comparisonModeEl.addEventListener('change', function () {
                    const nextMode = normalizeComparisonMode(this.value);
                    if (getComparisonMode() === nextMode) return;
                    setComparisonMode(nextMode);
                    resetComparablePeriodCache();
                    if (getRawData().length) {
                        applyAllFilters();
                    } else {
                        updateFilterSummary('', '');
                    }
                });
            }
        }

        function initApp() {
            if (initialized) return;
            initialized = true;
            initTheme();
            setupDropzone();
            setupTabs();
            bindStaticControls();
        }

        return {
            updateHeaderFileInfo,
            drillDownFilter,
            clearDrilldown,
            clearAllDrilldowns,
            updateDrilldownBanner,
            updateCurrentTab,
            resetDashboard,
            toggleTheme,
            initTheme,
            toggleFilterCollapsible,
            initApp
        };
    }

    window.DASH_APP_SHELL = {
        createAppShell
    };
})();
