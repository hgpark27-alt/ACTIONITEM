// 순수 로직 (화면·DB와 무관) — 테스트 대상

const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };

function validDate(y, m, d) {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? ymd(dt) : null;
}

// "오늘", "11/3", "@11-3", "2026-11-03" → "YYYY-MM-DD" (못 알아들으면 null)
export function parseDateToken(tok, today) {
  tok = tok.replace(/^@/, '');
  if (tok === '오늘') return today;
  if (tok === '내일') return addDays(today, 1);
  if (tok === '모레') return addDays(today, 2);
  let m = tok.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = tok.match(/^(\d{1,2})[\/-](\d{1,2})$/);
  if (m) {
    const y = +today.slice(0, 4);
    const r = validDate(y, +m[1], +m[2]);
    if (!r) return null;
    // 60일 넘게 지난 날짜면 내년으로 본다 (연말에 1월 일정 입력)
    return r < addDays(today, -60) ? validDate(y + 1, +m[1], +m[2]) : r;
  }
  return null;
}

// "Valicy > LED Signage > 할 일 11/3" → { category, title, date }
export function parseQuickInput(text, today) {
  const words = text.trim().split(/\s+/);
  let date = null;
  for (let i = words.length - 1; i >= 0; i--) {
    const d = parseDateToken(words[i], today);
    if (d) { date = d; words.splice(i, 1); break; }
  }
  const parts = words.join(' ').split('>').map(s => s.trim()).filter(Boolean);
  const title = parts.pop() || '';
  return { category: parts.join(' > '), title, date };
}

// 이름 → 저장 위치 열쇠 (같은 이름이면 어느 기기에서든 같은 열쇠)
export const normalizeName = s => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
export async function nameToKey(name) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode('actionitem:' + normalizeName(name)));
  return 'n' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}


const byRecent = (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
const uniq = arr => [...new Set(arr)];

// 카테고리 칩: 최근에 쓴 순서
export const categoryList = items =>
  uniq([...items].sort(byRecent).map(i => i.category).filter(Boolean));

// 분류 단어 → 고유 색상(hue 0~359). 같은 단어는 어느 기기에서든 같은 색
export function catHue(word) {
  let h = 2166136261;
  for (const ch of word.trim()) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 360;
}

// "A > B > C" 경로 정리 (공백·빈 단계 제거)
export const cleanPath = s => (s || '').split('>').map(x => x.trim()).filter(Boolean).join(' > ');

// 분류 트리: 상위 단계도 포함해 단계별로 정렬
export function categoryTree(items) {
  const paths = new Set();
  for (const it of items) {
    const parts = cleanPath(it.category).split(' > ').filter(Boolean);
    parts.forEach((_, i) => paths.add(parts.slice(0, i + 1).join(' > ')));
  }
  return [...paths]
    .sort((a, b) => { const x = a.split(' > '), y = b.split(' > ');
      for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i].localeCompare(y[i]);
      return x.length - y.length; })
    .map(path => { const parts = path.split(' > '); return { path, name: parts.at(-1), depth: parts.length - 1 }; });
}

// 분류 이름 변경: 자기 자신 + 하위 분류를 쓰는 항목 → {id: 새 분류}
export function renameCategory(items, from, to) {
  to = cleanPath(to);
  const out = {};
  for (const it of items) {
    const c = it.category || '';
    if (c === from) out[it.id] = to;
    else if (c.startsWith(from + ' > ')) out[it.id] = cleanPath(to + c.slice(from.length));
  }
  return out;
}

export const dateLabel = s => { const d = parseYmd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };
export const fullTitle = it => (it.category ? `${it.category} > ` : '') + it.title;

// 미완료는 전부, 완료는 (날짜가 오늘 이후) 또는 (오늘 완료) 인 것만
export function visibleItems(items, today) {
  return items.filter(it =>
    !it.done || (it.date && it.date >= today) || (it.doneAt && ymd(new Date(it.doneAt)) === today));
}

// 날짜 오름차순, Pending(null)은 맨 뒤, 그룹 안은 order 순
export function groupByDate(items) {
  const map = new Map();
  for (const it of items) {
    const k = it.date || null;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  return [...map.keys()]
    .sort((a, b) => (a === null) - (b === null) || (a < b ? -1 : a > b ? 1 : 0))
    .map(date => ({ date, items: map.get(date).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) }));
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 전체 데이터 내보내기 (엑셀에서 열리는 CSV)
export function toCSV(items) {
  const cell = v => { v = v == null ? '' : String(v); return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const day = t => (t ? ymd(new Date(t)) : '');
  const rows = [['구분', '날짜', '분류', '할 일', '완료', '변경표시', '완료일', '생성일']];
  const sorted = [...items].sort((a, b) => (!!a.memo - !!b.memo) || (a.date || '9').localeCompare(b.date || '9') || (a.order ?? 0) - (b.order ?? 0));
  for (const i of sorted)
    rows.push([i.memo ? '메모' : '액션', i.date || '', i.category || '', i.title, i.done ? 'Y' : '', i.changed ? 'Y' : '', i.done ? day(i.doneAt) : '', day(i.createdAt)]);
  return rows.map(r => r.map(cell).join(',')).join('\r\n');
}

// 업무보고 형식: 텍스트(메모장/메신저용) + HTML(메일용, 변경은 빨강, 완료는 빨강 취소선)
// 번호: 날짜 칸은 날짜가 바뀌어도 1, 2, 3… 이어서 / Pending은 1부터 다시
export function buildReport(items, today) {
  const groups = groupByDate(visibleItems(items.filter(i => !i.memo), today));
  const text = [], html = [];
  let n = 0;
  for (const g of groups) {
    if (!g.date) n = 0;
    const head = g.date ? `[${dateLabel(g.date)}]` : '[Pending 업무]';
    const lines = g.items.map(it => ({ it, line: `${++n}. ${fullTitle(it)}` }));
    text.push([head, ...lines.map(l => l.line)].join('\n'));
    html.push(`<p><b>${esc(head)}</b></p>` + lines.map(({ it, line }) => {
      const st = it.done ? ';color:#d00000;text-decoration:line-through' : it.changed ? ';color:#d00000' : '';
      return `<p style="margin:0${st}">${esc(line)}</p>`;
    }).join('') + '<p>&nbsp;</p>');
  }
  return { text: text.join('\n\n'), html: html.join('') };
}

/* ---------- 노트(RAW 메모) → 메모 항목 ---------- */
// 줄마다 하나의 항목. 빈 줄은 버리고 앞의 글머리(-, *, •, ·, 1. 1)) 제거
export function noteLines(text) {
  return String(text).split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
}
// 선택(또는 커서) 위치가 걸친 줄 전체의 범위. 뒤 줄바꿈까지 포함, 마지막 줄이면 앞 줄바꿈을 포함
export function lineRange(text, selStart, selEnd) {
  let start = text.lastIndexOf('\n', selStart - 1) + 1;
  let end = text.indexOf('\n', Math.max(selStart, selEnd - (selEnd > selStart && text[selEnd - 1] === '\n' ? 1 : 0)));
  if (end === -1) { end = text.length; if (start > 0) start -= 1; }
  else end += 1;
  return { start, end };
}
