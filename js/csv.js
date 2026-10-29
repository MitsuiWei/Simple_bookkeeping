/* CSV 匯入 / 匯出
   匯出格式與原始檔完全相同：
   - 表頭：時間,名稱,金額（$）,項目,類別,記帳人
   - 時間：YYYY/M/D + U+2009 細空格 + 時段（凌晨/清晨/上午/中午/下午/晚上）+ h:mm（12 小時制）
   - UTF-8、無 BOM、LF 換行、檔尾無換行、由舊到新排序
*/
(function (global) {
  'use strict';

  const HEADER = ['時間', '名稱', '金額（$）', '項目', '類別', '記帳人'];
  const THIN_SPACE = ' ';

  /* ---------- 解碼：UTF-8（含 BOM）優先，失敗則 Big5 ---------- */
  function decodeBytes(buf) {
    const bytes = new Uint8Array(buf);
    let hasBom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? bytes.subarray(3) : bytes);
      return { text, encoding: hasBom ? 'UTF-8 (BOM)' : 'UTF-8' };
    } catch (e) {
      try {
        const text = new TextDecoder('big5').decode(bytes);
        return { text, encoding: 'Big5' };
      } catch (e2) {
        const text = new TextDecoder('utf-8').decode(bytes);
        return { text, encoding: 'UTF-8（部分字元無法解析）' };
      }
    }
  }

  /* ---------- RFC 4180 解析 ---------- */
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim() !== ''));
  }

  /* ---------- 時間字串 ---------- */
  const PERIOD_RE = '(凌晨|午夜|清晨|早上|上午|中午|下午|晚上|AM|PM|am|pm)?';
  const TIME_RE = new RegExp('^(\\d{4})[/\\-.年](\\d{1,2})[/\\-.月](\\d{1,2})日?[\\s\\u2009\\u3000T]*' + PERIOD_RE + '[\\s\\u2009]*(\\d{1,2})?(?::(\\d{2}))?(?::(\\d{2}))?[\\s\\u2009]*' + PERIOD_RE + '$');

  function parseTime(str) {
    const s = (str || '').trim();
    const m = TIME_RE.exec(s);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const period = m[4] || m[8] || '';
    let h = m[5] != null ? +m[5] : 0;
    const mi = m[6] != null ? +m[6] : 0;
    const sec = m[7] != null ? +m[7] : 0;
    if (period) h = to24(h, period);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
    return new Date(y, mo - 1, d, h, mi, sec).getTime();
  }

  function to24(h, period) {
    const h12 = h % 12;
    switch (period) {
      case '凌晨': case '午夜': case '清晨': case '早上': case '上午': case 'AM': case 'am':
        return h12;
      case '中午':
        return h12 === 0 ? 12 : h12 + 12; // 中午12:30 → 12:30、中午1:00 → 13:00
      case '下午': case 'PM': case 'pm':
        return h12 + 12;
      case '晚上':
        return h12 === 0 ? 0 : h12 + 12; // 晚上12:30 視為 00:30
      default:
        return h;
    }
  }

  function periodOf(h) {
    if (h < 5) return '凌晨';
    if (h < 8) return '清晨';
    if (h < 12) return '上午';
    if (h < 13) return '中午';
    if (h < 19) return '下午';
    return '晚上';
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const h = d.getHours();
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const mi = d.getMinutes();
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + THIN_SPACE + periodOf(h) + h12 + ':' + (mi < 10 ? '0' + mi : mi);
  }

  /* ---------- 表格 → 紀錄 ---------- */
  function rowsToRecords(rows) {
    const result = { records: [], skipped: 0, ledgerName: '' };
    if (!rows.length) return result;

    // 找表頭（允許順序不同、含 BOM、前後空白）
    const head = rows[0].map(h => h.replace(/^﻿/, '').trim());
    const idx = {
      time: head.findIndex(h => /時間|日期|date|time/i.test(h)),
      name: head.findIndex(h => /名稱|內容|備註|name|note|desc/i.test(h)),
      amount: head.findIndex(h => /金額|amount|price/i.test(h)),
      type: head.findIndex(h => /項目|類型|收支|type/i.test(h)),
      cat: head.findIndex(h => /類別|分類|category/i.test(h)),
      who: head.findIndex(h => /記帳人|帳本|user|owner/i.test(h))
    };
    const hasHeader = idx.time >= 0 && idx.amount >= 0;
    if (!hasHeader) {
      // 沒有表頭：假設欄位順序與原始格式相同
      Object.assign(idx, { time: 0, name: 1, amount: 2, type: 3, cat: 4, who: 5 });
    }
    const body = hasHeader ? rows.slice(1) : rows;

    body.forEach(r => {
      const ts = parseTime(r[idx.time]);
      const amount = parseAmount(r[idx.amount]);
      const typeRaw = (idx.type >= 0 ? r[idx.type] : '') || '';
      const type = /收入|income/i.test(typeRaw) ? 'income' : /支出|expense/i.test(typeRaw) ? 'expense' : (amount < 0 ? 'income' : 'expense');
      const cat = ((idx.cat >= 0 ? r[idx.cat] : '') || '其他').trim() || '其他';
      const name = ((idx.name >= 0 ? r[idx.name] : '') || cat).trim() || cat;
      if (ts == null || !(amount > 0)) { result.skipped++; return; }
      result.records.push({ ts, name, amount: Math.abs(amount), type, cat });
      if (!result.ledgerName && idx.who >= 0 && r[idx.who]) result.ledgerName = r[idx.who].trim();
    });
    return result;
  }

  function parseAmount(s) {
    if (s == null) return NaN;
    const n = parseFloat(String(s).replace(/[$,\s元NT]/g, ''));
    return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  }

  /* ---------- 紀錄 → CSV 文字 ---------- */
  function escapeField(v) {
    const s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function recordsToCSV(records, ledgerName) {
    const typeLabel = { expense: '支出', income: '收入' };
    const sorted = records.slice().sort((a, b) => a.ts - b.ts);
    const lines = [HEADER.join(',')];
    sorted.forEach(r => {
      lines.push([
        formatTime(r.ts),
        escapeField(r.name),
        formatAmount(r.amount),
        typeLabel[r.type] || r.type,
        escapeField(r.cat),
        escapeField(ledgerName || '')
      ].join(','));
    });
    return lines.join('\n');
  }

  function formatAmount(n) {
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  }

  /* ---------- 下載 ---------- */
  function download(filename, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  }

  global.CSV = { HEADER, decodeBytes, parseCSV, parseTime, formatTime, rowsToRecords, recordsToCSV, download };
})(window);
