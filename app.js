import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getDatabase, ref, onValue, push, update, get, set } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';
import { ymd, parseQuickInput, dateLabel, fullTitle, visibleItems, groupByDate, buildReport,
  nameToKey, categoryList, categoryTree, renameCategory, cleanPath, catHue } from './core.js';

const db = getDatabase(initializeApp(firebaseConfig));
const app = document.getElementById('app');
const $ = id => app.querySelector('#' + id);     // #app 안에서 찾음 → 미니 창으로 옮겨가도 동작
const today = () => ymd(new Date());
const WD = ['일', '월', '화', '수', '목', '금', '토'];

const CAL = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/></svg>';
const TAG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8.6 1.8H13a1.2 1.2 0 0 1 1.2 1.2v4.4L7.6 14a1.2 1.2 0 0 1-1.7 0L2 10.1a1.2 1.2 0 0 1 0-1.7z"/><circle cx="10.8" cy="5.2" r="1"/></svg>';

let key = localStorage.getItem('ai-key');
let name = localStorage.getItem('ai-name');
let itemsRef = null, unsub = null;
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
    render();
  }, err => toast('DB 오류: ' + err.message));
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
function undo() {
  const before = undoStack.pop();
  if (!before) return toast('되돌릴 작업 없음');
  update(itemsRef, before);
}

// 입력 → 메모 맨 위에 쌓임 (날짜까지 적으면 바로 액션 아이템)
function addItem(text) {
  const p = parseQuickInput(text, today());
  if (!p.title) return;
  const now = Date.now();
  const data = { category: p.category, title: p.title, done: false, createdAt: now, updatedAt: now };
  if (p.date) {   // 바로 액션 아이템이 되는 경우만 빨강 (새 메모는 빨강 아님)
    const same = items.filter(i => !i.memo && i.date === p.date);
    Object.assign(data, { changed: true, date: p.date, order: same.length ? Math.max(...same.map(i => i.order ?? 0)) + 1 : 0 });
  } else {
    const memos = items.filter(i => i.memo);
    Object.assign(data, { memo: true, order: memos.length ? Math.min(...memos.map(i => i.order ?? 0)) - 1 : 0 });
  }
  write({ [push(itemsRef).key]: { __new: data } });
}
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
  return `<li class="item${i.done ? ' done' : ''}${i.memo ? ' memo' : ''}${i.changed ? ' changed' : ''}" data-id="${i.id}">
    <button class="chk" title="완료"></button>
    <div class="txt">${cat}<span class="title">${esc(i.title)}</span></div>
    <span class="act">
      <button data-a="cat" title="분류">${TAG}</button>
      <label class="calbtn" title="날짜">${CAL}<input type="date" data-a="date" value="${i.date || ''}"></label>
      <button data-a="del" title="삭제">✕</button>
    </span>
    <button class="mark" title="변경 표시"></button>
  </li>`;
}
// 끄는 동안 화면 아래에 뜨는 놓을 곳
function renderChips() {
  $('catChips').innerHTML = '<span class="chip" data-dropcat="">없음</span>' +
    categoryList(items).map(c => `<span class="chip catchip" data-dropcat="${esc(c)}">${catHtml(c)}</span>`).join('');
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
      patch(it.id, { ...f, changed: true });
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
function openPop(anchor, html, bind) {
  const pop = $('pop');
  pop.innerHTML = html; pop.hidden = false;
  const a = anchor.getBoundingClientRect(), base = app.getBoundingClientRect();
  pop.style.top = (a.bottom - base.top + 4) + 'px';
  pop.style.left = Math.max(0, Math.min(a.right - base.left - pop.offsetWidth, base.width - pop.offsetWidth)) + 'px';
  bind(pop);
}
const closePop = () => { $('pop').hidden = true; };

// 분류: 직접 입력(">"로 단계) 또는 목록에서 고르기, ✎로 이름 변경(하위 분류·모든 항목 함께)
function catPop(btn, it) {
  const tree = categoryTree(items);
  openPop(btn, `
    <input class="catin" value="${esc(it.category || '')}" placeholder="대분류 > 중분류 > 소분류">
    <div class="tree">
      <div class="node" data-path="">없음</div>
      ${tree.map(n => `<div class="node${n.path === it.category ? ' on' : ''}" data-path="${esc(n.path)}" style="padding-left:${8 + n.depth * 14}px">
        <i class="hue" style="--h:${catHue(n.name)}"></i><span>${esc(n.name)}</span><button class="ren" title="이름 변경">✎</button></div>`).join('')}
    </div>`, pop => {
    const apply = path => { if (cleanPath(path) !== (it.category || '')) patch(it.id, { category: cleanPath(path), changed: true }); closePop(); };
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
function acctPop(btn) {
  openPop(btn, `<div class="code">${esc(name)}</div><button data-a="out">로그아웃</button>`, pop => {
    pop.querySelector('[data-a=out]').onclick = () => {
      closePop(); localStorage.removeItem('ai-key'); localStorage.removeItem('ai-name'); key = name = null;
      if (unsub) { unsub(); unsub = null; } items = []; showLogin();
    };
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
      if (chip.dataset.dropcat !== (byId(id).category || '')) patch(id, { category: chip.dataset.dropcat, changed: true });
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
    if (!!prev.memo !== toMemo || (prev.date || null) !== newDate) ch[id].changed = true;   // 날짜·칸이 바뀌면 빨강 (순서만 바꾸면 그대로)
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
  const red = items.filter(i => i.changed);
  if (!red.length) return toast('복사됨');
  toast('복사됨', '빨강 모두 해제', () => write(Object.fromEntries(red.map(i => [i.id, { changed: null }]))));
}

/* ---------- 항상 위(핀): PC 앱이면 실제 창, 브라우저면 미니 창 ---------- */
const setPinned = on => $('pinBtn').classList.toggle('on', on);
const host = window.chrome && window.chrome.webview;   // PC 앱(ActionItem.exe) 안에서 실행 중이면 존재
if (host) {
  host.addEventListener('message', e => {
    if (e.data === 'focus') $('quick').focus();
    else if (e.data && 'pinned' in e.data) setPinned(e.data.pinned);
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
  if (!t.closest('#pop') && !t.closest('[data-a=cat]') && !t.closest('#acctBtn')) closePop();
  if (t.id === 'nameEnter') return enter($('nameInput').value);
  if (t.id === 'copyBtn') return copyReport();
  if (t.closest('#pinBtn')) return togglePin();
  if (t.closest('#acctBtn')) return acctPop(t.closest('#acctBtn'));
  if (t.id === 'oldBtn') { showOld = !showOld; return render(); }
  const li = t.closest('.item');
  if (!li) return;
  const it = byId(li.dataset.id); if (!it) return;
  if (t.closest('.chk')) return patch(it.id, { done: !it.done, doneAt: it.done ? null : Date.now() });
  if (t.closest('.mark')) return patch(it.id, { changed: it.changed ? null : true });   // 빨강 직접 켜기/끄기
  if (t.closest('[data-a=del]')) return deleteItem(it);
  if (t.closest('[data-a=cat]')) return catPop(t.closest('[data-a=cat]'), it);
  if (t.matches('input[data-a=date]')) { e.preventDefault(); try { t.showPicker(); } catch { } }   // 아이콘 바로 옆에 달력
});
// 달력에서 날짜 고르면 그 날짜 액션 아이템, 지우기 누르면 Pending
app.addEventListener('change', e => {
  if (!e.target.matches('input[data-a=date]')) return;
  const li = e.target.closest('.item');
  if (li) patch(li.dataset.id, { date: e.target.value || null, memo: null, changed: true });
});
app.addEventListener('dblclick', e => {
  const li = e.target.closest('.item');
  if (li && !e.target.closest('.chk, .act, .mark, input')) editRow(li);
});
app.addEventListener('pointerdown', e => {
  const li = e.target.closest('.item');
  if (li && e.button === 0 && !e.target.closest('.chk, .act, .mark, input')) pressItem(e, li);
});
// 꾹 누른 뒤·드래그 중엔 화면 스크롤 막기 (폰)
app.addEventListener('touchmove', e => { if (holding || dragging) e.preventDefault(); }, { passive: false });
app.addEventListener('contextmenu', e => { if (e.target.closest('.item')) e.preventDefault(); });
app.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.isComposing) return;
  if (e.target.id === 'quick') { addItem(e.target.value); e.target.value = ''; }
  if (e.target.id === 'nameInput') enter(e.target.value);
});
// Ctrl+Z: 글자 입력 중이면 글자 되돌리기, 아니면(입력칸이 비었을 때 포함) 마지막 작업 되돌리기
function onUndoKey(e) {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey || !key) return;
  const t = e.target;
  if (t.tagName === 'INPUT' && t.value !== '' && t.type !== 'date') return;
  e.preventDefault();
  undo();
}
document.addEventListener('keydown', onUndoKey);
document.getElementById('unpin').onclick = () => pipWin && pipWin.close();

// 자정이 지나면 "오늘" 기준 다시 계산
let lastDay = today();
setInterval(() => { if (today() !== lastDay) { lastDay = today(); render(); } }, 60000);
// 편집·드래그 중 미뤄둔 화면 갱신 처리
setInterval(() => { if (pending && !busy) render(); }, 300);

// 미니 창을 지원하지 않는 브라우저(폰 등)에서는 핀 버튼 숨김
if (!host && !('documentPictureInPicture' in window)) $('pinBtn').hidden = true;

if (key && name) start(); else showLogin();
