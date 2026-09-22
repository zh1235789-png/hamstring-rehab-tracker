// 取り込み(parseImport)は全記録を置き換える操作なので、壊れた入力を
// そのまま S に入れるとアプリが開かなくなる。ここが最後の砦。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, norm } from './harness.mjs';

const app = () => loadApp({ today: '2026-09-22T09:00:00+09:00' });

const valid = {
  phase: 3, runSession: 7, criteria: { 3: [true, false, false] },
  days: { '2026-09-22': { pain: 1, done: {}, type: 'バイク日', phase: 3 } },
};

test('parseImport() は正常な書き出しデータを受け入れる', () => {
  const r = app().parseImport(JSON.stringify(valid));
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.equal(r.state.phase, 3);
  assert.equal(r.state.runSession, 7);
});

test('parseImport() は JSON として壊れた入力を弾く', () => {
  const r = app().parseImport('{"phase":3,');
  assert.equal(r.ok, false);
  assert.match(r.error, /JSON/);
});

test('parseImport() は空文字を弾く', () => {
  assert.equal(app().parseImport('').ok, false);
});

test('parseImport() は days が無いオブジェクトを弾く', () => {
  const r = app().parseImport('{"phase":3}');
  assert.equal(r.ok, false);
  assert.match(r.error, /days/);
});

test('parseImport() は配列やnullを弾く', () => {
  const a = app();
  assert.equal(a.parseImport('[]').ok, false);
  assert.equal(a.parseImport('null').ok, false);
  assert.equal(a.parseImport('"文字列"').ok, false);
  assert.equal(a.parseImport('{"days":[]}').ok, false);
});

test('parseImport() は日付形式でないキーを捨てる', () => {
  // renderHistory が dayNum() に渡すため、不正なキーが混ざると表示が壊れる
  const r = app().parseImport(JSON.stringify({
    ...valid,
    days: { '2026-09-22': { pain: 1 }, 'ゴミ': { pain: 2 }, '2026-9-2': { pain: 3 } },
  }));
  assert.equal(r.ok, true);
  assert.deepEqual(norm(Object.keys(r.state.days)), ['2026-09-22']);
});

test('parseImport() は有効な日が1日も無ければ弾く', () => {
  const r = app().parseImport('{"days":{"ゴミ":{}}}');
  assert.equal(r.ok, false);
});

test('parseImport() は範囲外の phase を 1 に丸める', () => {
  // 未知の phase は PHASES[S.phase] が undefined になり render() が落ちる
  const a = app();
  assert.equal(a.parseImport(JSON.stringify({ ...valid, phase: 99 })).state.phase, 1);
  assert.equal(a.parseImport(JSON.stringify({ ...valid, phase: 0 })).state.phase, 1);
  assert.equal(a.parseImport(JSON.stringify({ ...valid, phase: 'ラン' })).state.phase, 1);
  assert.equal(a.parseImport(JSON.stringify({ ...valid, phase: 5 })).state.phase, 5);
});

test('parseImport() は範囲外の runSession を 1 に丸める', () => {
  const a = app();
  assert.equal(a.parseImport(JSON.stringify({ ...valid, runSession: 999 })).state.runSession, 1);
  assert.equal(a.parseImport(JSON.stringify({ ...valid, runSession: -3 })).state.runSession, 1);
  assert.equal(a.parseImport(JSON.stringify({ ...valid, runSession: 11 })).state.runSession, 11);
});

test('parseImport() は criteria が壊れていても空オブジェクトで続行する', () => {
  const r = app().parseImport(JSON.stringify({ ...valid, criteria: 'こわれ' }));
  assert.equal(r.ok, true);
  assert.deepEqual(norm(r.state.criteria), {});
});

test('書き出し→取り込みで記録が保たれる（往復）', () => {
  const a = app();
  const json = JSON.stringify(valid);
  const r = a.parseImport(json);
  assert.deepEqual(norm(r.state.days), norm(valid.days));
  // 取り込んだ結果をもう一度書き出しても通る
  assert.equal(a.parseImport(JSON.stringify(r.state)).ok, true);
});
