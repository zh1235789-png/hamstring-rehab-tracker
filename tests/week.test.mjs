import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, norm } from './harness.mjs';

// 2026-10-20 は火曜、2026-10-22 は木曜、2026-10-24 は土曜
const at = (iso, storage) => loadApp({ today: iso, storage, expectClean: true });
const stateWith = (phase, days = {}) => ({ hamrehab_v1: JSON.stringify({ phase, runSession: 1, criteria: {}, days }) });

test('weekdayOf() はローカル日付の曜日（0=日曜）', () => {
  const a = at('2026-10-21T09:00:00+09:00');
  assert.equal(a.weekdayOf('2026-10-20'), 2);
  assert.equal(a.weekdayOf('2026-10-25'), 0);
});

test('スケジュールの日の種類は、そのフェーズで選べるものだけ', () => {
  const a = at('2026-10-21T09:00:00+09:00');
  const WEEK = norm(a.$('WEEK')), PHASES = norm(a.$('PHASES'));
  for (const [n, days] of Object.entries(WEEK)) {
    assert.equal(days.length, 7, `Phase ${n}`);
    for (const e of days) assert.ok(PHASES[n].dayTypes.includes(e.type), `Phase ${n}: ${e.type}`);
  }
});

test('月・木は散歩だけ、脚は火・金・土の3回、ジムは月・木以外の毎日', () => {
  const WEEK = norm(at('2026-10-21T09:00:00+09:00').$('WEEK'));
  for (const [n, days] of Object.entries(WEEK)) {
    for (const w of [1, 4]) {
      assert.equal(days[w].type, '休養日', `Phase ${n} ${w}`);
      assert.ok(!days[w].gym, `Phase ${n} ${w}`);
    }
    assert.deepEqual(days.map((e, i) => e.legs ? i : -1).filter((i) => i >= 0), [2, 5, 6], `Phase ${n} の脚は火金土`);
    assert.deepEqual(days.map((e, i) => e.gym ? i : -1).filter((i) => i >= 0), [0, 2, 3, 5, 6], `Phase ${n} のジムは日火水金土`);
    assert.ok(!days[3].legs, `Phase ${n} 水曜は脚なし`);
    assert.equal(days[0].type, 'バイク日', `Phase ${n} 日曜はバイク`);
  }
});

test('Phase 4 はGarminコーチどおり火・水(ロング走)・金に走る', () => {
  const days = norm(at('2026-10-21T09:00:00+09:00').$('WEEK'))[4];
  assert.deepEqual(days.map((e, i) => e.type === 'ラン日' ? i : -1).filter((i) => i >= 0), [2, 3, 5]);
  assert.match(days[3].label, /ロング走/);
});

test('Phase 3 は火・金ランで1日おきを守る', () => {
  const days = norm(at('2026-10-21T09:00:00+09:00').$('WEEK'))[3];
  const runs = days.map((e, i) => e.type === 'ラン日' ? i : -1).filter((i) => i >= 0);
  assert.deepEqual(runs, [2, 5]);
});

test('タブを選んでいない日は、曜日どおりのメニューになる', () => {
  const a = at('2026-10-24T09:00:00+09:00', stateWith(3));
  assert.equal(a.$('S').days['2026-10-24'].type, '筋トレ日');
});

test('前に既定で入った種類が保存されていても、選んでいなければ曜日を優先', () => {
  const a = at('2026-10-21T09:00:00+09:00', stateWith(3, { '2026-10-21': { pain: 1, done: {}, type: 'ラン日', phase: 3 } }));
  assert.equal(a.$('S').days['2026-10-21'].type, '筋トレ日');
});

test('自分で選んだタブはスケジュールより優先される', () => {
  const a = at('2026-10-20T09:00:00+09:00', stateWith(3));
  a.setType('タバタ日');
  a.render();
  assert.equal(a.$('S').days['2026-10-20'].type, 'タバタ日');
});

test('スケジュールのないフェーズは従来どおり最初の種類', () => {
  const a = at('2026-10-21T09:00:00+09:00', stateWith(2));
  assert.equal(a.$('S').days['2026-10-21'].type, '遠心性トレ日');
});
