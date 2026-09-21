// index.html が起動時に例外を出さないことの回帰テスト。
// 純粋関数のテストは関数定義さえあれば通るため、これが無いと
// 「起動した瞬間に落ちるアプリ」を緑のまま見逃す。
import { test } from 'node:test';
import { assertLoads } from './harness.mjs';

test('index.html が例外なく初期化できる', () => {
  assertLoads({ today: '2026-09-21T09:00:00+09:00' });
});

test('保存データが空でも初期化できる（初回起動）', () => {
  assertLoads({ today: '2026-09-21T09:00:00+09:00', storage: {} });
});

test('保存データが壊れていても初期化できる', () => {
  // localStorage の中身が壊れるのは実際に起こる。ここで落ちるとアプリが開かない
  const junk = { __proto__: null };
  assertLoads({ today: '2026-09-21T09:00:00+09:00', storage: new Proxy(junk, { get: () => 'not json{' }) });
});
