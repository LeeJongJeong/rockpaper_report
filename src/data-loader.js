(function () {
    'use strict';

    function createDataLoader(deps) {
        const {
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
            applyAllFilters,
            updateHeaderFileInfo,
            isInternal,
            isBillable,
            typeCategoryOf,
            visitTypeOf,
            productGroupOf,
            calcHours,
            getRawData,
            setRawData,
            getLoadedFiles,
            setLoadedFiles,
            getColumnNames,
            setColumnNames,
            getCompensationEntries,
            setCompensationEntries,
            setActiveFilterFromDate,
            setActiveFilterToDate,
            setComparisonMode,
            setFilteredData,
            getDateRange
        } = deps;

        function handleFiles(fileList, appendMode) {
            const files = Array.from(fileList).filter(file => {
                const ext = file.name.split('.').pop().toLowerCase();
                if (!['xlsx', 'xls'].includes(ext)) {
                    showToast(`${file.name}: 지원하지 않는 형식입니다.`, 'error');
                    return false;
                }
                if (file.size > CONFIG.FILE_MAX_MB * 1024 * 1024) {
                    showToast(`${file.name}: 파일 크기가 ${CONFIG.FILE_MAX_MB}MB를 초과합니다.`, 'error');
                    return false;
                }
                return true;
            });
            if (!files.length) return;

            if (!appendMode) {
                setRawData([]);
                setLoadedFiles([]);
                setColumnNames([]);
                setCompensationEntries([]);
                setActiveFilterFromDate(null);
                setActiveFilterToDate(null);
                setComparisonMode('previous_period');
                updateComparisonModeControl();
                resetDeptColors();
                setFilteredData([]);
                resetFilteredComputationCache();
                resetComparablePeriodCache();
            }
            processFilesSequentially(files, 0);
        }

        function processFilesSequentially(files, idx) {
            if (idx >= files.length) {
                finalizeDataLoad();
                return;
            }
            const file = files[idx];
            showLoading(
                true,
                `파일 읽는 중 (${idx + 1}/${files.length})`,
                `${file.name} · ${(file.size / 1024).toFixed(1)} KB`
            );
            const reader = new FileReader();
            reader.onload = function (event) {
                showLoading(true, `${file.name} 파싱 중...`, '대용량 파일은 수 초 소요될 수 있습니다');
                setTimeout(() => {
                    try {
                        appendExcelData(event.target.result, file.name);
                        processFilesSequentially(files, idx + 1);
                    } catch (err) {
                        showLoading(false);
                        showToast(`${file.name} 파싱 오류: ${err.message}`, 'error');
                        console.error(err);
                    }
                }, 50);
            };
            reader.onerror = () => {
                showLoading(false);
                showToast(`${file.name}을 읽을 수 없습니다.`, 'error');
            };
            reader.readAsArrayBuffer(file);
        }

        function parseMetricValue(v) {
            if (v === null || v === undefined) return NaN;
            if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
            const text = String(v).replace(/,/g, '').trim();
            if (!text) return NaN;
            const num = Number(text);
            return Number.isFinite(num) ? num : NaN;
        }

        function normalizeMetricField(name) {
            return String(name || '')
                .replace(/[\s\uFEFF\r\n\t]/g, '')
                .replace(/[\(\)]/g, '')
                .trim();
        }

        function getCompSheetField(row, fieldName) {
            const target = normalizeMetricField(fieldName);
            for (const key in row) {
                if (normalizeMetricField(key) === target) return row[key];
            }
            return '';
        }

        function getCompSheetFieldAny(row, candidates) {
            for (let i = 0; i < candidates.length; i++) {
                const value = getCompSheetField(row, candidates[i]);
                if (value !== '' && value !== null && value !== undefined) return value;
            }
            return '';
        }

        function appendCompensationSheet(wb, fileName) {
            const compSheetName = (wb.SheetNames || []).find(name => {
                const sheetName = String(name || '').trim();
                return sheetName === '근무-보상시간 통계' || sheetName === '근무-보상시간' || /보상.*통계/.test(sheetName);
            });
            if (!compSheetName) return;

            const ws = wb.Sheets[compSheetName];
            if (!ws || !ws['!ref']) return;

            const firstCell = ws['A1'];
            const firstText = (firstCell && (firstCell.w || firstCell.v)) || '';
            const periodMatch = String(firstText).match(/(\d{4}-\d{1,2}-\d{1,2})\s*~\s*(\d{4}-\d{1,2}-\d{1,2})/);
            const periodStart = periodMatch ? parseDate(periodMatch[1]) : null;
            const periodEnd = periodMatch ? parseDate(periodMatch[2]) : null;

            const compRows = XLSX.utils.sheet_to_json(ws, { range: 3, defval: '', raw: false });
            if (!Array.isArray(compRows) || !compRows.length) return;

            const compensationEntries = getCompensationEntries();
            for (let i = 0; i < compRows.length; i++) {
                const row = compRows[i];
                const engineer = String(getCompSheetField(row, '엔지니어') || '').trim();
                if (!engineer) continue;
                const compHours = parseMetricValue(getCompSheetFieldAny(row, ['총 보상발생시간', '총보상발생시간', '총 보상 발생시간', '총보상시간']));
                if (!Number.isFinite(compHours)) continue;

                compensationEntries.push({
                    fileName,
                    engineer,
                    dept: String(getCompSheetField(row, '팀명') || '').trim(),
                    workHours: parseMetricValue(getCompSheetField(row, '근무시간')),
                    substituteHours: parseMetricValue(getCompSheetField(row, '대체 근무시간')),
                    totalWorkHours: parseMetricValue(getCompSheetField(row, '총 근무시간')),
                    compensationHours: compHours,
                    periodStart,
                    periodEnd
                });
            }
        }

        // Some source workbooks are packaged with ZIP data descriptors.
        // SheetJS parses them correctly but logs benign size warnings in the browser console.
        function readWorkbookSafely(buffer) {
            const originalConsoleError = console.error;
            const suppressed = [];
            console.error = function () {
                const message = Array.from(arguments).map(value => String(value)).join(' ');
                if (/^Bad uncompressed size:/i.test(message)) {
                    suppressed.push(message);
                    return;
                }
                return originalConsoleError.apply(this, arguments);
            };
            try {
                return XLSX.read(buffer, { type: 'array' });
            } catch (err) {
                suppressed.forEach(message => originalConsoleError.call(console, message));
                throw err;
            } finally {
                console.error = originalConsoleError;
            }
        }

        function appendExcelData(buffer, fileName) {
            const wb = readWorkbookSafely(buffer);
            const sheetName = wb.SheetNames[0];
            const ws = wb.Sheets[sheetName];
            if (!ws || !ws['!ref']) {
                showToast(`${fileName}: 시트에 데이터가 없습니다.`, 'error');
                return;
            }
            const json = XLSX.utils.sheet_to_json(ws, { range: 2, defval: '' });
            if (!json.length) {
                showToast(`${fileName}: 데이터가 없습니다. 4행부터 시작되는지 확인해주세요.`, 'error');
                return;
            }

            if (!getColumnNames().length) {
                setColumnNames(Object.keys(json[0]));
            }

            const loadedFiles = getLoadedFiles();
            const rawData = getRawData();
            const fileColor = DEPT_COLORS[loadedFiles.length % DEPT_COLORS.length];
            for (let i = 0; i < json.length; i++) {
                const row = json[i];
                const startDate = parseDate(row['작업시작일시']);
                const endDate = parseDate(row['작업종료일시']);
                const supportType = String(row['지원유형'] || '').trim();
                const productName = String(row['제품명'] || '').trim();
                row._date = startDate || null;
                row._endDate = endDate || null;
                row._dateStr = startDate ? formatDateStr(startDate) : '';
                row._dayOfWeek = startDate ? startDate.getDay() : -1;
                row._sourceFile = fileName;
                row._isInternal = isInternal(supportType);
                row._isBillable = isBillable(supportType);
                row._typeCategory = typeCategoryOf(supportType);
                row._visitType = visitTypeOf(supportType);
                row._productGroup = productGroupOf(productName);
                const workHours = calcHours(row);
                row._hoursNum = workHours > 0 ? Math.round(workHours * 10) / 10 : 0;
                row['작업시간(h)'] = row._hoursNum > 0 ? row._hoursNum.toFixed(1) + 'h' : '-';
                rawData.push(row);
            }
            loadedFiles.push({ name: fileName, count: json.length, color: fileColor });
            appendCompensationSheet(wb, fileName);
        }

        function finalizeDataLoad() {
            const rawData = getRawData();
            if (!rawData.length) {
                showLoading(false);
                showToast('로드된 데이터가 없습니다.', 'error');
                return;
            }

            let minDate = null;
            let maxDate = null;
            for (let i = 0; i < rawData.length; i++) {
                const date = rawData[i]._date;
                if (date) {
                    if (!minDate || date < minDate) minDate = date;
                    if (!maxDate || date > maxDate) maxDate = date;
                }
            }
            const dateRange = getDateRange();
            dateRange.min = minDate;
            dateRange.max = maxDate;

            updateHeaderFileInfo();
            document.getElementById('uploadSection').style.display = 'none';
            document.getElementById('dashboard').classList.add('active');

            showLoading(true, '필터를 초기화하는 중...');
            initializeFilters();
            initializeDatePicker();

            showLoading(true, '차트를 그리는 중...');
            setTimeout(() => {
                applyAllFilters();
                showLoading(false);
                const loadedFiles = getLoadedFiles();
                const msg = loadedFiles.length > 1
                    ? `${loadedFiles.length}개 파일 병합 완료 · 총 ${formatNum(rawData.length)}건`
                    : `${formatNum(rawData.length)}건의 데이터가 로드되었습니다.`;
                showToast(msg, 'success');
            }, 100);
        }

        return {
            handleFiles,
            processFilesSequentially,
            parseMetricValue,
            normalizeMetricField,
            getCompSheetField,
            getCompSheetFieldAny,
            appendCompensationSheet,
            appendExcelData,
            finalizeDataLoad
        };
    }

    window.DASH_DATA_LOADER = {
        createDataLoader
    };
})();
