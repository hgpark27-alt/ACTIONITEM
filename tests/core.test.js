import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickInput, dateLabel, visibleItems, groupByDate, buildReport,
  normalizeName, nameToKey, categoryList, categoryTree, renameCategory, catHue, toCSV, noteLines, cleanNoteHtml, textToNoteHtml, noteHtmlToText, weekList, weekSplit, weekCat, weekSorted, weekShort, worldClocks } from '../core.js';

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
    '[11월 3일]\n1. 27년 1Q 매출 작성\n2. FBM > LED점등 불량 <update>\n\n' +
    '[11월 4일]\n3. Valicy > LED Signage > Weekly meeting 진행\n\n' +
    '[Pending 업무]\n1. Valicy > Tariff Refund Invoice 입수');
  assert.match(r.html, /<p style="margin:0;color:#d00000;text-decoration:line-through">2\. FBM &gt; LED점등 불량 &lt;update&gt;<\/p>/);
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
  assert.equal(buildReport(items, TODAY).text, '[11월 3일]\n1. 액션');
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
  assert.match(html, /<p style="margin:0;color:#d00000">1\. IGS &gt; 신규 PO 확인<\/p>/);
  assert.match(html, /<p style="margin:0">2\. 그대로<\/p>/);
});
test('내보내기 CSV: 머리줄 + 항목, 쉼표·따옴표·줄바꿈 처리, 메모/액션 구분', () => {
  const items = [
    { category: 'Valicy > LED', title: 'PT "초안", 작성', date: '2026-11-03', done: true, changed: true, order: 0,
      createdAt: Date.parse('2026-11-01T09:00:00'), doneAt: Date.parse('2026-11-03T10:00:00') },
    { category: '', title: '메모', memo: true, done: false, order: 0, createdAt: Date.parse('2026-11-02T09:00:00') },
  ];
  assert.equal(toCSV(items),
    '구분,날짜,분류,할 일,완료,변경표시,완료일,생성일\r\n' +
    '액션,2026-11-03,Valicy > LED,"PT ""초안"", 작성",Y,Y,2026-11-03,2026-11-01\r\n' +
    '메모,,,메모,,,,2026-11-02');
});
test('노트 → 메모: 빈 줄 버리고, 앞의 글머리(-, *, •, 1.) 떼기', () => {
  assert.deepEqual(noteLines('- 회의록 정리\n\n  * 견적 요청 \n• 샘플 발송\n2) 도면 검토\n3. Valicy > 보고 내일\n그냥 한 줄'),
    ['회의록 정리', '견적 요청', '샘플 발송', '도면 검토', 'Valicy > 보고 내일', '그냥 한 줄']);
  assert.deepEqual(noteLines('  \n\n'), []);
});
test('노트 서식: 밑줄·줄(div)·줄바꿈만 남기고 나머지 태그·속성은 제거', () => {
  assert.equal(cleanNoteHtml('<div>회의 <u style="x">견적</u></div><div><br></div>'), '<div>회의 <u>견적</u></div><div><br></div>');
  assert.equal(cleanNoteHtml('<div><b>굵게</b> <span style="color:red">빨강</span></div>'), '<div>굵게 빨강</div>');
  assert.equal(cleanNoteHtml('<img src=x onerror="alert(1)">글<script>alert(1)</script>'), '글alert(1)');
  assert.equal(cleanNoteHtml('a &lt;b&gt; &amp; c'), 'a &lt;b&gt; &amp; c');
  assert.equal(cleanNoteHtml('<p>문단</p><br>'), '<div>문단</div><br>');
});
test('노트 서식: 예전 글(줄글) → 줄마다 div, 특수문자 안전 처리', () => {
  assert.equal(textToNoteHtml('첫 줄\n<둘째> & 줄\n\n'), '<div>첫 줄</div><div>&lt;둘째&gt; &amp; 줄</div><div><br></div><div><br></div>');
  assert.equal(textToNoteHtml(''), '<div><br></div>');
});
test('노트 서식 → 줄글 (저장용·다른 기기 호환): 빈 줄 한 번, 밑줄 표시 제거, 특수문자 복원', () => {
  assert.equal(noteHtmlToText('<div>회의 <u>아이디어</u></div><div><br></div><div>a &lt;b&gt; &amp;&nbsp;c</div>'), '회의 아이디어\n\na <b> & c');
  assert.equal(noteHtmlToText('첫 줄<div>둘째<br></div><div>셋째</div>'), '첫 줄\n둘째\n셋째');
  assert.equal(noteHtmlToText(''), '');
});
test('주간업무 목록: 예전 글(줄글) → 한 줄 = 업무 하나, 시간만 있는 줄은 윗줄에 붙임', () => {
  assert.deepEqual(weekList('Reign 컨콜\n09:30\n\n자료 정리 '), [{ t: 'Reign 컨콜 09:30' }, { t: '자료 정리' }]);
  assert.deepEqual(weekList([{ t: 'a', c: 'meet' }, null, { t: '' }]), [{ t: 'a', c: 'meet' }]);
  assert.deepEqual(weekList(undefined), []);
});
test('주간업무 시간: 글 속 09:30 / 9:30 → 앞에 따로 표시, 글에서는 뺌', () => {
  assert.deepEqual(weekSplit('Reign 컨콜 09:30'), { time: '09:30', text: 'Reign 컨콜' });
  assert.deepEqual(weekSplit('9:00 LED OPO 컨콜'), { time: '09:00', text: 'LED OPO 컨콜' });
  assert.deepEqual(weekSplit('개발회의'), { time: '', text: '개발회의' });
  assert.deepEqual(weekSplit('rev 20.4 업뎃'), { time: '', text: 'rev 20.4 업뎃' });
});
test('주간업무 성격: 직접 고른 색 우선, 없으면 단어로 추측', () => {
  assert.equal(weekCat({ t: 'Reign 컨콜' }), 'meet');
  assert.equal(weekCat({ t: '개발회의' }), 'meet');
  assert.equal(weekCat({ t: 'PO List 정리' }), 'prep');
  assert.equal(weekCat({ t: 'LED OPO 송부' }), 'send');
  assert.equal(weekCat({ t: '퇴근확인' }), 'etc');
  assert.equal(weekCat({ t: 'Reign 컨콜', c: 'prep' }), 'prep');
});
test('주간업무 순서: 시간 있는 것 시간순 → 시간 없는 것 쓴 순서 (원래 번호 유지)', () => {
  const l = [{ t: 'A' }, { t: 'B 13:00' }, { t: 'C' }, { t: 'D 08:30' }];
  assert.deepEqual(weekSorted(l).map(x => x.i), [3, 1, 0, 2]);
});
test('주간업무 얇은 띠: 앞 두 글자 (영문·숫자는 좁으니 세 글자, 시간·공백 빼고)', () => {
  assert.equal(weekShort('개발회의'), '개발');
  assert.equal(weekShort('Reign 컨콜 09:30'), 'Rei');
  assert.equal(weekShort('PO List 정리'), 'POL');
  assert.equal(weekShort('LED OPO 송부'), 'LED');
  assert.equal(weekShort('09:00 수요 업무'), '수요');
  assert.equal(weekShort('A'), 'A');
});

test('worldClocks: 라스베가스·미네소타·뉴욕 현재 시각 (서머타임 자동 반영)', () => {
  // 겨울(표준시): UTC 12:05 → 04:05 / 06:05 / 07:05
  assert.deepEqual(worldClocks(new Date('2026-11-09T12:05:00Z')), [
    { city: 'LV', name: '라스베가스', time: '04:05' },
    { city: 'MN', name: '미네소타', time: '06:05' },
    { city: 'NY', name: '뉴욕', time: '07:05' },
  ]);
  // 여름(서머타임): UTC 12:05 → 05:05 / 07:05 / 08:05
  assert.deepEqual(worldClocks(new Date('2026-07-01T12:05:00Z')).map(c => c.time), ['05:05', '07:05', '08:05']);
  // 자정은 24:00 이 아니라 00:00
  assert.equal(worldClocks(new Date('2026-11-09T08:00:00Z'))[0].time, '00:00');
});
