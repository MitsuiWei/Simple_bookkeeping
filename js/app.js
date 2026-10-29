/* 主程式：畫面、互動、匯入匯出、備份提醒 */
(function () {
  'use strict';

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const { dateKey, fromDateKey, startOfDay, endOfDay, fmtSlash, fmtZh, fmtShortSlash, fmtRelative, fmtMoney, fmtPct, fmtExpr } = Fmt;

  const TYPE_LABEL = { expense: '支出', income: '收入' };
  const PLACEHOLDER = { expense: '花在哪裡？', income: '錢從哪裡來？' };
  /* 依排名給色（與截圖一致：第 1 名 tan、第 2 名 sage…） */
  const RANK_COLORS = ['#CEB99E', '#B3C1B4', '#BBB59B', '#C1B58B', '#C09E83', '#C7A99A', '#C9B0B8', '#B9C0C6', '#D3C4A2', '#AFC0B5', '#D4B8A6', '#C4C0A0'];

  const ui = {
    tab: 'add',            // 底部導覽：'add' | 'overview'
    sub: null,             // 'categories' | 'search' | 'settings' | 'edit' | null
    type: 'expense',       // 新增頁類型
    expr: '',              // 計算機運算式
    date: dateKey(Date.now()),
    edit: null,            // 編輯中的紀錄
    ovType: 'expense',
    preset: 'month',
    custom: null,          // 自訂區間 { start, end }
    catType: 'expense', catWork: [], catRenames: [],
    persisted: null
  };

  /* =====================================================
     共用：畫面切換、對話框、Toast
     ===================================================== */
  function showView(name) {
    $$('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + name));
    const tab = name === 'add' || name === 'overview' ? name : ui.tab;
    $$('.nav-btn').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));
    const active = $('#view-' + name + ' .view-scroll');
    if (active) active.scrollTop = 0;
  }

  /* 子畫面開啟時在瀏覽器歷史多放一筆，讓 Android 返回鍵 / 手勢能關閉子畫面而不是離開 App。
     任何時候最多只有一筆額外紀錄（subPushed），避免連續開關造成狀態錯亂。 */
  function openSub(name) {
    ui.sub = name;
    showView(name === 'edit' ? 'add' : name);
    try {
      if (!ui.subPushed) { history.pushState({ sub: true }, ''); ui.subPushed = true; }
      else history.replaceState({ sub: true }, '');
    } catch (e) { /* file:// 下可能失敗，忽略 */ }
  }

  /** 真正關閉子畫面 */
  function performClose() {
    if (!ui.sub) return;
    const was = ui.sub;
    ui.sub = null;
    if (was === 'edit') resetForm();
    if (was === 'categories') { ui.catWork = []; ui.catRenames = []; }
    showView(ui.tab);
    if (ui.tab === 'overview') renderOverview();
  }

  /** UI 上的返回鍵：先關畫面，再把多出來的歷史紀錄收回 */
  function goBack() {
    performClose();
    if (ui.subPushed) {
      ui.ignorePop = true;
      try { history.back(); } catch (e) { ui.ignorePop = false; }
    }
  }

  window.addEventListener('popstate', () => {
    if (ui.ignorePop) { ui.ignorePop = false; ui.subPushed = false; return; }
    ui.subPushed = false;
    if (ui.sub) performClose();
  });

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /**
   * 對話框（樣式沿用截圖 6 的匯出確認框）
   * opt: { text | html, body?: Element, buttons: [{ label, kind?: 'secondary'|'danger', onClick?(api) → 回傳 true 表示不關閉 }], dismissable?: boolean }
   */
  function showDialog(opt) {
    const root = $('#dialog-root');
    const scrim = document.createElement('div');
    scrim.className = 'dialog-scrim';
    const box = document.createElement('div');
    box.className = 'dialog';
    box.setAttribute('role', 'dialog');
    const text = document.createElement('div');
    text.className = 'dialog-text';
    if (opt.html) text.innerHTML = opt.html; else text.textContent = opt.text || '';
    box.appendChild(text);
    if (opt.body) box.appendChild(opt.body);
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    const api = { close() { scrim.remove(); }, el: box };
    (opt.buttons || []).forEach(b => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dialog-btn' + (b.kind ? ' is-' + b.kind : '');
      btn.textContent = b.label;
      btn.addEventListener('click', () => {
        const keep = b.onClick ? b.onClick(api) : false;
        if (keep !== true) api.close();
      });
      actions.appendChild(btn);
    });
    box.appendChild(actions);
    scrim.appendChild(box);
    scrim.addEventListener('click', e => { if (e.target === scrim && opt.dismissable !== false) api.close(); });
    root.appendChild(scrim);
    const input = box.querySelector('input[type="text"]');
    if (input) setTimeout(() => input.focus(), 50);
    return api;
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-show'), 1800);
  }

  function updateTitles() {
    const name = Store.get('ledgerName') || '簡單記帳';
    if (!ui.edit) $('#add-title').textContent = name;
    $('#ov-title').textContent = name + '總覽';
  }

  /* =====================================================
     新增 / 編輯紀錄
     ===================================================== */
  function currentCat() {
    const list = Store.getCategories(ui.type);
    const last = Store.get('lastCat')[ui.type];
    if (ui.edit && list.includes(ui.edit.cat)) return ui.edit.cat;
    return list.includes(last) ? last : (list[0] || '');
  }

  function renderAddCats() {
    const list = Store.getCategories(ui.type);
    const cur = currentCat();
    const box = $('#add-cats');
    box.innerHTML = list.map(c =>
      `<button type="button" class="chip chip-cat${c === cur ? ' is-active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`
    ).join('') + `<button type="button" class="chip chip-edit" id="add-edit-cats"><svg><use href="#i-edit"/></svg>編輯</button>`;
  }

  function setType(type) {
    ui.type = type;
    const seg = $('#add-seg');
    seg.dataset.active = type;
    $$('.seg-btn', seg).forEach(b => b.classList.toggle('is-active', b.dataset.type === type));
    $('#add-name').placeholder = PLACEHOLDER[type];
    renderAddCats();
  }

  function selectCat(cat) {
    const lastCat = Store.get('lastCat');
    lastCat[ui.type] = cat;
    Store.set('lastCat', lastCat);
    if (ui.edit) ui.edit.cat = cat;
    $$('.chip-cat').forEach(b => b.classList.toggle('is-active', b.dataset.cat === cat));
  }

  function updateAmount() {
    const el = $('#add-amount');
    const txt = fmtExpr(ui.expr) || '0';
    el.textContent = txt;
    el.style.fontSize = txt.length > 12 ? '24px' : txt.length > 9 ? '28px' : '';
  }

  function updateDateLabel() {
    $('#add-date-label').textContent = fmtRelative(fromDateKey(ui.date));
    $('#add-date').value = ui.date;
  }

  function pressKey(k) {
    if (k === 'OK') { submitRecord(); return; }
    if (k === 'AC') ui.expr = '';
    else if (k === 'BS') ui.expr = ui.expr.slice(0, -1);
    else if ('+-*/'.includes(k)) {
      if (!ui.expr) return;
      if (/[+\-*/]$/.test(ui.expr)) ui.expr = ui.expr.slice(0, -1) + k;
      else if (ui.expr.length < 24) ui.expr += k;
    } else if (k === '.') {
      const cur = ui.expr.split(/[+\-*/]/).pop();
      if (cur.includes('.')) return;
      ui.expr += cur === '' ? '0.' : '.';
    } else {
      const cur = ui.expr.split(/[+\-*/]/).pop();
      if (cur.replace('.', '').length >= 9 || ui.expr.length >= 24) return;
      if (cur === '0') ui.expr = ui.expr.slice(0, -1) + k;
      else ui.expr += k;
    }
    updateAmount();
  }

  /** 計算運算式（先乘除後加減） */
  function evaluate(expr) {
    const s = expr.replace(/[+\-*/]$/, '');
    if (!s) return 0;
    const tokens = s.match(/\d*\.?\d+|[+\-*/]/g);
    if (!tokens || tokens.length % 2 === 0) return NaN;
    const stack = [parseFloat(tokens[0])];
    for (let i = 1; i < tokens.length; i += 2) {
      const op = tokens[i], n = parseFloat(tokens[i + 1]);
      if (isNaN(n)) return NaN;
      if (op === '*') stack.push(stack.pop() * n);
      else if (op === '/') stack.push(stack.pop() / n);
      else { stack.push(op); stack.push(n); }
    }
    let total = stack[0];
    for (let j = 1; j < stack.length; j += 2) total = stack[j] === '+' ? total + stack[j + 1] : total - stack[j + 1];
    return Math.round(total * 100) / 100;
  }

  function submitRecord() {
    const amount = evaluate(ui.expr);
    if (!isFinite(amount) || amount <= 0) { toast('請輸入金額'); return; }
    const cat = currentCat();
    if (!cat) { toast('請先建立一個類別'); return; }
    const name = $('#add-name').value.trim() || cat;
    const dayStart = fromDateKey(ui.date);
    const clock = ui.edit ? new Date(ui.edit.ts) : new Date();
    const ts = dayStart + ((clock.getHours() * 60 + clock.getMinutes()) * 60 + clock.getSeconds()) * 1000;

    if (ui.edit) {
      Store.updateRecord(ui.edit.id, { ts, name, amount, type: ui.type, cat });
      toast('已更新 ' + fmtMoney(amount));
      goBack();
    } else {
      Store.addRecord({ ts, name, amount, type: ui.type, cat });
      toast('已儲存 ' + fmtMoney(amount));
      resetForm(true);
    }
    checkEmptyHints();
  }

  function resetForm(keepType) {
    const wasEdit = !!ui.edit;
    ui.edit = null;
    ui.expr = '';
    ui.date = dateKey(Date.now());
    $('#add-name').value = '';
    if (!keepType && wasEdit) setType(ui.type); else renderAddCats();
    updateAmount();
    updateDateLabel();
    $('#add-back').hidden = true;
    $('#add-delete').hidden = true;
    $('#btn-settings').hidden = false;
    updateTitles();
  }

  /** 從總覽 / 搜尋點選紀錄 → 編輯（補充設計：截圖未出現編輯畫面，沿用新增頁） */
  function openEdit(rec) {
    ui.edit = Object.assign({}, rec);
    ui.expr = String(rec.amount);
    ui.date = dateKey(rec.ts);
    setType(rec.type);
    $('#add-name').value = rec.name;
    updateAmount();
    updateDateLabel();
    $('#add-title').textContent = '編輯紀錄';
    $('#add-back').hidden = false;
    $('#add-delete').hidden = false;
    $('#btn-settings').hidden = true;
    openSub('edit');
  }

  function confirmDelete() {
    if (!ui.edit) return;
    const rec = ui.edit;
    showDialog({
      html: `要刪除「${escapeHtml(rec.name)}」${fmtMoney(rec.amount)} 這筆紀錄嗎？<small>刪除後無法復原。</small>`,
      buttons: [
        { label: '取消', kind: 'secondary' },
        { label: '刪除', kind: 'danger', onClick() { Store.deleteRecord(rec.id); toast('已刪除'); goBack(); } }
      ]
    });
  }

  function bindAddView() {
    $('#add-seg').addEventListener('click', e => {
      const b = e.target.closest('.seg-btn');
      if (b && b.dataset.type !== ui.type) {
        setType(b.dataset.type);
        if (ui.edit) ui.edit.type = b.dataset.type;
      }
    });
    $('#add-cats').addEventListener('click', e => {
      const edit = e.target.closest('#add-edit-cats');
      if (edit) { openCategories(ui.type); return; }
      const b = e.target.closest('.chip-cat');
      if (b) selectCat(b.dataset.cat);
    });
    $('#keypad').addEventListener('click', e => {
      const k = e.target.closest('.key');
      if (k) pressKey(k.dataset.k);
    });
    $('#add-date-btn').addEventListener('click', () => {
      const inp = $('#add-date');
      try { if (inp.showPicker) inp.showPicker(); else inp.click(); } catch (e) { inp.click(); }
    });
    $('#add-date').addEventListener('change', e => {
      if (fromDateKey(e.target.value) != null) { ui.date = e.target.value; updateDateLabel(); }
    });
    $('#add-name').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
    $('#btn-settings').addEventListener('click', openSettings);
    $('#add-back').addEventListener('click', goBack);
    $('#add-delete').addEventListener('click', confirmDelete);
  }

  /* =====================================================
     總覽
     ===================================================== */
  function getRange() {
    const now = Date.now();
    const d = new Date(now);
    switch (ui.preset) {
      case 'today': return { start: startOfDay(now), end: endOfDay(now) };
      case 'week': {
        const s = new Date(startOfDay(now));
        s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); // 週一為一週開始
        const e = new Date(s); e.setDate(e.getDate() + 6);
        return { start: s.getTime(), end: endOfDay(e.getTime()) };
      }
      case 'lastMonth':
        return { start: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), end: endOfDay(new Date(d.getFullYear(), d.getMonth(), 0).getTime()) };
      case 'custom':
        if (ui.custom) return ui.custom;
      /* falls through */
      default:
        return { start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), end: endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime()) };
    }
  }

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function recordRow(r) {
    return `<div class="rec-row" data-id="${r.id}">
      <div class="rec-main">
        <div class="rec-name">${escapeHtml(r.name)}</div>
        <div class="rec-meta"><span>${fmtSlash(r.ts)}</span><span class="rec-tag">${escapeHtml(r.cat)}</span></div>
      </div>
      <div class="rec-amount">${fmtMoney(r.amount)}</div>
    </div>`;
  }

  function renderOverview() {
    const { start, end } = getRange();
    $('#ov-range-text').innerHTML = `<span>${fmtZh(start)}</span><span class="range-to">至</span><span>${fmtZh(end)}</span>`;
    $$('#ov-presets .chip').forEach(c => c.classList.toggle('is-active', c.dataset.preset === ui.preset));
    const seg = $('#ov-seg');
    seg.dataset.active = ui.ovType;
    $$('.seg-btn', seg).forEach(b => b.classList.toggle('is-active', b.dataset.type === ui.ovType));

    const all = Store.query({ start, end });
    let income = 0, expense = 0;
    all.forEach(r => { if (r.type === 'income') income += r.amount; else expense += r.amount; });
    const total = ui.ovType === 'income' ? income : expense;
    $('#ov-total').textContent = fmtMoney(total);
    $('#ov-balance').textContent = fmtMoney(income - expense);

    const mode = Store.get('overviewMode');
    $('#ov-mode use').setAttribute('href', mode === 'list' ? '#i-listnum' : '#i-chart');

    const recs = all.filter(r => r.type === ui.ovType);
    const box = $('#ov-content');
    if (!recs.length) {
      // 補充設計：空狀態
      box.innerHTML = `<div class="empty">這段期間沒有${TYPE_LABEL[ui.ovType]}紀錄</div>`;
      return;
    }
    if (mode === 'list') {
      box.innerHTML = recs.sort((a, b) => b.ts - a.ts).map(recordRow).join('');
      return;
    }
    const groups = new Map();
    recs.forEach(r => groups.set(r.cat, (groups.get(r.cat) || 0) + r.amount));
    const rows = Array.from(groups.entries()).sort((a, b) => b[1] - a[1]);
    box.innerHTML = rows.map(([cat, amt], i) => {
      const pct = total ? amt / total * 100 : 0;
      const color = RANK_COLORS[i % RANK_COLORS.length];
      const width = Math.min(58 + pct * 2.36, 250);
      return `<div class="rank-row">
        <div class="rank-name"><i class="rank-bar" style="width:${width.toFixed(1)}px;background:${hexToRgba(color, .28)}"></i><span>${escapeHtml(cat)}</span></div>
        <div class="rank-amount">${fmtMoney(amt)}</div>
        <div class="rank-badge" style="background:${color}">${fmtPct(pct)}</div>
      </div>`;
    }).join('');
  }

  function openCustomRange() {
    const { start, end } = getRange();
    const body = document.createElement('div');
    body.className = 'dialog-dates';
    body.innerHTML = `<label>開始<input type="date" id="dlg-start" value="${dateKey(start)}"></label>
      <label>結束<input type="date" id="dlg-end" value="${dateKey(end)}"></label>`;
    showDialog({
      text: '自訂日期區間',
      body,
      buttons: [
        { label: '取消', kind: 'secondary' },
        {
          label: '確認', onClick(api) {
            let s = fromDateKey($('#dlg-start', api.el).value), e = fromDateKey($('#dlg-end', api.el).value);
            if (s == null || e == null) { toast('請選擇日期'); return true; }
            if (s > e) { const t = s; s = e; e = t; }
            ui.custom = { start: s, end: endOfDay(e) };
            ui.preset = 'custom';
            renderOverview();
          }
        }
      ]
    });
  }

  function exportRange() {
    const { start, end } = getRange();
    const recs = Store.query({ start, end });
    if (!recs.length) { toast('這段期間沒有紀錄'); return; }
    showDialog({
      text: `您要匯出所有自${fmtShortSlash(start)}至${fmtShortSlash(end)}的帳目嗎？`,
      buttons: [
        { label: '取消' },
        {
          label: '確認', onClick() {
            CSV.download(`簡單記帳_${dateKey(start)}_${dateKey(end)}.csv`, CSV.recordsToCSV(recs, Store.get('ledgerName')));
            toast('已匯出 ' + recs.length + ' 筆');
          }
        }
      ]
    });
  }

  function bindOverview() {
    $('#ov-seg').addEventListener('click', e => {
      const b = e.target.closest('.seg-btn');
      if (b && b.dataset.type !== ui.ovType) { ui.ovType = b.dataset.type; renderOverview(); }
    });
    $('#ov-presets').addEventListener('click', e => {
      const c = e.target.closest('.chip');
      if (!c) return;
      if (c.dataset.preset === 'custom') { openCustomRange(); return; }
      ui.preset = c.dataset.preset;
      renderOverview();
    });
    $('#ov-range').addEventListener('click', openCustomRange);
    $('#ov-mode').addEventListener('click', () => {
      Store.set('overviewMode', Store.get('overviewMode') === 'list' ? 'chart' : 'list');
      renderOverview();
    });
    $('#ov-export').addEventListener('click', exportRange);
    $('#ov-content').addEventListener('click', e => {
      const row = e.target.closest('.rec-row');
      if (row) { const rec = Store.getRecord(row.dataset.id); if (rec) openEdit(rec); }
    });
    $('#btn-search').addEventListener('click', openSearch);
  }

  /* =====================================================
     搜尋
     ===================================================== */
  const EMPTY_ILLU = `<svg class="empty-illu" viewBox="0 0 160 160" aria-hidden="true">
    <circle cx="84" cy="86" r="64" fill="#F2E1CD"/>
    <path d="M44 30h64a8 8 0 0 1 8 8v6H52v-6a8 8 0 0 1-8-8z" fill="#7E8072"/>
    <rect x="52" y="38" width="64" height="88" rx="4" fill="#FFFFFF"/>
    <rect x="63" y="52" width="36" height="5" rx="2.5" fill="#7E8072"/>
    <rect x="63" y="68" width="28" height="5" rx="2.5" fill="#7E8072"/>
    <rect x="63" y="84" width="22" height="5" rx="2.5" fill="#7E8072"/>
    <path d="M40 126h66a8 8 0 0 1 8 8v2H48a8 8 0 0 1-8-8z" fill="#7E8072"/>
    <circle cx="112" cy="96" r="19" fill="#FFFFFF" stroke="#7E8072" stroke-width="5"/>
    <path d="M126 110l14 14" stroke="#7E8072" stroke-width="7" stroke-linecap="round"/>
  </svg>`;

  function fillSearchCats() {
    const type = $('#search-type').value;
    const sel = $('#search-cat');
    const cur = sel.value;
    sel.innerHTML = '<option value="">所有類別</option>' + Store.getCategories(type).map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    if (Array.from(sel.options).some(o => o.value === cur)) sel.value = cur;
  }

  function renderSearch() {
    const kw = $('#search-input').value.trim();
    const type = $('#search-type').value;
    const cat = $('#search-cat').value;
    const months = +$('#search-period').value;
    const box = $('#search-results');
    if (!kw && !cat) { box.innerHTML = EMPTY_ILLU; return; }
    let start = null;
    if (months > 0) { const d = new Date(); d.setMonth(d.getMonth() - months); start = startOfDay(d.getTime()); }
    const recs = Store.query({ type, cat, keyword: kw, start }).sort((a, b) => b.ts - a.ts);
    box.innerHTML = recs.length ? recs.map(recordRow).join('') : '<div class="empty">找不到符合的紀錄</div>';
  }

  function openSearch() {
    $('#search-type').value = ui.ovType;
    fillSearchCats();
    renderSearch();
    openSub('search');
    setTimeout(() => $('#search-input').focus(), 250);
  }

  function bindSearch() {
    $('#search-back').addEventListener('click', goBack);
    $('#search-input').addEventListener('input', renderSearch);
    $('#search-type').addEventListener('change', () => { fillSearchCats(); renderSearch(); });
    $('#search-cat').addEventListener('change', renderSearch);
    $('#search-period').addEventListener('change', renderSearch);
    $('#search-results').addEventListener('click', e => {
      const row = e.target.closest('.rec-row');
      if (row) { const rec = Store.getRecord(row.dataset.id); if (rec) openEdit(rec); }
    });
  }

  /* =====================================================
     編輯類別（拖曳排序、改名、刪除、新增）
     ===================================================== */
  function openCategories(type) {
    ui.catType = type;
    ui.catWork = Store.getCategories(type);
    ui.catRenames = [];
    renderCatList();
    openSub('categories');
  }

  function renderCatList() {
    $('#cat-list').innerHTML = ui.catWork.map((c, i) =>
      `<div class="cat-card" data-index="${i}">
        <span class="cat-handle" aria-label="拖曳排序"><svg><use href="#i-drag"/></svg></span>
        <span class="cat-name">${escapeHtml(c)}</span>
      </div>`).join('');
  }

  function askCatName(opt) {
    const body = document.createElement('div');
    body.innerHTML = `<input class="dialog-input" type="text" maxlength="10" placeholder="類別名稱" value="${escapeHtml(opt.value || '')}">`;
    const buttons = [];
    if (opt.onDelete) buttons.push({ label: '刪除', kind: 'danger', onClick() { opt.onDelete(); } });
    buttons.push({ label: '取消', kind: 'secondary' });
    buttons.push({
      label: '儲存', onClick(api) {
        const v = $('input', api.el).value.trim();
        if (!v) { toast('請輸入名稱'); return true; }
        if (ui.catWork.some((c, i) => c === v && i !== opt.index)) { toast('已有相同名稱'); return true; }
        opt.onSave(v);
      }
    });
    showDialog({ text: opt.title, body, buttons });
  }

  function editCategory(index) {
    const name = ui.catWork[index];
    if (ui.sub !== 'categories' || typeof name !== 'string') return;
    askCatName({
      title: '編輯類別', value: name, index,
      onSave(v) {
        if (v === name) return;
        // 記錄改名，儲存時同步更新既有紀錄
        const prev = ui.catRenames.find(m => m.to === name);
        if (prev) prev.to = v; else ui.catRenames.push({ from: name, to: v });
        ui.catWork[index] = v;
        renderCatList();
      },
      onDelete() {
        const origin = (ui.catRenames.find(m => m.to === name) || {}).from || name;
        const n = Store.countByCategory(ui.catType, origin);
        const doDelete = () => { ui.catWork.splice(index, 1); ui.catRenames = ui.catRenames.filter(m => m.to !== name); renderCatList(); };
        if (!n) { doDelete(); return; }
        showDialog({
          html: `「${escapeHtml(name)}」已有 ${n} 筆紀錄。<small>刪除類別後，這些紀錄仍會保留原本的類別名稱。</small>`,
          buttons: [{ label: '取消', kind: 'secondary' }, { label: '刪除', kind: 'danger', onClick: doDelete }]
        });
      }
    });
  }

  function bindCategories() {
    const list = $('#cat-list');
    list.addEventListener('click', e => {
      if (e.target.closest('.cat-handle')) return;
      const card = e.target.closest('.cat-card');
      if (card) editCategory(+card.dataset.index);
    });
    $('#cat-add').addEventListener('click', () => {
      askCatName({ title: '新增類別', index: -1, onSave(v) { ui.catWork.push(v); renderCatList(); } });
    });
    $('#cat-save').addEventListener('click', () => {
      if (ui.sub !== 'categories') return;
      const list = ui.catWork.filter(c => typeof c === 'string' && c.trim());
      if (!list.length) { toast('至少要保留一個類別'); return; }
      Store.setCategories(ui.catType, list, ui.catRenames);
      toast('已儲存類別');
      renderAddCats();
      goBack();
    });
    $('#cat-back').addEventListener('click', goBack);

    /* 拖曳排序：以指標事件實作，手機與桌機皆可 */
    let drag = null;
    list.addEventListener('pointerdown', e => {
      const handle = e.target.closest('.cat-handle');
      if (!handle) return;
      const card = handle.closest('.cat-card');
      const cards = $$('.cat-card', list);
      const rect = card.getBoundingClientRect();
      const pitch = cards.length > 1 ? cards[1].getBoundingClientRect().top - cards[0].getBoundingClientRect().top : rect.height + 18;
      drag = { card, cards, index: +card.dataset.index, startY: e.clientY, pitch, target: +card.dataset.index };
      card.classList.add('is-dragging');
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* 部分瀏覽器不支援，忽略 */ }
      e.preventDefault();
    });
    list.addEventListener('pointermove', e => {
      if (!drag) return;
      const dy = e.clientY - drag.startY;
      drag.card.style.transform = `translateY(${dy}px)`;
      const target = Math.max(0, Math.min(drag.cards.length - 1, drag.index + Math.round(dy / drag.pitch)));
      drag.target = target;
      drag.cards.forEach((c, i) => {
        if (i === drag.index) return;
        let shift = 0;
        if (drag.index < target && i > drag.index && i <= target) shift = -drag.pitch;
        else if (drag.index > target && i >= target && i < drag.index) shift = drag.pitch;
        c.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    });
    const endDrag = () => {
      if (!drag) return;
      const { index, target } = drag;
      drag.cards.forEach(c => { c.style.transform = ''; c.classList.remove('is-dragging'); });
      drag = null;
      if (index !== target) {
        const [item] = ui.catWork.splice(index, 1);
        ui.catWork.splice(target, 0, item);
      }
      renderCatList();
    };
    list.addEventListener('pointerup', endDrag);
    list.addEventListener('pointercancel', endDrag);
  }

  /* =====================================================
     設定（補充設計）：帳本名稱、匯出備份、匯入 CSV
     ===================================================== */
  function renderSettings() {
    $('#set-ledger').value = Store.get('ledgerName') || '';
    const last = Store.get('lastBackup');
    $('#set-last-backup').textContent = last ? '上次備份：' + fmtSlash(last) : '尚未備份';
    $('#set-count').textContent = Store.records.length + ' 筆紀錄';
    $('#set-persist').textContent = ui.persisted === true ? '已啟用持久儲存' : ui.persisted === false ? '持久儲存未啟用' : '';
  }

  function openSettings() { renderSettings(); openSub('settings'); }

  function exportBackup() {
    const recs = Store.records;
    if (!recs.length) { toast('還沒有任何紀錄'); return; }
    const now = Date.now();
    CSV.download(`記帳備份_${dateKey(now)}.csv`, CSV.recordsToCSV(recs, Store.get('ledgerName')));
    Store.set('lastBackup', now);
    Store.save(true);
    renderSettings();
    toast('已匯出 ' + recs.length + ' 筆備份');
  }

  function importFile(file) {
    file.arrayBuffer().then(buf => {
      const { text, encoding } = CSV.decodeBytes(buf);
      const parsed = CSV.rowsToRecords(CSV.parseCSV(text));
      if (!parsed.records.length) {
        showDialog({ html: `找不到可匯入的紀錄。<small>編碼：${escapeHtml(encoding)}；略過 ${parsed.skipped} 列無法解析的資料。請確認檔案格式與匯出的 CSV 相同。</small>`, buttons: [{ label: '確定' }] });
        return;
      }
      const dup = Store.countDuplicates(parsed.records);
      const existing = Store.records.length;
      const notes = [];
      if (dup) notes.push(`其中 ${dup} 筆與現有紀錄相同，合併時會略過`);
      if (parsed.skipped) notes.push(`略過 ${parsed.skipped} 列無法解析`);
      showDialog({
        html: `檔案共 ${parsed.records.length} 筆紀錄（${escapeHtml(encoding)}）。要合併到現有的 ${existing} 筆，還是覆蓋？<small>${escapeHtml(notes.join('；'))}</small>`,
        dismissable: false,
        buttons: [
          { label: '取消', kind: 'secondary' },
          {
            label: '覆蓋', kind: 'danger', onClick() {
              const run = () => { const n = Store.replaceRecords(parsed.records); afterImport('已覆蓋，現有 ' + n + ' 筆'); };
              if (!existing) { run(); return; }
              showDialog({ text: `覆蓋會刪除目前的 ${existing} 筆紀錄，確定嗎？`, buttons: [{ label: '取消', kind: 'secondary' }, { label: '確定覆蓋', kind: 'danger', onClick: run }] });
            }
          },
          { label: '合併', onClick() { const n = Store.mergeRecords(parsed.records); afterImport('已合併，新增 ' + n + ' 筆'); } }
        ]
      });
      if (parsed.ledgerName && !Store.get('ledgerNameTouched')) {
        /* 帳本名稱維持使用者設定，不自動覆蓋；只記錄一次提示 */
      }
    }).catch(err => {
      console.error(err);
      showDialog({ text: '讀取檔案失敗，請再試一次。', buttons: [{ label: '確定' }] });
    });
  }

  function afterImport(msg) {
    toast(msg);
    renderSettings();
    renderAddCats();
    checkEmptyHints();
  }

  function bindSettings() {
    $('#settings-back').addEventListener('click', goBack);
    $('#set-ledger').addEventListener('change', e => {
      const v = e.target.value.trim() || '簡單記帳';
      e.target.value = v;
      Store.set('ledgerName', v);
      Store.set('ledgerNameTouched', true);
      updateTitles();
    });
    $('#set-export').addEventListener('click', exportBackup);
    $('#set-import').addEventListener('click', () => $('#set-file').click());
    $('#set-file').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) importFile(f);
      e.target.value = '';
    });
  }

  /* =====================================================
     備份提醒：超過 7 天未備份，每天最多提醒一次
     ===================================================== */
  function checkBackupReminder() {
    if (!Store.records.length) return;
    const last = Store.get('lastBackup');
    const days = last ? (Date.now() - last) / 86400000 : Infinity;
    if (days <= 7) return;
    const today = dateKey(Date.now());
    if (Store.get('lastReminder') === today) return;
    Store.set('lastReminder', today);
    showDialog({
      html: last
        ? `距離上次備份已超過 ${Math.floor(days)} 天。<small>資料只存在這個瀏覽器，建議定期匯出備份。</small>`
        : `你還沒有匯出過備份。<small>資料只存在這個瀏覽器，建議定期匯出備份。</small>`,
      buttons: [
        { label: '稍後', kind: 'secondary' },
        { label: '立即備份', onClick() { exportBackup(); } }
      ]
    });
  }

  function checkEmptyHints() { /* 預留：未來可在空資料時顯示引導 */ }

  /* =====================================================
     底部導覽與啟動
     ===================================================== */
  function bindNav() {
    $('#bottom-nav').addEventListener('click', e => {
      const b = e.target.closest('.nav-btn');
      if (!b) return;
      const tab = b.dataset.tab;
      if (ui.sub) { ui.sub = null; if (ui.edit) resetForm(); ui.catWork = []; ui.catRenames = []; }
      ui.tab = tab;
      showView(tab);
      if (tab === 'overview') renderOverview();
    });
  }

  function init() {
    bindAddView();
    bindOverview();
    bindSearch();
    bindCategories();
    bindSettings();
    bindNav();

    updateTitles();
    setType('expense');
    updateAmount();
    updateDateLabel();
    renderOverview();
    showView('add');

    // 請求持久儲存，降低瀏覽器自動清除資料的機率
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(ok => { ui.persisted = ok; }).catch(() => {});
    }
    // 離線支援
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker 註冊失敗', err));
    }
    // 回到前景時重新整理總覽（日期可能已改變）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && ui.tab === 'overview' && !ui.sub) renderOverview();
    });
    setTimeout(checkBackupReminder, 600);
  }

  window.App = { toast, showDialog };
  document.addEventListener('DOMContentLoaded', init);
})();
