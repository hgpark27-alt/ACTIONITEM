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

// 업무보고 형식: 텍스트(메모장/메신저용) + HTML(메일용, 완료는 빨강 취소선)
export function buildReport(items, today) {
  const groups = groupByDate(visibleItems(items, today));
  const text = [], html = [];
  for (const g of groups) {
    const head = g.date ? `[${dateLabel(g.date)}]` : '[Pending 업무]';
    text.push([head, ...g.items.map(fullTitle)].join('\n'));
    html.push(`<p><b>${esc(head)}</b></p><ul>` + g.items.map(it =>
      it.done
        ? `<li style="color:#d00000;text-decoration:line-through">${esc(fullTitle(it))}</li>`
        : `<li>${esc(fullTitle(it))}</li>`).join('') + '</ul>');
  }
  return { text: text.join('\n\n'), html: html.join('') };
}
