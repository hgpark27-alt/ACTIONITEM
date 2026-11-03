import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getDatabase, ref, onValue, push, update, remove } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';
import { ymd, parseQuickInput, parseDateToken, dateLabel, fullTitle, visibleItems, groupByDate, buildReport } from './core.js';

const db = getDatabase(initializeApp(firebaseConfig));
const app = document.getElementById('app');
const $ = id => app.querySelector('#' + id);     // #app 안에서 찾음 → 미니 창으로 옮겨가도 동작
const today = () => ymd(new Date());
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const CODE_RE = /^[a-z0-9_-]{8,}$/;

let code = localStorage.getItem('ai-code');
let itemsRef = null;
let items = [];            // [{id, ...}]
let showOld = false;
let busy = false;          // 드래그·편집 중엔 다시 그리기를 미룸
let pending = false;
let pipWin = null;

const win = () => app.ownerDocument.defaultView;   // 현재 #app이 있는 창 (메인 또는 미니 창)

/* ---------- 로그인 (계정 코드) ---------- */
function showLogin(msg = '') {
  $('main').hidden = true; $('login').hidden = false;
  $('loginMsg').textContent = msg;
  $('codeInput').focus();
}
function enter(c) {
  c = c.trim().toLowerCase();
  if (!CODE_RE.test(c)) return showLogin('영문 소문자·숫자 8자 이상으로 입력하세요.');
  code = c; localStorage.setItem('ai-code', c);
  start();
}
function newCode() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint8Array(12));
  return [...r].map(n => abc[n % abc.length]).join('');
}

/* ---------- DB 연결 ---------- */
let unsub = null;
function start() {
  $('login').hidden = true; $('main').hidden = false;
  if (unsub) unsub();
  itemsRef = ref(db, `u/${code}/items`);
  unsub = onValue(itemsRef, snap => {
    const v = snap.val() || {};
    items = Object.entries(v).map(([id, it]) => ({ id, ...it }));
    render();
  }, err => toast('DB 오류: ' + err.message));
  $('quick').focus();
}
onValue(ref(db, '.info/connected'), s => $('conn').classList.toggle('on', !!s.val()));

const touch = () => ({ updatedAt: Date.now() });
function patch(id, fields) { return update(ref(db, `u/${code}/items/${id}`), { ...fields, ...touch() }); }

function addItem(text) {
  const p = parseQuickInput(text, today());
  if (!p.title) return;
  const sameDay = items.filter(i => (i.date || null) === p.date);
  const order = sameDay.length ? Math.max(...sameDay.map(i => i.order ?? 0)) + 1 : 0;
  const now = Date.now();
  push(itemsRef, { ...p, done: false, order, createdAt: now, updatedAt: now });
  if (!p.date) toast('날짜가 없어 Pending에 넣었습니다');
}

/* ---------- 화면 그리기 ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function render() {
  if (busy) { pending = true; return; }
  pending = false;
  const t = today();
  const q = $('search').value.trim().toLowerCase();
  let list = items;
  if (q) list = list.filter(i => fullTitle(i).toLowerCase().includes(q));
  const vis = showOld || q ? list : visibleItems(list, t);
  const groups = groupByDate(vis);
  // 오늘과 Pending 칸은 비어 있어도 항상 보여줌 (끌어다 놓을 자리)
  if (!q) {
    if (!groups.some(g => g.date === t)) groups.push({ date: t, items: [] });
    if (!groups.some(g => g.date === null)) groups.push({ date: null, items: [] });
    groups.sort((a, b) => (a.date === null) - (b.date === null) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
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
    const rows = g.items.map(row).join('') || '<li class="empty">여기로 끌어다 놓기</li>';
    return `<section class="group" data-date="${g.date || ''}"><h2>${head}${cnt}</h2><ul class="items">${rows}</ul></section>`;
  }).join('');
  const hidden = items.length - visibleItems(items, t).length;
  $('oldBtn').hidden = !!q || (!hidden && !showOld);
  $('oldBtn').textContent = showOld ? '지난 완료 항목 숨기기' : `지난 완료 항목 ${hidden}건 보기`;
}
function row(i) {
  const cat = i.category ? `<span class="cat">${esc(i.category)} &gt; </span>` : '';
  return `<li class="item${i.done ? ' done' : ''}" data-id="${i.id}">
    <span class="grip" title="끌어서 순서·날짜 이동">⠿</span>
    <button class="chk" title="완료"></button>
    <div class="txt">${cat}<span class="title">${esc(i.title)}</span></div>
    <span class="act"><button data-a="date" title="날짜 변경">날짜</button><button data-a="del" title="삭제">✕</button></span>
  </li>`;
}
const byId = id => items.find(i => i.id === id);

/* ---------- 인라인 편집 ---------- */
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
      // 편집 때 날짜를 안 적으면 기존 날짜 유지
      patch(it.id, { category: p.category, title: p.title, date: p.date ?? it.date ?? null });
    }
    render();
  };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing) finish(true);
    if (e.key === 'Escape') finish(false);
  });
  inp.addEventListener('blur', () => finish(true));
}

/* ---------- 팝업 (날짜 / 계정) ---------- */
function openPop(anchor, html, bind) {
  const pop = $('pop');
  pop.innerHTML = html; pop.hidden = false;
  const a = anchor.getBoundingClientRect(), base = app.getBoundingClientRect();
  pop.style.top = (a.bottom - base.top + 4) + 'px';
  pop.style.left = Math.max(0, Math.min(a.right - base.left - 160, base.width - 170)) + 'px';
  bind(pop);
}
const closePop = () => { $('pop').hidden = true; };

function datePop(btn, it) {
  const t = today();
  openPop(btn, `
    <button data-d="${t}">오늘</button>
    <button data-d="${parseDateToken('내일', t)}">내일</button>
    <input type="date" value="${it.date || ''}">
    <button data-d="">Pending (날짜 없음)</button>`, pop => {
    pop.querySelectorAll('button').forEach(b => b.onclick = () => { patch(it.id, { date: b.dataset.d || null }); closePop(); });
    pop.querySelector('input').onchange = e => { if (e.target.value) { patch(it.id, { date: e.target.value }); closePop(); } };
  });
}
function acctPop(btn) {
  openPop(btn, `
    <div class="lbl">계정 코드 (다른 PC에서 이 코드 입력)</div>
    <div class="code">${esc(code)}</div>
    <button data-a="copy">코드 복사</button>
    <button data-a="out">로그아웃</button>`, pop => {
    pop.querySelector('[data-a=copy]').onclick = () => { win().navigator.clipboard.writeText(code); toast('코드를 복사했습니다'); closePop(); };
    pop.querySelector('[data-a=out]').onclick = () => {
      closePop(); localStorage.removeItem('ai-code'); code = null;
      if (unsub) { unsub(); unsub = null; } items = []; showLogin();
    };
  });
}

/* ---------- 드래그 (마우스·터치 공통, 미니 창에서도 동작) ---------- */
function startDrag(e, li) {
  e.preventDefault();
  const doc = li.ownerDocument;
  busy = true; closePop();
  const r = li.getBoundingClientRect();
  const offY = e.clientY - r.top;
  const ghost = li.cloneNode(true);
  ghost.classList.add('ghost', 'item');
  Object.assign(ghost.style, { width: r.width + 'px', left: r.left + 'px', top: r.top + 'px' });
  doc.body.append(ghost);
  li.classList.add('placeholder');

  const move = ev => {
    ghost.style.top = (ev.clientY - offY) + 'px';
    const el = doc.elementFromPoint(ev.clientX, ev.clientY);
    const ul = el?.closest('.group')?.querySelector('.items');
    if (!ul) return;
    ul.querySelector('.empty')?.remove();
    const after = [...ul.querySelectorAll('.item:not(.placeholder)')]
      .find(x => { const b = x.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
    if (after) ul.insertBefore(li, after); else ul.append(li);
  };
  const up = () => {
    doc.removeEventListener('pointermove', move);
    doc.removeEventListener('pointerup', up);
    ghost.remove(); li.classList.remove('placeholder');
    const ul = li.parentElement;
    const date = ul.closest('.group').dataset.date || null;
    const u = {};
    [...ul.querySelectorAll('.item')].forEach((x, i) => { u[`${x.dataset.id}/order`] = i; });
    u[`${li.dataset.id}/date`] = date;
    u[`${li.dataset.id}/updatedAt`] = Date.now();
    busy = false;
    update(itemsRef, u);
    render();
  };
  doc.addEventListener('pointermove', move);
  doc.addEventListener('pointerup', up);
}

/* ---------- 보고서 복사 ---------- */
async function copyReport() {
  const { text, html } = buildReport(items, today());
  if (!text) return toast('복사할 항목이 없습니다');
  const w = win();
  try {
    await w.navigator.clipboard.write([new w.ClipboardItem({
      'text/html': new Blob([`<div style="font-family:'맑은 고딕',sans-serif;font-size:10pt">${html}</div>`], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })]);
  } catch {
    await w.navigator.clipboard.writeText(text);
  }
  toast('보고서를 복사했습니다 · 메일에 붙여넣기 하세요');
}

/* ---------- 항상 위 미니 창 (크롬·엣지 Document Picture-in-Picture) ---------- */
async function togglePin() {
  if (pipWin) { pipWin.close(); return; }
  if (!('documentPictureInPicture' in window)) return toast('크롬 또는 엣지 최신 버전에서만 됩니다');
  pipWin = await documentPictureInPicture.requestWindow({ width: 400, height: 640 });
  const d = pipWin.document;
  d.title = 'Action Items';
  document.querySelectorAll('link[rel=stylesheet]').forEach(l => d.head.append(l.cloneNode(true)));
  d.body.append(app);
  $('pinBtn').textContent = '고정 해제';
  document.getElementById('pipNote').hidden = false;
  pipWin.addEventListener('pagehide', () => {
    document.getElementById('home').append(app);
    pipWin = null;
    $('pinBtn').textContent = '고정';
    document.getElementById('pipNote').hidden = true;
  });
  $('quick').focus();
}

/* ---------- 알림 ---------- */
let toastT;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2200);
}

/* ---------- 이벤트 (모두 #app에 걸어서 미니 창으로 옮겨도 동작) ---------- */
app.addEventListener('click', e => {
  const t = e.target;
  if (!t.closest('#pop') && !t.closest('[data-a=date]') && !t.closest('#acctBtn')) closePop();
  const li = t.closest('.item');
  if (t.id === 'codeEnter') return enter($('codeInput').value);
  if (t.id === 'codeNew') { $('codeInput').value = newCode(); return enter($('codeInput').value); }
  if (t.id === 'copyBtn') return copyReport();
  if (t.id === 'pinBtn') return togglePin();
  if (t.id === 'acctBtn') return acctPop(t);
  if (t.id === 'oldBtn') { showOld = !showOld; return render(); }
  if (!li) return;
  const it = byId(li.dataset.id); if (!it) return;
  if (t.closest('.chk')) return patch(it.id, { done: !it.done, doneAt: it.done ? null : Date.now() });
  if (t.closest('[data-a=del]')) { if (win().confirm(`삭제할까요?\n${fullTitle(it)}`)) remove(ref(db, `u/${code}/items/${it.id}`)); return; }
  if (t.closest('[data-a=date]')) return datePop(t, it);
  if (t.closest('.txt') && !t.closest('input')) return editRow(li);
});
app.addEventListener('pointerdown', e => {
  const g = e.target.closest('.grip');
  if (g) startDrag(e, g.closest('.item'));
});
app.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.isComposing) return;
  if (e.target.id === 'quick') { addItem(e.target.value); e.target.value = ''; }
  if (e.target.id === 'codeInput') enter(e.target.value);
});
app.addEventListener('input', e => { if (e.target.id === 'search') render(); });
document.getElementById('unpin').onclick = () => pipWin && pipWin.close();

// 자정이 지나면 "오늘" 기준 다시 계산
let lastDay = today();
setInterval(() => { if (today() !== lastDay) { lastDay = today(); render(); } }, 60000);
// 편집·드래그 중 미뤄둔 화면 갱신 처리
setInterval(() => { if (pending && !busy) render(); }, 300);

// 미니 창을 지원하지 않는 브라우저(폰 등)에서는 고정 버튼 숨김
if (!('documentPictureInPicture' in window)) $('pinBtn').hidden = true;

if (code && CODE_RE.test(code)) start(); else showLogin();
