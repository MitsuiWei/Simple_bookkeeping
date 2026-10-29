/* 格式化工具：日期、金額、百分比 */
(function (global) {
  'use strict';

  const pad2 = n => (n < 10 ? '0' + n : '' + n);

  /** 本地日期 → "YYYY-MM-DD" */
  function dateKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** "YYYY-MM-DD" → 當天 00:00 的時間戳 */
  function fromDateKey(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  }

  function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function endOfDay(ts) { const d = new Date(ts); d.setHours(23, 59, 59, 999); return d.getTime(); }

  /** 2026/10/27 */
  function fmtSlash(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate());
  }

  /** 2026年10月1日 */
  function fmtZh(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  /** 2026年10月29日 星期四（本日模式用） */
  function fmtZhWeekday(ts) {
    const d = new Date(ts);
    return fmtZh(ts) + ' 星期' + ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  }

  /** 2026/10/1（不補零，匯出對話框用） */
  function fmtShortSlash(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  }

  /** 今天 / 昨天 / 明天 / 2026/10/27 */
  function fmtRelative(ts) {
    const today = startOfDay(Date.now());
    const day = startOfDay(ts);
    const diff = Math.round((day - today) / 86400000);
    if (diff === 0) return '今天';
    if (diff === -1) return '昨天';
    if (diff === 1) return '明天';
    return fmtSlash(ts);
  }

  /** $65,465；小數最多兩位 */
  function fmtMoney(n) {
    const neg = n < 0;
    const abs = Math.abs(n);
    const s = abs.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return (neg ? '-$' : '$') + s;
  }

  /** 44.7% / 16%（去掉 .0） */
  function fmtPct(p) {
    if (!isFinite(p)) return '0%';
    const r = Math.round(p * 10) / 10;
    return (Number.isInteger(r) ? r : r.toFixed(1)) + '%';
  }

  /** 計算機顯示用：運算子換成全形符號 */
  function fmtExpr(expr) {
    return expr.replace(/\//g, '÷').replace(/\*/g, '×').replace(/-/g, '−');
  }

  global.Fmt = { pad2, dateKey, fromDateKey, startOfDay, endOfDay, fmtSlash, fmtZh, fmtZhWeekday, fmtShortSlash, fmtRelative, fmtMoney, fmtPct, fmtExpr };
})(window);
