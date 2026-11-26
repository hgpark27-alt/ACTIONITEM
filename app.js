import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getDatabase, ref, onValue, push, update, get, set } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';
import { ymd, parseQuickInput, dateLabel, fullTitle, visibleItems, groupByDate, buildReport,
  nameToKey, categoryList, categoryTree, renameCategory, cleanPath, catHue, toCSV, noteLines, cleanNoteHtml, textToNoteHtml, noteHtmlToText, weekList, weekSplit, weekCat, weekSorted, weekShort, WEEK_CATS, worldClocks, redExpiry, weekOccurs, weekCycles, weekCycleLabel, monthWeeks, weekTimeShort, recentCategories, weekSyncPlan } from './core.js';

const db = getDatabase(initializeApp(firebaseConfig));
const app = document.getElementById('app');
const $ = id => app.querySelector('#' + id);     // #app 안에서 찾음 → 미니 창으로 옮겨가도 동작
const today = () => ymd(new Date());
const WD = ['일', '월', '화', '수', '목', '금', '토'];

const CAL = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/></svg>';
const DEL = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
const TAG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8.6 1.8H13a1.2 1.2 0 0 1 1.2 1.2v4.4L7.6 14a1.2 1.2 0 0 1-1.7 0L2 10.1a1.2 1.2 0 0 1 0-1.7z"/><circle cx="10.8" cy="5.2" r="1"/></svg>';

let key = localStorage.getItem('ai-key');
let name = localStorage.getItem('ai-name');
let itemsRef = null, unsub = null, noteRef = null, noteUnsub = null;
let items = [];            // [{id, ...}]  memo:true = 메모, 아니면 액션 아이템
let showOld = false;
let busy = false, pending = false;   // 드래그·편집 중엔 다시 그리기를 미룸
let pipWin = null;

const win = () => app.ownerDocument.defaultView;   // 현재 #app이 있는 창 (메인 또는 미니 창)
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// 분류 단계마다 고유 색 배지 (같은 단어 = 같은 색)
const catHtml = c => c.split(' > ').map(w => `<span class="seg" style="--h:${catHue(w)}">${esc(w)}</span>`).join('');
const byId = id => items.find(i => i.id === id);
const strip = it => { const { id, ...d } = it; return d; };

/* ---------- 로그인 (이름 → 열쇠) ---------- */
function showLogin(msg = '') {
  $('main').hidden = true; $('login').hidden = false;
  $('loginMsg').textContent = msg;
  if (noteOn || drawer) setNoteOpen(false);   // 로그인 화면에선 노트 닫음 (PC 앱 창도 원래 폭)
  $('nameInput').focus();
}
async function enter(raw) {
  const n = raw.trim();
  if (n.length < 2) return showLogin('이름을 2글자 이상 입력하세요.');
  key = await nameToKey(n); name = n;
  localStorage.setItem('ai-key', key); localStorage.setItem('ai-name', n);
  await migrateOldCode();
  start();
}
// 예전 "계정 코드" 방식 데이터가 있으면 새 이름 자리로 한 번 옮김
async function migrateOldCode() {
  const old = localStorage.getItem('ai-code');
  if (!old) return;
  try {
    const [o, n] = await Promise.all([get(ref(db, `u/${old}/items`)), get(ref(db, `u/${key}/items`))]);
    if (o.exists() && !n.exists()) await set(ref(db, `u/${key}/items`), o.val());
    localStorage.removeItem('ai-code');
  } catch { }
}

/* ---------- DB 연결 ---------- */
function start() {
  $('login').hidden = true; $('main').hidden = false;
  $('who').textContent = name;
  if (unsub) unsub();
  itemsRef = ref(db, `u/${key}/items`);
  unsub = onValue(itemsRef, snap => {
    items = Object.entries(snap.val() || {}).map(([id, it]) => ({ id, ...it }));
    expireRed();
    itemsReady = true; syncWeek();
    render();
  }, err => toast('DB 오류: ' + err.message));
  startNote();
  startWeek();
  $('quick').focus();
}
onValue(ref(db, '.info/connected'), s => $('conn').classList.toggle('on', !!s.val()));

/* ---------- 쓰기 + 되돌리기(Ctrl+Z) ---------- */
// 모든 변경은 write()를 거침: 바뀌기 전 상태를 저장해 두고 그대로 되돌림
const undoStack = [];
function write(changes) {                     // changes: { id: {필드...} | null(삭제) | {__new: 데이터} }
  const before = {}, u = {};
  for (const [id, ch] of Object.entries(changes)) {
    const cur = byId(id);
    before[id] = cur ? strip(cur) : null;
    if (ch === null) u[id] = null;
    else if (ch.__new) u[id] = ch.__new;
    else for (const [f, v] of Object.entries({ ...ch, updatedAt: Date.now() })) u[`${id}/${f}`] = v;
  }
  undoStack.push(before);
  if (undoStack.length > 50) undoStack.shift();
  return update(itemsRef, u);
}
const patch = (id, fields) => write({ [id]: fields });
// 빨강 12시간 지나면 자동 해제 (되돌리기 기록 없이 바로 저장)
function expireRed() {
  const u = redExpiry(items);
  if (itemsRef && Object.keys(u).length) update(itemsRef, u);
}
function undo() {
  const before = undoStack.pop();
  if (!before) return toast('되돌릴 작업 없음');
  update(itemsRef, before);
}

// 입력 → 메모 맨 위에 쌓임 (날짜까지 적으면 바로 액션 아이템)
// 여러 줄을 한 번에 넣으면 적힌 순서 그대로, Ctrl+Z 한 번에 모두 취소
// to: 생략 = 메모(날짜 적었으면 그 날짜) / { date } = 그 날짜 칸(null = Pending)으로 바로
function addItems(texts, to) {
  const now = Date.now(), ch = {};
  const memoTop = Math.min(0, ...items.filter(i => i.memo).map(i => i.order ?? 0));
  const lastOrder = {};
  const ps = texts.map(t => parseQuickInput(t, today())).filter(p => p.title);
  ps.forEach((p, k) => {
    const data = { category: p.category, title: p.title, done: false, createdAt: now + k, updatedAt: now };
    const date = to ? (p.date || to.date || null) : p.date;
    if (to || p.date) {   // 바로 액션 아이템이 되는 경우만 빨강 (새 메모는 빨강 아님)
      if (!(date in lastOrder)) lastOrder[date] = Math.max(-1, ...items.filter(i => !i.memo && (i.date || null) === date).map(i => i.order ?? 0));
      Object.assign(data, { changed: Date.now(), order: ++lastOrder[date] });
      if (date) data.date = date;
    } else Object.assign(data, { memo: true, order: memoTop - ps.length + k });
    ch[push(itemsRef).key] = { __new: data };
  });
  if (ps.length) write(ch);
  return ps.length;
}
const addItem = text => addItems([text]);
function deleteItem(it) {
  write({ [it.id]: null });
  toast('삭제됨', '되돌리기', undo);
}

/* ---------- 화면 그리기 ---------- */
function render() {
  if (busy) { pending = true; return; }
  pending = false;
  const t = today();

  // 메모 (완료한 메모는 당일까지만)
  const allMemos = items.filter(i => i.memo);
  const memos = (showOld ? allMemos : visibleItems(allMemos, t)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  $('memoCnt').textContent = memos.length || '';
  $('memoList').innerHTML = memos.map(row).join('');

  // 액션 아이템 (날짜별)
  const actions = items.filter(i => !i.memo);
  const groups = groupByDate(showOld ? actions : visibleItems(actions, t));
  if (!groups.some(g => g.date === t)) groups.push({ date: t, items: [] });       // 오늘·Pending 칸은 항상 (놓을 자리)
  if (!groups.some(g => g.date === null)) groups.push({ date: null, items: [] });
  groups.sort((a, b) => (a.date === null) - (b.date === null) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  $('list').innerHTML = groups.map(g => {
    let head;
    if (g.date) {
      const wd = WD[new Date(g.date + 'T00:00').getDay()];
      const tag = g.date === t ? '<span class="tag today">오늘</span>'
        : g.date < t && g.items.some(i => !i.done) ? '<span class="tag over">지남</span>' : '';
      head = `${dateLabel(g.date)} <span class="wd">${wd}</span>${tag}`;
    } else head = 'Pending 업무';
    const done = g.items.filter(i => i.done).length;
    const cnt = g.items.length ? `<span class="cnt">${done}/${g.items.length}</span>` : '';
    return `<section class="group" data-date="${g.date || ''}"><h2>${head}${cnt}</h2><ul class="items">${g.items.map(row).join('')}</ul></section>`;
  }).join('');
  const hidden = items.length - visibleItems(items, t).length;
  $('oldBtn').hidden = !hidden && !showOld;
  $('oldBtn').textContent = showOld ? '지난 완료 항목 숨기기' : `지난 완료 항목 ${hidden}건 보기`;
  renderChips();
}
function row(i) {
  const cat = i.category ? `<span class="cat">${catHtml(i.category)}</span>` : '';
  if (i.wk) return `<li class="item linked${i.done ? ' done' : ''}${i.noCopy ? ' nocopy' : ''}" data-id="${i.id}" title="주간업무에서 자동 · 위 달력에서 수정">
    <button class="chk" title="완료"></button>
    <div class="txt"><span class="wkmark">↻</span><span class="title">${esc(i.title)}</span></div>
    <span class="mark"></span>
    <button class="nocopy-dot" title="보고서 복사에서 제외"></button>
  </li>`;   // 주간업무에서 온 것: 흐리게, 완료·복사 제외만 가능
  return `<li class="item${i.done ? ' done' : ''}${i.memo ? ' memo' : ''}${i.changed ? ' changed' : ''}${i.noCopy ? ' nocopy' : ''}" data-id="${i.id}">
    <button class="chk" title="완료"></button>
    <div class="txt">${cat}<span class="title">${esc(i.title)}</span></div>
    <span class="act">
      <button data-a="cat" title="분류">${TAG}</button>
      <label class="calbtn" title="날짜">${CAL}<input type="date" data-a="date" value="${i.date || ''}"></label>
      <button data-a="del" title="삭제">${DEL}</button>
    </span>
    <button class="mark" title="변경 표시"></button>
    ${i.memo ? '' : '<button class="nocopy-dot" title="보고서 복사에서 제외"></button>'}
  </li>`;
}
// 끄는 동안 화면 아래에 뜨는 놓을 곳
function renderChips() {
  $('catChips').innerHTML = '<span class="chip" data-dropcat="">없음</span>' +
    recentCategories(items).map(c => `<span class="chip catchip" data-dropcat="${esc(c)}">${catHtml(c)}</span>`).join('');
}

/* ---------- 더블클릭 수정 ---------- */
function editRow(li) {
  const it = byId(li.dataset.id); if (!it) return;
  busy = true;
  const box = li.querySelector('.txt');
  box.innerHTML = '';
  const inp = li.ownerDocument.createElement('input');
  inp.value = fullTitle(it);
  box.append(inp); inp.focus();
  let closed = false;
  const finish = save => {
    if (closed) return; closed = true;
    busy = false;
    const v = inp.value.trim();
    if (save && v && v !== fullTitle(it)) {
      const p = parseQuickInput(v, today());
      const f = { category: p.category, title: p.title };
      if (p.date) Object.assign(f, { date: p.date, memo: null });   // 날짜를 적으면 그 날짜 액션 아이템으로
      patch(it.id, { ...f, changed: Date.now() });
    }
    render();
  };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing) finish(true);
    if (e.key === 'Escape') finish(false);
  });
  inp.addEventListener('blur', () => finish(true));
}

/* ---------- 팝업 (분류 / 계정) — 누른 아이콘 바로 옆에 뜸 ---------- */
let popAnchor = null;
function openPop(anchor, html, bind) {
  const pop = $('pop');
  if (!pop.hidden && popAnchor === anchor) return closePop();   // 같은 버튼 다시 누르면 닫기
  popAnchor = anchor;
  pop.innerHTML = html; pop.hidden = false;
  const a = anchor.getBoundingClientRect(), base = app.getBoundingClientRect();
  pop.style.top = (a.bottom - base.top + 4) + 'px';
  pop.style.left = Math.max(0, Math.min(a.right - base.left - pop.offsetWidth, base.width - pop.offsetWidth)) + 'px';
  bind(pop);
}
const closePop = () => { $('pop').hidden = true; popAnchor = null; };
// 팝업(설정·분류·계정) 밖 어디를 눌러도 닫힘 — 앱 바깥 여백 포함
function closePopOutside(e) {
  if ($('pop').hidden) return;
  if (e.target.closest && (e.target.closest('#pop') || (popAnchor && popAnchor.contains(e.target)))) return;
  closePop();
}
document.addEventListener('pointerdown', closePopOutside);

// 분류: 직접 입력(">"로 단계) 또는 목록에서 고르기, ✎로 이름 변경(하위 분류·모든 항목 함께)
function catPop(btn, it) {
  const keep = new Set([...recentCategories(items), it.category || '']);   // 최근 쓴 분류 10개 (+ 지금 분류)
  const tree = categoryTree(items.filter(i => keep.has(i.category || '')));
  openPop(btn, `
    <input class="catin" value="${esc(it.category || '')}" placeholder="대분류 > 중분류 > 소분류">
    <div class="tree">
      <div class="node" data-path="">없음</div>
      ${tree.map(n => `<div class="node${n.path === it.category ? ' on' : ''}" data-path="${esc(n.path)}" style="padding-left:${8 + n.depth * 14}px">
        <i class="hue" style="--h:${catHue(n.name)}"></i><span>${esc(n.name)}</span><button class="ren" title="이름 변경">✎</button></div>`).join('')}
    </div>`, pop => {
    const apply = path => { if (cleanPath(path) !== (it.category || '')) patch(it.id, { category: cleanPath(path), changed: Date.now() }); closePop(); };
    const inp = pop.querySelector('.catin');
    inp.focus(); inp.select();
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) apply(inp.value); if (e.key === 'Escape') closePop(); });
    pop.querySelectorAll('.node').forEach(n => n.onclick = e => {
      if (e.target.closest('.ren') || e.target.closest('input')) return;
      apply(n.dataset.path);
    });
    pop.querySelectorAll('.ren').forEach(b => b.onclick = () => {
      const node = b.closest('.node'), from = node.dataset.path;
      const r = node.ownerDocument.createElement('input');
      r.className = 'catin'; r.value = from;
      node.replaceWith(r); r.focus(); r.select();
      r.addEventListener('keydown', e => {
        if (e.key === 'Escape') closePop();
        if (e.key !== 'Enter' || e.isComposing) return;
        const map = renameCategory(items, from, r.value);
        if (Object.keys(map).length && cleanPath(r.value)) {
          write(Object.fromEntries(Object.entries(map).map(([id, c]) => [id, { category: c }])));
          toast(`${Object.keys(map).length}개 항목 분류 변경`, '되돌리기', undo);
        }
        closePop();
      });
    });
  });
}
/* ---------- 설정 (톱니바퀴) ---------- */
const theme = () => localStorage.getItem('ai-theme') || 'light';
function applyTheme() {
  [document, pipWin && pipWin.document].forEach(d => { if (d) d.documentElement.dataset.theme = theme(); });
}
function setPop(btn) {
  const on = v => `<span class="ck">${v ? '✓' : ''}</span>`;
  openPop(btn, `
    <button data-s="export">${on(false)}데이터 내보내기 (엑셀)</button>
    <button data-s="dark">${on(theme() === 'dark')}다크 모드</button>
    ${host ? `<button data-s="auto">${on(autostart)}Windows 시작 시 자동 실행</button>` : ''}
    <div class="sep"></div>
    <button data-s="out">${on(false)}로그아웃 <small>${esc(name)}</small></button>`, pop => {
    pop.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
      const s = b.dataset.s;
      closePop();
      if (s === 'export') exportCSV();
      if (s === 'dark') { localStorage.setItem('ai-theme', theme() === 'dark' ? 'light' : 'dark'); applyTheme(); }
      if (s === 'auto') { host.postMessage(autostart ? 'autostart:off' : 'autostart:on'); toast(autostart ? '자동 실행 끔' : '자동 실행 켬'); }
      if (s === 'out') logout();
    });
  });
}
function exportCSV() {
  const blob = new Blob(['\uFEFF' + toCSV(items)], { type: 'text/csv;charset=utf-8' });   // BOM: 엑셀 한글 깨짐 방지
  const a = app.ownerDocument.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ActionItems_${today()}.csv`;
  app.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function logout() {
  localStorage.removeItem('ai-key'); localStorage.removeItem('ai-name'); key = name = null;
  if (unsub) { unsub(); unsub = null; } items = [];
  if (noteUnsub) { noteUnsub(); noteUnsub = null; } $('noteText').innerHTML = '';
  if (weekUnsub) { weekUnsub(); weekUnsub = null; } week = {}; renderWeek(); itemsReady = weekReady = false;
  showLogin();
}

function acctPop(btn) {
  openPop(btn, `<div class="code">${esc(name)}</div><button data-a="out">로그아웃</button>`, pop => {
    pop.querySelector('[data-a=out]').onclick = () => { closePop(); logout(); };
  });
}

/* ---------- 드래그: 항목 어디든 잡고 끌기 ---------- */
// 마우스: 5px 이상 움직이면 드래그 · 터치: 0.35초 꾹 누른 뒤 끌기(그냥 쓸면 스크롤)
let holding = false, dragging = false;
function pressItem(e, li) {
  const doc = li.ownerDocument, sx = e.clientX, sy = e.clientY;
  const touch = e.pointerType === 'touch';
  let held = !touch;
  const timer = touch ? setTimeout(() => { held = holding = true; li.classList.add('lift'); }, 350) : 0;
  const cleanup = () => {
    clearTimeout(timer); holding = false; li.classList.remove('lift');
    doc.removeEventListener('pointermove', mv); doc.removeEventListener('pointerup', cleanup); doc.removeEventListener('pointercancel', cleanup);
  };
  const mv = ev => {
    const d = Math.hypot(ev.clientX - sx, ev.clientY - sy);
    if (!held) { if (d > 8) cleanup(); return; }
    if (d > 5) { cleanup(); startDrag(ev, li, sy); }
  };
  doc.addEventListener('pointermove', mv); doc.addEventListener('pointerup', cleanup); doc.addEventListener('pointercancel', cleanup);
}

function startDrag(e, li, startY) {
  const doc = li.ownerDocument;
  busy = true; dragging = true; closePop();
  app.classList.add('dragging');     // 화면 아래 놓을 곳(칩) 표시
  const r = li.getBoundingClientRect();
  const offY = startY - r.top;
  const ghost = li.cloneNode(true);
  ghost.classList.add('ghost');
  Object.assign(ghost.style, { width: r.width + 'px', left: r.left + 'px', top: (e.clientY - offY) + 'px' });
  doc.body.append(ghost);
  li.classList.add('placeholder');
  let chip = null;

  const move = ev => {
    ghost.style.top = (ev.clientY - offY) + 'px';
    const el = doc.elementFromPoint(ev.clientX, ev.clientY);
    const c = el && el.closest('[data-dropcat]');
    if (chip !== c) { if (chip) chip.classList.remove('over'); chip = c; if (c) c.classList.add('over'); }
    if (c) return;
    const g = el && el.closest('.group');
    const ul = g && g.querySelector('.items');
    if (!ul) return;
    const after = [...ul.querySelectorAll('.item:not(.placeholder)')]
      .find(x => { const b = x.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
    if (after) ul.insertBefore(li, after); else ul.append(li);
  };
  const up = () => {
    doc.removeEventListener('pointermove', move);
    doc.removeEventListener('pointerup', up);
    ghost.remove(); li.classList.remove('placeholder');
    app.classList.remove('dragging');
    busy = false; dragging = false;
    const id = li.dataset.id;
    if (chip) {
      chip.classList.remove('over');
      if (chip.dataset.dropcat !== (byId(id).category || '')) patch(id, { category: chip.dataset.dropcat, changed: Date.now() });
      render();
      return;
    }
    const ul = li.parentElement;
    const zone = ul.closest('.group');
    const toMemo = zone.dataset.zone === 'memo';
    const ch = {};
    [...ul.querySelectorAll('.item')].forEach((x, i) => { ch[x.dataset.id] = { order: i }; });
    const prev = byId(id), newDate = toMemo ? null : (zone.dataset.date || null);
    Object.assign(ch[id], { memo: toMemo ? true : null, date: newDate });
    if (!!prev.memo !== toMemo || (prev.date || null) !== newDate) ch[id].changed = Date.now();   // 날짜·칸이 바뀌면 빨강 (순서만 바꾸면 그대로)
    write(ch);
    render();
  };
  doc.addEventListener('pointermove', move);
  doc.addEventListener('pointerup', up);
}

/* ---------- 보고서 복사 ---------- */
async function copyReport() {
  const { text, html } = buildReport(items, today());
  if (!text) return toast('복사할 항목 없음');
  const w = win();
  try {
    await w.navigator.clipboard.write([new w.ClipboardItem({
      'text/html': new Blob([`<div style="font-family:'맑은 고딕',sans-serif;font-size:10pt">${html}</div>`], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })]);
  } catch {
    await w.navigator.clipboard.writeText(text);
  }
  // 보고 후 빨강 한 번에 해제 (Ctrl+Z로 되돌리기 가능)
  const red = items.filter(i => i.changed && !i.noCopy);   // 복사에서 뺀 항목은 아직 보고 전이므로 빨강 유지
  if (!red.length) return toast('복사됨');
  toast('복사됨', '빨강 모두 해제', () => write(Object.fromEntries(red.map(i => [i.id, { changed: null }]))));
}

/* ---------- 항상 위(핀): PC 앱이면 실제 창, 브라우저면 미니 창 ---------- */
const setPinned = on => $('pinBtn').classList.toggle('on', on);
const host = window.chrome && window.chrome.webview;   // PC 앱(ActionItem.exe) 안에서 실행 중이면 존재
const drawer = !!(host && window.__aiStrip);             // 새 PC 앱: 노트 칸을 창 밖에 숨겨 두는 방식 지원 (옛 exe는 일반 화면처럼)
let autostart = false;
if (host) {
  host.addEventListener('message', e => {
    if (e.data === 'focus') $('quick').focus();
    else if (e.data && 'pinned' in e.data) { setPinned(e.data.pinned); autostart = !!e.data.autostart; }
  });
  host.postMessage('hello');
}

async function togglePin() {
  if (host) { host.postMessage('togglePin'); return; }
  if (pipWin) { pipWin.close(); return; }
  if (!('documentPictureInPicture' in window)) return toast('이 브라우저는 지원 안 함');
  pipWin = await documentPictureInPicture.requestWindow({ width: 400, height: 640 });
  const d = pipWin.document;
  d.title = 'Action Items';
  document.querySelectorAll('link[rel=stylesheet]').forEach(l => d.head.append(l.cloneNode(true)));
  d.body.append(app);
  d.addEventListener('keydown', onUndoKey);
  d.addEventListener('pointerdown', closePopOutside);
  d.addEventListener('pointerdown', closeNoteOutside);
  applyTheme();
  setPinned(true);
  document.getElementById('pipNote').hidden = false;
  pipWin.addEventListener('pagehide', () => {
    document.getElementById('home').append(app);
    pipWin = null;
    setPinned(false);
    document.getElementById('pipNote').hidden = true;
  });
  $('quick').focus();
}

/* ---------- 주간업무 (이번 달 월~금 달력: 이번 주만 크게, 날짜 누르면 작은 창) ---------- */
// u/{key}/week/{mon..fri} = [{t: 글, c: 성격, r: 반복, a: 반복 기준 날짜}]. 한 줄 = 업무 하나, 시간 있으면 시간순
let weekUnsub = null;
let week = {};              // 요일 → 업무 목록
let wpop = null;            // 열린 작은 창 {date, edit: 고치는 줄 번호(-1 = 새 줄), cyc: 새 줄 반복, draft: 새 줄 쓰던 글}
let wpDown = false, wpRendering = false;   // 다시 그리는 중 입력칸이 빠지는 건 "바깥 누름" 아님         // 창 안을 누르는 중 (그 사이 저장해도 화면은 클릭 처리 뒤에 다시 그림)
const WDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WD_KO = ['월', '화', '수', '목', '금'];
const wdOf = date => WDAYS[(new Date(date + 'T00:00').getDay() + 6) % 7];
const plusDays = (date, n) => ymd(new Date(new Date(date + 'T00:00').getTime() + n * 864e5));
function startWeek() {
  if (weekUnsub) weekUnsub();
  weekUnsub = onValue(ref(db, `u/${key}/week`), snap => {
    const v = snap.val() || {};
    WDAYS.forEach(d => { week[d] = weekList(v[d]); });
    // 번호 없는 예전 업무엔 고유 번호 (요일+글로 정해서 PC·폰이 같이 붙여도 같은 번호)
    WDAYS.forEach(d => { if (week[d].some(x => !x.id)) saveWeekDay(d, week[d].map(x => x.id ? x : { id: d + hashText(x.t), ...x })); });
    weekReady = true; syncWeek();
    renderWeek();
    if (wpop && wpop.edit === null) renderWpop();   // 쓰는 중엔 덮어쓰지 않음
  });
  setWeekOpen(localStorage.getItem('ai-week') === '1');
}
// 그날 하는 업무 (반복 맞는 것만, 시간순)
const dayItems = date => weekSorted(week[wdOf(date)] || []).filter(x => weekOccurs(x, date));
function wrowHtml(x) {
  const s = weekSplit(x.t);
  return `<li class="wrow" data-c="${weekCat(x)}" title="${esc(x.t)}"><span class="wdot"></span><span class="wt">${esc(s.text)}</span>${s.time ? `<span class="wtime">${weekTimeShort(s.time)}</span>` : ''}<span class="wsh">${esc(weekShort(x.t))}</span></li>`;
}
function renderWeek() {
  const el = $('week'), t = today(), weeks = monthWeeks(t);
  let cur = weeks.findIndex(w => t < plusDays(w[0], 7));
  if (cur < 0) cur = weeks.length - 1;
  const mon = t.slice(0, 7);
  el.innerHTML = `<div class="whead">${WD_KO.map(d => `<span>${d}</span>`).join('')}</div>` + weeks.map((w, wi) =>
    `<div class="wweek${wi === cur ? ' cur' : ''}">${w.map((date, i) => {
      const cls = (date === t ? ' today' : '') + (date < t ? ' past' : '') + (date.slice(0, 7) !== mon ? ' out' : '');
      return `<div class="wcell${cls}" data-date="${date}"><b><i>${WD_KO[i]}</i><span>${+date.slice(8)}</span></b><ul class="wlist">${dayItems(date).map(wrowHtml).join('')}</ul></div>`;
    }).join('')}</div>`).join('');
  el.style.setProperty('--wh', (20 + 118 + (weeks.length - 1) * 26) + 'px');   // 머리 + 이번 주 + 나머지 주
}
function setWeekOpen(on) {
  localStorage.setItem('ai-week', on ? '1' : '0');
  $('week').classList.toggle('open', on);
  $('weekBtn').classList.toggle('on', on);
  if (!on && wpop) closePop();
}
const hashText = t => { let h = 2166136261; for (const ch of t) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const markWeekToday = renderWeek;   // 자정 지나면 오늘·이번 주 다시 계산

// 주간업무 → 액션 아이템 연동: 위 달력이 원본, 아래 액션 아이템은 7일 안의 것만 따라감 (아래에선 수정 불가)
// 켤 때 · 주간업무나 액션 아이템이 바뀔 때 · 날짜 바뀔 때 맞춤. 번호가 정해져 있어 PC·폰이 같이 해도 하나만
let itemsReady = false, weekReady = false, legacyCleaned = false;
function syncWeek() {
  if (!key || !itemsReady || !weekReady) return;
  const u = weekSyncPlan(week, items, today());
  if (Object.keys(u).length) update(itemsRef, u);
  if (!legacyCleaned) { legacyCleaned = true; set(ref(db, `u/${key}/weekSent`), null); }   // 예전 방식의 보낸 기록은 이제 안 씀
}

// 날짜 누르면 그날 업무 전부 보이는 작은 창: 추가·수정·삭제·성격·반복
function openWpop(cell) {
  const date = cell.dataset.date;
  openPop(cell, '<div class="wpop"></div>', pop => {
    wpop = { date, edit: -1, cyc: '', draft: '' };
    const box = pop.querySelector('.wpop');
    box.addEventListener('click', wpopClick);
    box.addEventListener('keydown', wpopKey);
    box.addEventListener('focusout', e => { if (!wpRendering && e.target.classList.contains('win')) wpopCommit(e.target, false, wpDown); });
    box.addEventListener('pointerdown', e => {
      wpDown = true;
      if (e.target.closest('.new .wcyc')) e.preventDefault();   // 새 줄 반복 고를 땐 입력칸 그대로
    });
    renderWpop();
  });
}
function renderWpop() {
  const box = !$('pop').hidden && $('pop').querySelector('.wpop');
  if (!box || !wpop) { wpop = null; return; }
  const { date, edit } = wpop, d = new Date(date + 'T00:00');
  const cyc = r => weekCycles(date).find(c => c.r === r) || weekCycles(date)[0];
  const inp = (v, ph = '') => `<input class="win" value="${esc(v)}" placeholder="${ph}" autocomplete="off" spellcheck="false">`;
  wpRendering = true;
  box.innerHTML = `<div class="wp-h">${d.getMonth() + 1}월 ${d.getDate()}일 (${WD_KO[(d.getDay() + 6) % 7]})</div><ul>` +
    dayItems(date).map(x => {
      if (edit === x.i) return `<li class="wprow editing" data-i="${x.i}">${inp(x.t)}</li>`;
      const s = weekSplit(x.t);
      return `<li class="wprow" data-i="${x.i}" data-c="${weekCat(x)}"><button class="wdot" title="성격"></button><span class="wt">${esc(s.text)}</span>${s.time ? `<span class="wtime">${weekTimeShort(s.time)}</span>` : ''}<button class="wcyc${x.r ? ' on' : ''}" title="반복">${weekCycleLabel(x)}</button></li>`;
    }).join('') +
    (edit === -1 ? `<li class="wprow editing new">${inp(wpop.draft, '+ 추가')}<button class="wcyc${wpop.cyc ? ' on' : ''}" title="반복">${cyc(wpop.cyc).label}</button></li>` : '<li class="wpadd">+</li>') + '</ul>';
  wpRendering = false;
  const i = box.querySelector('.win');
  if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
const nextCyc = (date, r) => { const cs = weekCycles(date), k = cs.findIndex(c => c.r === (r || '')); return cs[(k + 1) % cs.length].r; };
function saveWeekDay(d, list) {
  week[d] = list;
  if (key) set(ref(db, `u/${key}/week/${d}`), list.length ? list : null);
  renderWeek();
}
function withCyc(it, r, date) {
  const o = { ...it }; delete o.r; delete o.a;
  return r ? { ...o, r, a: date } : o;
}
// Enter·바깥 누름 = 저장 / 비우면 삭제 / 새 줄은 Enter 치면 다음 줄 바로 이어서
function wpopCommit(input, more, later) {
  if (!wpop || wpop.edit === null || !input.isConnected) return;
  const { date, edit, cyc } = wpop, d = wdOf(date), v = input.value.trim(), list = [...(week[d] || [])];
  wpop.edit = null; wpop.draft = ''; wpop.cyc = '';   // 다음 줄은 다시 매주부터
  if (edit >= 0 && !v) wpop.shifted = true;   // 지운 뒤라 줄 번호가 밀림 → 이번 클릭은 무시
  if (edit < 0) { if (v) list.push(withCyc({ id: push(ref(db, 'x')).key, t: v }, cyc, date)); }
  else if (!v) list.splice(edit, 1);
  else if (v !== list[edit].t) list[edit] = { ...list[edit], t: v };
  if (v || edit >= 0) saveWeekDay(d, list);
  if (more && edit < 0 && v) wpop.edit = -1;
  if (!later) renderWpop();
}
function wpopClick(e) {
  wpDown = false;
  if (!wpop) return;
  if (wpop.shifted) { wpop.shifted = false; return renderWpop(); }
  const t = e.target, row = t.closest('.wprow'), date = wpop.date, d = wdOf(date);
  if (t.closest('.wcyc')) {
    if (row.classList.contains('new')) { wpop.draft = row.querySelector('.win').value; wpop.cyc = nextCyc(date, wpop.cyc); return renderWpop(); }
    const list = [...week[d]], i = +row.dataset.i;
    list[i] = withCyc(list[i], nextCyc(date, list[i].r), date);
    saveWeekDay(d, list); return renderWpop();
  }
  if (t.closest('.wdot') && row) {
    const list = [...week[d]], i = +row.dataset.i;
    list[i] = { ...list[i], c: WEEK_CATS[(WEEK_CATS.indexOf(weekCat(list[i])) + 1) % WEEK_CATS.length] };
    saveWeekDay(d, list); return renderWpop();
  }
  if (t.closest('.wpadd')) { wpop.edit = -1; return renderWpop(); }
  if (row && !row.classList.contains('editing')) { wpop.edit = +row.dataset.i; return renderWpop(); }
  if (wpop.edit === null) renderWpop();   // 빈 곳 클릭: 저장 뒤 미뤄둔 화면 갱신
}
// 창 안에서 누르고 클릭 없이 끝나면(끌기 등) 미뤄둔 화면 갱신
document.addEventListener('pointerup', () => setTimeout(() => { if (wpDown) { wpDown = false; renderWpop(); } }, 0));
function wpopKey(e) {
  if (!e.target.classList.contains('win') || e.isComposing) return;
  if (e.key === 'Enter') { e.preventDefault(); wpopCommit(e.target, true); }
  if (e.key === 'Escape') { e.stopPropagation(); if (wpop.edit === -1 && !e.target.value) return closePop(); wpop.edit = null; renderWpop(); }
}

/* ---------- 노트 (왼쪽, RAW 메모) → 메모 → 액션 아이템 ---------- */
// 노트 글은 u/{key}/note 에 저장, PC·폰 실시간 동기화 (쓰는 중인 쪽은 덮어쓰지 않음)
let noteT = 0;
function startNote() {
  if (noteUnsub) noteUnsub();
  noteRef = ref(db, `u/${key}/note`);
  noteUnsub = onValue(noteRef, snap => {
    const el = $('noteText'), v = snap.val() || {};
    const html = v.html != null ? cleanNoteHtml(v.html) : textToNoteHtml(v.text || '');
    if (el.ownerDocument.activeElement !== el && !noteT && el.innerHTML !== html) el.innerHTML = html;
  });
  setNoteOpen(localStorage.getItem('ai-note') === '1');
}
function saveNote() {
  clearTimeout(noteT); noteT = 0;
  const el = $('noteText');
  if (noteRef) set(noteRef, { text: noteHtmlToText(el.innerHTML), html: cleanNoteHtml(el.innerHTML), at: Date.now() });
}
let noteOn = false;
function setNoteOpen(on) {
  noteOn = on;
  localStorage.setItem('ai-note', on ? '1' : '0');
  app.classList.toggle('note-open', on);
  $('noteBtn').classList.toggle('on', on);
  if (!drawer) { $('note').hidden = !on; return; }
  // PC 앱: 노트는 창 밖 왼쪽 칸에 미리 그려 두고, 창 가장자리만 부드럽게 늘였다 줄임
  if (on) $('note').hidden = false;
  else setTimeout(() => { if (!noteOn) $('note').hidden = true; }, 250);   // 줄어드는 동안은 보이게
  host.postMessage(on ? 'note:open' : 'note:close');
}
const noteOverlay = () => !drawer && win().matchMedia('(max-width: 759px)').matches;   // 좁은 창: 내용 위에 덮는 방식
// 커서가 있는 줄(또는 선택한 줄들) → 메모로 보내고 노트에서는 지움 (Ctrl+Z로 노트 글 복구 가능)
// 노트 한 줄 = div 하나. 맨 윗줄처럼 div 없이 적힌 글은 먼저 div로 감쌈
function noteBlocks(el) {
  let line = null;
  [...el.childNodes].forEach(n => {
    if (n.nodeName === 'DIV') { line = null; return; }
    if (!line) { line = el.ownerDocument.createElement('div'); el.insertBefore(line, n); }
    line.append(n);
    if (n.nodeName === 'BR') line = null;
  });
  return [...el.children];
}
function sendNote() {
  const el = $('noteText'), doc = el.ownerDocument, sel = doc.getSelection();
  if (!sel.rangeCount || !el.contains(sel.anchorNode)) return;
  const range = sel.getRangeAt(0);
  const blocks = noteBlocks(el).filter(b => range.intersectsNode(b));
  if (!blocks.length || !addItems(noteLines(blocks.map(b => b.innerText).join('\n')))) return;
  const r = doc.createRange();
  r.setStartBefore(blocks[0]); r.setEndAfter(blocks[blocks.length - 1]);
  sel.removeAllRanges(); sel.addRange(r);
  doc.execCommand('delete');
  saveNote();
}
// 밑줄 (버튼 또는 Ctrl+U) — 노트 서식은 밑줄만
function underlineNote() {
  const doc = $('noteText').ownerDocument;
  doc.execCommand('styleWithCSS', false, false);
  doc.execCommand('underline');
}
// 노트에서 글을 선택해 끌어다 메모·날짜 칸에 놓기 (노트에서는 빠짐 = 이동)
app.addEventListener('dragover', e => {
  if (e.dataTransfer.types.includes('text/plain') && e.target.closest('#main') && !e.target.closest('#note, input')) e.preventDefault();
});
app.addEventListener('drop', e => {
  if (e.target.closest('#note, input') || !e.target.closest('#main')) return;
  e.preventDefault();
  const g = e.target.closest('#actionZone .group');
  addItems(noteLines(e.dataTransfer.getData('text/plain')), g ? { date: g.dataset.date || null } : undefined);
});
function closeNoteOutside(e) {
  if (!noteOn || !noteOverlay() || !e.target.closest) return;
  if (e.target.closest('#note, #noteBtn')) return;
  setNoteOpen(false);
}
document.addEventListener('pointerdown', closeNoteOutside);

/* ---------- 알림 (앱 안) ---------- */
let toastT;
function toast(msg, action, onAction) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  if (action) {
    const b = t.ownerDocument.createElement('button');
    b.textContent = action;
    b.onclick = () => { t.hidden = true; onAction(); };
    t.append(b);
  }
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, action ? 4000 : 2200);
}

/* ---------- 이벤트 (모두 #app에 걸어서 미니 창으로 옮겨도 동작) ---------- */
app.addEventListener('click', e => {
  const t = e.target;
  if (t.closest('#setBtn')) return setPop(t.closest('#setBtn'));
  if (t.closest('#noteBtn')) return setNoteOpen(!noteOn);
  if (t.closest('#weekBtn')) return setWeekOpen(!$('week').classList.contains('open'));
  if (t.closest('#week') && !$('week').classList.contains('open')) return setWeekOpen(true);   // 얇은 띠 누르면 펼침
  if (t.closest('#week .wcell')) return openWpop(t.closest('.wcell'));   // 날짜 누르면 그날 업무 작은 창
  if (t.closest('#noteU')) return underlineNote();
  if (t.id === 'nameEnter') return enter($('nameInput').value);
  if (t.id === 'copyBtn') return copyReport();
  if (t.closest('#pinBtn')) return togglePin();
  if (t.closest('#acctBtn')) return acctPop(t.closest('#acctBtn'));
  if (t.id === 'oldBtn') { showOld = !showOld; return render(); }
  const li = t.closest('.item');
  if (!li) return;
  const it = byId(li.dataset.id); if (!it) return;
  if (it.wk && !t.closest('.chk, .nocopy-dot')) return;   // 주간업무에서 온 것: 완료·복사 제외만
  if (t.closest('.chk')) return patch(it.id, { done: !it.done, doneAt: it.done ? null : Date.now(), ...(it.memo || it.wk ? {} : { changed: Date.now() }) });   // 액션 아이템 완료/해제도 변경(빨강)
  if (t.closest('.mark')) return patch(it.id, { changed: it.changed ? null : Date.now() });   // 빨강 직접 켜기/끄기
  if (t.closest('.nocopy-dot')) return patch(it.id, { noCopy: it.noCopy ? null : true });   // 검은 점: 보고서 복사에서 제외
  if (t.closest('[data-a=del]')) return deleteItem(it);
  if (t.closest('[data-a=cat]')) return catPop(t.closest('[data-a=cat]'), it);
  if (t.matches('input[data-a=date]')) { e.preventDefault(); try { t.showPicker(); } catch { } }   // 아이콘 바로 옆에 달력
});
// 달력에서 날짜 고르면 그 날짜 액션 아이템, 지우기 누르면 Pending
app.addEventListener('change', e => {
  if (!e.target.matches('input[data-a=date]')) return;
  const li = e.target.closest('.item');
  if (li) patch(li.dataset.id, { date: e.target.value || null, memo: null, changed: Date.now() });
});
app.addEventListener('dblclick', e => {
  const li = e.target.closest('.item');
  if (li && !li.classList.contains('linked') && !e.target.closest('.chk, .act, .mark, .nocopy-dot, input')) editRow(li);
});
app.addEventListener('pointerdown', e => {
  const li = e.target.closest('.item');
  if (li && e.button === 0 && !li.classList.contains('linked') && !e.target.closest('.chk, .act, .mark, .nocopy-dot, input')) pressItem(e, li);
});
// 꾹 누른 뒤·드래그 중엔 화면 스크롤 막기 (폰)
app.addEventListener('touchmove', e => { if (holding || dragging) e.preventDefault(); }, { passive: false });
app.addEventListener('contextmenu', e => { if (e.target.closest('.item')) e.preventDefault(); });
app.addEventListener('input', e => {
  if (e.target.id !== 'noteText') return;
  clearTimeout(noteT); noteT = setTimeout(saveNote, 400);
});
app.addEventListener('focusout', e => {
  if (e.target.id === 'noteText' && noteT) saveNote();
});
// 밑줄 버튼을 눌러도 노트의 선택이 풀리지 않게
app.addEventListener('pointerdown', e => { if (e.target.closest('#noteU')) e.preventDefault(); });
// 노트에 붙여넣기는 글자만 (다른 곳 서식은 버림)
app.addEventListener('paste', e => {
  if (e.target.closest && e.target.closest('#noteText')) { e.preventDefault(); e.target.ownerDocument.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }
});
// 노트: 굵게·기울임 단축키 막기 (밑줄만 허용)
app.addEventListener('keydown', e => {
  if (e.target.id !== 'noteText' || !(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'b' || k === 'i') e.preventDefault();
  if (k === 'u') { e.preventDefault(); underlineNote(); }
});
app.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.isComposing) return;
  if (e.target.id === 'noteText') { if (e.ctrlKey || e.metaKey) { e.preventDefault(); sendNote(); } return; }
  if (e.target.id === 'quick') { addItem(e.target.value); e.target.value = ''; }
  if (e.target.id === 'nameInput') enter(e.target.value);
});
// Ctrl+Z: 글자 입력 중이면 글자 되돌리기, 아니면(입력칸이 비었을 때 포함) 마지막 작업 되돌리기
function onUndoKey(e) {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey || !key) return;
  const t = e.target;
  if (t.tagName === 'INPUT' && t.value !== '' && t.type !== 'date') return;
  if (t.isContentEditable) return;   // 노트: 글자 되돌리기
  if (t.closest('.wpop')) return;   // 주간업무 입력칸: 글자 되돌리기
  e.preventDefault();
  undo();
}
document.addEventListener('keydown', onUndoKey);
document.getElementById('unpin').onclick = () => pipWin && pipWin.close();

// 자정이 지나면 "오늘" 기준 다시 계산
let lastDay = today();
setInterval(() => { if (today() !== lastDay) { lastDay = today(); render(); markWeekToday(); syncWeek(); } }, 60000);
setInterval(expireRed, 60000);
// 편집·드래그 중 미뤄둔 화면 갱신 처리
setInterval(() => { if (pending && !busy) render(); }, 300);

// 미니 창을 지원하지 않는 브라우저(폰 등)에서는 핀 버튼 숨김
if (!host && !('documentPictureInPicture' in window)) $('pinBtn').hidden = true;

applyTheme();
// 이름(로그인) 정보를 브라우저가 공간 정리 때 지우지 않도록 "보관 유지" 요청 (지원 브라우저만)
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });

if (key && name) start(); else showLogin();

// 헤더 시계 (LV · MN · NY)
function tickClocks() {
  const html = worldClocks().map(c => `<span title="${c.name}">${c.city} ${c.time}</span>`).join('');
  if ($('clocks').innerHTML !== html) $('clocks').innerHTML = html;
}
tickClocks();
setInterval(tickClocks, 1000);
