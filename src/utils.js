(function() {
    'use strict';

    function parseDate(value) {
        if (value == null || value === '') return null;
        if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

        if (typeof value === 'number' && isFinite(value) && value > 0) {
            // Excel serial (1900 system) to Date
            return new Date(Date.UTC(1899, 11, 30) + value * 24 * 60 * 60 * 1000);
        }

        const raw = String(value).trim();
        if (!raw) return null;

        if (/^[0-9]+(\.[0-9]+)?$/.test(raw)) {
            const serial = Number(raw);
            if (isFinite(serial) && serial > 0) {
                return new Date(Date.UTC(1899, 11, 30) + serial * 24 * 60 * 60 * 1000);
            }
        }

        // "YYYY-MM-DD HH:mm:ss" and variants
        let normalized = raw.replace(/\//g, '-');
        normalized = normalized.replace(/\s+/g, 'T');
        const d = new Date(normalized);
        if (!isNaN(d.getTime())) return d;

        return null;
    }

    function formatDateStr(date) {
        if (!(date instanceof Date) || isNaN(date.getTime())) return '';
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function formatNum(v) {
        if (v === null || v === undefined || v === '') return '0';
        const n = Number(v);
        if (!isFinite(n)) return String(v);
        return new Intl.NumberFormat('ko-KR').format(n);
    }

    function utilColor(usagePct) {
        const n = Number(usagePct);
        if (!isFinite(n)) return '#6B7280';
        if (n >= 80) return '#10B981';
        if (n >= 60) return '#F59E0B';
        return '#EF4444';
    }

    function debounce(fn, wait) {
        let timer = null;
        return function() {
            const args = arguments;
            const ctx = this;
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(ctx, args), wait || 0);
        };
    }

    function showToast(message, type = 'error') {
        const toast = document.getElementById('toast');
        const msg = document.getElementById('toastMsg');
        if (!toast || !msg) return;

        const safeType = (type === 'success') ? 'success' : 'error';
        toast.className = `toast ${safeType}`;
        msg.textContent = message;
        toast.style.display = 'flex';

        clearTimeout(window.__toastTimer);
        window.__toastTimer = setTimeout(() => {
            toast.style.display = 'none';
        }, 2600);
    }

    function showLoading(show, text, subText) {
        const overlay = document.getElementById('loadingOverlay');
        if (!overlay) return;

        const textEl = document.getElementById('loadingText');
        const subEl = document.getElementById('loadingSub');

        if (!show) {
            overlay.classList.remove('active');
            return;
        }

        overlay.classList.add('active');
        if (textEl && text !== undefined) textEl.textContent = text;
        if (subEl && subText !== undefined) subEl.textContent = subText;
    }

    window.DASH_UTILS = {
        parseDate,
        formatDateStr,
        formatNum,
        utilColor,
        debounce,
        showToast,
        showLoading
    };
})();
