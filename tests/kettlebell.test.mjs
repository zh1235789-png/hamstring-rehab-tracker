import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, norm } from './harness.mjs';

const PHASES = () => norm(loadApp({ today: '2026-10-20T09:00:00+09:00' }).$('PHASES'));

test('どのフェーズでも、選べる日の種類すべてにメニューがある', () => {
  for (const [n, ph] of Object.entries(PHASES())) {
    for (const t of ph.dayTypes) {
      assert.ok(Array.isArray(ph.menu[t]) && ph.menu[t].length, `Phase ${n} の ${t}`);
    }
  }
});

test('同じ日のメニュー内でチェック項目のIDが重複しない', () => {
  // ID が重なると片方のチェックでもう片方も付く
  for (const [n, ph] of Object.entries(PHASES())) {
    for (const [t, items] of Object.entries(ph.menu)) {
      const ids = items.map((it) => it.id);
      assert.equal(new Set(ids).size, ids.length, `Phase ${n} の ${t}`);
    }
  }
});

test('ケトルベル日は Phase 2 から', () => {
  const p = PHASES();
  assert.ok(!p[1].dayTypes.includes('ケトルベル日'));
  for (const n of [2, 3, 4, 5]) assert.ok(p[n].dayTypes.includes('ケトルベル日'), `Phase ${n}`);
});

test('スイングは Phase 4 になるまで出てこない', () => {
  // スイングはハムに速い伸張負荷がかかる
  const p = PHASES();
  for (const n of [2, 3]) {
    const swingItems = p[n].menu['ケトルベル日'].filter((it) => it.t.includes('スイング'));
    assert.deepEqual(swingItems, [], `Phase ${n}`);
  }
  assert.ok(p[4].menu['ケトルベル日'].some((it) => it.t.includes('スイング')));
});
