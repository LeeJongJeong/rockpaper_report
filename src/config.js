(function() {
    'use strict';

    const CONFIG = {
        UTIL: { DANGER: 60, TARGET: 80 },
        WORK_HOURS_PER_DAY: 8,
        // 공휴일 설정
        // - fixed: 매년 반복 (MM-DD)
        // - yearly: 연도별 공휴일 (YYYY)
        // - includeSubstitute: 주말 공휴일의 대체공휴일(월~금 다음 평일) 적용 여부
        // - extras: 기타(필요 시 특정 날짜 강제 등록)
        HOLIDAYS: {
            fixed: [
                '01-01', // 신정
                '03-01', // 삼일절
                '05-05', // 어린이날
                '06-06', // 현충일
                '08-15', // 광복절
                '10-03', // 개천절
                '10-09', // 한글날
                '12-25'  // 성탄절
            ],
            yearly: {
                '2026': ['02-16', '02-17', '02-18', '09-24', '09-25', '09-26'] // 설/추석 연휴(연도별 입력)
            },
            extras: [],
            includeSubstitute: true
        },
        MOVING_AVG_DAYS: 7,
        FILE_MAX_MB: 200,
        TABLE_DEFAULT_PER_PAGE: 50,
        CHART_TOP_N: { PIE: 8, BAR: 10, RADAR: 5, TREND: 6 },
        DEBOUNCE_MS: 150
    };

    const FILTER_COLUMNS = [
        { key: '부서명', label: '부서' },
        { key: '엔지니어', label: '엔지니어' },
        { key: '제품명', label: '제품' },
        { key: '지원유형', label: '지원유형' },
        { key: '고객사명', label: '고객사' },
        { key: '담당영업', label: '담당영업' }
    ];

    const COLORS = [
        '#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444',
        '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#06B6D4',
        '#6366F1', '#84CC16', '#D946EF', '#0D9488', '#E11D48',
        '#7C3AED', '#059669', '#DC2626', '#2563EB', '#CA8A04',
        '#9333EA', '#16A34A', '#DB2777', '#0284C7', '#EA580C'
    ];

    const DEPT_COLORS = [
        '#2563EB', '#7C3AED', '#059669', '#DC2626', '#D97706',
        '#0891B2', '#BE185D', '#4338CA', '#0D9488', '#B45309',
        '#7E22CE', '#15803D', '#9333EA', '#0284C7', '#EA580C'
    ];

    const DEPT_BG_COLORS = [
        '#DBEAFE', '#F3E8FF', '#DCFCE7', '#FEE2E2', '#FEF3C7',
        '#CFFAFE', '#FCE7F3', '#E0E7FF', '#CCFBF1', '#FEF3C7',
        '#F3E8FF', '#DCFCE7', '#FAE8FF', '#E0F2FE', '#FFF7ED'
    ];

    const TABLE_COLUMNS = [
        '작업시작일시',
        '작업종료일시',
        '작업시간(h)',
        '부서명',
        '엔지니어',
        '제품명',
        '지원유형',
        '고객사명',
        '지원내역',
        '지원도시',
        '담당영업'
    ];

    const PRODUCT_GROUP_RULES = [
        // DB 계열
        { re: /MySQL.*(?:OCI|Azure|Cloud|RDS|GCP)/i, group: '클라우드 DB' },
        { re: /MySQL/i, group: 'MySQL' },
        { re: /MariaDB/i, group: 'MariaDB' },
        { re: /Postgre|EDB|PPAS/i, group: 'PostgreSQL' },
        { re: /Mongo/i, group: 'MongoDB' },
        { re: /Redis/i, group: 'Redis' },
        { re: /Kafka/i, group: 'Kafka' },
        { re: /Cassandra/i, group: 'Cassandra' },
        { re: /Cubrid/i, group: 'Cubrid' },
        { re: /Tibero/i, group: 'Tibero' },
        { re: /Oracle/i, group: 'Oracle' },
        // 미들웨어 / WAS 계열
        { re: /JBoss\s*EAP/i, group: 'JBoss EAP' },
        { re: /JBCS/i, group: 'JBCS' },
        { re: /WildFly/i, group: 'WildFly' },
        { re: /Tomcat/i, group: 'Tomcat' },
        { re: /Apache/i, group: 'Apache' },
        { re: /Nginx/i, group: 'Nginx' },
        { re: /WebLogic/i, group: 'WebLogic' },
        { re: /WebSphere/i, group: 'WebSphere' },
        // 컨테이너 / 클라우드
        { re: /OpenShift/i, group: 'OpenShift' },
        { re: /Kubernetes|K8s/i, group: 'Kubernetes' },
        { re: /Docker/i, group: 'Docker' },
        { re: /Ansible/i, group: 'Ansible' },
        { re: /OCI|Azure|AWS|GCP|Cloud/i, group: '클라우드' },
        // 서비스
        { re: /Managed\s*Service/i, group: 'Managed Service' },
        { re: /Presales/i, group: 'Presales' },
        // 데이터
        { re: /Hadoop|Hive|Spark/i, group: '빅데이터' },
        { re: /Elastic|OpenSearch/i, group: 'Elastic' }
    ];

    window.DASH_CONFIG = {
        CONFIG,
        FILTER_COLUMNS,
        COLORS,
        DEPT_COLORS,
        DEPT_BG_COLORS,
        TABLE_COLUMNS,
        PRODUCT_GROUP_RULES
    };
})();
