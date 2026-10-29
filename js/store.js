/* 資料層：所有資料只存在 localStorage，預設為空 */
(function (global) {
  'use strict';

  const KEY = 'simple-ledger.v1';

  /* 預設分類（與截圖一致）；紀錄資料一律為空 */
  const DEFAULT_CATEGORIES = {
    expense: ['飲食', '日常', '交通', '娛樂', '房租', '電信', '水電', '學習', '其他'],
    income: ['薪水', '獎金', '現金回饋', '其他']
  };

  const defaults = () => ({
    version: 1,
    ledgerName: '簡單記帳',
    categories: { expense: DEFAULT_CATEGORIES.expense.slice(), income: DEFAULT_CATEGORIES.income.slice() },
    records: [],          // { id, ts, name, amount, type: 'expense'|'income', cat }
    lastCat: { expense: '', income: '' },
    lastBackup: null,     // 時間戳
    lastReminder: null,   // 上次顯示備份提醒的日期 key
    overviewMode: 'chart' // 'chart' | 'list'
  });

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const data = JSON.parse(raw);
      const base = defaults();
      // 合併缺漏欄位，避免舊版本資料缺 key
      const merged = Object.assign(base, data);
      merged.categories = Object.assign(base.categories, data.categories || {});
      merged.lastCat = Object.assign(base.lastCat, data.lastCat || {});
      if (!Array.isArray(merged.records)) merged.records = [];
      return merged;
    } catch (e) {
      console.warn('讀取資料失敗，使用空白資料', e);
      return defaults();
    }
  }

  let saveTimer = null;
  function save(immediate) {
    const doSave = () => {
      try { localStorage.setItem(KEY, JSON.stringify(state)); }
      catch (e) { console.error('儲存失敗', e); global.App && global.App.toast && global.App.toast('儲存失敗：空間不足'); }
    };
    if (immediate) { clearTimeout(saveTimer); doSave(); return; }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, 50);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---- 紀錄 ---- */
  function addRecord(rec) {
    const r = { id: uid(), ts: rec.ts, name: rec.name, amount: rec.amount, type: rec.type, cat: rec.cat };
    state.records.push(r);
    save();
    return r;
  }
  function updateRecord(id, patch) {
    const r = state.records.find(x => x.id === id);
    if (!r) return null;
    Object.assign(r, patch);
    save();
    return r;
  }
  function deleteRecord(id) {
    const i = state.records.findIndex(x => x.id === id);
    if (i >= 0) { state.records.splice(i, 1); save(); }
  }
  function getRecord(id) { return state.records.find(x => x.id === id) || null; }

  /** 篩選：{ type, start, end, cat, keyword } */
  function query(opt) {
    opt = opt || {};
    const kw = (opt.keyword || '').trim().toLowerCase();
    return state.records.filter(r => {
      if (opt.type && r.type !== opt.type) return false;
      if (opt.start != null && r.ts < opt.start) return false;
      if (opt.end != null && r.ts > opt.end) return false;
      if (opt.cat && r.cat !== opt.cat) return false;
      if (kw && !(r.name || '').toLowerCase().includes(kw) && !(r.cat || '').toLowerCase().includes(kw)) return false;
      return true;
    });
  }

  /** 把一批紀錄併入（略過完全相同者），回傳新增筆數 */
  function mergeRecords(list) {
    const seen = new Set(state.records.map(sig));
    let added = 0;
    list.forEach(r => {
      const s = sig(r);
      if (seen.has(s)) return;
      seen.add(s);
      state.records.push({ id: uid(), ts: r.ts, name: r.name, amount: r.amount, type: r.type, cat: r.cat });
      added++;
    });
    ensureCategories(list);
    save(true);
    return added;
  }
  function replaceRecords(list) {
    state.records = list.map(r => ({ id: uid(), ts: r.ts, name: r.name, amount: r.amount, type: r.type, cat: r.cat }));
    ensureCategories(list);
    save(true);
    return state.records.length;
  }
  function sig(r) { return [r.ts, r.name, r.amount, r.type, r.cat].join('\u0001'); }
  function countDuplicates(list) {
    const seen = new Set(state.records.map(sig));
    return list.filter(r => seen.has(sig(r))).length;
  }
  /** 匯入時若出現不存在的分類，自動加入清單尾端 */
  function ensureCategories(list) {
    list.forEach(r => {
      const arr = state.categories[r.type];
      if (arr && r.cat && !arr.includes(r.cat)) arr.push(r.cat);
    });
  }

  /* ---- 分類 ---- */
  function getCategories(type) { return state.categories[type].slice(); }
  function setCategories(type, list, renames) {
    state.categories[type] = list.slice();
    // 改名時同步更新既有紀錄
    if (renames && renames.length) {
      state.records.forEach(r => {
        if (r.type !== type) return;
        renames.forEach(m => { if (r.cat === m.from) r.cat = m.to; });
      });
      if (renames.some(m => m.from === state.lastCat[type])) state.lastCat[type] = renames.find(m => m.from === state.lastCat[type]).to;
    }
    if (!list.includes(state.lastCat[type])) state.lastCat[type] = '';
    save(true);
  }
  function countByCategory(type, cat) { return state.records.filter(r => r.type === type && r.cat === cat).length; }

  /* ---- 其他設定 ---- */
  function get(key) { return state[key]; }
  function set(key, value) { state[key] = value; save(); }

  global.Store = {
    DEFAULT_CATEGORIES,
    get records() { return state.records; },
    addRecord, updateRecord, deleteRecord, getRecord, query,
    mergeRecords, replaceRecords, countDuplicates,
    getCategories, setCategories, countByCategory,
    get, set, save
  };
})(window);
