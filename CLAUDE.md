# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Single-file HTML analytics dashboard for analyzing weekly work reports (주간업무보고) from Rock Paper (락페이퍼). The entire application is `index.html` — ~4,300 lines of inlined HTML/CSS/JavaScript with no build process.

**No build, lint, or test commands exist.** To run: open `index.html` in a browser. Sample data files (`주간업무보고_2026_*.xlsx`) are provided for testing.

## Architecture

All code lives in `index.html`. The logical structure within that file:

1. **CDN imports** — SheetJS 0.18.5 (Excel parsing), Chart.js 4.4.1 (charts), Flatpickr (date picker), Font Awesome 6.4.0
2. **CSS** — inline `<style>` block
3. **HTML structure** — upload dropzone, filter bar, 6 analysis tabs
4. **JavaScript** — one large `<script>` block with these layers:
   - Global state (`rawData`, `filteredData`, `filterState`, `drilldownState`, `tableState`)
   - `CONFIG` constants (utilization thresholds, pagination, chart top-N counts, debounce)
   - `FILTER_COLUMNS` definition (the 6 filterable dimensions)
   - Business logic functions (see below)
   - Tab rendering functions (`updateOverviewTab`, `updateEngineerTab`, `updateProductTab`, `updateSupportTab`, `updateCustomerTab`, `updateDetailTab`)
   - Event wiring / initialization

## Key Business Logic

### Data Pipeline
Excel upload → SheetJS parse → `rawData[]` → date/filter pipeline (150ms debounce) → `filteredData[]` → tab renders

### Core Calculation Functions
- **`calcHours(row)`** — work hours with lunch deduction (09:00–18:00 or 08:30–17:30 = 8h; other ranges calculated directly)
- **`isBillable(type)`** — determines if a support type counts toward utilization rate (기술지원, 점검지원, Presales, 비상대기, 현장실습, 고객사교육 = billable)
- **`isInternal(type)`** — matches 내부|셀프|교육
- **`typeCategoryOf(type)`** — maps to 7 categories (내부업무, 셀프스터디, 교육, 점검지원, Presales, 기술지원, 기타)
- **`productGroupOf(prod)`** — regex-based product grouping into DB / Middleware/WAS / Container/Cloud / Services / Big Data; falls back to the product name itself (no "기타" collapse)
- **`visitTypeOf(type)`** — classifies as on-site `[방문]`, remote `[원격]`, or 기타(내부)

### Aggregation Functions (all single-pass)
- `aggregateEngineers(data)` → per-engineer metrics including `billableHours`, `billableCount`, `billableCusts`
- `aggregateCustomers(data)`, `aggregateProducts(data)`, `aggregateByTeam(engMap)`
- Utilities: `aggregateCounts`, `aggregateByDate`, `aggregateByKeyAndDate`, `crossTab`, `topNWithOther`, `movingAverage`

### Utilization Rate Formula
`billableHours / (activityDays × 8) × 100%`
- ≥80% → green; 60–80% → amber; <60% → red

### Department Color System
- `getDeptColor(deptName)` — assigns colors from a 15-color palette, cached in `deptColorCache`
- `resetDeptColors()` — call on dashboard reset to clear cache
- Dynamic (no hard-coded department names)

## Expected Excel Columns
`작업시작일시`, `작업종료일시`, `부서명`, `엔지니어`, `제품명`, `지원유형`, `고객사명`, `지원내역`, `지원도시`, `담당영업`

## Important Constraints
- File size limit: 200 MB (`CONFIG.FILE_MAX_MB`)
- Chart instance reuse: always call `chart.update('none')` rather than destroying and recreating charts
- Tab rendering is lazy — only the active tab's charts are updated
- Filter debounce: 150ms (`CONFIG.DEBOUNCE_MS`)
- The engineer workload bubble chart (Tab 2) uses only billable records, not all records
