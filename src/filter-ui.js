(function () {
    'use strict';

    function createFilterUI(deps) {
        const {
            FILTER_COLUMNS,
            CONFIG,
            flatpickr,
            escapeAttr,
            safeInlineText,
            formatNum,
            debounce,
            getRawData,
            getFilteredData,
            setFilteredData,
            getFilterState,
            setFilterState,
            getDateRange,
            getDatePickers,
            getFilterOutsideClickHandler,
            setFilterOutsideClickHandler,
            getDrilldownState,
            setDrilldownState,
            setActiveFilterFromDate,
            setActiveFilterToDate,
            resetFilteredComputationCache,
            resetComparablePeriodCache,
            updateContractHours,
            updateCurrentTab,
            updateDrilldownBanner,
            getComparisonModeLabel,
            formatDateStr
        } = deps;

        const debouncedApply = debounce(() => applyAllFilters(), CONFIG.DEBOUNCE_MS);

        function initializeFilters() {
            const grid = document.getElementById('filterGrid');
            grid.innerHTML = '';
            setFilterState({});

            FILTER_COLUMNS.forEach(fc => {
                const values = [];
                const seen = new Set();
                const rawData = getRawData();
                for (let i = 0; i < rawData.length; i++) {
                    const value = String(rawData[i][fc.key] || '').trim();
                    if (value && !seen.has(value)) {
                        seen.add(value);
                        values.push(value);
                    }
                }
                values.sort((a, b) => a.localeCompare(b, 'ko'));

                const filterState = getFilterState();
                filterState[fc.key] = { options: values, selected: new Set(values) };

                const group = document.createElement('div');
                group.className = 'filter-group';
                group.innerHTML = `
                    <label>${safeInlineText(fc.label)}</label>
                    <div class="filter-select-wrapper">
                        <button class="filter-select-btn" data-key="${escapeAttr(fc.key)}">
                            <span class="filter-select-text">전체 (${values.length}개)</span>
                            <i class="fas fa-chevron-down" style="font-size:10px; color:var(--gray-400);"></i>
                        </button>
                        <div class="filter-dropdown" data-key="${escapeAttr(fc.key)}">
                            <div class="filter-dropdown-search">
                                <input type="text" placeholder="검색..." data-key="${escapeAttr(fc.key)}">
                            </div>
                            <div class="filter-dropdown-actions">
                                <button onclick="filterSelectAll('${fc.key}')">전체 선택</button>
                                <button onclick="filterDeselectAll('${fc.key}')">전체 해제</button>
                            </div>
                            <div class="filter-dropdown-list" data-key="${escapeAttr(fc.key)}">
                                ${values.map(value => `
                                    <label class="filter-dropdown-item" data-value="${escapeAttr(value)}">
                                        <input type="checkbox" checked data-key="${escapeAttr(fc.key)}" data-val="${escapeAttr(value)}">
                                        <span>${safeInlineText(value)}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                `;
                grid.appendChild(group);
            });

            setupFilterEvents();
        }

        function setupFilterEvents() {
            document.querySelectorAll('.filter-select-btn').forEach(btn => {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    const key = this.dataset.key;
                    const dropdown = document.querySelector(`.filter-dropdown[data-key="${key}"]`);
                    const isOpen = dropdown.classList.contains('open');

                    document.querySelectorAll('.filter-dropdown.open').forEach(node => node.classList.remove('open'));
                    document.querySelectorAll('.filter-select-btn.active').forEach(node => node.classList.remove('active'));

                    if (!isOpen) {
                        dropdown.classList.add('open');
                        this.classList.add('active');
                        dropdown.querySelector('input[type="text"]').focus();
                    }
                });
            });

            if (!getFilterOutsideClickHandler()) {
                setFilterOutsideClickHandler(function () {
                    document.querySelectorAll('.filter-dropdown.open').forEach(node => node.classList.remove('open'));
                    document.querySelectorAll('.filter-select-btn.active').forEach(node => node.classList.remove('active'));
                });
                document.addEventListener('click', getFilterOutsideClickHandler());
            }

            document.querySelectorAll('.filter-dropdown').forEach(dropdown => {
                dropdown.addEventListener('click', e => e.stopPropagation());
            });

            document.querySelectorAll('.filter-dropdown-list input[type="checkbox"]').forEach(cb => {
                cb.addEventListener('change', function () {
                    const key = this.dataset.key;
                    const value = this.dataset.val;
                    const filterState = getFilterState();
                    if (this.checked) {
                        filterState[key].selected.add(value);
                    } else {
                        filterState[key].selected.delete(value);
                    }
                    updateFilterBtnText(key);
                    debouncedApply();
                });
            });

            document.querySelectorAll('.filter-dropdown-search input').forEach(input => {
                input.addEventListener('input', function () {
                    const key = this.dataset.key;
                    const query = this.value.toLowerCase();
                    const list = document.querySelector(`.filter-dropdown-list[data-key="${key}"]`);
                    list.querySelectorAll('.filter-dropdown-item').forEach(item => {
                        const value = item.dataset.value.toLowerCase();
                        item.style.display = value.includes(query) ? 'flex' : 'none';
                    });
                });
            });
        }

        function updateFilterBtnText(key) {
            const filterState = getFilterState();
            const fs = filterState[key];
            const btn = document.querySelector(`.filter-select-btn[data-key="${key}"]`);
            const textEl = btn.querySelector('.filter-select-text');
            const oldBadge = btn.querySelector('.filter-badge');
            if (oldBadge) oldBadge.remove();

            if (fs.selected.size === fs.options.length) {
                textEl.textContent = `전체 (${fs.options.length}개)`;
            } else if (fs.selected.size === 0) {
                textEl.textContent = '선택 없음';
            } else {
                const selected = [...fs.selected];
                textEl.textContent = selected.length <= 2 ? selected.join(', ') : `${selected[0]} 외 ${selected.length - 1}개`;
                const badge = document.createElement('span');
                badge.className = 'filter-badge';
                badge.textContent = fs.selected.size;
                btn.appendChild(badge);
            }
        }

        function destroyDatePickers() {
            const datePickers = getDatePickers();
            if (datePickers.from) {
                datePickers.from.destroy();
                datePickers.from = null;
            }
            if (datePickers.to) {
                datePickers.to.destroy();
                datePickers.to = null;
            }
        }

        function initializeDatePicker() {
            destroyDatePickers();
            const dateRange = getDateRange();
            const datePickers = getDatePickers();
            const config = {
                locale: 'ko',
                dateFormat: 'Y-m-d',
                allowInput: true,
                onChange: debouncedApply
            };

            if (dateRange.min) {
                datePickers.from = flatpickr('#dateFrom', { ...config, defaultDate: dateRange.min, minDate: dateRange.min, maxDate: dateRange.max });
                datePickers.to = flatpickr('#dateTo', { ...config, defaultDate: dateRange.max, minDate: dateRange.min, maxDate: dateRange.max });
            }
        }

        function filterSelectAll(key) {
            const filterState = getFilterState();
            filterState[key].selected = new Set(filterState[key].options);
            document.querySelectorAll(`.filter-dropdown-list[data-key="${key}"] input[type="checkbox"]`).forEach(cb => { cb.checked = true; });
            updateFilterBtnText(key);
            debouncedApply();
        }

        function filterDeselectAll(key) {
            const filterState = getFilterState();
            filterState[key].selected.clear();
            document.querySelectorAll(`.filter-dropdown-list[data-key="${key}"] input[type="checkbox"]`).forEach(cb => { cb.checked = false; });
            updateFilterBtnText(key);
            debouncedApply();
        }

        function clearAllFilters() {
            const filterState = getFilterState();
            FILTER_COLUMNS.forEach(fc => {
                filterState[fc.key].selected = new Set(filterState[fc.key].options);
                document.querySelectorAll(`.filter-dropdown-list[data-key="${escapeAttr(fc.key)}"] input[type="checkbox"]`).forEach(cb => { cb.checked = true; });
                updateFilterBtnText(fc.key);
            });
            const dateRange = getDateRange();
            if (dateRange.min) {
                document.getElementById('dateFrom')._flatpickr.setDate(dateRange.min);
                document.getElementById('dateTo')._flatpickr.setDate(dateRange.max);
            }
            setDrilldownState({});
            updateDrilldownBanner();
            applyAllFilters();
        }

        function applyAllFilters() {
            const dateRange = getDateRange();
            const dateFromEl = document.getElementById('dateFrom');
            const dateToEl = document.getElementById('dateTo');
            const fromDate = dateFromEl._flatpickr ? dateFromEl._flatpickr.selectedDates[0] : null;
            const toDate = dateToEl._flatpickr ? dateToEl._flatpickr.selectedDates[0] : null;
            setActiveFilterFromDate(fromDate || dateRange.min);
            setActiveFilterToDate(toDate || dateRange.max);

            const fromStr = fromDate ? formatDateStr(fromDate) : '';
            const toStr = toDate ? formatDateStr(toDate) : '';
            const rawData = getRawData();
            const filterState = getFilterState();
            const nextFiltered = [];
            resetFilteredComputationCache();
            resetComparablePeriodCache();

            for (let i = 0; i < rawData.length; i++) {
                const row = rawData[i];
                if (fromStr && row._dateStr < fromStr) continue;
                if (toStr && row._dateStr > toStr) continue;

                let pass = true;
                for (let j = 0; j < FILTER_COLUMNS.length; j++) {
                    const fc = FILTER_COLUMNS[j];
                    const fs = filterState[fc.key];
                    if (fs.selected.size < fs.options.length) {
                        const value = String(row[fc.key] || '').trim();
                        if (!fs.selected.has(value) && !(value === '' && fs.selected.size === fs.options.length)) {
                            pass = false;
                            break;
                        }
                    }
                }
                if (pass) nextFiltered.push(row);
            }

            setFilteredData(nextFiltered);
            updateFilterSummary(fromStr, toStr);
            updateContractHours(fromDate, toDate);
            updateCurrentTab();
        }

        function updateFilterSummary(fromStr, toStr) {
            const el = document.getElementById('filterSummary');
            const tags = [];
            const filterState = getFilterState();
            const rawData = getRawData();
            const filteredData = getFilteredData();
            const compareLabel = getComparisonModeLabel();

            if (fromStr || toStr) {
                tags.push(`<span class="filter-tag"><span class="tag-label">기간:</span> ${safeInlineText(fromStr || '처음')} ~ ${safeInlineText(toStr || '끝')}</span>`);
            }

            FILTER_COLUMNS.forEach(fc => {
                const fs = filterState[fc.key];
                if (fs.selected.size < fs.options.length && fs.selected.size > 0) {
                    const label = FILTER_COLUMNS.find(item => item.key === fc.key).label;
                    if (fs.selected.size <= 3) {
                        tags.push(`<span class="filter-tag"><span class="tag-label">${safeInlineText(label)}:</span> ${safeInlineText([...fs.selected].join(', '))}</span>`);
                    } else {
                        tags.push(`<span class="filter-tag"><span class="tag-label">${safeInlineText(label)}:</span> ${fs.selected.size}개 선택</span>`);
                    }
                }
            });

            const compareTag = `<span class="filter-tag filter-tag-neutral"><i class="fas fa-not-equal"></i> 비교: ${safeInlineText(compareLabel)}</span>`;
            if (tags.length === 0) {
                el.innerHTML = compareTag + '<span class="no-filter-msg"><i class="fas fa-info-circle"></i> 모든 데이터를 표시합니다 (필터 미적용) - 총 ' + formatNum(rawData.length) + '건</span>';
            } else {
                el.innerHTML = `<span class="filter-tag" style="background:var(--gray-100);color:var(--gray-600);"><i class="fas fa-filter"></i> ${formatNum(filteredData.length)}건 / ${formatNum(rawData.length)}건</span>` + compareTag + tags.join('');
            }
        }

        return {
            initializeFilters,
            setupFilterEvents,
            updateFilterBtnText,
            destroyDatePickers,
            initializeDatePicker,
            filterSelectAll,
            filterDeselectAll,
            clearAllFilters,
            applyAllFilters,
            updateFilterSummary
        };
    }

    window.DASH_FILTER_UI = {
        createFilterUI
    };
})();
