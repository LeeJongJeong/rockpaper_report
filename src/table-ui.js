(function () {
    'use strict';

    function createTableUI(deps) {
        const {
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
            getFilteredData,
            getTableState
        } = deps;

        function updateDetailTab() {
            const tableState = getTableState();
            tableState.page = 1;
            tableState.search = document.getElementById('tableSearch').value;
            applyTableSearchAndRender();
        }

        function getTableSortValue(row, col) {
            const type = TABLE_COLUMN_TYPES[col] || 'text';
            if (type === 'number') {
                if (col === '작업시간(h)') return Number(row._hoursNum) || 0;
                return parseMetricValue(row[col]);
            }
            if (type === 'date') {
                if (col === '작업시작일시') return row._date instanceof Date ? row._date.getTime() : Number.NEGATIVE_INFINITY;
                if (col === '작업종료일시') return row._endDate instanceof Date ? row._endDate.getTime() : Number.NEGATIVE_INFINITY;
                const parsed = parseDate(row[col]);
                return parsed instanceof Date ? parsed.getTime() : Number.NEGATIVE_INFINITY;
            }
            return String(row[col] || '').toLowerCase();
        }

        function compareTableRows(a, b, col, dir) {
            const type = TABLE_COLUMN_TYPES[col] || 'text';
            const va = getTableSortValue(a, col);
            const vb = getTableSortValue(b, col);

            if (type === 'text') {
                return String(a[col] || '').localeCompare(String(b[col] || ''), 'ko') * dir;
            }

            const aInvalid = !Number.isFinite(va);
            const bInvalid = !Number.isFinite(vb);
            if (aInvalid && bInvalid) return 0;
            if (aInvalid) return 1;
            if (bInvalid) return -1;
            if (va === vb) return 0;
            return (va > vb ? 1 : -1) * dir;
        }

        function applyTableSearchAndRender() {
            const tableState = getTableState();
            const filteredData = getFilteredData();
            const query = tableState.search.toLowerCase().trim();

            if (query) {
                tableState.searchData = [];
                for (let i = 0; i < filteredData.length; i++) {
                    const row = filteredData[i];
                    let match = false;
                    for (let j = 0; j < TABLE_COLUMNS.length; j++) {
                        if (String(row[TABLE_COLUMNS[j]] || '').toLowerCase().includes(query)) {
                            match = true;
                            break;
                        }
                    }
                    if (match) tableState.searchData.push(row);
                }
            } else {
                tableState.searchData = filteredData;
            }

            if (tableState.sortCol !== null) {
                const col = TABLE_COLUMNS[tableState.sortCol];
                const dir = tableState.sortDir === 'asc' ? 1 : -1;
                tableState.searchData = [...tableState.searchData].sort((a, b) => compareTableRows(a, b, col, dir));
            }

            renderTable();
        }

        function renderTable() {
            const tableState = getTableState();
            const filteredData = getFilteredData();
            const data = tableState.searchData;
            const perPage = tableState.perPage;
            const totalPages = Math.max(1, Math.ceil(data.length / perPage));
            if (tableState.page > totalPages) tableState.page = totalPages;
            const page = tableState.page;
            const start = (page - 1) * perPage;
            const end = Math.min(start + perPage, data.length);
            const pageData = data.slice(start, end);

            document.getElementById('tableInfo').textContent =
                `총 ${formatNum(filteredData.length)}건 중 ${formatNum(data.length)}건 검색됨 │ ${formatNum(start + 1)}~${formatNum(end)} 표시`;

            const thead = document.getElementById('dataTableHead');
            thead.innerHTML = TABLE_COLUMNS.map((col, i) => {
                const isSorted = tableState.sortCol === i;
                const icon = isSorted ? (tableState.sortDir === 'asc' ? '&#9650;' : '&#9660;') : '&#8597;';
                return `<th class="${isSorted ? 'sorted' : ''}" onclick="sortTable(${i})">${safeInlineText(col)} <span class="sort-icon">${icon}</span></th>`;
            }).join('');

            const tbody = document.getElementById('dataTableBody');
            if (pageData.length === 0) {
                tbody.innerHTML = `<tr><td colspan="${TABLE_COLUMNS.length}" style="text-align:center;padding:40px;color:var(--gray-400);">
                    <i class="fas fa-search" style="font-size:24px;margin-bottom:8px;display:block;"></i>
                    데이터가 없습니다
                </td></tr>`;
            } else {
                let html = '';
                for (let i = 0; i < pageData.length; i++) {
                    html += '<tr>';
                    TABLE_COLUMNS.forEach(col => {
                        const value = String(pageData[i][col] || '');
                        const cls = col === '지원내역' ? ' class="td-detail"' : '';
                        const displayVal = value.length > 100 ? value.substring(0, 100) + '...' : value;
                        html += `<td${cls} title="${escapeAttr(value)}">${escapeHtml(displayVal).replace(/\r?\n/g, '<br>')}</td>`;
                    });
                    html += '</tr>';
                }
                tbody.innerHTML = html;
            }

            renderPagination(totalPages, page);
        }

        function renderPagination(totalPages, currentPage) {
            const el = document.getElementById('pagination');
            if (totalPages <= 1) {
                el.innerHTML = '';
                return;
            }

            let html = '';
            html += `<button class="page-btn" onclick="goPage(1)" ${currentPage === 1 ? 'disabled' : ''}><i class="fas fa-angle-double-left"></i></button>`;
            html += `<button class="page-btn" onclick="goPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}><i class="fas fa-angle-left"></i></button>`;

            let startP = Math.max(1, currentPage - 3);
            let endP = Math.min(totalPages, currentPage + 3);
            if (endP - startP < 6) {
                if (startP === 1) endP = Math.min(totalPages, 7);
                else startP = Math.max(1, endP - 6);
            }

            if (startP > 1) html += '<button class="page-btn" disabled>...</button>';
            for (let p = startP; p <= endP; p++) {
                html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="goPage(${p})">${p}</button>`;
            }
            if (endP < totalPages) html += '<button class="page-btn" disabled>...</button>';

            html += `<button class="page-btn" onclick="goPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}><i class="fas fa-angle-right"></i></button>`;
            html += `<button class="page-btn" onclick="goPage(${totalPages})" ${currentPage === totalPages ? 'disabled' : ''}><i class="fas fa-angle-double-right"></i></button>`;
            el.innerHTML = html;
        }

        function goPage(p) {
            const tableState = getTableState();
            tableState.page = p;
            renderTable();
            document.querySelector('.data-table-wrapper').scrollTop = 0;
        }

        function sortTable(colIdx) {
            const tableState = getTableState();
            if (tableState.sortCol === colIdx) {
                tableState.sortDir = tableState.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                tableState.sortCol = colIdx;
                tableState.sortDir = 'asc';
            }
            applyTableSearchAndRender();
        }

        function exportToExcel() {
            const tableState = getTableState();
            const data = tableState.searchData;
            if (!data.length) {
                showToast('다운로드할 데이터가 없습니다.', 'error');
                return;
            }

            const ws = XLSX.utils.json_to_sheet(data.map(row => {
                const obj = {};
                TABLE_COLUMNS.forEach(col => { obj[col] = row[col] || ''; });
                return obj;
            }));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '지원내역');
            XLSX.writeFile(wb, `지원내역_필터결과_${formatDateStr(new Date())}.xlsx`);
        }

        function initTableControls() {
            document.getElementById('tableSearch').addEventListener('input', debounce(function () {
                const tableState = getTableState();
                tableState.search = this.value;
                tableState.page = 1;
                applyTableSearchAndRender();
            }, 200));

            document.getElementById('rowsPerPage').addEventListener('change', function () {
                const tableState = getTableState();
                tableState.perPage = parseInt(this.value, 10);
                tableState.page = 1;
                renderTable();
            });
        }

        return {
            updateDetailTab,
            getTableSortValue,
            compareTableRows,
            applyTableSearchAndRender,
            renderTable,
            renderPagination,
            goPage,
            sortTable,
            exportToExcel,
            initTableControls
        };
    }

    window.DASH_TABLE_UI = {
        createTableUI
    };
})();
