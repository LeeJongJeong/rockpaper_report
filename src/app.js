    (function() {
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
            isNormalizedHolidayConfig: APP_CONTRACT_UTILS.isNormalizedHolidayConfig || function(config) {
                return !!(config
                    && typeof config === 'object'
                    && config.fixed instanceof Set
                    && config.extras instanceof Set
                    && config.extrasMonthDay instanceof Set
                    && config.yearly instanceof Map
                );
            },
            normalizeHolidayConfig: APP_CONTRACT_UTILS.normalizeHolidayConfig || function(rawConfig) {
                if (CONTRACT_UTILS.isNormalizedHolidayConfig(rawConfig)) return rawConfig;
                const data = {
                    fixed: new Set(),
                    yearly: new Map(),
                    extras: new Set(),
                    extrasMonthDay: new Set(),
                    includeSubstitute: false
                };

                const pad2 = function(v) {
                    return String(v).padStart(2, '0');
                };
                const isMonthDay = function(v) { return /^\d{1,2}-\d{1,2}$/.test(String(v || '').trim()); };
                const isFullDate = function(v) { return /^\d{4}-\d{1,2}-\d{1,2}$/.test(String(v || '').trim()); };

                const addMonthDay = function(set, v) {
                    const raw = String(v || '').trim();
                    if (!isMonthDay(raw)) return;
                    const p = raw.split('-').map(Number);
                    if (!p[0] || !p[1] || p[0] < 1 || p[0] > 12 || p[1] < 1 || p[1] > 31) return;
                    const mmdd = `${pad2(p[0])}-${pad2(p[1])}`;
                    if (set) set.add(`${pad2(p[0])}-${pad2(p[1])}`);
                };

                const add = function(list, setOrMode) {
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
            buildHolidaySetForRange: APP_CONTRACT_UTILS.buildHolidaySetForRange || function(startDate, endDate, rawConfig) {
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
                const addWithSub = function(dt) {
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
                const addMonthDay = function(y, mmdd) {
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
            countBusinessDaysWithHolidaySet: APP_CONTRACT_UTILS.countBusinessDaysWithHolidaySet || function(startDate, endDate, holidaySet) {
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
            summarizeContractHoursByRange: APP_CONTRACT_UTILS.summarizeContractHoursByRange || function(startDate, endDate, rawConfig, options) {
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
        let deptColorCache = {};
        let deptIndex = 0;
        function getDeptColor(deptName) {
            if (!deptColorCache[deptName]) {
                deptColorCache[deptName] = {
                    color: DEPT_COLORS[deptIndex % DEPT_COLORS.length],
                    bg: DEPT_BG_COLORS[deptIndex % DEPT_BG_COLORS.length]
                };
                deptIndex++;
            }
            return deptColorCache[deptName];
        }
        function resetDeptColors() {
            deptColorCache = {};
            deptIndex = 0;
        }
        function getAllDeptNames(data) {
            return [...new Set(data.map(r => String(r['부서명'] || '').trim()).filter(Boolean))].sort();
        }
        function buildDeptLegendHTML(deptNames) {
            return deptNames.map(d => {
                const c = getDeptColor(d);
                return `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:8px;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c.color}"></span>${d}</span>`;
            }).join('');
        }

        /* ============================================================
           유틸리티 함수
           ============================================================ */

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
            const files = Array.from(fileList).filter(f => {
                const ext = f.name.split('.').pop().toLowerCase();
                if (!['xlsx', 'xls'].includes(ext)) {
                    showToast(`${f.name}: 지원하지 않는 형식입니다.`, 'error');
                    return false;
                }
                if (f.size > CONFIG.FILE_MAX_MB * 1024 * 1024) {
                    showToast(`${f.name}: 파일 크기가 ${CONFIG.FILE_MAX_MB}MB를 초과합니다.`, 'error');
                    return false;
                }
                return true;
            });
            if (!files.length) return;

            if (!appendMode) {
                rawData = [];
                loadedFiles = [];
                columnNames = [];
                compensationEntries = [];
                activeFilterFromDate = null;
                activeFilterToDate = null;
                resetDeptColors();
            }
            processFilesSequentially(files, 0);
        }

        /** 파일 목록을 순차적으로 읽어 rawData에 누적 */
        function processFilesSequentially(files, idx) {
            if (idx >= files.length) {
                finalizeDataLoad();
                return;
            }
            const file = files[idx];
            showLoading(true,
                `파일 읽는 중 (${idx + 1}/${files.length})`,
                `${file.name} · ${(file.size / 1024).toFixed(1)} KB`
            );
            const reader = new FileReader();
            reader.onload = function(e) {
                showLoading(true, `${file.name} 파싱 중...`, '대용량 파일은 수 초 소요될 수 있습니다');
                setTimeout(() => {
                    try {
                        appendExcelData(e.target.result, file.name);
                        processFilesSequentially(files, idx + 1);
                    } catch(err) {
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

        /** 보상 시간 숫자 파싱 */
        function parseMetricValue(v) {
            if (v === null || v === undefined) return NaN;
            if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
            const text = String(v).replace(/,/g, '').trim();
            if (!text) return NaN;
            const n = Number(text);
            return Number.isFinite(n) ? n : NaN;
        }

        /** 보상 시트 필드명 정규화(공백/탭/개행 제거) */
        function normalizeMetricField(name) {
            return String(name || '')
                .replace(/[\s\uFEFF\r\n\t]/g, '')
                .replace(/[\(\)]/g, '')
                .trim();
        }

        /** 보상 시트 필드 조회(공백 변형 대응) */
        function getCompSheetField(row, fieldName) {
            const target = normalizeMetricField(fieldName);
            for (const key in row) {
                if (normalizeMetricField(key) === target) return row[key];
            }
            return '';
        }

        /** 보상 시트 필드명 대체군 조회 */
        function getCompSheetFieldAny(row, candidates) {
            for (let i = 0; i < candidates.length; i++) {
                const v = getCompSheetField(row, candidates[i]);
                if (v !== '' && v !== null && v !== undefined) return v;
            }
            return '';
        }

        /** 근무-보상시간 통계 시트에서 엔지니어별 총 보상발생시간 추출 */
        function appendCompensationSheet(wb, fileName) {
            const compSheetName = (wb.SheetNames || []).find(name => {
                const n = String(name || '').trim();
                return n === '근무-보상시간 통계' || n === '근무-보상시간' || /보상.*통계/.test(n);
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

        /** 엑셀 파일 1개를 파싱해 rawData에 추가 (헤더 3행, 데이터 4행부터) */
        function appendExcelData(buffer, fileName) {
            const wb = XLSX.read(buffer, { type: 'array' });
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
            if (!columnNames.length) columnNames = Object.keys(json[0]);

            const fileColor = DEPT_COLORS[loadedFiles.length % DEPT_COLORS.length];
            for (let i = 0; i < json.length; i++) {
                const row = json[i];
                const d = parseDate(row['작업시작일시']);
                row._date = d || null;
                row._dateStr = d ? formatDateStr(d) : '';
                row._dayOfWeek = d ? d.getDay() : -1;
                row._sourceFile = fileName;   // 파일 출처 추적
                const workH = calcHours(row);
                row['작업시간(h)'] = workH > 0 ? workH.toFixed(1) + 'h' : '-';
                rawData.push(row);
            }
            loadedFiles.push({ name: fileName, count: json.length, color: fileColor });
            appendCompensationSheet(wb, fileName);
        }

        /** 모든 파일 로드 후 날짜 범위 재계산 및 UI 확정 */
        function finalizeDataLoad() {
            if (!rawData.length) {
                showLoading(false);
                showToast('로드된 데이터가 없습니다.', 'error');
                return;
            }
            // 전체 rawData에서 날짜 범위 재계산
            let minDate = null, maxDate = null;
            for (let i = 0; i < rawData.length; i++) {
                const d = rawData[i]._date;
                if (d) {
                    if (!minDate || d < minDate) minDate = d;
                    if (!maxDate || d > maxDate) maxDate = d;
                }
            }
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
                const msg = loadedFiles.length > 1
                    ? `${loadedFiles.length}개 파일 병합 완료 · 총 ${formatNum(rawData.length)}건`
                    : `${formatNum(rawData.length)}건의 데이터가 로드되었습니다.`;
                showToast(msg, 'success');
            }, 100);
        }

        /** 헤더 파일 칩 & 행 수 업데이트 */
        function updateHeaderFileInfo() {
            const chipsEl = document.getElementById('headerFileChips');
            const rowEl   = document.getElementById('headerRowCount');
            if (loadedFiles.length === 1) {
                chipsEl.innerHTML = `<span class="header-badge">${loadedFiles[0].name}</span>`;
            } else {
                chipsEl.innerHTML = loadedFiles.map(f => {
                    const shortName = f.name.replace(/주간업무보고_/, '').replace(/\.xlsx?$/, '');
                    return `<span class="file-chip">` +
                        `<span class="chip-dot" style="background:${f.color}"></span>` +
                        `${shortName} <span class="chip-count">${formatNum(f.count)}행</span></span>`;
                }).join('');
            }
            rowEl.textContent = `총 ${formatNum(rawData.length)}행`;
            document.getElementById('headerInfo').style.display = 'flex';
        }

        /* ============================================================
           필터 초기화 및 관리
           ============================================================ */
        
        /** 필터 UI 동적 생성 */
        function initializeFilters() {
            const grid = document.getElementById('filterGrid');
            grid.innerHTML = '';
            filterState = {};

            FILTER_COLUMNS.forEach(fc => {
                // 유니크 값 추출 (빈 값 제외)
                const values = [];
                const seen = new Set();
                for (let i = 0; i < rawData.length; i++) {
                    const v = String(rawData[i][fc.key] || '').trim();
                    if (v && !seen.has(v)) {
                        seen.add(v);
                        values.push(v);
                    }
                }
                values.sort((a, b) => a.localeCompare(b, 'ko'));

                filterState[fc.key] = { options: values, selected: new Set(values) };

                // DOM 생성
                const group = document.createElement('div');
                group.className = 'filter-group';
                group.innerHTML = `
                    <label>${fc.label}</label>
                    <div class="filter-select-wrapper">
                        <button class="filter-select-btn" data-key="${fc.key}">
                            <span class="filter-select-text">전체 (${values.length}개)</span>
                            <i class="fas fa-chevron-down" style="font-size:10px; color:var(--gray-400);"></i>
                        </button>
                        <div class="filter-dropdown" data-key="${fc.key}">
                            <div class="filter-dropdown-search">
                                <input type="text" placeholder="검색..." data-key="${fc.key}">
                            </div>
                            <div class="filter-dropdown-actions">
                                <button onclick="filterSelectAll('${fc.key}')">전체 선택</button>
                                <button onclick="filterDeselectAll('${fc.key}')">전체 해제</button>
                            </div>
                            <div class="filter-dropdown-list" data-key="${fc.key}">
                                ${values.map(v => `
                                    <label class="filter-dropdown-item" data-value="${v.replace(/"/g, '&quot;')}">
                                        <input type="checkbox" checked data-key="${fc.key}" data-val="${v.replace(/"/g, '&quot;')}">
                                        <span>${v}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                `;
                grid.appendChild(group);
            });

            // 이벤트 바인딩
            setupFilterEvents();
        }

        /** 필터 이벤트 바인딩 */
        function setupFilterEvents() {
            // 드롭다운 토글
            document.querySelectorAll('.filter-select-btn').forEach(btn => {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    const key = this.dataset.key;
                    const dd = document.querySelector(`.filter-dropdown[data-key="${key}"]`);
                    const isOpen = dd.classList.contains('open');
                    
                    // 다른 드롭다운 닫기
                    document.querySelectorAll('.filter-dropdown.open').forEach(d => d.classList.remove('open'));
                    document.querySelectorAll('.filter-select-btn.active').forEach(b => b.classList.remove('active'));
                    
                    if (!isOpen) {
                        dd.classList.add('open');
                        this.classList.add('active');
                        dd.querySelector('input[type="text"]').focus();
                    }
                });
            });

            // 바깥 클릭 시 닫기
            document.addEventListener('click', () => {
                document.querySelectorAll('.filter-dropdown.open').forEach(d => d.classList.remove('open'));
                document.querySelectorAll('.filter-select-btn.active').forEach(b => b.classList.remove('active'));
            });
            document.querySelectorAll('.filter-dropdown').forEach(dd => {
                dd.addEventListener('click', e => e.stopPropagation());
            });

            // 체크박스 변경
            document.querySelectorAll('.filter-dropdown-list input[type="checkbox"]').forEach(cb => {
                cb.addEventListener('change', function() {
                    const key = this.dataset.key;
                    const val = this.dataset.val;
                    if (this.checked) {
                        filterState[key].selected.add(val);
                    } else {
                        filterState[key].selected.delete(val);
                    }
                    updateFilterBtnText(key);
                    debouncedApply();
                });
            });

            // 필터 내 검색
            document.querySelectorAll('.filter-dropdown-search input').forEach(input => {
                input.addEventListener('input', function() {
                    const key = this.dataset.key;
                    const query = this.value.toLowerCase();
                    const list = document.querySelector(`.filter-dropdown-list[data-key="${key}"]`);
                    list.querySelectorAll('.filter-dropdown-item').forEach(item => {
                        const val = item.dataset.value.toLowerCase();
                        item.style.display = val.includes(query) ? 'flex' : 'none';
                    });
                });
            });
        }

        /** 필터 버튼 텍스트 업데이트 */
        function updateFilterBtnText(key) {
            const fs = filterState[key];
            const btn = document.querySelector(`.filter-select-btn[data-key="${key}"]`);
            const textEl = btn.querySelector('.filter-select-text');
            
            // 기존 배지 제거
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

        /** 날짜 선택기 초기화 */
        function initializeDatePicker() {
            const config = {
                locale: 'ko',
                dateFormat: 'Y-m-d',
                allowInput: true,
                onChange: debouncedApply
            };

            if (dateRange.min) {
                flatpickr('#dateFrom', { ...config, defaultDate: dateRange.min, minDate: dateRange.min, maxDate: dateRange.max });
                flatpickr('#dateTo', { ...config, defaultDate: dateRange.max, minDate: dateRange.min, maxDate: dateRange.max });
            }
        }

        /** 전체 선택 */
        window.filterSelectAll = function(key) {
            filterState[key].selected = new Set(filterState[key].options);
            document.querySelectorAll(`.filter-dropdown-list[data-key="${key}"] input[type="checkbox"]`).forEach(cb => cb.checked = true);
            updateFilterBtnText(key);
            debouncedApply();
        };

        /** 전체 해제 */
        window.filterDeselectAll = function(key) {
            filterState[key].selected.clear();
            document.querySelectorAll(`.filter-dropdown-list[data-key="${key}"] input[type="checkbox"]`).forEach(cb => cb.checked = false);
            updateFilterBtnText(key);
            debouncedApply();
        };

        /** 전체 필터 초기화 */
        window.clearAllFilters = function() {
            FILTER_COLUMNS.forEach(fc => {
                filterState[fc.key].selected = new Set(filterState[fc.key].options);
                document.querySelectorAll(`.filter-dropdown-list[data-key="${fc.key}"] input[type="checkbox"]`).forEach(cb => cb.checked = true);
                updateFilterBtnText(fc.key);
            });
            // 날짜 리셋
            if (dateRange.min) {
                document.getElementById('dateFrom')._flatpickr.setDate(dateRange.min);
                document.getElementById('dateTo')._flatpickr.setDate(dateRange.max);
            }
            // 드릴다운 상태 초기화
            drilldownState = {};
            updateDrilldownBanner();
            applyAllFilters();
        };

        /** 디바운스된 필터 적용 (150ms) */
        const debouncedApply = debounce(() => applyAllFilters(), CONFIG.DEBOUNCE_MS);

        /* ============================================================
           필터 적용 및 데이터 필터링 (단일 pass)
           ============================================================ */
        
        /** 모든 필터를 적용하여 filteredData 생성 */
        window.applyAllFilters = function() {
            const dateFromEl = document.getElementById('dateFrom');
            const dateToEl = document.getElementById('dateTo');
            const fromDate = dateFromEl._flatpickr ? dateFromEl._flatpickr.selectedDates[0] : null;
            const toDate = dateToEl._flatpickr ? dateToEl._flatpickr.selectedDates[0] : null;
            activeFilterFromDate = fromDate || dateRange.min;
            activeFilterToDate = toDate || dateRange.max;

            // 날짜 범위를 문자열로 변환 (비교 최적화)
            const fromStr = fromDate ? formatDateStr(fromDate) : '';
            const toStr = toDate ? formatDateStr(toDate) : '';

            // 단일 pass 필터링
            filteredData = [];
            for (let i = 0; i < rawData.length; i++) {
                const row = rawData[i];
                
                // 날짜 필터
                if (fromStr && row._dateStr < fromStr) continue;
                if (toStr && row._dateStr > toStr) continue;

                // 다중 필터 (AND 조건)
                let pass = true;
                for (let j = 0; j < FILTER_COLUMNS.length; j++) {
                    const fc = FILTER_COLUMNS[j];
                    const fs = filterState[fc.key];
                    if (fs.selected.size < fs.options.length) {
                        const val = String(row[fc.key] || '').trim();
                        if (!fs.selected.has(val) && !(val === '' && fs.selected.size === fs.options.length)) {
                            pass = false;
                            break;
                        }
                    }
                }
                if (pass) filteredData.push(row);
            }

            // 필터 요약 업데이트
            updateFilterSummary(fromStr, toStr);

            // 필터 기준 소정근무 시간(영업일×8h) 계산
            updateContractHours(fromDate, toDate);
            
            // 현재 탭 차트 업데이트
            updateCurrentTab();
        };

        /** 필터 요약 UI 업데이트 */
        function updateFilterSummary(fromStr, toStr) {
            const el = document.getElementById('filterSummary');
            const tags = [];

            if (fromStr || toStr) {
                tags.push(`<span class="filter-tag"><span class="tag-label">기간:</span> ${fromStr || '처음'} ~ ${toStr || '끝'}</span>`);
            }

            FILTER_COLUMNS.forEach(fc => {
                const fs = filterState[fc.key];
                if (fs.selected.size < fs.options.length && fs.selected.size > 0) {
                    const label = FILTER_COLUMNS.find(f => f.key === fc.key).label;
                    if (fs.selected.size <= 3) {
                        tags.push(`<span class="filter-tag"><span class="tag-label">${label}:</span> ${[...fs.selected].join(', ')}</span>`);
                    } else {
                        tags.push(`<span class="filter-tag"><span class="tag-label">${label}:</span> ${fs.selected.size}개 선택</span>`);
                    }
                }
            });

            if (tags.length === 0) {
                el.innerHTML = '<span class="no-filter-msg"><i class="fas fa-info-circle"></i> 모든 데이터를 표시합니다 (필터 미적용) — 총 ' + formatNum(rawData.length) + '건</span>';
            } else {
                el.innerHTML = `<span class="filter-tag" style="background:var(--gray-100);color:var(--gray-600);"><i class="fas fa-filter"></i> ${formatNum(filteredData.length)}건 / ${formatNum(rawData.length)}건</span>` + tags.join('');
            }
        }

        /** 현재 필터 기간과 겹치는 근무-보상시간 엔트리 집계 */
        function getCompensationEntriesForRange(startDate, endDate) {
            const from = startDate || null;
            const to = endDate || null;
            if (!compensationEntries.length) return [];
            if (!from && !to) return compensationEntries;

            return compensationEntries.filter(e => {
                const pStart = e.periodStart;
                const pEnd = e.periodEnd;
                if (from && pEnd && pEnd < from) return false;
                if (to && pStart && pStart > to) return false;
                return true;
            });
        }

        /** 보상시간 Top 엔지니어 집계 */
        function getCompensationTopEngineers(startDate, endDate, topN = 3) {
            const rows = getCompensationEntriesForRange(startDate, endDate);
            if (!rows.length) return { list: [], top: [], total: 0 };

            const totals = {};
            for (let i = 0; i < rows.length; i++) {
                const e = rows[i];
                const name = String(e.engineer || '').trim();
                if (!name) continue;
                const v = e.compensationHours;
                if (!Number.isFinite(v)) continue;
                totals[name] = (totals[name] || 0) + v;
            }
            const list = Object.entries(totals).sort((a, b) => b[1] - a[1]).filter(([, v]) => Number.isFinite(v) && v > 0);
            const total = list.reduce((s, e) => s + e[1], 0);
            return {
                list,
                top: list.slice(0, topN),
                total
            };
        }

        /* ============================================================
           차트 드릴다운 필터
           ============================================================ */

        /** 차트 onClick 핸들러 팩토리 — 반복 패턴을 단일 함수로 추출
         *  @param {string} filterKey  drillDownFilter에 넘길 컬럼키
         *  @param {boolean} [allowOther=false] '기타' 레이블도 드릴다운 허용 여부
         */
        function makeDrilldownClick(filterKey, allowOther = false) {
            return (evt, elements, chart) => {
                if (!elements.length) return;
                const label = chart.data.labels[elements[0].index];
                if (label && (allowOther || label !== '기타')) drillDownFilter(filterKey, label);
            };
        }

        /** 차트 클릭 시 해당 값으로 필터를 단일 선택으로 설정 */
        window.drillDownFilter = function(key, value) {
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
        window.clearDrilldown = function(key) {
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
        window.clearAllDrilldowns = function() {
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
                    `<span class="drilldown-key">${labelMap[key] || key}</span> <strong>${val}</strong>` +
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
                btn.addEventListener('click', function() {
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
            switch(currentTab) {
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
            const result = {};
            keys.forEach(k => { result[k] = {}; });
            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                keys.forEach(k => {
                    const v = String(row[k] || '').trim();
                    if (v) result[k][v] = (result[k][v] || 0) + 1;
                });
            }
            return result;
        }

        /** 일별 집계 */
        function aggregateByDate(data) {
            const map = {};
            for (let i = 0; i < data.length; i++) {
                const ds = data[i]._dateStr;
                if (ds) map[ds] = (map[ds] || 0) + 1;
            }
            return map;
        }

        /** 키별 일별 집계 */
        function aggregateByKeyAndDate(data, key) {
            const map = {};
            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                const k = String(row[key] || '').trim();
                const d = row._dateStr;
                if (k && d) {
                    if (!map[k]) map[k] = {};
                    map[k][d] = (map[k][d] || 0) + 1;
                }
            }
            return map;
        }

        /** 크로스탭 집계 */
        function crossTab(data, key1, key2) {
            const map = {};
            for (let i = 0; i < data.length; i++) {
                const v1 = String(data[i][key1] || '').trim();
                const v2 = String(data[i][key2] || '').trim();
                if (v1 && v2) {
                    if (!map[v1]) map[v1] = {};
                    map[v1][v2] = (map[v1][v2] || 0) + 1;
                }
            }
            return map;
        }

        /** 상위 N개 + 기타 그룹핑 */
        function topNWithOther(countObj, n, otherLabel = '기타') {
            const entries = Object.entries(countObj).sort((a, b) => b[1] - a[1]);
            if (entries.length <= n) return { labels: entries.map(e => e[0]), values: entries.map(e => e[1]) };
            const top = entries.slice(0, n);
            const otherSum = entries.slice(n).reduce((s, e) => s + e[1], 0);
            return {
                labels: [...top.map(e => e[0]), otherLabel],
                values: [...top.map(e => e[1]), otherSum]
            };
        }

        /** 유니크 카운트 */
        function uniqueCount(data, key) {
            const s = new Set();
            for (let i = 0; i < data.length; i++) {
                const v = String(data[i][key] || '').trim();
                if (v) s.add(v);
            }
            return s.size;
        }

        /** 유니크 키별 유니크 값 수 */
        function uniqueCountByKey(data, groupKey, countKey) {
            const map = {};
            for (let i = 0; i < data.length; i++) {
                const g = String(data[i][groupKey] || '').trim();
                const c = String(data[i][countKey] || '').trim();
                if (g && c) {
                    if (!map[g]) map[g] = new Set();
                    map[g].add(c);
                }
            }
            const result = {};
            Object.keys(map).forEach(k => { result[k] = map[k].size; });
            return result;
        }

        /* ============================================================
           신규 유틸리티: 작업시간, 내부/외부 분류, 제품군, 지원유형 대분류
           ============================================================ */

        /** 작업시간(h) 계산: 시작~종료 차이
         *  - 09:00~18:00 (종일근무)인 경우 휴게시간 1시간 차감 → 8h
         *  - 08:30~17:30 (종일근무)인 경우 휴게시간 1시간 차감 → 8h
         */
        function calcHours(row) {
            const s = row._date;
            const eStr = String(row['작업종료일시'] || '').trim();
            if (!s || !eStr) return 0;
            const e = new Date(eStr.replace(' ', 'T'));
            if (isNaN(e.getTime())) return 0;
            let h = (e - s) / (1000 * 60 * 60);
            if (!(h > 0 && h < 24)) return 0;
            // 휴게시간 차감: 종일근무 패턴에 점심시간 1h 제외
            const sH = s.getHours(), sM = s.getMinutes();
            const eH = e.getHours(), eM = e.getMinutes();
            if ((sH === 9 && sM === 0 && eH === 18 && eM === 0) ||
                (sH === 8 && sM === 30 && eH === 17 && eM === 30)) {
                h -= 1;
            }
            return h;
        }

        /** 지원유형 → 내부/외부 분류 */
        function isInternal(type) {
            return /내부|셀프|교육/.test(type);
        }

        /** 지원유형 → 가동률 포함 여부 (Billable)
         *  포함: 기술지원, 점검지원, Presales, 비상대기, 현장실습, 고객사교육지원
         *  제외: 내부업무, 셀프스터디, 일반교육(사내) 등
         *  가동률 = 가동시간(billableHours) / 소정근무시간(필터 영업일×8h) × 100%
         */
        function isBillable(type) {
            return /기술지원|점검지원|Presales|presales|비상대기|현장실습|고객사교육/.test(type);
        }

        /** 지원유형 → 대분류 5개 */
        function typeCategoryOf(type) {
            if (/내부업무/.test(type)) return '내부업무';
            if (/셀프/.test(type)) return '셀프스터디';
            if (/교육/.test(type)) return '교육';
            if (/점검/.test(type)) return '점검지원';
            if (/Presales|presales/.test(type)) return 'Presales';
            if (/기술지원/.test(type)) return '기술지원';
            return '기타';
        }

        /** 지원유형 → 방문/원격/기타 분류 */
        function visitTypeOf(type) {
            if (/\[방문\]/.test(type)) return '방문';
            if (/\[원격\]/.test(type)) return '원격';
            return '기타(내부)';
        }

        /** 제품 → 제품군 그룹핑 (동적 확장형)
         *  - 알려진 키워드 패턴 → 미리 정의된 그룹명
         *  - 매칭 안 되면 제품명 자체를 그룹으로 사용 (기타로 몰리지 않음)
         */
        function productGroupOf(prod) {
            if (!prod) return '기타';
            for (const rule of PRODUCT_GROUP_RULES) {
                if (rule.re.test(prod)) return rule.group;
            }
            // 매칭되지 않는 경우: 제품명 자체를 그룹으로 사용
            // 복합 제품명(슬래시/콤마 구분)이면 첫 번째 토큰을 사용
            const cleaned = prod.replace(/\s*[\[\(].*?[\]\)]\s*/g, '').trim();
            const token = cleaned.split(/[\/,]/)[0].trim();
            return token || '기타';
        }

        /** 엔지니어 종합 집계 (단일 pass) */
        function aggregateEngineers(data) {
            const map = {};
            for (let i = 0; i < data.length; i++) {
                const r = data[i];
                const eng = String(r['엔지니어'] || '').trim();
                if (!eng) continue;
                if (!map[eng]) map[eng] = { count: 0, hours: 0, billableHours: 0, billableCount: 0, billableCusts: new Set(), custs: new Set(), prods: new Set(), types: {}, dept: '', dates: new Set(), internal: 0, external: 0 };
                const m = map[eng];
                m.count++;
                const rowH = calcHours(r);
                m.hours += rowH;
                m.dept = String(r['부서명'] || '').trim() || m.dept;
                const cust = String(r['고객사명'] || '').trim();
                if (cust) m.custs.add(cust);
                const prod = String(r['제품명'] || '').trim();
                if (prod) m.prods.add(prod);
                const type = String(r['지원유형'] || '').trim();
                if (type) { m.types[type] = (m.types[type] || 0) + 1; }
                if (r._dateStr) m.dates.add(r._dateStr);
                if (isInternal(type)) m.internal++; else m.external++;
                if (isBillable(type)) {
                    m.billableHours += rowH;
                    m.billableCount++;
                    if (cust) m.billableCusts.add(cust);
                }
            }
            return map;
        }

        /** 고객사 종합 집계 (단일 pass) */
        function aggregateCustomers(data) {
            const map = {};
            for (let i = 0; i < data.length; i++) {
                const r = data[i];
                const cust = String(r['고객사명'] || '').trim();
                if (!cust) continue;
                if (!map[cust]) map[cust] = { count: 0, hours: 0, prods: new Set(), engs: new Set(), types: {}, sales: new Set() };
                const m = map[cust];
                m.count++;
                m.hours += calcHours(r);
                const p = String(r['제품명'] || '').trim();
                if (p) m.prods.add(p);
                const e = String(r['엔지니어'] || '').trim();
                if (e) m.engs.add(e);
                const t = String(r['지원유형'] || '').trim();
                if (t) { m.types[t] = (m.types[t] || 0) + 1; }
                const s = String(r['담당영업'] || '').trim();
                if (s) m.sales.add(s);
            }
            return map;
        }

        /** 제품 종합 집계 (단일 pass) */
        function aggregateProducts(data) {
            const map = {};
            for (let i = 0; i < data.length; i++) {
                const r = data[i];
                const prod = String(r['제품명'] || '').trim();
                if (!prod) continue;
                if (!map[prod]) map[prod] = { count: 0, hours: 0, custs: new Set(), engs: new Set(), types: {} };
                const m = map[prod];
                m.count++;
                m.hours += calcHours(r);
                const c = String(r['고객사명'] || '').trim();
                if (c) m.custs.add(c);
                const e = String(r['엔지니어'] || '').trim();
                if (e) m.engs.add(e);
                const t = String(r['지원유형'] || '').trim();
                if (t) { m.types[t] = (m.types[t] || 0) + 1; }
            }
            return map;
        }

        /** 팀(부서)별 가동률 집계 — aggregateEngineers() 결과를 입력으로 받음
         *  반환: { [dept]: { billableH, workH, totalH, engCount } }
         */

        /** 담당영업별 집계
         *  반환: { [salesName]: { count, hours, custs, engs, prods, types, dates } }
         */
        function aggregateSales(data) {
            const map = {};
            for (let i = 0; i < data.length; i++) {
                const r = data[i];
                const sales = String(r['담당영업'] || '').trim();
                if (!sales) continue;
                if (!map[sales]) map[sales] = { count: 0, hours: 0, custs: new Set(), engs: new Set(), prods: new Set(), types: {}, dates: new Set() };
                const m = map[sales];
                m.count++;
                m.hours += calcHours(r);
                const c = String(r['고객사명'] || '').trim();
                if (c) m.custs.add(c);
                const e = String(r['엔지니어'] || '').trim();
                if (e) m.engs.add(e);
                const p = String(r['제품명'] || '').trim();
                if (p) m.prods.add(p);
                const t = String(r['지원유형'] || '').trim();
                if (t) m.types[t] = (m.types[t] || 0) + 1;
                if (r._dateStr) m.dates.add(r._dateStr);
            }
            return map;
        }

        function aggregateByTeam(engMap, contractHoursPerEngineer = 0) {
            const teamMap = {};
            Object.values(engMap).forEach(m => {
                const dept = m.dept || '미지정';
                if (!teamMap[dept]) teamMap[dept] = { billableH: 0, workH: 0, totalH: 0, engCount: 0 };
                teamMap[dept].billableH += m.billableHours;
                teamMap[dept].workH     += contractHoursPerEngineer;
                teamMap[dept].totalH    += m.hours;
                teamMap[dept].engCount++;
            });
            return teamMap;
        }

        /* ============================================================
           주차별 집계 & 이동평균 유틸리티
           ============================================================ */

        /** Date → 해당 주 월요일 날짜 문자열(YYYY-MM-DD) */
        function getWeekKey(date) {
            const d = new Date(date);
            const day = d.getDay();                        // 0=일, 1=월 ...
            const diff = (day === 0 ? -6 : 1 - day);      // 월요일까지 오프셋
            d.setDate(d.getDate() + diff);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${dd}`;
        }

        /** 주 월요일 키 → "MM/DD~MM/DD" 레이블 */
        function getWeekLabel(mondayKey) {
            const [y, m, d] = mondayKey.split('-').map(Number);
            const mon = new Date(y, m - 1, d);
            const sun = new Date(mon);
            sun.setDate(sun.getDate() + 6);
            const fmt = dt => `${dt.getMonth() + 1}/${dt.getDate()}`;
            return `${fmt(mon)}~${fmt(sun)}`;
        }

        /** 데이터를 주차별로 집계 → { weekKey: count } */
        function aggregateByWeek(data) {
            const map = {};
            for (let i = 0; i < data.length; i++) {
                if (!data[i]._date) continue;
                const k = getWeekKey(data[i]._date);
                map[k] = (map[k] || 0) + 1;
            }
            return map;
        }

        /** N일 이동평균 계산 (앞 방향 누적, 데이터 부족한 초기 구간은 실제 평균) */
        function movingAverage(values, n) {
            return values.map((_, i) => {
                const start = Math.max(0, i - n + 1);
                const slice = values.slice(start, i + 1);
                const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
                return Math.round(avg * 10) / 10;
            });
        }

        /** 히트맵 HTML 생성기 */
        function buildHeatmapHTML(rowLabels, colLabels, matrix, maxVal) {
            if (!rowLabels.length || !colLabels.length) return '<p style="color:var(--gray-400);text-align:center;padding:20px;">데이터가 없습니다</p>';
            let html = '<table class="heatmap-table"><thead><tr><th></th>';
            colLabels.forEach(c => { html += `<th>${c}</th>`; });
            html += '<th>합계</th></tr></thead><tbody>';
            rowLabels.forEach((rl, ri) => {
                html += `<tr><td>${rl}</td>`;
                let rowSum = 0;
                colLabels.forEach((cl, ci) => {
                    const v = matrix[ri][ci] || 0;
                    rowSum += v;
                    const intensity = maxVal > 0 ? v / maxVal : 0;
                    const bg = v > 0 ? `rgba(79,70,229,${0.08 + intensity * 0.72})` : 'transparent';
                    const fg = intensity > 0.5 ? 'white' : 'var(--gray-700)';
                    const tooltip = v > 0 ? `지원 건수(건): ${v}` : '지원 건수(건): 0';
                    html += `<td><span class="hm-cell" style="background:${bg};color:${fg}" title="${tooltip}">${v || ''}</span></td>`;
                });
                html += `<td><strong title="지원 건수(건): ${rowSum}">${rowSum}</strong></td></tr>`;
            });
            html += '</tbody></table>';
            return html;
        }

        /* ============================================================
           Chart.js 헬퍼 (인스턴스 재사용)
           ============================================================ */
        
        /** 차트 생성 또는 업데이트 */
        function upsertChart(id, config) {
            const canvas = document.getElementById(id);
            if (!canvas) return null;
            const ctx = canvas.getContext('2d');

            if (charts[id]) {
                // 기존 인스턴스 재사용: 데이터만 갱신
                const chart = charts[id];
                chart.data = config.data;
                if (config.options) {
                    // 옵션 업데이트 (깊은 병합은 생략, 필요 시 재생성)
                    Object.assign(chart.options, config.options);
                }
                chart.update('none'); // 애니메이션 없이 즉시 갱신
                return chart;
            } else {
                charts[id] = new Chart(ctx, config);
                return charts[id];
            }
        }

        /** 라인차트 설정 생성 */
        function lineChartConfig(labels, datasets, yTitle = '건수', xTitle = '날짜') {
            return {
                type: 'line',
                data: { labels, datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 16 } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { maxTicksLimit: 15, font: { size: 11 } }, title: { display: !!xTitle, text: xTitle || '', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                        y: { beginAtZero: true, title: { display: true, text: yTitle, font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, ticks: { stepSize: 1, font: { size: 11 } } }
                    }
                }
            };
        }

        /** 막대차트 설정 생성 */
        function barChartConfig(labels, data, label, color, horizontal = false, valTitle = '', catTitle = '') {
            return {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{ label, data, backgroundColor: Array.isArray(color) ? color : color + 'CC', borderColor: Array.isArray(color) ? color : color, borderWidth: 1, borderRadius: 4, maxBarThickness: 40 }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    indexAxis: horizontal ? 'y' : 'x',
                    plugins: { legend: { display: false } },
                    scales: {
                        [horizontal ? 'x' : 'y']: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } }, title: { display: !!valTitle, text: valTitle || '', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                        [horizontal ? 'y' : 'x']: { ticks: { font: { size: 11 } }, grid: { display: false }, title: { display: !!catTitle, text: catTitle || '', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } }
                    }
                }
            };
        }

        /** 파이/도넛 차트 설정 */
        function pieChartConfig(labels, data, isDoughnut = true) {
            return {
                type: isDoughnut ? 'doughnut' : 'pie',
                data: {
                    labels,
                    datasets: [{
                        data,
                        backgroundColor: COLORS.slice(0, labels.length).map(c => c + 'CC'),
                        borderColor: COLORS.slice(0, labels.length),
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'right', labels: { font: { size: 11, family: 'Noto Sans KR' }, padding: 10, usePointStyle: true } },
                        tooltip: {
                            callbacks: {
                                label: function(ctx) {
                                    const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                    const pct = ((ctx.parsed / total) * 100).toFixed(1);
                                    return ` ${ctx.label}: ${formatNum(ctx.parsed)}건 (${pct}%)`;
                                }
                            }
                        }
                    }
                }
            };
        }

        /** 스택 바 차트 설정 */
        function stackedBarConfig(labels, datasets, horizontal = false, valTitle = '', catTitle = '') {
            return {
                type: 'bar',
                data: { labels, datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    indexAxis: horizontal ? 'y' : 'x',
                    plugins: { legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 12 } } },
                    scales: {
                        x: { stacked: true, ticks: { font: { size: 11 } }, grid: { display: horizontal }, title: { display: !!(horizontal ? valTitle : catTitle), text: (horizontal ? valTitle : catTitle) || '', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                        y: { stacked: true, beginAtZero: true, ticks: { font: { size: 11 } }, grid: { display: !horizontal }, title: { display: !!(horizontal ? catTitle : valTitle), text: (horizontal ? catTitle : valTitle) || '', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } }
                    }
                }
            };
        }

        /** 랭킹 테이블 HTML 생성 */
        function rankTableHTML(entries, labelName) {
            if (!entries.length) return '<p style="color:var(--gray-400);text-align:center;padding:20px;">데이터가 없습니다</p>';
            const total = entries.reduce((s, e) => s + e[1], 0);
            let html = `<table class="rank-table"><thead><tr><th>#</th><th>${labelName}</th><th>건수</th><th>비율</th><th>바</th></tr></thead><tbody>`;
            entries.forEach(([name, count], i) => {
                const pct = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
                const rc = i < 3 ? `rank-${i + 1}` : 'rank-other';
                const barColor = COLORS[i % COLORS.length];
                html += `<tr>
                    <td><span class="rank-num ${rc}">${i + 1}</span></td>
                    <td>${name}</td>
                    <td><strong>${formatNum(count)}</strong></td>
                    <td>${pct}%</td>
                    <td style="min-width:120px"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${barColor}"></div></div></td>
                </tr>`;
            });
            html += '</tbody></table>';
            return html;
        }

        /* ============================================================
           TAB 1: Overview
           ============================================================ */
        function updateOverviewTab() {
            const data = filteredData;
            if (!data.length) {
                document.getElementById('kpi-total').textContent = '0';
                return;
            }

            // === KPI 카드 업데이트 ===
            const engCount = uniqueCount(data, '엔지니어');
            const custCount = uniqueCount(data, '고객사명');
            const prodCount = uniqueCount(data, '제품명');
            
            // 기간 계산
            let minD = null, maxD = null;
            for (let i = 0; i < data.length; i++) {
                if (data[i]._date) {
                    if (!minD || data[i]._date < minD) minD = data[i]._date;
                    if (!maxD || data[i]._date > maxD) maxD = data[i]._date;
                }
            }
            const days = minD && maxD ? Math.ceil((maxD - minD) / (1000 * 60 * 60 * 24)) + 1 : 1;
            const avg = (data.length / days).toFixed(1);

            document.getElementById('kpi-total').textContent = formatNum(data.length);
            document.getElementById('kpi-total-sub').textContent = `필터 적용 결과`;
            document.getElementById('kpi-engineers').textContent = formatNum(engCount);
            document.getElementById('kpi-engineers-sub').textContent = `명 활동`;
            document.getElementById('kpi-customers').textContent = formatNum(custCount);
            document.getElementById('kpi-customers-sub').textContent = `개 고객사`;
            document.getElementById('kpi-products').textContent = formatNum(prodCount);
            document.getElementById('kpi-products-sub').textContent = `종 제품`;
            document.getElementById('kpi-period').textContent = minD ? `${formatDateStr(minD)} ~ ${formatDateStr(maxD)}` : '-';
            document.getElementById('kpi-period-sub').textContent = `${days}일`;
            document.getElementById('kpi-avg').textContent = avg;
            document.getElementById('kpi-avg-sub').textContent = `건/일`;

            // === 전체 평균 가동률 KPI ===
            const ovEngMap = aggregateEngineers(data);
            const ovEngEntries = Object.entries(ovEngMap);
            const ovContractWorkH = getContractWorkHours();
            const ovTotalBillH = ovEngEntries.reduce((s, e) => s + e[1].billableHours, 0);
            const ovTotalWorkH = ovEngEntries.length * ovContractWorkH;
            const ovUtilPct = ovTotalWorkH > 0 ? ((ovTotalBillH / ovTotalWorkH) * 100).toFixed(1) : '-';
            const ovUtilEl = document.getElementById('kpi-util');
            ovUtilEl.textContent = ovUtilPct === '-' ? '-' : ovUtilPct + '%';
            ovUtilEl.style.color = ovUtilPct === '-' ? '' : utilColor(parseFloat(ovUtilPct));
            document.getElementById('kpi-util-sub').textContent = ovUtilPct === '-' ? '' : `가동${ovTotalBillH.toFixed(0)}h / 소정${ovTotalWorkH}h`;

            // === 일별 지원 건수 라인 차트 + 7일 이동평균 ===
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

            // === 주차별 트렌드 차트 ===
            const weeklyMap = aggregateByWeek(data);
            const weekKeys = Object.keys(weeklyMap).sort();
            const weekCounts = weekKeys.map(k => weeklyMap[k]);
            const weekLabels = weekKeys.map(getWeekLabel);

            // 전주 대비 증감률(%) — 첫 주는 null
            const weekDelta = weekCounts.map((c, i) => {
                if (i === 0) return null;
                const prev = weekCounts[i - 1];
                return prev > 0 ? Math.round(((c - prev) / prev) * 1000) / 10 : null;
            });

            // 막대 색상: 첫 주=인디고, 증가=그린, 감소=레드, 보합=그레이
            const wBarBg = weekDelta.map((d, i) => {
                if (i === 0 || d === null) return '#7C3AED99';
                if (d > 0)  return '#10B98199';
                if (d < 0)  return '#EF444499';
                return '#9CA3AF99';
            });
            const wBarBorder = wBarBg.map(c => c.replace('99', ''));

            // 주차 요약 (전체 기간 평균 vs 최근 4주 평균)
            const totalAvg = weekCounts.reduce((a, b) => a + b, 0) / (weekCounts.length || 1);
            const last4  = weekCounts.slice(-4);
            const last4Avg = last4.reduce((a, b) => a + b, 0) / (last4.length || 1);
            const trendDir = last4Avg > totalAvg ? '▲' : last4Avg < totalAvg ? '▼' : '━';
            const trendColor = last4Avg > totalAvg ? '#059669' : last4Avg < totalAvg ? '#DC2626' : '#6B7280';
            const summaryEl = document.getElementById('weeklyTrendSummary');
            if (summaryEl) {
                summaryEl.innerHTML =
                    `전체 ${weekKeys.length}주 · 주평균 ${totalAvg.toFixed(1)}건 &nbsp;` +
                    `<span style="color:${trendColor};font-weight:600;">${trendDir} 최근 4주 평균 ${last4Avg.toFixed(1)}건</span>`;
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

            // === 제품 파이차트 (드릴다운 지원) ===
            const counts = aggregateCounts(data, '제품명', '지원유형');
            const prodTop = topNWithOther(counts['제품명'], CONFIG.CHART_TOP_N.PIE);
            const prodPieCfg = pieChartConfig(prodTop.labels, prodTop.values);
            prodPieCfg.options.onClick = makeDrilldownClick('제품명');
            upsertChart('chartProductPie', prodPieCfg);

            // === 지원유형 막대차트 (드릴다운 지원) ===
            const typeTop = topNWithOther(counts['지원유형'], CONFIG.CHART_TOP_N.BAR);
            const typeBarCfg = barChartConfig(typeTop.labels, typeTop.values, '지원유형', COLORS.slice(0, typeTop.labels.length), true, '건수', '지원유형');
            typeBarCfg.options.onClick = makeDrilldownClick('지원유형');
            upsertChart('chartTypeBar', typeBarCfg);

            // === 부서별 막대차트 (드릴다운 지원) ===
            const deptCounts = aggregateCounts(data, '부서명');
            const deptEntries = Object.entries(deptCounts['부서명']).sort((a, b) => b[1] - a[1]);
            const deptBarCfg = barChartConfig(
                deptEntries.map(e => e[0]), deptEntries.map(e => e[1]), '부서', deptEntries.map(e => getDeptColor(e[0]).color), false, '건수', '부서'
            );
            deptBarCfg.options.onClick = makeDrilldownClick('부서명', true);
            upsertChart('chartDeptBar', deptBarCfg);

            // === 요일별 패턴 ===
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

            // === 🆕 팀별(부서별) 가동률 Overview 차트 ===
            const ovTeamMap = aggregateByTeam(ovEngMap, ovContractWorkH);
            const ovTeamEntries = Object.entries(ovTeamMap).sort((a, b) => a[0].localeCompare(b[0]));
            const ovTeamNames = ovTeamEntries.map(e => e[0]);
            const ovTeamUtilPcts = ovTeamEntries.map(e => e[1].workH > 0 ? Math.round((e[1].billableH / e[1].workH) * 1000) / 10 : 0);
            // 전체 평균 가동률을 각 팀에 대비해 표시
            const ovAvgUtil = ovTotalWorkH > 0 ? (ovTotalBillH / ovTotalWorkH) * 100 : 0;
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
                                    return [`가동시간: ${ovTotalBillH.toFixed(1)}h`, `소정근무: ${ovTotalWorkH}h`, `엔지니어: ${ovEngEntries.length}명`];
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

            // === 자동 인사이트 패널 ===
            const insights = generateInsights(data, ovEngMap, getCompensationTopEngineers(activeFilterFromDate, activeFilterToDate));
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
            const compensation = compSummary && compSummary.list ? compSummary : { list: [], top: [], total: 0 };

            // A0: 총 보상발생시간 Top 3 집중도
            if (compensation.top && compensation.top.length >= 1) {
                const top3 = compensation.top.slice(0, 3);
                const top3Sum = top3.reduce((s, e) => s + e[1], 0);
                const totalComp = compensation.total || 0;
                const avgComp = compensation.list.length ? totalComp / compensation.list.length : 0;
                const top1 = top3[0][1];
                const top1Ratio = avgComp > 0 ? (top1 / avgComp) : 0;
                const topShare = totalComp > 0 ? (top3Sum / totalComp) * 100 : 0;
                const top3Names = top3.map((e, idx) => `${idx + 1}. ${e[0]} (${e[1].toFixed(1)}h)`).join(', ');
                const type = top1Ratio >= 2 ? 'danger' : top1Ratio >= 1.5 ? 'warning' : 'info';
                const typeLabel = type === 'danger' ? '보상시간 편중 위험' : type === 'warning' ? '보상시간 편중 주의' : '보상시간 편중 확인';
                const desc = `근무-보상시간 통계 기준 상위 ${top3.length}인의 총 보상발생시간이 전체의 ${top3Sum.toFixed(1)}h (${topShare.toFixed(0)}%)입니다. ${top3Names}. ` +
                    `상위 1인 집중도는 팀 평균 대비 ${top1Ratio.toFixed(1)}배로, 인력별 보상 편중 관리가 필요합니다.`;
                if (!pushInsight({ type, icon: '💰', label: '총 보상발생시간', title: `${typeLabel} — Top 3이 ${topShare.toFixed(0)}% 집중`, desc })) return insights;
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
                const eng  = row['엔지니어'];
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
                    if (!pushInsight({ type: 'info', icon: '🔍', label: '점검지원 저조',
                        title: `점검지원 비중 ${inspPct.toFixed(0)}% — 예방 점검 활동 강화 필요`,
                        desc: '장애 대응 위주의 반응형 지원 구조입니다. 정기 점검 일정 확대로 사전 예방을 강화하세요.' })) return insights;
                }
            }

            // I: 주간 지원 급증 — 최근 주가 직전 주 대비 40% 이상 증가
            if (weekKeys.length >= 2) {
                const lastWk = weekMap[weekKeys[weekKeys.length - 1]];
                const prevWk = weekMap[weekKeys[weekKeys.length - 2]];
                if (prevWk > 0) {
                    const surgePct = ((lastWk - prevWk) / prevWk) * 100;
                    if (surgePct >= 40) {
                        if (!pushInsight({ type: 'warning', icon: '📈', label: '지원 수요 급증',
                            title: `최근 주 지원 건수 ${surgePct.toFixed(0)}% 급증 (${prevWk}건 → ${lastWk}건)`,
                            desc: '단기 수요 급증이 감지되었습니다. 대응 여력 및 인력 배분을 즉시 점검하세요.' })) return insights;
                    }
                }
            }

            // J: 담당영업 미배정 — 외부 지원 건 중 담당영업 공백 ≥ 30%
            if (externalCntJ >= 5) {
                const noSalesPct = (noSalesCntJ / externalCntJ) * 100;
                if (noSalesPct >= 30) {
                    if (!pushInsight({ type: 'warning', icon: '👤', label: '영업 커버리지 공백',
                        title: `외부 지원 ${noSalesCntJ}건(${noSalesPct.toFixed(0)}%) 담당영업 미배정`,
                        desc: '영업 담당자 미지정 고객 지원이 많습니다. 담당 영업 배정 현황을 재점검하세요.' })) return insights;
                }
            }

            // K: 저활동 엔지니어 — 활동일이 팀 평균의 50% 미만 (billable 건 보유 기준)
            const avgActDays = totalActDays / engEntries.length;
            if (avgActDays >= 5) {
                const lowActEngs = engEntries.filter(([, m]) => m.dates.size < avgActDays * 0.5 && m.billableCount > 0);
                if (lowActEngs.length > 0) {
                    const nameStr = lowActEngs.slice(0, 3).map(([n]) => n).join(', ');
                    if (!pushInsight({ type: 'info', icon: '🗓️', label: '저활동 엔지니어',
                        title: `${lowActEngs.length}명 활동일 팀 평균(${avgActDays.toFixed(0)}일)의 절반 미만`,
                        desc: `${nameStr} — 부분 참여, 휴가 또는 파견 상태일 수 있습니다. 가용 인력을 확인하세요.` })) return insights;
                }
            }

            // L: Presales 활성화 신호 — 고객지원 건 중 Presales ≥ 15%
            if (billableTotalL >= 10 && presalesCntL > 0) {
                const presalesPct = (presalesCntL / billableTotalL) * 100;
                if (presalesPct >= 15) {
                    if (!pushInsight({ type: 'success', icon: '💼', label: 'Presales 활성',
                        title: `Presales 비중 ${presalesPct.toFixed(0)}% — 신규 영업 파이프라인 활발`,
                        desc: `${presalesCntL}건의 기술 기여 영업 활동이 진행 중입니다. 수주 전환율을 모니터링하세요.` })) return insights;
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
                        <div class="insight-label">${ins.label}</div>
                        <span class="insight-icon">${ins.icon || ''}</span>
                    </div>
                    <div class="insight-title">${ins.title}</div>
                    <div class="insight-desc">${ins.desc}</div>
                </div>
            `).join('');
        }

        /* ============================================================
           TAB 2: 엔지니어 분석 (전면 재설계)
           ============================================================ */
        function updateEngineerTab() {
            const data = filteredData;
            const engMap = aggregateEngineers(data);
            const engEntries = Object.entries(engMap).sort((a, b) => b[1].count - a[1].count);

            if (!engEntries.length) {
                document.getElementById('engKpiRow').innerHTML = '';
                document.getElementById('engHeatmap').innerHTML = '<p style="color:var(--gray-400);text-align:center;padding:20px;">데이터 없음</p>';
                document.getElementById('engScorecard').innerHTML = '';
                return;
            }

            // === KPI 미니 ===
            const totalH = engEntries.reduce((s, e) => s + e[1].hours, 0);
            const avgCnt = (data.length / engEntries.length).toFixed(1);
            const maxEng = engEntries.reduce((best, e) => e[1].billableCount > best[1].billableCount ? e : best, engEntries[0]);
            const totalExternal = engEntries.reduce((s, e) => s + e[1].external, 0);
            const extPct = data.length > 0 ? ((totalExternal / data.length) * 100).toFixed(1) : 0;
            // 전체 평균 가동률 계산
            const totalBillableH = engEntries.reduce((s, e) => s + e[1].billableHours, 0);
            const engContractWorkH = getContractWorkHours();
            const totalWorkingH = engEntries.length * engContractWorkH;
            const avgUtilPct = totalWorkingH > 0 ? ((totalBillableH / totalWorkingH) * 100).toFixed(1) : 0;
            document.getElementById('engKpiRow').innerHTML = `
                <div class="kpi-mini"><div class="kpi-mini-label">총 엔지니어</div><div class="kpi-mini-value">${engEntries.length}</div><div class="kpi-mini-sub">명 활동</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">총 투입시간</div><div class="kpi-mini-value">${totalH.toFixed(0)}</div><div class="kpi-mini-sub">시간 (h)</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">평균 가동률</div><div class="kpi-mini-value" style="color:${utilColor(parseFloat(avgUtilPct))}">${avgUtilPct}%</div><div class="kpi-mini-sub">가동${totalBillableH.toFixed(0)}h / 소정${totalWorkingH}h</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">외부지원 비율</div><div class="kpi-mini-value">${extPct}%</div><div class="kpi-mini-sub">${totalExternal}건 / ${data.length}건</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">고객지원 최다활동</div><div class="kpi-mini-value">${maxEng[0]}</div><div class="kpi-mini-sub">${maxEng[1].billableCount}건, ${maxEng[1].billableHours.toFixed(0)}h</div></div>
            `;

            // ① 버블차트: X=고객업무 건수, Y=고객업무 시간, R=담당 고객사수 (billable만)
            const bubbleData = engEntries.map((e, i) => ({
                label: e[0],
                data: [{ x: e[1].billableCount, y: Math.round(e[1].billableHours * 10) / 10, r: Math.max(5, e[1].billableCusts.size * 3) }],
                backgroundColor: COLORS[i % COLORS.length] + '99',
                borderColor: COLORS[i % COLORS.length],
                borderWidth: 1
            }));
            upsertChart('chartEngBubble', {
                type: 'bubble',
                data: { datasets: bubbleData },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: true, position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 10 } },
                        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.x}건, ${ctx.parsed.y}h, 고객사 ${Math.round(ctx.raw.r / 3)}곳` } }
                    },
                    scales: {
                        x: { title: { display: true, text: '고객업무 건수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, beginAtZero: true },
                        y: { title: { display: true, text: '고객업무 투입시간 (h)', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, beginAtZero: true }
                    }
                }
            });

            // 🆕 엔지니어별 가동률 막대차트
            const engByUtil = engEntries.map(([name, m]) => {
                const workingH = engContractWorkH;
                const utilPct = workingH > 0 ? (m.billableHours / workingH) * 100 : 0;
                return { name, billableH: m.billableHours, workingH, utilPct, dept: m.dept };
            }).sort((a, b) => b.utilPct - a.utilPct);
            const utilColors = engByUtil.map(e => utilColor(e.utilPct) + 'CC');
            const utilBorders = engByUtil.map(e => utilColor(e.utilPct));
            upsertChart('chartEngUtil', {
                type: 'bar',
                data: {
                    labels: engByUtil.map(e => e.name),
                    datasets: [{
                        label: '가동률(%)',
                        data: engByUtil.map(e => Math.round(e.utilPct * 10) / 10),
                        backgroundColor: utilColors,
                        borderColor: utilBorders,
                        borderWidth: 1,
                        borderRadius: 4,
                        maxBarThickness: 28
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                    onClick: makeDrilldownClick('엔지니어', true),
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: ctx => {
                                    const e = engByUtil[ctx.dataIndex];
                                    return [
                                        ` 가동률: ${e.utilPct.toFixed(1)}%`,
                                        ` 가동시간: ${e.billableH.toFixed(1)}h`,
                                        ` 소정근무: ${e.workingH}h (${contractWorkDays}일×${CONFIG.WORK_HOURS_PER_DAY}h)`
                                    ];
                                }
                            }
                        },
                        annotation: undefined
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            max: Math.max(120, Math.ceil(Math.max(...engByUtil.map(e => e.utilPct)) / 10) * 10 + 10),
                            ticks: { callback: v => v + '%', font: { size: 11 } },
                            title: { display: true, text: '가동률 (%)', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }
                        },
                        y: { ticks: { font: { size: 11 } }, grid: { display: false }, title: { display: true, text: '엔지니어', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } }
                    }
                }
            });

            // 🆕 팀별(부서별) 가동률 비교 차트
            const teamMap = {};
            engEntries.forEach(([name, m]) => {
                const dept = m.dept || '미지정';
                if (!teamMap[dept]) teamMap[dept] = { billableH: 0, workingH: 0, engCount: 0, totalH: 0 };
                const tm = teamMap[dept];
                tm.billableH += m.billableHours;
                tm.workingH += engContractWorkH;
                tm.totalH += m.hours;
                tm.engCount++;
            });
            const teamEntries = Object.entries(teamMap).sort((a, b) => a[0].localeCompare(b[0]));
            const teamNames = teamEntries.map(e => e[0]);
            const teamUtilPcts = teamEntries.map(e => e[1].workingH > 0 ? Math.round((e[1].billableH / e[1].workingH) * 1000) / 10 : 0);
            // 팀별 가동률 레전드 동적 생성
            const teamDeptNamesForLegend = teamNames;
            const teamUtilLegendEl = document.getElementById('teamUtilLegend');
            if (teamUtilLegendEl) teamUtilLegendEl.innerHTML = buildDeptLegendHTML(teamDeptNamesForLegend);
            upsertChart('chartTeamUtil', {
                type: 'bar',
                data: {
                    labels: teamNames,
                    datasets: [
                        {
                            label: '가동률(%)',
                            data: teamUtilPcts,
                            backgroundColor: teamNames.map(n => getDeptColor(n).color + 'CC'),
                            borderColor: teamNames.map(n => getDeptColor(n).color),
                            borderWidth: 2, borderRadius: 6, maxBarThickness: 80,
                            yAxisID: 'y'
                        },
                        {
                            label: '가동시간(h)',
                            data: teamEntries.map(e => Math.round(e[1].billableH * 10) / 10),
                            type: 'line',
                            borderColor: '#EF4444', backgroundColor: '#EF444422',
                            pointRadius: 6, pointHoverRadius: 8, tension: 0,
                            yAxisID: 'y1', order: 0
                        }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 12 } },
                        tooltip: {
                            callbacks: {
                                afterBody: (items) => {
                                    const idx = items[0].dataIndex;
                                    const te = teamEntries[idx][1];
                                    return [
                                        `소정근무: ${te.workingH}h`,
                                        `엔지니어: ${te.engCount}명`,
                                        `총투입시간: ${te.totalH.toFixed(0)}h`
                                    ];
                                }
                            }
                        }
                    },
                    scales: {
                        x: { ticks: { font: { size: 13, weight: '600' } }, grid: { display: false }, title: { display: true, text: '팀(부서)', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                        y: { beginAtZero: true, title: { display: true, text: '가동률(%)', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, ticks: { callback: v => v + '%', font: { size: 11 } } },
                        y1: { beginAtZero: true, position: 'right', title: { display: true, text: '가동시간(h)', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, ticks: { font: { size: 11 } }, grid: { drawOnChartArea: false } }
                    }
                }
            });

            // ② 역량 레이더: Top 5 엔지니어의 5축(건수, 시간, 고객사, 제품, 활동일) 비교
            const maxVals = { count: 0, hours: 0, custs: 0, prods: 0, dates: 0 };
            engEntries.forEach(([, m]) => {
                if (m.count > maxVals.count) maxVals.count = m.count;
                if (m.hours > maxVals.hours) maxVals.hours = m.hours;
                if (m.custs.size > maxVals.custs) maxVals.custs = m.custs.size;
                if (m.prods.size > maxVals.prods) maxVals.prods = m.prods.size;
                if (m.dates.size > maxVals.dates) maxVals.dates = m.dates.size;
            });
            const radarTop5 = engEntries.slice(0, CONFIG.CHART_TOP_N.RADAR);
            upsertChart('chartEngRadar', {
                type: 'radar',
                data: {
                    labels: ['지원건수', '투입시간', '고객사수', '제품다양성', '활동일수'],
                    datasets: radarTop5.map(([name, m], i) => ({
                        label: name,
                        data: [
                            maxVals.count > 0 ? (m.count / maxVals.count * 100).toFixed(0) : 0,
                            maxVals.hours > 0 ? (m.hours / maxVals.hours * 100).toFixed(0) : 0,
                            maxVals.custs > 0 ? (m.custs.size / maxVals.custs * 100).toFixed(0) : 0,
                            maxVals.prods > 0 ? (m.prods.size / maxVals.prods * 100).toFixed(0) : 0,
                            maxVals.dates > 0 ? (m.dates.size / maxVals.dates * 100).toFixed(0) : 0
                        ],
                        borderColor: COLORS[i % COLORS.length],
                        backgroundColor: COLORS[i % COLORS.length] + '22',
                        borderWidth: 2,
                        pointBackgroundColor: COLORS[i % COLORS.length],
                        pointRadius: 3
                    }))
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 10 } },
                        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.r}%` } }
                    },
                    scales: {
                        r: { beginAtZero: true, max: 100, ticks: { stepSize: 25, font: { size: 10 } }, pointLabels: { font: { size: 12, family: 'Noto Sans KR' } } }
                    }
                }
            });

            // ③ 내부 vs 외부 100% 스택바
            const engNames = engEntries.map(e => e[0]);
            upsertChart('chartEngIntExt', {
                type: 'bar',
                data: {
                    labels: engNames,
                    datasets: [
                        { label: '외부 고객지원', data: engEntries.map(e => e[1].external), backgroundColor: '#4F46E5CC', borderColor: '#4F46E5', borderWidth: 1 },
                        { label: '내부 업무', data: engEntries.map(e => e[1].internal), backgroundColor: '#F59E0BCC', borderColor: '#F59E0B', borderWidth: 1 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                    plugins: { legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true } },
                        tooltip: { callbacks: { label: ctx => { const total = ctx.chart.data.datasets.reduce((s, ds) => s + (ds.data[ctx.dataIndex] || 0), 0); const pct = total > 0 ? ((ctx.parsed.x / total) * 100).toFixed(0) : 0; return ` ${ctx.dataset.label}: ${ctx.parsed.x}건 (${pct}%)`; } } }
                    },
                    scales: { x: { stacked: true, ticks: { font: { size: 11 } }, title: { display: true, text: '건수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } }, y: { stacked: true, ticks: { font: { size: 11 } }, grid: { display: false }, title: { display: true, text: '엔지니어', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } } }
                }
            });

            // ④ 엔지니어별 투입시간(h) - 부서별 색상 분류 (동적)
            const engByHours = engEntries.sort((a, b) => b[1].hours - a[1].hours);
            const hourColors = engByHours.map(e => getDeptColor(e[1].dept).color + 'CC');
            // 투입시간 차트 레전드 동적 생성
            const engHoursLegendEl = document.getElementById('engHoursLegend');
            if (engHoursLegendEl) engHoursLegendEl.innerHTML = buildDeptLegendHTML(getAllDeptNames(data));
            upsertChart('chartEngHours', barChartConfig(
                engByHours.map(e => e[0]),
                engByHours.map(e => Math.round(e[1].hours * 10) / 10),
                '투입시간(h)', hourColors, true, '시간(h)', '엔지니어'
            ));
            // 다시 건수 내림차순 정렬 복원
            engEntries.sort((a, b) => b[1].count - a[1].count);

            // ⑤ 주요 엔지니어 일별 지원 추이 (Top 6 라인차트)
            const engDaily = aggregateByKeyAndDate(data, '엔지니어');
            const allDatesEng = [...new Set(data.filter(r => r._dateStr).map(r => r._dateStr))].sort();
            const top6Eng = engEntries.slice(0, CONFIG.CHART_TOP_N.TREND).map(e => e[0]);
            upsertChart('chartEngDaily', lineChartConfig(
                allDatesEng,
                top6Eng.map((name, i) => ({
                    label: name, data: allDatesEng.map(d => (engDaily[name] || {})[d] || 0),
                    borderColor: COLORS[i % COLORS.length], tension: 0.3, pointRadius: 2
                })),
                '건수', '날짜'
            ));

            // ⑥ 엔지니어별 제품 전문성 스택바
            const allProds = [...new Set(data.map(r => String(r['제품명'] || '').trim()).filter(Boolean))];
            const engProd = crossTab(data, '엔지니어', '제품명');
            const engNamesForStack = engEntries.map(e => e[0]);
            upsertChart('chartEngProduct', stackedBarConfig(
                engNamesForStack,
                allProds.slice(0, 12).map((p, i) => ({
                    label: p, data: engNamesForStack.map(n => (engProd[n] || {})[p] || 0),
                    backgroundColor: COLORS[i % COLORS.length] + 'CC', borderColor: COLORS[i % COLORS.length], borderWidth: 1
                })),
                true, '건수', '엔지니어'
            ));

            // ⑦ 히트맵: 엔지니어 × 지원유형
            const allTypes = [...new Set(data.map(r => String(r['지원유형'] || '').trim()).filter(Boolean))];
            const engTypeX = crossTab(data, '엔지니어', '지원유형');
            let maxHM = 0;
            const hmNames = engEntries.map(e => e[0]);
            const hmMatrix = hmNames.map(eng => allTypes.map(t => { const v = (engTypeX[eng] || {})[t] || 0; if (v > maxHM) maxHM = v; return v; }));
            document.getElementById('engHeatmap').innerHTML = buildHeatmapHTML(hmNames, allTypes, hmMatrix, maxHM);

            // ⑧ 스코어카드 (확장: 가동률 지표 추가)
            let scHtml = '<table class="scorecard-table"><thead><tr><th>엔지니어</th><th>부서</th><th>건수</th><th>시간(h)</th><th>건당시간</th><th>활동일</th><th>건/일</th><th>고객사</th><th>제품수</th><th>가동시간</th><th>소정근무</th><th>가동률</th><th>업무강도</th></tr></thead><tbody>';
            engEntries.forEach(([name, m]) => {
                const daysActive = m.dates.size || 1;
                const perDay = (m.count / daysActive).toFixed(1);
                const perCase = m.count > 0 ? (m.hours / m.count).toFixed(1) : '-';
                const deptColorInfo = getDeptColor(m.dept);
                // 가동률 계산
                const billH = m.billableHours;
                const workH = engContractWorkH;
                const utilPctEng = workH > 0 ? (billH / workH) * 100 : 0;
                const utilBadge = utilPctEng >= CONFIG.UTIL.TARGET ? 'low' : utilPctEng >= CONFIG.UTIL.DANGER ? 'mid' : 'high'; // low=green, high=red
                // 업무강도: 시간/활동일 기준
                const intensity = m.hours / daysActive;
                const intBadge = intensity >= 10 ? 'high' : intensity >= 7 ? 'mid' : 'low';
                const intLabel = intensity >= 10 ? '과부하' : intensity >= 7 ? '적정' : '여유';
                scHtml += `<tr><td>${name}</td><td><span class="sc-dept" style="background:${deptColorInfo.bg};color:${deptColorInfo.color}">${m.dept}</span></td><td><strong>${m.count}</strong></td><td>${m.hours.toFixed(1)}</td><td>${perCase}h</td><td>${daysActive}</td><td>${perDay}</td><td>${m.custs.size}</td><td>${m.prods.size}</td><td>${billH.toFixed(1)}h</td><td>${workH}h</td><td><span class="sc-badge ${utilBadge}">${utilPctEng.toFixed(1)}%</span></td><td><span class="sc-badge ${intBadge}">${intLabel} (${intensity.toFixed(1)}h/일)</span></td></tr>`;
            });
            scHtml += '</tbody></table>';
            document.getElementById('engScorecard').innerHTML = scHtml;
        }

        /* ============================================================
           TAB 3: 제품 분석 (전면 재설계)
           ============================================================ */
        function updateProductTab() {
            const data = filteredData;
            const prodMap = aggregateProducts(data);
            const prodEntries = Object.entries(prodMap).sort((a, b) => b[1].count - a[1].count);

            if (!prodEntries.length) {
                document.getElementById('prodKpiRow').innerHTML = '';
                document.getElementById('prodHeatmap').innerHTML = '';
                document.getElementById('prodScorecard').innerHTML = '';
                return;
            }

            // === KPI 미니 ===
            const totalProdH = prodEntries.reduce((s, e) => s + e[1].hours, 0);
            const totalCust = new Set(); prodEntries.forEach(e => e[1].custs.forEach(c => totalCust.add(c)));
            const totalEngs = new Set(); prodEntries.forEach(e => e[1].engs.forEach(en => totalEngs.add(en)));
            const avgPerProd = (prodEntries.reduce((s,e)=>s+e[1].count,0) / prodEntries.length).toFixed(1);
            const singleEngProds = prodEntries.filter(e => e[1].engs.size <= 1).length;
            document.getElementById('prodKpiRow').innerHTML = `
                <div class="kpi-mini"><div class="kpi-mini-label">지원 제품 수</div><div class="kpi-mini-value">${prodEntries.length}</div><div class="kpi-mini-sub">종</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">총 투입시간</div><div class="kpi-mini-value">${totalProdH.toFixed(0)}</div><div class="kpi-mini-sub">시간(h)</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">제품당 평균</div><div class="kpi-mini-value">${avgPerProd}</div><div class="kpi-mini-sub">건/제품</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">연관 고객사</div><div class="kpi-mini-value">${totalCust.size}</div><div class="kpi-mini-sub">곳</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">⚠ 단일엔지니어 제품</div><div class="kpi-mini-value">${singleEngProds}</div><div class="kpi-mini-sub">종 (리스크)</div></div>
            `;

            // ① 포트폴리오 맵 버블: X=고객사수, Y=건수, R=엔지니어수
            const bubbleData = prodEntries.map((e, i) => ({
                label: e[0],
                data: [{ x: e[1].custs.size, y: e[1].count, r: Math.max(5, e[1].engs.size * 4) }],
                backgroundColor: COLORS[i % COLORS.length] + '99',
                borderColor: COLORS[i % COLORS.length], borderWidth: 1
            }));
            upsertChart('chartProdBubble', {
                type: 'bubble', data: { datasets: bubbleData },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: true, position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 10 } },
                        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: 고객사 ${ctx.parsed.x}곳, ${ctx.parsed.y}건, 엔지니어 ${Math.round(ctx.raw.r / 4)}명` } }
                    },
                    scales: {
                        x: { title: { display: true, text: '고객사 수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, beginAtZero: true },
                        y: { title: { display: true, text: '지원 건수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, beginAtZero: true }
                    }
                }
            });

            // ② 제품군별 도넛
            const groupCounts = {};
            data.forEach(r => {
                const p = String(r['제품명'] || '').trim();
                if (!p) return;
                const g = productGroupOf(p);
                groupCounts[g] = (groupCounts[g] || 0) + 1;
            });
            const gEntries = Object.entries(groupCounts).sort((a, b) => b[1] - a[1]);
            upsertChart('chartProdGroup', pieChartConfig(gEntries.map(e => e[0]), gEntries.map(e => e[1])));

            // ③ 제품별 건수 vs 투입시간 이중축 차트 (건당시간 효율 분석)
            const topProdNames10 = prodEntries.slice(0, 10).map(e => e[0]);
            upsertChart('chartProdEfficiency', {
                type: 'bar',
                data: {
                    labels: topProdNames10,
                    datasets: [
                        { label: '지원건수', data: topProdNames10.map(p => prodMap[p].count), backgroundColor: '#4F46E5CC', borderColor: '#4F46E5', borderWidth: 1, borderRadius: 4, yAxisID: 'y', order: 2 },
                        { label: '투입시간(h)', data: topProdNames10.map(p => Math.round(prodMap[p].hours * 10) / 10), type: 'line', borderColor: '#EF4444', backgroundColor: '#EF444422', pointRadius: 4, pointHoverRadius: 6, tension: 0.3, yAxisID: 'y1', order: 1, fill: true }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 12 } },
                        tooltip: { callbacks: { afterBody: (items) => { const idx = items[0].dataIndex; const p = topProdNames10[idx]; const m = prodMap[p]; const perCase = m.count > 0 ? (m.hours / m.count).toFixed(1) : '-'; return `건당 소요: ${perCase}h`; } } }
                    },
                    scales: {
                        x: { ticks: { font: { size: 11 }, maxRotation: 45 }, grid: { display: false }, title: { display: true, text: '제품명', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                        y: { beginAtZero: true, position: 'left', title: { display: true, text: '건수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, ticks: { stepSize: 5, font: { size: 11 } } },
                        y1: { beginAtZero: true, position: 'right', title: { display: true, text: '시간(h)', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, ticks: { font: { size: 11 } }, grid: { drawOnChartArea: false } }
                    }
                }
            });

            // ④ 제품별 지원유형 구성 (대분류 스택바)
            const catNames = ['기술지원', '점검지원', 'Presales', '내부업무', '셀프스터디', '교육', '기타'];
            const catColors = ['#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#9CA3AF'];
            const topProdNames = prodEntries.slice(0, 10).map(e => e[0]);
            const prodCatMap = {};
            data.forEach(r => {
                const p = String(r['제품명'] || '').trim();
                const t = String(r['지원유형'] || '').trim();
                if (!p || !t) return;
                if (!prodCatMap[p]) prodCatMap[p] = {};
                const cat = typeCategoryOf(t);
                prodCatMap[p][cat] = (prodCatMap[p][cat] || 0) + 1;
            });
            upsertChart('chartProdTypeComp', stackedBarConfig(
                topProdNames,
                catNames.map((cat, i) => ({
                    label: cat, data: topProdNames.map(p => (prodCatMap[p] || {})[cat] || 0),
                    backgroundColor: catColors[i] + 'CC', borderColor: catColors[i], borderWidth: 1
                })),
                true, '건수', '제품명'
            ));

            // ⑤ 제품별 부서 투입 비중 (동적 부서 색상)
            const prodDeptMap = {};
            data.forEach(r => {
                const p = String(r['제품명'] || '').trim();
                const d = String(r['부서명'] || '').trim();
                if (!p || !d) return;
                if (!prodDeptMap[p]) prodDeptMap[p] = {};
                prodDeptMap[p][d] = (prodDeptMap[p][d] || 0) + 1;
            });
            const depts = [...new Set(data.map(r => String(r['부서명'] || '').trim()).filter(Boolean))].sort();
            // 레전드 동적 생성
            const prodDeptLegendEl = document.getElementById('prodDeptLegend');
            if (prodDeptLegendEl) prodDeptLegendEl.innerHTML = buildDeptLegendHTML(depts);
            upsertChart('chartProdDept', stackedBarConfig(
                topProdNames,
                depts.map(d => ({
                    label: d, data: topProdNames.map(p => (prodDeptMap[p] || {})[d] || 0),
                    backgroundColor: getDeptColor(d).color + 'CC',
                    borderColor: getDeptColor(d).color, borderWidth: 1
                })),
                true, '건수', '제품명'
            ));

            // ⑥ 일별 추이
            const prodDaily = aggregateByKeyAndDate(data, '제품명');
            const allDates = [...new Set(data.filter(r => r._dateStr).map(r => r._dateStr))].sort();
            const topProds = prodEntries.slice(0, 6).map(e => e[0]);
            upsertChart('chartProdDaily', lineChartConfig(
                allDates,
                topProds.map((name, i) => ({
                    label: name, data: allDates.map(d => (prodDaily[name] || {})[d] || 0),
                    borderColor: COLORS[i % COLORS.length], tension: 0.3, pointRadius: 2
                })),
                '건수', '날짜'
            ));

            // ⑦ 히트맵: 제품 × 엔지니어
            const allEngs = [...new Set(data.map(r => String(r['엔지니어'] || '').trim()).filter(Boolean))];
            const prodEngX = crossTab(data, '제품명', '엔지니어');
            let maxPH = 0;
            const phMatrix = prodEntries.map(([prod]) => allEngs.map(eng => { const v = (prodEngX[prod] || {})[eng] || 0; if (v > maxPH) maxPH = v; return v; }));
            document.getElementById('prodHeatmap').innerHTML = buildHeatmapHTML(prodEntries.map(e => e[0]), allEngs, phMatrix, maxPH);

            // ⑧ 스코어카드 (확장: 건당시간, 부서 비율 추가)
            const scDepts = getAllDeptNames(data);
            let pscHtml = '<table class="scorecard-table"><thead><tr><th>제품</th><th>제품군</th><th>건수</th><th>시간(h)</th><th>건당시간</th><th>고객사</th><th>엔지니어</th><th>부서별 비율</th><th>엔지니어 의존도</th></tr></thead><tbody>';
            prodEntries.forEach(([name, m]) => {
                const grp = productGroupOf(name);
                const perCase = m.count > 0 ? (m.hours / m.count).toFixed(1) : '-';
                const deptRatioStr = scDepts.map(d => {
                    const cnt = (prodDeptMap[name] || {})[d] || 0;
                    return cnt > 0 ? `${d.replace(/\s/g,'')}:${cnt}` : null;
                }).filter(Boolean).join(' / ') || '-';
                const depRisk = m.engs.size <= 1 ? 'high' : m.engs.size <= 2 ? 'mid' : 'low';
                const depLabel = m.engs.size <= 1 ? '⚠ 단일' : m.engs.size <= 2 ? '주의' : '양호';
                pscHtml += `<tr><td>${name}</td><td>${grp}</td><td><strong>${m.count}</strong></td><td>${m.hours.toFixed(1)}</td><td>${perCase}h</td><td>${m.custs.size}</td><td>${m.engs.size}명</td><td style="font-size:10px;white-space:nowrap">${deptRatioStr}</td><td><span class="sc-badge ${depRisk}">${depLabel} (${m.engs.size}명)</span></td></tr>`;
            });
            pscHtml += '</tbody></table>';
            document.getElementById('prodScorecard').innerHTML = pscHtml;
        }

        /* ============================================================
           TAB 4: 지원유형 분석 (전면 재설계)
           ============================================================ */
        function updateSupportTab() {
            const data = filteredData;
            if (!data.length) {
                document.getElementById('typeKpiRow').innerHTML = '';
                document.getElementById('typeScorecard').innerHTML = '';
                return;
            }

            // 사전 집계
            let totalInternal = 0, totalExternal = 0, totalVisit = 0, totalRemote = 0, totalOther = 0;
            let totalHoursAll = 0;
            const catCounts = {}, typeCounts = {}, typeHours = {}, typeEngs = {}, typeCusts = {};
            const catDates = {};
            data.forEach(r => {
                const t = String(r['지원유형'] || '').trim();
                if (!t) return;
                typeCounts[t] = (typeCounts[t] || 0) + 1;
                const h = calcHours(r);
                typeHours[t] = (typeHours[t] || 0) + h;
                totalHoursAll += h;
                const eng = String(r['엔지니어'] || '').trim();
                if (eng) { if (!typeEngs[t]) typeEngs[t] = new Set(); typeEngs[t].add(eng); }
                const cust = String(r['고객사명'] || '').trim();
                if (cust) { if (!typeCusts[t]) typeCusts[t] = new Set(); typeCusts[t].add(cust); }
                if (isInternal(t)) totalInternal++; else totalExternal++;
                const vt = visitTypeOf(t);
                if (vt === '방문') totalVisit++; else if (vt === '원격') totalRemote++; else totalOther++;
                const cat = typeCategoryOf(t);
                catCounts[cat] = (catCounts[cat] || 0) + 1;
                if (r._dateStr) {
                    if (!catDates[cat]) catDates[cat] = {};
                    catDates[cat][r._dateStr] = (catDates[cat][r._dateStr] || 0) + 1;
                }
            });

            // === KPI 미니 ===
            const extPct = data.length > 0 ? ((totalExternal / data.length) * 100).toFixed(1) : 0;
            const visitPct = (totalVisit + totalRemote) > 0 ? ((totalVisit / (totalVisit + totalRemote)) * 100).toFixed(1) : 0;
            const uniqueTypes = Object.keys(typeCounts).length;
            const avgHPerCase = data.length > 0 ? (totalHoursAll / data.length).toFixed(1) : 0;
            document.getElementById('typeKpiRow').innerHTML = `
                <div class="kpi-mini"><div class="kpi-mini-label">지원유형 종류</div><div class="kpi-mini-value">${uniqueTypes}</div><div class="kpi-mini-sub">가지</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">외부 고객지원</div><div class="kpi-mini-value">${totalExternal}</div><div class="kpi-mini-sub">${extPct}% of 전체</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">방문 지원</div><div class="kpi-mini-value">${totalVisit}</div><div class="kpi-mini-sub">방문비율 ${visitPct}%</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">건당 평균시간</div><div class="kpi-mini-value">${avgHPerCase}h</div><div class="kpi-mini-sub">총 ${totalHoursAll.toFixed(0)}h</div></div>
            `;

            // ① 대분류 도넛
            const catEntries = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
            upsertChart('chartTypeCat', pieChartConfig(catEntries.map(e => e[0]), catEntries.map(e => e[1])));

            // ② 방문 vs 원격 파이
            upsertChart('chartTypeVisitRemote', {
                type: 'doughnut',
                data: {
                    labels: ['방문', '원격', '기타(내부)'],
                    datasets: [{ data: [totalVisit, totalRemote, totalOther],
                        backgroundColor: ['#4F46E5CC', '#0EA5E9CC', '#F59E0BCC'],
                        borderColor: ['#4F46E5', '#0EA5E9', '#F59E0B'], borderWidth: 2 }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'right', labels: { font: { size: 12, family: 'Noto Sans KR' }, padding: 12, usePointStyle: true } },
                        tooltip: { callbacks: { label: ctx => { const total = ctx.dataset.data.reduce((a, b) => a + b, 0); return ` ${ctx.label}: ${ctx.parsed}건 (${((ctx.parsed / total) * 100).toFixed(1)}%)`; } } }
                    }
                }
            });

            // ③ 지원유형별 건수 vs 투입시간 이중축 차트
            const typeEntries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
            const topTypeNames = typeEntries.slice(0, 12).map(e => e[0]);
            upsertChart('chartTypeCountHours', {
                type: 'bar',
                data: {
                    labels: topTypeNames,
                    datasets: [
                        { label: '건수', data: topTypeNames.map(t => typeCounts[t] || 0), backgroundColor: '#4F46E5CC', borderColor: '#4F46E5', borderWidth: 1, borderRadius: 4, yAxisID: 'y', order: 2 },
                        { label: '투입시간(h)', data: topTypeNames.map(t => Math.round((typeHours[t] || 0) * 10) / 10), type: 'line', borderColor: '#EF4444', backgroundColor: '#EF444422', pointRadius: 4, pointHoverRadius: 6, tension: 0.3, yAxisID: 'y1', order: 1, fill: true }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                    plugins: { legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 12 } },
                        tooltip: { callbacks: { afterBody: (items) => { const idx = items[0].dataIndex; const t = topTypeNames[idx]; const cnt = typeCounts[t] || 0; const hrs = typeHours[t] || 0; const perCase = cnt > 0 ? (hrs / cnt).toFixed(1) : '-'; return `건당 소요: ${perCase}h`; } } }
                    },
                    scales: {
                        y: { ticks: { font: { size: 11 } }, grid: { display: false } },
                        x: { beginAtZero: true, position: 'bottom', title: { display: true, text: '건수', font: { size: 11 } }, ticks: { font: { size: 11 } } },
                        y1: { display: false, beginAtZero: true }
                    }
                }
            });

            // ④ 대분류별 일별 추이 (라인)
            const allDates = [...new Set(data.filter(r => r._dateStr).map(r => r._dateStr))].sort();
            const catColorMap = { '기술지원': '#4F46E5', '점검지원': '#0EA5E9', 'Presales': '#10B981', '내부업무': '#F59E0B', '셀프스터디': '#EC4899', '교육': '#8B5CF6', '기타': '#9CA3AF' };
            upsertChart('chartTypeTrend', lineChartConfig(
                allDates,
                catEntries.map(([cat]) => ({
                    label: cat,
                    data: allDates.map(d => (catDates[cat] || {})[d] || 0),
                    borderColor: catColorMap[cat] || '#9CA3AF',
                    tension: 0.3, pointRadius: 2, fill: false
                }))
            ));

            // ⑤ 부서별 업무유형 비중 (100% 스택바)
            const deptCatMap = {};
            data.forEach(r => {
                const dept = String(r['부서명'] || '').trim();
                const t = String(r['지원유형'] || '').trim();
                if (!dept || !t) return;
                const cat = typeCategoryOf(t);
                if (!deptCatMap[dept]) deptCatMap[dept] = {};
                deptCatMap[dept][cat] = (deptCatMap[dept][cat] || 0) + 1;
            });
            const depts = Object.keys(deptCatMap).sort();
            const catKeys = catEntries.map(e => e[0]);
            upsertChart('chartTypeDeptComp', stackedBarConfig(
                depts,
                catKeys.map((cat, i) => ({
                    label: cat, data: depts.map(d => (deptCatMap[d] || {})[cat] || 0),
                    backgroundColor: (catColorMap[cat] || '#9CA3AF') + 'CC',
                    borderColor: catColorMap[cat] || '#9CA3AF', borderWidth: 1
                })),
                false
            ));

            // ⑥ 지원유형별 엔지니어 투입수 (인력 분산 분석)
            const typeEngCounts = typeEntries.slice(0, 12).map(([t]) => ({ name: t, engCnt: typeEngs[t] ? typeEngs[t].size : 0, custCnt: typeCusts[t] ? typeCusts[t].size : 0 }));
            upsertChart('chartTypeEngCount', {
                type: 'bar',
                data: {
                    labels: typeEngCounts.map(e => e.name),
                    datasets: [
                        { label: '투입 엔지니어수', data: typeEngCounts.map(e => e.engCnt), backgroundColor: '#4F46E5CC', borderColor: '#4F46E5', borderWidth: 1, borderRadius: 4 },
                        { label: '관련 고객사수', data: typeEngCounts.map(e => e.custCnt), backgroundColor: '#10B981CC', borderColor: '#10B981', borderWidth: 1, borderRadius: 4 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                    plugins: { legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 10 } } },
                    scales: {
                        y: { ticks: { font: { size: 11 } }, grid: { display: false }, title: { display: true, text: '지원유형', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                        x: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } }, title: { display: true, text: '수량', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } }
                    }
                }
            });

            // ⑦ 히트맵: 지원유형 × 제품
            const allProdsForType = [...new Set(data.map(r => String(r['제품명'] || '').trim()).filter(Boolean))];
            const typeProdsX = crossTab(data, '지원유형', '제품명');
            let maxTH = 0;
            const thNames = typeEntries.map(e => e[0]);
            const thMatrix = thNames.map(t => allProdsForType.map(p => { const v = (typeProdsX[t] || {})[p] || 0; if (v > maxTH) maxTH = v; return v; }));
            document.getElementById('typeHeatmap').innerHTML = buildHeatmapHTML(thNames, allProdsForType, thMatrix, maxTH);

            // ⑧ 스코어카드 (확장: 고객사수, 건당시간 추가)
            const totalAll = typeEntries.reduce((s, e) => s + e[1], 0);
            let tscHtml = '<table class="scorecard-table"><thead><tr><th>지원유형</th><th>대분류</th><th>방문/원격</th><th>건수</th><th>비율</th><th>총시간(h)</th><th>건당시간</th><th>엔지니어</th><th>고객사</th></tr></thead><tbody>';
            typeEntries.forEach(([name, cnt]) => {
                const cat = typeCategoryOf(name);
                const vr = visitTypeOf(name);
                const pct = totalAll > 0 ? ((cnt / totalAll) * 100).toFixed(1) : 0;
                const hrs = typeHours[name] || 0;
                const perCase = cnt > 0 ? (hrs / cnt).toFixed(1) : '-';
                const engCnt = typeEngs[name] ? typeEngs[name].size : 0;
                const custCnt = typeCusts[name] ? typeCusts[name].size : 0;
                const vrBadge = vr === '방문' ? 'high' : vr === '원격' ? 'mid' : 'low';
                tscHtml += `<tr><td>${name}</td><td>${cat}</td><td><span class="sc-badge ${vrBadge}">${vr}</span></td><td><strong>${cnt}</strong></td><td>${pct}%</td><td>${hrs.toFixed(1)}</td><td>${perCase}h</td><td>${engCnt}명</td><td>${custCnt}곳</td></tr>`;
            });
            tscHtml += '</tbody></table>';
            document.getElementById('typeScorecard').innerHTML = tscHtml;
        }

        /* ============================================================
           TAB 5: 고객사 분석 (전면 재설계)
           ============================================================ */
        function updateCustomerTab() {
            const data = filteredData;
            const custMap = aggregateCustomers(data);
            const custEntries = Object.entries(custMap).sort((a, b) => b[1].count - a[1].count);

            if (!custEntries.length) {
                document.getElementById('custKpiRow').innerHTML = '';
                document.getElementById('custScorecard').innerHTML = '';
                return;
            }

            // === KPI 미니 ===
            const singleEngCust = custEntries.filter(e => e[1].engs.size === 1).length;
            const multiProdCust = custEntries.filter(e => e[1].prods.size >= 2).length;
            const totalCustH = custEntries.reduce((s, e) => s + e[1].hours, 0);
            const topCust = custEntries[0];
            document.getElementById('custKpiRow').innerHTML = `
                <div class="kpi-mini"><div class="kpi-mini-label">지원 고객사</div><div class="kpi-mini-value">${custEntries.length}</div><div class="kpi-mini-sub">곳</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">총 투입시간</div><div class="kpi-mini-value">${totalCustH.toFixed(0)}</div><div class="kpi-mini-sub">시간(h)</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">⚠ 단일엔지니어 고객</div><div class="kpi-mini-value">${singleEngCust}</div><div class="kpi-mini-sub">곳 (인력 리스크)</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">멀티제품 고객</div><div class="kpi-mini-value">${multiProdCust}</div><div class="kpi-mini-sub">곳 (2종 이상)</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">최다 지원 고객</div><div class="kpi-mini-value">${topCust[0]}</div><div class="kpi-mini-sub">${topCust[1].count}건, ${topCust[1].hours.toFixed(0)}h</div></div>
            `;

            // ① 세그멘테이션 버블: X=건수, Y=제품수, R=엔지니어수
            const topBubble = custEntries.slice(0, 20);
            const bubbleData = topBubble.map((e, i) => ({
                label: e[0],
                data: [{ x: e[1].count, y: e[1].prods.size, r: Math.max(5, e[1].engs.size * 4) }],
                backgroundColor: COLORS[i % COLORS.length] + '99',
                borderColor: COLORS[i % COLORS.length], borderWidth: 1
            }));
            upsertChart('chartCustBubble', {
                type: 'bubble', data: { datasets: bubbleData },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: true, position: 'top', labels: { font: { size: 10, family: 'Noto Sans KR' }, usePointStyle: true, padding: 8 } },
                        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.x}건, 제품 ${ctx.parsed.y}종, 엔지니어 ${Math.round(ctx.raw.r / 4)}명` } }
                    },
                    scales: {
                        x: { title: { display: true, text: '지원 건수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, beginAtZero: true },
                        y: { title: { display: true, text: '사용 제품 수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, beginAtZero: true, ticks: { stepSize: 1 } }
                    }
                }
            });

            // ② Top 15 지원유형 구성 스택바
            const top15 = custEntries.slice(0, 15);
            const catNames = ['기술지원', '점검지원', 'Presales', '내부업무', '셀프스터디', '교육', '기타'];
            const catColors2 = ['#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#9CA3AF'];
            const custCatMap = {};
            data.forEach(r => {
                const c = String(r['고객사명'] || '').trim();
                const t = String(r['지원유형'] || '').trim();
                if (!c || !t) return;
                if (!custCatMap[c]) custCatMap[c] = {};
                const cat = typeCategoryOf(t);
                custCatMap[c][cat] = (custCatMap[c][cat] || 0) + 1;
            });
            const top15Names = top15.map(e => e[0]);
            upsertChart('chartCustTypeComp', stackedBarConfig(
                top15Names,
                catNames.map((cat, i) => ({
                    label: cat, data: top15Names.map(c => (custCatMap[c] || {})[cat] || 0),
                    backgroundColor: catColors2[i] + 'CC', borderColor: catColors2[i], borderWidth: 1
                })),
                true, '건수', '고객사'
            ));

            // ③ Top 15 건수 vs 투입시간 이중축 차트
            upsertChart('chartCustEfficiency', {
                type: 'bar',
                data: {
                    labels: top15Names,
                    datasets: [
                        { label: '지원건수', data: top15Names.map(c => custMap[c].count), backgroundColor: '#4F46E5CC', borderColor: '#4F46E5', borderWidth: 1, borderRadius: 4, yAxisID: 'y', order: 2 },
                        { label: '투입시간(h)', data: top15Names.map(c => Math.round(custMap[c].hours * 10) / 10), type: 'line', borderColor: '#EF4444', backgroundColor: '#EF444422', pointRadius: 4, pointHoverRadius: 6, tension: 0.3, yAxisID: 'y1', order: 1, fill: true }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                    plugins: { legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 12 } },
                        tooltip: { callbacks: { afterBody: (items) => { const idx = items[0].dataIndex; const c = top15Names[idx]; const m = custMap[c]; const perCase = m.count > 0 ? (m.hours / m.count).toFixed(1) : '-'; return `건당 소요: ${perCase}h | 엔지니어: ${m.engs.size}명 | 제품: ${m.prods.size}종`; } } }
                    },
                    scales: {
                        y: { ticks: { font: { size: 11 } }, grid: { display: false }, title: { display: true, text: '고객사', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                        x: { beginAtZero: true, position: 'bottom', title: { display: true, text: '건수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, ticks: { font: { size: 11 } } },
                        y1: { display: false, beginAtZero: true }
                    }
                }
            });

            // ④ Top 5 추이
            const custDaily = aggregateByKeyAndDate(data, '고객사명');
            const allDates = [...new Set(data.filter(r => r._dateStr).map(r => r._dateStr))].sort();
            const top5 = custEntries.slice(0, 5).map(e => e[0]);
            upsertChart('chartCustTrend', lineChartConfig(
                allDates,
                top5.map((name, i) => ({
                    label: name, data: allDates.map(d => (custDaily[name] || {})[d] || 0),
                    borderColor: COLORS[i % COLORS.length], tension: 0.3, pointRadius: 2
                })),
                '건수', '날짜'
            ));

            // ⑤ 담당영업별 지원 현황 (건수 + 고객사수 Grouped Bar)
            const salesMap = {};
            data.forEach(r => {
                const s = String(r['담당영업'] || '').trim();
                const c = String(r['고객사명'] || '').trim();
                if (!s) return;
                if (!salesMap[s]) salesMap[s] = { count: 0, custs: new Set(), hours: 0 };
                salesMap[s].count++;
                salesMap[s].hours += calcHours(r);
                if (c) salesMap[s].custs.add(c);
            });
            const salesEntries = Object.entries(salesMap).sort((a, b) => b[1].count - a[1].count);
            upsertChart('chartCustSales', {
                type: 'bar',
                data: {
                    labels: salesEntries.map(e => e[0]),
                    datasets: [
                        { label: '지원 건수', data: salesEntries.map(e => e[1].count), backgroundColor: '#4F46E5CC', borderColor: '#4F46E5', borderWidth: 1, borderRadius: 4, xAxisID: 'x' },
                        { label: '담당 고객사 수', data: salesEntries.map(e => e[1].custs.size), backgroundColor: '#10B981CC', borderColor: '#10B981', borderWidth: 1, borderRadius: 4, xAxisID: 'x1' }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                    plugins: { legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, pointStyle: 'circle' } },
                        tooltip: { callbacks: { afterBody: (items) => { const idx = items[0].dataIndex; const sName = salesEntries[idx][0]; const sm = salesEntries[idx][1]; return `총 시간: ${sm.hours.toFixed(1)}h`; } } }
                    },
                    scales: {
                        y: { ticks: { font: { size: 11 } }, grid: { display: false }, title: { display: true, text: '담당영업', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                        x: { position: 'bottom', beginAtZero: true, ticks: { font: { size: 11 } }, title: { display: true, text: '건수 / 고객사수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } },
                        x1: { display: false, beginAtZero: true }
                    }
                }
            });

            // ⑥ 엔지니어 투입수 (리스크 분석) - 색상으로 리스크 표시
            const top20 = custEntries.slice(0, 20);
            const riskColors = top20.map(e => {
                const n = e[1].engs.size;
                return n <= 1 ? '#EF4444CC' : n <= 2 ? '#F59E0BCC' : '#10B981CC';
            });
            upsertChart('chartCustEngRisk', barChartConfig(
                top20.map(e => e[0]),
                top20.map(e => e[1].engs.size),
                '투입 엔지니어 수', riskColors, true, '엔지니어 수(명)', '고객사'
            ));

            // ⑦ 히트맵: 주요 고객사 × 제품
            const allProdsForCust = [...new Set(data.map(r => String(r['제품명'] || '').trim()).filter(Boolean))];
            const custProdX = crossTab(data, '고객사명', '제품명');
            let maxCH = 0;
            const top20Names = top20.map(e => e[0]);
            const chMatrix = top20Names.map(c => allProdsForCust.map(p => { const v = (custProdX[c] || {})[p] || 0; if (v > maxCH) maxCH = v; return v; }));
            document.getElementById('custHeatmap').innerHTML = buildHeatmapHTML(top20Names, allProdsForCust, chMatrix, maxCH);

            // ⑧ 고객사 종합 현황 테이블 (확장: 건당시간, 주요제품 추가)
            let cscHtml = '<table class="scorecard-table"><thead><tr><th>고객사</th><th>건수</th><th>시간(h)</th><th>건당시간</th><th>제품</th><th>엔지니어</th><th>담당영업</th><th>인력 리스크</th></tr></thead><tbody>';
            custEntries.slice(0, 30).forEach(([name, m]) => {
                const risk = m.engs.size <= 1 ? 'high' : m.engs.size <= 2 ? 'mid' : 'low';
                const riskLabel = m.engs.size <= 1 ? '⚠ 위험' : m.engs.size <= 2 ? '주의' : '양호';
                const prodsStr = [...m.prods].slice(0, 3).join(', ') + (m.prods.size > 3 ? ` +${m.prods.size - 3}` : '');
                const salesStr = [...m.sales].join(', ');
                const perCase = m.count > 0 ? (m.hours / m.count).toFixed(1) : '-';
                cscHtml += `<tr><td>${name}</td><td><strong>${m.count}</strong></td><td>${m.hours.toFixed(1)}</td><td>${perCase}h</td><td title="${[...m.prods].join(', ')}">${prodsStr}</td><td>${m.engs.size}명</td><td>${salesStr}</td><td><span class="sc-badge ${risk}">${riskLabel}</span></td></tr>`;
            });
            cscHtml += '</tbody></table>';
            document.getElementById('custScorecard').innerHTML = cscHtml;
        }

        /* ============================================================
           TAB 6: 지원내역 상세 테이블
           ============================================================ */
        
        /* ============================================================
           TAB 7: 담당영업별 분석
           ============================================================ */
        function updateSalesTab() {
            const data = filteredData;
            const salesMap = aggregateSales(data);
            const salesEntries = Object.entries(salesMap).sort((a, b) => b[1].count - a[1].count);

            if (!salesEntries.length) {
                document.getElementById('salesKpiRow').innerHTML = '';
                document.getElementById('salesScorecard').innerHTML = '';
                document.getElementById('salesHeatmap').innerHTML = '<p style="color:var(--gray-400);text-align:center;padding:20px;">데이터 없음</p>';
                return;
            }

            // === KPI 미니 ===
            const totalSalesH = salesEntries.reduce((s, e) => s + e[1].hours, 0);
            const allCusts = new Set(salesEntries.flatMap(([, m]) => [...m.custs]));
            const topSales = salesEntries[0];
            const avgCustPerSales = (allCusts.size / salesEntries.length).toFixed(1);
            const heavyLoad = salesEntries.filter(([, m]) => m.custs.size > allCusts.size / salesEntries.length * 1.5).length;
            document.getElementById('salesKpiRow').innerHTML = `
                <div class="kpi-mini"><div class="kpi-mini-label">담당영업 수</div><div class="kpi-mini-value">${salesEntries.length}</div><div class="kpi-mini-sub">명</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">총 지원 건수</div><div class="kpi-mini-value">${data.length}</div><div class="kpi-mini-sub">건</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">총 투입시간</div><div class="kpi-mini-value">${totalSalesH.toFixed(0)}</div><div class="kpi-mini-sub">시간(h)</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">인당 평균 고객사</div><div class="kpi-mini-value">${avgCustPerSales}</div><div class="kpi-mini-sub">곳 / 인</div></div>
                <div class="kpi-mini"><div class="kpi-mini-label">최다 고객사 담당</div><div class="kpi-mini-value">${topSales[0]}</div><div class="kpi-mini-sub">${topSales[1].custs.size}곳, ${topSales[1].count}건</div></div>
            `;

            // ① 포트폴리오 버블: X=고객사수, Y=건수, R=제품수
            const bubbleData = salesEntries.map((e, i) => ({
                label: e[0],
                data: [{ x: e[1].custs.size, y: e[1].count, r: Math.max(5, e[1].prods.size * 4) }],
                backgroundColor: COLORS[i % COLORS.length] + '99',
                borderColor: COLORS[i % COLORS.length], borderWidth: 1
            }));
            upsertChart('chartSalesBubble', {
                type: 'bubble', data: { datasets: bubbleData },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { display: true, position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 10 } },
                        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: 고객사 ${ctx.parsed.x}곳, ${ctx.parsed.y}건, 제품 ${Math.round(ctx.raw.r / 4)}종` } }
                    },
                    scales: {
                        x: { title: { display: true, text: '담당 고객사수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, beginAtZero: true, ticks: { stepSize: 1 } },
                        y: { title: { display: true, text: '지원 건수', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' }, beginAtZero: true }
                    }
                }
            });

            // ② 건수 vs 투입시간 이중축 (가로 막대)
            const salesNames = salesEntries.map(e => e[0]);
            upsertChart('chartSalesCountHours', {
                type: 'bar',
                data: {
                    labels: salesNames,
                    datasets: [
                        { label: '지원건수', data: salesNames.map(s => salesMap[s].count), backgroundColor: '#4F46E5CC', borderColor: '#4F46E5', borderWidth: 1, borderRadius: 4, yAxisID: 'y', order: 2 },
                        { label: '투입시간(h)', data: salesNames.map(s => Math.round(salesMap[s].hours * 10) / 10), type: 'line', borderColor: '#EF4444', backgroundColor: '#EF444422', pointRadius: 4, pointHoverRadius: 6, tension: 0.3, yAxisID: 'y1', order: 1, fill: true }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                    plugins: {
                        legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 12 } },
                        tooltip: { callbacks: { afterBody: items => { const s = salesNames[items[0].dataIndex]; const cnt = salesMap[s].count; const hrs = salesMap[s].hours; return cnt > 0 ? `건당 평균: ${(hrs / cnt).toFixed(1)}h` : ''; } } }
                    },
                    scales: {
                        y: { ticks: { font: { size: 11 } }, grid: { display: false } },
                        x: { beginAtZero: true, title: { display: true, text: '건수', font: { size: 11 } }, ticks: { font: { size: 11 } } },
                        y1: { display: false, beginAtZero: true }
                    }
                }
            });

            // ③ 담당영업별 지원유형 구성 스택바
            const catNames = ['기술지원', '점검지원', 'Presales', '내부업무', '셀프스터디', '교육', '기타'];
            const catColors = ['#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#9CA3AF'];
            const salesCatMap = {};
            for (let i = 0; i < data.length; i++) {
                const s = String(data[i]['담당영업'] || '').trim();
                const t = String(data[i]['지원유형'] || '').trim();
                if (!s || !t) continue;
                if (!salesCatMap[s]) salesCatMap[s] = {};
                const cat = typeCategoryOf(t);
                salesCatMap[s][cat] = (salesCatMap[s][cat] || 0) + 1;
            }
            upsertChart('chartSalesTypeComp', stackedBarConfig(
                salesNames,
                catNames.map((cat, i) => ({
                    label: cat, data: salesNames.map(s => (salesCatMap[s] || {})[cat] || 0),
                    backgroundColor: catColors[i] + 'CC', borderColor: catColors[i], borderWidth: 1
                })),
                true, '건수', '담당영업'
            ));

            // ④ 담당영업별 고객사수 + 투입 엔지니어수 (가로 막대)
            upsertChart('chartSalesCustEng', {
                type: 'bar',
                data: {
                    labels: salesNames,
                    datasets: [
                        { label: '담당 고객사수', data: salesNames.map(s => salesMap[s].custs.size), backgroundColor: '#10B981CC', borderColor: '#10B981', borderWidth: 1, borderRadius: 4 },
                        { label: '투입 엔지니어수', data: salesNames.map(s => salesMap[s].engs.size), backgroundColor: '#8B5CF6CC', borderColor: '#8B5CF6', borderWidth: 1, borderRadius: 4 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                    plugins: { legend: { position: 'top', labels: { font: { size: 11, family: 'Noto Sans KR' }, usePointStyle: true, padding: 10 } } },
                    scales: {
                        y: { ticks: { font: { size: 11 } }, grid: { display: false } },
                        x: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } }, title: { display: true, text: '수량', font: { size: 11, family: 'Noto Sans KR' }, color: '#6B7280' } }
                    }
                }
            });

            // ⑤ Top 5 담당영업 일별 추이 (라인)
            const salesDaily = aggregateByKeyAndDate(data, '담당영업');
            const allDates = [...new Set(data.filter(r => r._dateStr).map(r => r._dateStr))].sort();
            const top5Sales = salesEntries.slice(0, CONFIG.CHART_TOP_N.TREND).map(e => e[0]);
            upsertChart('chartSalesDaily', lineChartConfig(
                allDates,
                top5Sales.map((s, i) => ({
                    label: s,
                    data: allDates.map(d => (salesDaily[s] || {})[d] || 0),
                    borderColor: COLORS[i % COLORS.length],
                    tension: 0.3, pointRadius: 2, fill: false
                }))
            ));

            // ⑥ 담당영업 × 고객사 히트맵 (Top 10 고객사)
            const topCustsForHM = Object.entries(
                data.reduce((acc, r) => {
                    const c = String(r['고객사명'] || '').trim();
                    if (c) acc[c] = (acc[c] || 0) + 1;
                    return acc;
                }, {})
            ).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
            const salesCustX = crossTab(data, '담당영업', '고객사명');
            let maxHMVal = 0;
            const hmMatrix = salesNames.map(s =>
                topCustsForHM.map(c => { const v = (salesCustX[s] || {})[c] || 0; if (v > maxHMVal) maxHMVal = v; return v; })
            );
            document.getElementById('salesHeatmap').innerHTML = buildHeatmapHTML(salesNames, topCustsForHM, hmMatrix, maxHMVal);

            // ⑦ 종합 스코어카드
            const totalAll = salesEntries.reduce((s, e) => s + e[1].count, 0);
            let scHtml = '<table class="scorecard-table"><thead><tr><th>담당영업</th><th>고객사수</th><th>건수</th><th>비율</th><th>총시간(h)</th><th>건당시간</th><th>제품수</th><th>투입엔지니어</th></tr></thead><tbody>';
            salesEntries.forEach(([name, m]) => {
                const pct = totalAll > 0 ? ((m.count / totalAll) * 100).toFixed(1) : 0;
                const perCase = m.count > 0 ? (m.hours / m.count).toFixed(1) : '-';
                scHtml += `<tr>
                    <td><strong>${name}</strong></td>
                    <td>${m.custs.size}곳</td>
                    <td><strong>${m.count}</strong></td>
                    <td>${pct}%</td>
                    <td>${m.hours.toFixed(1)}</td>
                    <td>${perCase}h</td>
                    <td>${m.prods.size}종</td>
                    <td>${m.engs.size}명</td>
                </tr>`;
            });
            scHtml += '</tbody></table>';
            document.getElementById('salesScorecard').innerHTML = scHtml;
        }

        function updateDetailTab() {
            tableState.page = 1;
            tableState.search = document.getElementById('tableSearch').value;
            applyTableSearchAndRender();
        }

        /** 테이블 검색 및 렌더링 */
        function applyTableSearchAndRender() {
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

            // 정렬 적용
            if (tableState.sortCol !== null) {
                const col = TABLE_COLUMNS[tableState.sortCol];
                const dir = tableState.sortDir === 'asc' ? 1 : -1;
                tableState.searchData = [...tableState.searchData].sort((a, b) => {
                    const va = String(a[col] || '');
                    const vb = String(b[col] || '');
                    return va.localeCompare(vb, 'ko') * dir;
                });
            }

            renderTable();
        }

        /** 테이블 렌더링 (페이지네이션 포함) */
        function renderTable() {
            const data = tableState.searchData;
            const perPage = tableState.perPage;
            const totalPages = Math.max(1, Math.ceil(data.length / perPage));
            if (tableState.page > totalPages) tableState.page = totalPages;
            const page = tableState.page;
            const start = (page - 1) * perPage;
            const end = Math.min(start + perPage, data.length);
            const pageData = data.slice(start, end);

            // 정보 표시
            document.getElementById('tableInfo').textContent = 
                `총 ${formatNum(filteredData.length)}건 중 ${formatNum(data.length)}건 검색됨 │ ${formatNum(start + 1)}~${formatNum(end)} 표시`;

            // 헤더 생성 (정렬 포함)
            const thead = document.getElementById('dataTableHead');
            thead.innerHTML = TABLE_COLUMNS.map((col, i) => {
                const isSorted = tableState.sortCol === i;
                const icon = isSorted ? (tableState.sortDir === 'asc' ? '▲' : '▼') : '↕';
                return `<th class="${isSorted ? 'sorted' : ''}" onclick="sortTable(${i})">${col} <span class="sort-icon">${icon}</span></th>`;
            }).join('');

            // 본문 생성
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
                        const val = String(pageData[i][col] || '');
                        const cls = col === '지원내역' ? ' class="td-detail"' : '';
                        const displayVal = val.length > 100 ? val.substring(0, 100) + '...' : val;
                        html += `<td${cls} title="${val.replace(/"/g, '&quot;').replace(/\r?\n/g, ' ')}">${displayVal.replace(/\r?\n/g, '<br>')}</td>`;
                    });
                    html += '</tr>';
                }
                tbody.innerHTML = html;
            }

            // 페이지네이션
            renderPagination(totalPages, page);
        }

        /** 페이지네이션 렌더링 */
        function renderPagination(totalPages, currentPage) {
            const el = document.getElementById('pagination');
            if (totalPages <= 1) { el.innerHTML = ''; return; }

            let html = '';
            html += `<button class="page-btn" onclick="goPage(1)" ${currentPage === 1 ? 'disabled' : ''}><i class="fas fa-angle-double-left"></i></button>`;
            html += `<button class="page-btn" onclick="goPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}><i class="fas fa-angle-left"></i></button>`;

            // 페이지 번호 범위 계산
            let startP = Math.max(1, currentPage - 3);
            let endP = Math.min(totalPages, currentPage + 3);
            if (endP - startP < 6) {
                if (startP === 1) endP = Math.min(totalPages, 7);
                else startP = Math.max(1, endP - 6);
            }

            if (startP > 1) html += `<button class="page-btn" disabled>...</button>`;
            for (let p = startP; p <= endP; p++) {
                html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="goPage(${p})">${p}</button>`;
            }
            if (endP < totalPages) html += `<button class="page-btn" disabled>...</button>`;

            html += `<button class="page-btn" onclick="goPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}><i class="fas fa-angle-right"></i></button>`;
            html += `<button class="page-btn" onclick="goPage(${totalPages})" ${currentPage === totalPages ? 'disabled' : ''}><i class="fas fa-angle-double-right"></i></button>`;

            el.innerHTML = html;
        }

        /** 페이지 이동 */
        window.goPage = function(p) {
            tableState.page = p;
            renderTable();
            // 테이블 상단으로 스크롤
            document.querySelector('.data-table-wrapper').scrollTop = 0;
        };

        /** 컬럼 정렬 */
        window.sortTable = function(colIdx) {
            if (tableState.sortCol === colIdx) {
                tableState.sortDir = tableState.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                tableState.sortCol = colIdx;
                tableState.sortDir = 'asc';
            }
            applyTableSearchAndRender();
        };

        /** 엑셀 다운로드 (필터 적용된 데이터) */
        window.exportToExcel = function() {
            const data = tableState.searchData;
            if (!data.length) { showToast('다운로드할 데이터가 없습니다.', 'error'); return; }
            
            const ws = XLSX.utils.json_to_sheet(data.map(r => {
                const obj = {};
                TABLE_COLUMNS.forEach(c => { obj[c] = r[c] || ''; });
                return obj;
            }));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '지원내역');
            XLSX.writeFile(wb, `지원내역_필터결과_${formatDateStr(new Date())}.xlsx`);
        };

        /* ============================================================
           대시보드 리셋 (다른 파일 업로드)
           ============================================================ */
        window.resetDashboard = function() {
            // 차트 인스턴스 파괴
            Object.values(charts).forEach(c => { try { c.destroy(); } catch(e){} });
            charts = {};
            rawData = [];
            filteredData = [];
            compensationEntries = [];
            activeFilterFromDate = null;
            activeFilterToDate = null;
            loadedFiles = [];
            drilldownState = {};
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
           초기화
           ============================================================ */
        function init() {
            setupDropzone();
            setupTabs();

            // 대시보드 내 "파일 추가" 버튼 (헤더)
            const addFileInput = document.getElementById('addFileInput');
            if (addFileInput) {
                addFileInput.addEventListener('change', function(e) {
                    if (e.target.files.length > 0) handleFiles(e.target.files, true);
                    this.value = '';
                });
            }

            // 테이블 검색 이벤트
            document.getElementById('tableSearch').addEventListener('input', debounce(function() {
                tableState.search = this.value;
                tableState.page = 1;
                applyTableSearchAndRender();
            }, 200));

            // 행 수 변경
            document.getElementById('rowsPerPage').addEventListener('change', function() {
                tableState.perPage = parseInt(this.value);
                tableState.page = 1;
                renderTable();
            });
        }

        // DOM 준비 후 초기화
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }

    })();
    
