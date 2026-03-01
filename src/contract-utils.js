(function(root) {
    'use strict';

    const fallbackSet = () => new Set();

    function pad2(v) {
        return String(v).padStart(2, '0');
    }

    function formatDate(date) {
        if (!(date instanceof Date) || isNaN(date.getTime())) return '';
        return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
    }

    function isMonthDay(value) {
        return /^\d{1,2}-\d{1,2}$/.test(String(value || '').trim());
    }

    function isFullDate(value) {
        return /^\d{4}-\d{1,2}-\d{1,2}$/.test(String(value || '').trim());
    }

    function isNormalizedHolidayConfig(value) {
        return !!(value
            && typeof value === 'object'
            && value.fixed instanceof Set
            && value.extras instanceof Set
            && value.extrasMonthDay instanceof Set
            && value.yearly instanceof Map
        );
    }

    function ensureHolidayConfig(rawConfig) {
        return isNormalizedHolidayConfig(rawConfig) ? rawConfig : normalizeHolidayConfig(rawConfig);
    }

    function toMonthDay(value) {
        const raw = String(value || '').trim();
        if (!isMonthDay(raw)) return '';
        const [m, d] = raw.split('-').map(Number);
        if (!m || !d || m < 1 || m > 12 || d < 1 || d > 31) return '';
        return pad2(m) + '-' + pad2(d);
    }

    function normalizeToDate(raw) {
        const s = String(raw || '').trim();
        if (!s) return null;

        if (isFullDate(s)) {
            const [y, m, d] = s.split('-').map(Number);
            if (!y || !m || !d) return null;
            return new Date(y, m - 1, d);
        }

        const parsed = new Date(s);
        if (!isNaN(parsed.getTime())) {
            return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
        }
        return null;
    }

    function normalizeHolidayConfig(rawConfig) {
        const data = {
            fixed: new Set(),          // MM-DD
            yearly: new Map(),         // year -> Set(MM-DD)
            extras: new Set(),         // YYYY-MM-DD
            extrasMonthDay: new Set(), // MM-DD
            includeSubstitute: false
        };

        const pushMonthDay = (set, raw) => {
            const mmdd = toMonthDay(raw);
            if (!mmdd) return;
            set.add(mmdd);
        };

        const pushFullDate = (raw) => {
            const date = normalizeToDate(raw);
            if (!date || isNaN(date.getTime())) return;
            data.extras.add(formatDate(date));
        };

        const pushList = (list, monthDayTarget) => {
            if (!Array.isArray(list)) return;
            for (let i = 0; i < list.length; i++) {
                const raw = list[i];
                if (raw === undefined || raw === null) continue;
                const rawStr = String(raw);
                const trimmed = rawStr.trim();
                if (!trimmed) continue;
                if (isMonthDay(trimmed)) {
                    if (monthDayTarget) pushMonthDay(monthDayTarget, trimmed);
                    continue;
                }
                if (isFullDate(trimmed) || normalizeToDate(trimmed)) {
                    pushFullDate(raw);
                }
            }
        };

        if (!rawConfig) return data;
        if (Array.isArray(rawConfig)) {
            pushList(rawConfig, data.fixed);
            return data;
        }
        if (typeof rawConfig !== 'object') return data;

        pushList(rawConfig.fixed, data.fixed);
        if (rawConfig.yearly && typeof rawConfig.yearly === 'object') {
            Object.keys(rawConfig.yearly).forEach(yearKey => {
                const year = Number(yearKey);
                if (!Number.isInteger(year)) return;
                if (!data.yearly.has(year)) data.yearly.set(year, new Set());
                pushList(rawConfig.yearly[yearKey], data.yearly.get(year));
            });
        }
        pushList(rawConfig.extras, data.extrasMonthDay);
        pushList(rawConfig.extras, null);
        data.includeSubstitute = !!rawConfig.includeSubstitute;
        return data;
    }

    function normalizeRange(startDate, endDate) {
        if (!(startDate instanceof Date) || !(endDate instanceof Date)) return { start: null, end: null };
        let start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        let end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
        if (start > end) {
            const t = start;
            start = end;
            end = t;
        }
        return { start, end };
    }

    function buildHolidayDate(year, mmdd) {
        const m = Number(String(mmdd).split('-')[0]);
        const d = Number(String(mmdd).split('-')[1]);
        if (!Number.isFinite(year) || !Number.isInteger(year) || !m || !d) return null;
        const date = new Date(year, m - 1, d);
        return isNaN(date.getTime()) ? null : date;
    }

    const rangeHolidayCache = new Map();
    function getRangeCacheKey(startDate, endDate, includeSubstitute) {
        return `${formatDate(startDate)}~${formatDate(endDate)}~${includeSubstitute ? 1 : 0}`;
    }

    function addWithSubstitute(set, date, includeSubstitute) {
        if (!(date instanceof Date) || isNaN(date.getTime())) return;
        set.add(formatDate(date));
        if (!includeSubstitute) return;

        const dow = date.getDay();
        if (dow !== 0 && dow !== 6) return;
        const substitute = new Date(date);
        substitute.setDate(substitute.getDate() + (dow === 6 ? 2 : 1));
        while (substitute.getDay() === 0 || substitute.getDay() === 6) {
            substitute.setDate(substitute.getDate() + 1);
        }
        set.add(formatDate(substitute));
    }

    function buildHolidaySetForRange(startDate, endDate, rawConfig) {
        const config = ensureHolidayConfig(rawConfig);
        const range = normalizeRange(startDate, endDate);
        if (!range.start || !range.end) return fallbackSet();
        const cacheKey = `${getRangeCacheKey(range.start, range.end, config.includeSubstitute)}`;
        if (rangeHolidayCache.has(cacheKey)) return new Set(rangeHolidayCache.get(cacheKey));

        const set = new Set();
        const startY = range.start.getFullYear();
        const endY = range.end.getFullYear();
        const startKey = formatDate(range.start);
        const endKey = formatDate(range.end);

        for (let year = startY; year <= endY; year++) {
            config.fixed.forEach(mmdd => addWithSubstitute(set, buildHolidayDate(year, mmdd), config.includeSubstitute));
            const yearlySet = config.yearly.get(year);
            if (yearlySet) {
                yearlySet.forEach(mmdd => addWithSubstitute(set, buildHolidayDate(year, mmdd), config.includeSubstitute));
            }
            config.extrasMonthDay.forEach(mmdd => addWithSubstitute(set, buildHolidayDate(year, mmdd), config.includeSubstitute));
        }

        config.extras.forEach(d => {
            if (d >= startKey && d <= endKey) set.add(d);
        });

        rangeHolidayCache.set(cacheKey, set);
        return new Set(set);
    }

    function countBusinessDaysWithHolidaySet(startDate, endDate, holidaySet) {
        const range = normalizeRange(startDate, endDate);
        if (!range.start || !range.end) return 0;
        const set = holidaySet instanceof Set ? holidaySet : new Set();

        let count = 0;
        const cursor = new Date(range.start);
        while (cursor <= range.end) {
            const dow = cursor.getDay();
            if (dow !== 0 && dow !== 6 && !set.has(formatDate(cursor))) count++;
            cursor.setDate(cursor.getDate() + 1);
        }
        return count;
    }

    function countBusinessDaysWithHolidays(startDate, endDate, rawConfig) {
        const range = normalizeRange(startDate, endDate);
        if (!range.start || !range.end) return 0;
        const holidaySet = buildHolidaySetForRange(range.start, range.end, rawConfig);
        return countBusinessDaysWithHolidaySet(range.start, range.end, holidaySet);
    }

    function summarizeContractHoursByRange(startDate, endDate, rawConfig, options) {
        const range = normalizeRange(startDate, endDate);
        if (!range.start || !range.end) return { totalWorkDays: 0, totalWorkHours: 0, byMonth: [] };

        const config = ensureHolidayConfig(rawConfig);
        const workHoursPerDay = Number((options || {}).workHoursPerDay) || 8;
        const holidaySet = buildHolidaySetForRange(range.start, range.end, config);
        const byMonth = [];
        let totalDays = 0;
        let cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
        if (cursor < range.start) cursor = new Date(range.start);

        while (cursor <= range.end) {
            const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
            const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
            const activeStart = monthStart < range.start ? range.start : monthStart;
            const activeEnd = monthEnd > range.end ? range.end : monthEnd;

            if (activeStart <= activeEnd) {
                const workDays = countBusinessDaysWithHolidaySet(activeStart, activeEnd, holidaySet);
                const workHours = workDays * workHoursPerDay;
                totalDays += workDays;
                byMonth.push({
                    key: `${activeStart.getFullYear()}-${pad2(activeStart.getMonth() + 1)}`,
                    monthStart: formatDate(monthStart),
                    monthEnd: formatDate(monthEnd),
                    workStart: formatDate(activeStart),
                    workEnd: formatDate(activeEnd),
                    workDays: workDays,
                    workHours: workHours
                });
            }

            cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        }

        return {
            totalWorkDays: totalDays,
            totalWorkHours: totalDays * workHoursPerDay,
            byMonth: byMonth
        };
    }

    const api = {
        normalizeHolidayConfig,
        buildHolidaySetForRange,
        countBusinessDaysWithHolidaySet,
        countBusinessDaysWithHolidays,
        summarizeContractHoursByRange
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (!root.DASH_CONTRACT_UTILS) root.DASH_CONTRACT_UTILS = {};
    root.DASH_CONTRACT_UTILS = Object.assign({}, root.DASH_CONTRACT_UTILS, api);
})(typeof window !== 'undefined' ? window : globalThis);
