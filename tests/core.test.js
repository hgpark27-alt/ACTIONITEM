import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickInput, dateLabel, visibleItems, groupByDate, buildReport,
  normalizeName, nameToKey, categoryList, categoryTree, renameCategory, catHue } from '../core.js';

const TODAY = '2026-11-03';

test('한 줄 입력: 카테고리 > 할 일 + 날짜', () => {
  assert.deepEqual(
    parseQuickInput('Valicy > LED Signage > Weekly meeting 진행 11/3', TODAY),
    { category: 'Valicy > LED Signage', title: 'Weekly meeting 진행', date: '2026-11-03' }
  );
});

test('한 줄 입력: 카테고리 없음, 날짜 없음 → Pending', () => {
  assert.deepEqual(
    parseQuickInput('27년 1Q 매출 작성', TODAY),
    { category: '', title: '27년 1Q 매출 작성', date: null }
  );
});

test('한 줄 입력: 오늘/내일/모레, @, YYYY-MM-DD', () => {
  assert.equal(parseQuickInput('보고 내일', TODAY).date, '2026-11-04');
  assert.equal(parseQuickInput('보고 모레', TODAY).date, '2026-11-05');
  assert.equal(parseQuickInput('오늘 보고', TODAY).date, '2026-11-03');
  assert.equal(parseQuickInput('보고 @11/10', TODAY).date, '2026-11-10');
  assert.equal(parseQuickInput('보고 2027-01-05', TODAY).date, '2027-01-05');
  assert.equal(parseQuickInput('보고 @11/10', TODAY).title, '보고');
});

test('한 줄 입력: 연말에 1월 날짜는 내년으로', () => {
  assert.equal(parseQuickInput('견적 1/5', '2026-12-20').date, '2027-01-05');
});

test('한 줄 입력: 제목 안의 숫자(EV1.0, 잘못된 날짜)는 건드리지 않음', () => {
  const r = parseQuickInput('Valicy > Pillar cabinet > EV1.0 PT 자료 보완', TODAY);
  assert.equal(r.title, 'EV1.0 PT 자료 보완');
  assert.equal(r.date, null);
  assert.equal(parseQuickInput('사양 13/40 확인', TODAY).date, null);
});

test('날짜 라벨', () => {
  assert.equal(dateLabel('2026-11-02'), '11월 2일');
});

test('보이는 항목: 미완료는 전부, 완료는 오늘 이후 날짜거나 오늘 완료한 것만', () => {
  const items = [
    { id: 'a', title: 'a', done: false, date: '2026-10-01' },
    { id: 'b', title: 'b', done: true, date: '2026-10-01', doneAt: Date.parse('2026-10-01T09:00:00') },
    { id: 'c', title: 'c', done: true, date: '2026-11-05', doneAt: Date.parse('2026-11-01T09:00:00') },
    { id: 'd', title: 'd', done: true, date: '2026-10-20', doneAt: Date.parse('2026-11-03T09:00:00') },
    { id: 'e', title: 'e', done: true, date: null, doneAt: Date.parse('2026-10-01T09:00:00') },
  ];
  assert.deepEqual(visibleItems(items, TODAY).map(i => i.id).sort(), ['a', 'c', 'd']);
});

test('날짜별 묶기: 날짜 오름차순, Pending 맨 뒤, 안에서는 order 순', () => {
  const groups = groupByDate([
    { id: 'p', date: null, order: 0 },
    { id: 'y', date: '2026-11-04', order: 2 },
    { id: 'x', date: '2026-11-04', order: 1 },
    { id: 'z', date: '2026-11-02', order: 5 },
  ]);
  assert.deepEqual(groups.map(g => g.date), ['2026-11-02', '2026-11-04', null]);
  assert.deepEqual(groups[1].items.map(i => i.id), ['x', 'y']);
});

test('보고서: 업무보고 형식 텍스트 + 완료는 빨강 취소선 HTML', () => {
  const items = [
    { id: '1', category: '', title: '27년 1Q 매출 작성', date: '2026-11-03', done: false, order: 0 },
    { id: '2', category: 'FBM', title: 'LED점등 불량 <update>', date: '2026-11-03', done: true, order: 1, doneAt: Date.parse('2026-11-03T10:00:00') },
    { id: '3', category: 'Valicy > LED Signage', title: 'Weekly meeting 진행', date: '2026-11-04', done: false, order: 0 },
    { id: '4', category: 'Valicy', title: 'Tariff Refund Invoice 입수', date: null, done: false, order: 0 },
  ];
  const r = buildReport(items, TODAY);
  assert.equal(r.text,
    '[11월 3일]\n27년 1Q 매출 작성\nFBM > LED점등 불량 <update>\n\n' +
    '[11월 4일]\nValicy > LED Signage > Weekly meeting 진행\n\n' +
    '[Pending 업무]\nValicy > Tariff Refund Invoice 입수');
  assert.match(r.html, /<li style="color:#d00000;text-decoration:line-through">FBM &gt; LED점등 불량 &lt;update&gt;<\/li>/);
  assert.match(r.html, /<p><b>\[Pending 업무\]<\/b><\/p>/);
});

test('이름 정규화: 앞뒤 공백·연속 공백·영문 대소문자 무시', () => {
  assert.equal(normalizeName('  Park  HG '), 'park hg');
  assert.equal(normalizeName('박혜근'), '박혜근');
});

test('이름 → 열쇠: 같은 이름은 항상 같은 열쇠, 다른 이름은 다른 열쇠', async () => {
  const a = await nameToKey('박혜근');
  assert.equal(a, await nameToKey(' 박혜근 '));
  assert.notEqual(a, await nameToKey('박혜근2'));
  assert.match(a, /^n[0-9a-f]{24}$/);
});


test('카테고리 칩: 최근에 쓴 순서, 중복·빈 값 제외', () => {
  const items = [
    { category: 'FBM', updatedAt: 1 },
    { category: '', updatedAt: 9 },
    { category: 'IGS', updatedAt: 5 },
    { category: 'FBM', updatedAt: 7 },
  ];
  assert.deepEqual(categoryList(items), ['FBM', 'IGS']);
});

test('보고서: 메모는 빠짐', () => {
  const items = [
    { id: '1', category: '', title: '메모 항목', date: null, memo: true, done: false, order: 0 },
    { id: '2', category: '', title: '액션', date: '2026-11-03', done: false, order: 0 },
  ];
  assert.equal(buildReport(items, TODAY).text, '[11월 3일]\n액션');
});

test('분류 트리: 상위 단계 자동 포함, 단계별 정렬, 깊이 표시', () => {
  const items = [{ category: 'Valicy > Pillar cabinet' }, { category: 'FBM' }, { category: 'Valicy > LED Signage > Teton' }, { category: '' }];
  assert.deepEqual(categoryTree(items), [
    { path: 'FBM', name: 'FBM', depth: 0 },
    { path: 'Valicy', name: 'Valicy', depth: 0 },
    { path: 'Valicy > LED Signage', name: 'LED Signage', depth: 1 },
    { path: 'Valicy > LED Signage > Teton', name: 'Teton', depth: 2 },
    { path: 'Valicy > Pillar cabinet', name: 'Pillar cabinet', depth: 1 },
  ]);
});

test('분류 이름 변경: 자기 자신과 하위 분류만 바뀜', () => {
  const items = [
    { id: 'a', category: 'Valicy' },
    { id: 'b', category: 'Valicy > LED Signage' },
    { id: 'c', category: 'Valicy2' },
    { id: 'd', category: 'FBM' },
  ];
  assert.deepEqual(renameCategory(items, 'Valicy', '고객 > Valicy'), { a: '고객 > Valicy', b: '고객 > Valicy > LED Signage' });
  assert.deepEqual(renameCategory(items, 'FBM', ' FBM >  RMA '), { d: 'FBM > RMA' });
});
test('분류 색: 같은 단어는 항상 같은 색, 0~359 범위, 단어마다 다름', () => {
  assert.equal(catHue('Valicy'), catHue('Valicy'));
  assert.equal(catHue(' Valicy '), catHue('Valicy'));
  assert.notEqual(catHue('Valicy'), catHue('Pillar cabinet'));
  for (const w of ['Valicy', 'FBM', 'IGS', '고객', 'LED Signage']) {
    const h = catHue(w);
    assert.ok(Number.isInteger(h) && h >= 0 && h < 360, `${w} → ${h}`);
  }
});
test('보고서: 변경 표시(changed)된 항목은 빨간 글씨, 완료는 빨간 취소선', () => {
  const items = [
    { id: '1', category: 'IGS', title: '신규 PO 확인', date: '2026-11-03', done: false, changed: true, order: 0 },
    { id: '2', category: '', title: '그대로', date: '2026-11-03', done: false, order: 1 },
  ];
  const { html } = buildReport(items, TODAY);
  assert.match(html, /<li style="color:#d00000">IGS &gt; 신규 PO 확인<\/li>/);
  assert.match(html, /<li>그대로<\/li>/);
});