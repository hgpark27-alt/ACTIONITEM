import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickInput, dateLabel, visibleItems, groupByDate, buildReport } from '../core.js';

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
