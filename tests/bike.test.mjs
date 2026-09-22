// バイク4×4（VO2maxトラック）の集計ロジック。
// ワット入力はユーザーが空欄・途中入力・非数値を平気で作るので、
// 平均・前回比・フェード判定がそこで壊れないことを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, norm } from './harness.mjs';

const TODAY = '2026-09-22T09:00:00+09:00';
const app = (storage) => loadApp({ today: TODAY, storage });

// S.days に直接バイクセッションを流し込む
function withSessions(sessions) {
  const days = {};
  for (const [ds, w] of Object.entries(sessions)) {
    days[ds] = { pain: null, done: {}, type: 'バイク日', phase: 3, routine: {}, journal: {}, bike: { w, rpe: null } };
  }
  return { hamrehab_v1: JSON.stringify({ phase: 3, runSession: 7, criteria: {}, days }) };
}

// ---- bikeAvg() ----

test('bikeAvg() は4本の平均を四捨五入して返す', () => {
  assert.equal(app().bikeAvg({ w: [200, 205, 195, 200] }), 200);
  assert.equal(app().bikeAvg({ w: [200, 201, 201, 201] }), 201); // 200.75 -> 201
});

test('bikeAvg() は入力済みの本数だけで平均する（途中入力）', () => {
  // 2本目まで入れた時点で平均が 0 に薄まってはいけない
  assert.equal(app().bikeAvg({ w: [200, 210, null, null] }), 205);
});

test('bikeAvg() は未入力・0・負値・非数値を無視する', () => {
  const a = app();
  assert.equal(a.bikeAvg({ w: [200, '', 0, -50] }), 200);
  assert.equal(a.bikeAvg({ w: [200, 'abc', null, undefined] }), 200);
});

test('bikeAvg() は1本も入っていなければ null', () => {
  const a = app();
  assert.equal(a.bikeAvg({ w: [null, null, null, null] }), null);
  assert.equal(a.bikeAvg({ w: ['', '', '', ''] }), null);
});

test('bikeAvg() は bike 自体が無い日でも落ちない（既存データの移行）', () => {
  const a = app();
  assert.equal(a.bikeAvg(undefined), null);
  assert.equal(a.bikeAvg(null), null);
  assert.equal(a.bikeAvg({}), null);          // w が無い
  assert.equal(a.bikeAvg({ w: 'nope' }), null); // w が配列でない
});

test('文字列で入力されたワットも数値として平均される', () => {
  // input[type=number].value は文字列で来る
  assert.equal(app().bikeAvg({ w: ['200', '210', '190', '200'] }), 200);
});

// ---- bikeSessions() / prevBikeAvg() ----

test('bikeSessions() は日付昇順で、記録のある日だけ返す', () => {
  const a = app(withSessions({
    '2026-09-18': [200, 200, 200, 200],
    '2026-09-15': [190, 190, 190, 190],
    '2026-09-16': [null, null, null, null], // 未記録の日は出さない
  }));
  assert.deepEqual(norm(a.bikeSessions().map(s => [s.ds, s.avg])),
    [['2026-09-15', 190], ['2026-09-18', 200]]);
});

test('prevBikeAvg() は指定日より前の直近セッションを返す', () => {
  const a = app(withSessions({
    '2026-09-15': [190, 190, 190, 190],
    '2026-09-18': [200, 200, 200, 200],
    '2026-09-22': [210, 210, 210, 210],
  }));
  assert.equal(a.prevBikeAvg('2026-09-22'), 200);
  assert.equal(a.prevBikeAvg('2026-09-18'), 190);
});

test('prevBikeAvg() は当日を自分自身と比較しない', () => {
  // 今日の入力が「前回」に混ざると常に差分0になる
  const a = app(withSessions({ '2026-09-22': [210, 210, 210, 210] }));
  assert.equal(a.prevBikeAvg('2026-09-22'), null);
});

test('prevBikeAvg() は初回セッションでは null', () => {
  assert.equal(app().prevBikeAvg('2026-09-22'), null);
});

// ---- bikeFade(): 強度設定が高すぎたかの判定 ----

test('bikeFade() は4本目が1本目から5%以上落ちたら true', () => {
  const a = app();
  assert.equal(a.bikeFade({ w: [200, 195, 190, 185] }), true); // 185 < 190
});

test('bikeFade() は5%以内の低下なら false（設定は適正）', () => {
  const a = app();
  assert.equal(a.bikeFade({ w: [200, 200, 195, 192] }), false); // 192 > 190
  assert.equal(a.bikeFade({ w: [200, 200, 200, 200] }), false);
  assert.equal(a.bikeFade({ w: [200, 205, 205, 210] }), false); // 上がった
});

test('bikeFade() は1本目か4本目が欠けていれば判定しない', () => {
  const a = app();
  assert.equal(a.bikeFade({ w: [200, 200, 200, null] }), null); // まだ途中
  assert.equal(a.bikeFade({ w: [null, 200, 200, 185] }), null);
  assert.equal(a.bikeFade(undefined), null);
});

// ---- bikeDeltaText() ----

test('bikeDeltaText() は増減の符号を付ける', () => {
  const a = app();
  assert.equal(a.bikeDeltaText(210, 200), '前回 200 → +10');
  assert.equal(a.bikeDeltaText(190, 200), '前回 200 → -10');
  assert.equal(a.bikeDeltaText(200, 200), '前回 200 → 0');
});

test('bikeDeltaText() は比較対象が無ければ空文字', () => {
  const a = app();
  assert.equal(a.bikeDeltaText(200, null), '');
  assert.equal(a.bikeDeltaText(null, 200), '');
});

// ---- フェーズ構成 ----

test('バイク日はフェーズ2〜5で選べる（急性期のPhase 1では選べない）', () => {
  const P = app().$('PHASES');
  assert.equal(P[1].dayTypes.includes('バイク日'), false);
  for (const p of [2, 3, 4, 5]) {
    assert.equal(P[p].dayTypes.includes('バイク日'), true, `Phase ${p}`);
    assert.ok(P[p].menu['バイク日'], `Phase ${p} のメニューが無い`);
  }
});

test('どのフェーズでも dayTypes に対応するメニューが存在する', () => {
  // dayTypes に足してメニューを足し忘れると renderToday が undefined で落ちる
  const P = app().$('PHASES');
  for (const p of [1, 2, 3, 4, 5]) {
    for (const t of P[p].dayTypes) {
      assert.ok(Array.isArray(P[p].menu[t]), `Phase ${p} の「${t}」にメニューが無い`);
    }
  }
});

// ---- getDay(): 既存データの移行 ----

test('getDay() は bike が無い既存の日に空の記録枠を足す', () => {
  const a = app({ hamrehab_v1: JSON.stringify({
    phase: 3, runSession: 7, criteria: {},
    days: { '2026-09-22': { pain: 1, done: {}, type: 'ラン日', phase: 3 } },
  }) });
  const d = a.getDay('2026-09-22');
  assert.deepEqual(norm(d.bike.w), [null, null, null, null]);
  assert.equal(d.pain, 1); // 既存の記録は壊さない
});
