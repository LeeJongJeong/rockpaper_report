const { 
    normalizeHolidayConfig,
    buildHolidaySetForRange,
    countBusinessDaysWithHolidays,
    summarizeContractHoursByRange
} = require('./contract-utils');

const HOLIDAY_CONFIG = {
    fixed: ['01-01', '03-01', '05-05', '06-06', '08-15', '10-03', '10-09', '12-25'],
    yearly: {
        '2026': ['02-16', '02-17', '02-18', '09-24', '09-25', '09-26']
    },
    extras: [],
    includeSubstitute: true
};

const WORK_HOURS_PER_DAY = 8;

function toYmd(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function assertEq(actual, expected, label) {
    if (actual !== expected) {
        throw new Error(`${label} | expected: ${expected}, actual: ${actual}`);
    }
}

function run() {
    console.log('[contract-utils] regression check start');

    const cfg = normalizeHolidayConfig(HOLIDAY_CONFIG);
    const rawCfg = HOLIDAY_CONFIG;
    const range = { start: new Date(2026, 0, 1), end: new Date(2026, 1, 28) };
    const summary = summarizeContractHoursByRange(
        range.start,
        range.end,
        cfg,
        { workHoursPerDay: WORK_HOURS_PER_DAY }
    );
    const rawSummary = summarizeContractHoursByRange(range.start, range.end, rawCfg, { workHoursPerDay: WORK_HOURS_PER_DAY });

    assertEq(summary.totalWorkDays, 38, '2026-01-01 ~ 2026-02-28 total work days');
    assertEq(summary.totalWorkHours, 304, '2026-01-01 ~ 2026-02-28 total work hours');
    assertEq(rawSummary.totalWorkDays, summary.totalWorkDays, 'raw-config summary = pre-normalized summary');
    assertEq(rawSummary.totalWorkHours, summary.totalWorkHours, 'raw-config summary hours = pre-normalized summary hours');

    const holidaySet = buildHolidaySetForRange(new Date(2026, 0, 1), new Date(2026, 1, 28), cfg);
    const rawHolidaySet = buildHolidaySetForRange(new Date(2026, 0, 1), new Date(2026, 1, 28), rawCfg);
    assertEq(rawHolidaySet.size, holidaySet.size, 'raw-config holiday set size equals pre-normalized');
    ['2026-02-16', '2026-02-17', '2026-02-18'].forEach(date => {
        if (!holidaySet.has(date) || !rawHolidaySet.has(date)) {
            throw new Error(`Missing yearly holiday in computed set: ${date}`);
        }
    });

    const janSummary = summarizeContractHoursByRange(
        new Date(2026, 0, 1),
        new Date(2026, 0, 31),
        cfg,
        { workHoursPerDay: WORK_HOURS_PER_DAY }
    );
    const janBusinessDays = countBusinessDaysWithHolidays(new Date(2026, 0, 1), new Date(2026, 0, 31), cfg);
    assertEq(janSummary.totalWorkDays, janBusinessDays, 'Jan summary = direct countBusinessDaysWithHolidays');

    const midJanDays = countBusinessDaysWithHolidays(new Date(2026, 0, 26), new Date(2026, 0, 30), cfg);
    assertEq(midJanDays, 5, '2026-01-26~2026-01-30 business days');

    if (!Array.isArray(summary.byMonth) || summary.byMonth.length !== 2) {
        throw new Error(`Unexpected month bins length: ${summary.byMonth ? summary.byMonth.length : 0}`);
    }
    assertEq(summary.byMonth[0].key, '2026-01', 'first month key');
    assertEq(summary.byMonth[1].key, '2026-02', 'second month key');

    console.log('[contract-utils] PASS');
    console.log(`- totalHours: ${summary.totalWorkHours}, detail: ${summary.byMonth.map((x) => `${x.key}:${x.workHours}`).join(', ')}`);
    console.log('[contract-utils] first/last date check:', `${toYmd(new Date(summary.byMonth[0].workStart))} ~ ${toYmd(new Date(summary.byMonth[1].workEnd))}`);
}

try {
    run();
    process.exit(0);
} catch (err) {
    console.error('[contract-utils] FAIL', err.message);
    process.exit(1);
}
