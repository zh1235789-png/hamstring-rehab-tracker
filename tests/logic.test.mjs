import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const TODAY = '2026-09-21T09:00:00+09:00';
const app = () => loadApp({ today: TODAY });

test('todayStr() はローカル日付を YYYY-MM-DD で返す', () => {
  assert.equal(app().todayStr(), '2026-09-21');
});

test('dayNum() は受傷日(2026-07-04)からの経過日数', () => {
  const a = app();
  assert.equal(a.dayNum('2026-07-04'), 0);
  assert.equal(a.dayNum('2026-07-05'), 1);
  assert.equal(a.dayNum('2026-09-21'), 79);
});

test('dayNum() は受傷前の日付で負になる', () => {
  assert.equal(app().dayNum('2026-07-03'), -1);
});

test('dayNum() は月をまたいでも日数がずれない', () => {
  const a = app();
  assert.equal(a.dayNum('2026-08-04'), 31);   // 7月は31日
  assert.equal(a.dayNum('2026-09-04'), 62);   // +8月31日
});

// ---- esc(): ジャーナルの自由入力が HTML に直接埋め込まれる ----

test('esc() は HTML の特殊文字を実体参照にする', () => {
  assert.equal(app().esc('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('esc() は & を二重エスケープしない', () => {
  // & を最初に置換していないと &lt; が &amp;lt; になる
  assert.equal(app().esc('a & b'), 'a &amp; b');
  assert.equal(app().esc('<'), '&lt;');
});

test('esc() は属性値を閉じられる二重引用符を潰す', () => {
  // value="${esc(...)}" の形で埋め込まれるため
  assert.equal(app().esc('" onfocus="alert(1)'),
    '&quot; onfocus=&quot;alert(1)');
});

test('esc() は null/undefined を空文字にする', () => {
  const a = app();
  assert.equal(a.esc(null), '');
  assert.equal(a.esc(undefined), '');
});

test('esc() は数値の 0 を空文字にしてしまう', () => {
  // (s||'') のため 0 が消える。痛みスコア等を直接渡してはいけない
  assert.equal(app().esc(0), '');
});
