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
  const groups = groupByDate(visibleItems(items.filter(i => !i.memo && !i.noCopy), today));
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
// 노트 서식: 밑줄(u)·줄(div)·줄바꿈(br)만 허용. 다른 태그는 글자만 남기고, 속성은 모두 제거
export function cleanNoteHtml(html) {
  return String(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, m => m.replace(/<[^>]*>/g, ''))
    .replace(/<(\/?)([a-z0-9]+)\b[^>]*>/gi, (m, close, tag) => {
      const t = tag.toLowerCase() === 'p' ? 'div' : tag.toLowerCase();
      if (t === 'br') return close ? '' : '<br>';
      return t === 'u' || t === 'div' ? `<${close}${t}>` : '';
    })
    .replace(/<(?!\/?(?:u|div|br)>)/g, '&lt;');
}
// 노트 서식 → 줄글 (줄 = div, 빈 줄 = <div><br></div>)
export function noteHtmlToText(html) {
  return cleanNoteHtml(html)
    .replace(/<br><\/div>/g, '</div>')
    .replace(/<div>/g, '\n').replace(/<\/div>/g, '').replace(/<br>/g, '\n')
    .replace(/<\/?u>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/^\n/, '');
}
// 예전에 줄글로 저장된 노트 → 줄마다 div
export function textToNoteHtml(text) {
  const e = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return String(text).split(/\r?\n/).map(l => `<div>${l ? e(l) : '<br>'}</div>`).join('');
}

/* ---------- 주간업무 (월~금 반복 업무) ---------- */
// 저장 형식: 요일마다 [{t: 글, c: 직접 고른 성격(없으면 단어로 추측)}]. 예전 줄글도 읽음
const TIME_RE = /(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?=\s|$)/;
export function weekList(v) {
  if (Array.isArray(v)) return v.filter(x => x && String(x.t || '').trim()).map(x => (x.c ? { t: x.t, c: x.c } : { t: x.t }));
  const out = [];
  for (const raw of String(v || '').split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (out.length && /^([01]?\d|2[0-3]):[0-5]\d$/.test(l)) out[out.length - 1].t += ' ' + l;
    else out.push({ t: l });
  }
  return out;
}
export function weekSplit(t) {
  const m = String(t).match(TIME_RE);
  if (!m) return { time: '', text: String(t).trim() };
  return { time: m[1].padStart(2, '0') + ':' + m[2], text: String(t).replace(TIME_RE, ' ').replace(/\s+/g, ' ').trim() };
}
export const WEEK_CATS = ['meet', 'prep', 'send', 'etc'];
export function weekCat(it) {
  if (it.c && WEEK_CATS.includes(it.c)) return it.c;
  const t = String(it.t).toLowerCase();
  if (/회의|미팅|컨콜|콜|call|meeting|면담|ojt/.test(t)) return 'meet';
  if (/송부|메일|보고|발송|공유|제출|mail/.test(t)) return 'send';
  if (/자료|준비|정리|작성|검토|업뎃|업데이트/.test(t)) return 'prep';
  return 'etc';
}
export function weekSorted(list) {
  const r = list.map((x, i) => ({ ...x, i, time: weekSplit(x.t).time }));
  return [...r.filter(x => x.time).sort((a, b) => a.time.localeCompare(b.time) || a.i - b.i), ...r.filter(x => !x.time)];
}
// 얇은 띠에 보일 앞 글자: 한글 두 글자 폭만큼 (영문·숫자는 좁아서 세 글자)
export function weekShort(t) {
  let out = '', w = 0;
  for (const ch of weekSplit(t).text.replace(/\s+/g, '')) {
    const cw = /[ᄀ-￿]/.test(ch) ? 3 : 2;   // 한글 3 · 영문 2 (한글 두 글자 = 6)
    if (w + cw > 6) break;
    out += ch; w += cw;
  }
  return out;
}

/* 헤더 시계: 미국 지역 현재 시각 (서머타임은 시간대 이름으로 자동 반영) */
const WORLD_CLOCKS = [['LV', '라스베가스', 'America/Los_Angeles'], ['MN', '미네소타', 'America/Chicago'], ['NY', '뉴욕', 'America/New_York']];
export function worldClocks(now = new Date()) {
  return WORLD_CLOCKS.map(([city, name, timeZone]) => ({
    city, name, time: new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now),
  }));
}

/* 빨강(변경 표시)은 켠 지 12시간 지나면 자동으로 꺼짐. changed = 켠 시각(ms). 예전 true 는 지금부터 셈 */
export const RED_TTL = 12 * 60 * 60 * 1000;
export function redExpiry(items, now = Date.now()) {
  const u = {};
  for (const i of items) {
    if (i.changed === true) u[`${i.id}/changed`] = now;
    else if (typeof i.changed === 'number' && now - i.changed >= RED_TTL) u[`${i.id}/changed`] = null;
  }
  return u;
}
