/* order.test.js — PICTUREBOOK-PRINT-1 buildPrintOrder(BFS 번호)·describeChoice 순수 검증. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../../picturebook-print.js');

function sc(over) { return Object.assign({ title: '', body: '', type: 'normal', choices: [] }, over); }
function ch(label, nextId) { return { label, nextId }; }

/* BASE10형: 표지1 → 2..9 직선 → 엔딩10 */
function base10() {
  const o = { '1': sc({ id: '1', num: 1, type: 'cover', choices: [ch('시작', '2')] }) };
  for (let i = 2; i <= 9; i++) o[String(i)] = sc({ id: String(i), num: i, choices: [ch('다음', String(i + 1))] });
  o['10'] = sc({ id: '10', num: 10, type: 'ending' });
  return o;
}

test('PRINT: BASE10 — 표지 무번호·시작=1번·직선 1~9·엔딩 9번', () => {
  const r = P.buildPrintOrder(base10());
  assert.strictEqual(r.coverKey, '1');
  assert.strictEqual(r.startKey, '2');
  assert.strictEqual(r.numberByKey['1'], undefined);          /* 표지 번호 없음 */
  assert.strictEqual(r.numberByKey['2'], 1);
  assert.strictEqual(r.numberByKey['10'], 9);
  assert.strictEqual(r.order.length, 9);
  assert.strictEqual(r.reachableCount, 9);
});

test('PRINT: 분기 — 버튼 순서대로 BFS(2→[3,4], 3→5, 4→5)', () => {
  const o = {
    '1': sc({ id: '1', num: 1, type: 'cover', choices: [ch('시작', '2')] }),
    '2': sc({ id: '2', num: 2, choices: [ch('문을 연다', '3'), ch('돌아간다', '4')] }),
    '3': sc({ id: '3', num: 3, choices: [ch('간다', '5')] }),
    '4': sc({ id: '4', num: 4, choices: [ch('간다', '5')] }),
    '5': sc({ id: '5', num: 5, type: 'ending' }),
  };
  const r = P.buildPrintOrder(o);
  assert.deepStrictEqual(r.order, ['2', '3', '4', '5']);
  assert.strictEqual(r.numberByKey['3'], 2);   /* 첫 버튼 자식 먼저 */
  assert.strictEqual(r.numberByKey['4'], 3);
  assert.strictEqual(r.numberByKey['5'], 4);   /* 합류 — 방문 1회 */
});

test('PRINT: 순환 — 무한루프 없이 1회 방문·이동 안내는 기존 번호 참조', () => {
  const o = {
    '1': sc({ id: '1', num: 1, type: 'cover', choices: [ch('시작', '2')] }),
    '2': sc({ id: '2', num: 2, choices: [ch('앞으로', '3')] }),
    '3': sc({ id: '3', num: 3, choices: [ch('돌아가기', '2'), ch('끝으로', '4')] }),
    '4': sc({ id: '4', num: 4, type: 'ending' }),
  };
  const r = P.buildPrintOrder(o);
  assert.strictEqual(r.order.length, 3);
  const back = P.describeChoice(o['3'].choices[0], r.numberByKey);
  assert.strictEqual(back.note, '→ 1번 장면으로 가세요');   /* 다시 2(=1번)로 */
});

test('PRINT: 누락 next → "(연결되지 않음)"', () => {
  const o = {
    '1': sc({ id: '1', num: 1, type: 'cover', choices: [ch('시작', '2')] }),
    '2': sc({ id: '2', num: 2, choices: [ch('사라진 길', '99'), ch('', null)] }),
  };
  const r = P.buildPrintOrder(o);
  assert.strictEqual(P.describeChoice(o['2'].choices[0], r.numberByKey).note, '(연결되지 않음)');
  const d = P.describeChoice(o['2'].choices[1], r.numberByKey);
  assert.strictEqual(d.label, '(선택)');
  assert.strictEqual(d.note, '(연결되지 않음)');
});

test('PRINT: 도달 불가 장면 — 번호 이어서 후미 수록(reachableCount 이후)', () => {
  const o = base10();
  o['20'] = sc({ id: '20', num: 20, choices: [] });            /* 고아 장면 */
  o['15'] = sc({ id: '15', num: 15, choices: [ch('x', '20')] });
  const r = P.buildPrintOrder(o);
  assert.strictEqual(r.reachableCount, 9);
  assert.strictEqual(r.numberByKey['15'], 10);                 /* num순으로 이어붙임 */
  assert.strictEqual(r.numberByKey['20'], 11);
  assert.strictEqual(r.order.length, 11);
});

test('PRINT: 표지 없음 — num 최소 non-cover가 시작·1번', () => {
  const o = {
    '5': sc({ id: '5', num: 5, choices: [ch('다음', '7')] }),
    '7': sc({ id: '7', num: 7, type: 'ending' }),
  };
  const r = P.buildPrintOrder(o);
  assert.strictEqual(r.coverKey, null);
  assert.strictEqual(r.startKey, '5');
  assert.strictEqual(r.numberByKey['5'], 1);
});

test('PRINT: 표지가 다시 표지를 가리켜도 표지는 번호 미부여', () => {
  const o = {
    '1': sc({ id: '1', num: 1, type: 'cover', choices: [ch('시작', '2')] }),
    '2': sc({ id: '2', num: 2, choices: [ch('처음으로', '1'), ch('끝', '3')] }),
    '3': sc({ id: '3', num: 3, type: 'ending' }),
  };
  const r = P.buildPrintOrder(o);
  assert.strictEqual(r.numberByKey['1'], undefined);
  assert.strictEqual(P.describeChoice(o['2'].choices[0], r.numberByKey).note, '(연결되지 않음)');   /* 표지 회귀는 인쇄상 미연결 처리 */
  assert.strictEqual(r.order.length, 2);
});

test('PRINT: 빈 입력 안전', () => {
  const r = P.buildPrintOrder(null);
  assert.strictEqual(r.order.length, 0);
  assert.strictEqual(r.startKey, null);
});
