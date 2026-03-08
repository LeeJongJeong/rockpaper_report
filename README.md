# 락페이퍼 주간업무보고 분석 대시보드

브라우저에서 엑셀(`.xlsx`, `.xls`) 파일을 직접 읽어 분석하는 정적 대시보드입니다.
업로드된 데이터는 서버로 전송하지 않고 브라우저 안에서만 처리됩니다.

## 주요 기능

- 기간, 부서, 엔지니어, 제품, 지원유형, 고객사, 담당영업 필터
- 개요, 엔지니어, 제품, 지원유형, 고객사, 담당영업, 상세 탭
- 비교 기준 선택
  - 직전 동기간
  - 전주 동일요일
  - 전월 동일기간
  - 전년 동기
- 차트 클릭 기반 드릴다운 필터
- 상세 테이블 검색, 정렬, 페이지네이션, 엑셀 다운로드
- 보상시트 연동 인사이트

## 실행 방법

별도 빌드 단계는 없습니다.

### 가장 간단한 실행

1. [index.html](/D:/myhome/rockpaper-report/index.html)을 브라우저로 엽니다.
2. 주간업무보고 엑셀 파일을 업로드합니다.
3. 필터와 탭을 바꿔가며 분석합니다.

### 권장 실행

정적 파일 서버로 여는 편이 호환성에서 더 안정적입니다.

```powershell
python -m http.server 8000
```

실행 후 브라우저에서 `http://localhost:8000` 을 엽니다.

## 데이터 처리 방식

### 기본 업로드

- 여러 파일 동시 업로드 및 병합 지원
- 첫 번째 시트를 메인 데이터로 사용
- 메인 데이터는 `sheet_to_json(..., { range: 2 })` 기준으로 읽음
- 보상시트가 있으면 추가 집계에 사용

### 보상시트

다음 이름 패턴의 시트를 탐색합니다.

- `근무-보상시간 통계`
- `근무-보상시간`
- `보상` 관련 시트명

여기서 엔지니어별 보상발생시간을 읽어 인사이트에 반영합니다.

## 분석 기준

### 엔지니어 가동률

현재 엔지니어 가동률은 아래 기준으로 계산합니다.

```text
가동률(%) = billableHours / 소정근무시간 × 100
```

- `billableHours`: 현재 필터 기간 내 billable 지원시간 합계
- `소정근무시간`: 현재 기간의 영업일 수 × 8시간

### billable 포함 규칙

현재 billable 포함 기준은 다음과 같습니다.

- `기술지원`
- `점검지원`
- `Presales`, `presales`
- `비상대기`
- `현장실습`
- `고객사교육`

따라서 `내부업무`, `셀프스터디` 같은 항목은 가동시간에 포함되지 않습니다.

관련 로직:
- [src/analytics-core.js](/D:/myhome/rockpaper-report/src/analytics-core.js)
- [src/data-loader.js](/D:/myhome/rockpaper-report/src/data-loader.js)

### 작업시간 계산

기본 작업시간은 `작업종료일시 - 작업시작일시` 입니다.
다음 패턴은 점심 1시간을 차감합니다.

- `09:00 ~ 18:00`
- `08:30 ~ 17:30`

### 비교 기준

대시보드 KPI와 비교형 서브텍스트는 현재 선택한 비교 기준으로 계산됩니다.

- `직전 동기간`: 현재와 길이가 같은 바로 이전 기간
- `전주 동일요일`: 7일 앞당긴 동일 요일 구간
- `전월 동일기간`: 한 달 앞당긴 동일 달력 구간
- `전년 동기`: 1년 앞당긴 동일 달력 구간

## 현재 소스 구조

### 진입점

- [index.html](/D:/myhome/rockpaper-report/index.html)
- [src/app.js](/D:/myhome/rockpaper-report/src/app.js)

### 공통 설정 및 유틸

- [src/config.js](/D:/myhome/rockpaper-report/src/config.js): 상수, 필터 컬럼, 색상, 제품군 규칙, 공휴일 설정
- [src/utils.js](/D:/myhome/rockpaper-report/src/utils.js): 날짜/숫자 포맷, debounce, toast, loading
- [src/contract-utils.js](/D:/myhome/rockpaper-report/src/contract-utils.js): 영업일/소정근무시간 계산
- [src/dashboard-ui.js](/D:/myhome/rockpaper-report/src/dashboard-ui.js): 차트/히트맵/랭킹 공통 UI 헬퍼

### 데이터/분석 계층

- [src/data-loader.js](/D:/myhome/rockpaper-report/src/data-loader.js): 파일 업로드, 엑셀 파싱, row 정규화, 보상시트 처리
- [src/analytics-core.js](/D:/myhome/rockpaper-report/src/analytics-core.js): 비교 기간, KPI summary, 집계, 분류 규칙

### UI 계층

- [src/filter-ui.js](/D:/myhome/rockpaper-report/src/filter-ui.js): 필터 생성, 드롭다운, 날짜 선택, 필터 요약
- [src/table-ui.js](/D:/myhome/rockpaper-report/src/table-ui.js): 상세 테이블, 정렬, 검색, 페이지네이션, 엑셀 export
- [src/app-shell.js](/D:/myhome/rockpaper-report/src/app-shell.js): 탭 전환, 드릴다운 배너, 테마, 리셋, 정적 이벤트 바인딩

### 탭 렌더러

- [src/tab-overview.js](/D:/myhome/rockpaper-report/src/tab-overview.js)
- [src/tab-engineer.js](/D:/myhome/rockpaper-report/src/tab-engineer.js)
- [src/tab-product.js](/D:/myhome/rockpaper-report/src/tab-product.js)
- [src/tab-support.js](/D:/myhome/rockpaper-report/src/tab-support.js)
- [src/tab-customer.js](/D:/myhome/rockpaper-report/src/tab-customer.js)
- [src/tab-sales.js](/D:/myhome/rockpaper-report/src/tab-sales.js)

## 개발 가이드

### 모듈 책임 원칙

- `app.js` 는 상태 보관과 모듈 wiring 중심으로 유지
- 계산 로직은 `analytics-core.js`
- 업로드/정규화는 `data-loader.js`
- DOM 이벤트와 화면 제어는 `filter-ui.js`, `table-ui.js`, `app-shell.js`
- 탭별 렌더링은 각 `tab-*.js`

### 인코딩 정책

저장소는 UTF-8을 기본 정책으로 사용합니다.

- [/.editorconfig](/D:/myhome/rockpaper-report/.editorconfig)
- [/.gitattributes](/D:/myhome/rockpaper-report/.gitattributes)

텍스트 파일은 UTF-8로 유지하고, BOM 없는 UTF-8을 권장합니다.

인코딩 검사는 아래 스크립트로 수행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-utf8.ps1
```

## 테스트 및 검증

### 회귀 테스트

```powershell
node src/contract-utils.test.js
```

### 문법 검사

```powershell
node --check src/app.js
node --check src/app-shell.js
node --check src/analytics-core.js
node --check src/data-loader.js
node --check src/filter-ui.js
node --check src/table-ui.js
```

## 샘플 파일

루트에 아래 샘플 파일이 포함되어 있습니다.

- `주간업무보고_2026_DS.xlsx`
- `주간업무보고_2026_IS.xlsx`
- `주간업무보고_2026_PS.xlsx`

## 운영 시 주의사항

- 원본 엑셀 컬럼명이 현재 로직의 기대값과 다르면 일부 집계가 누락될 수 있습니다.
- 지원유형 분류는 현재 정규식 기반입니다. 데이터 입력 표현이 달라지면 billable/internal 분류 결과가 달라질 수 있습니다.
- 브라우저에서 대용량 파일을 바로 처리하므로 파일 크기가 크면 첫 렌더링에 시간이 걸릴 수 있습니다.
- 비교 KPI 해석 전에는 현재 선택한 비교 기준을 먼저 확인하는 것이 좋습니다.
