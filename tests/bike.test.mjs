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

// ---- BUILD: 更新が端末に届いたかの確認手段 ----

test('BUILD は YYYY-MM-DD.xxxx 形式（pre-commit フックが書き換える）', () => {
  // 形式が崩れると表示が壊れ、更新確認の手段が失われる
  const build = app().$('BUILD');
  assert.match(build, /^\d{4}-\d{2}-\d{2}\.[0-9a-f]{4}$/);
});

test('BUILD の日付は未来ではない', () => {
  const build = app().$('BUILD');
  assert.ok(build.slice(0, 10) <= new Date().toISOString().slice(0, 10), `BUILD が未来: ${build}`);
});

// ---- 単位と負荷レベル（ワットが出ないエルゴ対応） ----

test('bikeUnit() は既定で W、RPM を選ぶと RPM', () => {
  const a = app();
  assert.equal(a.bikeUnit(), 'W');
  a.setBikeUnit('RPM');
  assert.equal(a.bikeUnit(), 'RPM');
  a.setBikeUnit('なんでも'); // 不正値は W に落とす
  assert.equal(a.bikeUnit(), 'W');
});

test('bikeSessions() は負荷レベルも返す', () => {
  const days = {
    '2026-10-01': { done: {}, journal: {}, routine: {}, bike: { w: [90, 90, 90, 90], level: 12 } },
    '2026-10-04': { done: {}, journal: {}, routine: {}, bike: { w: [93, 93, 93, 93], level: 12 } },
  };
  const a = app({ hamrehab_v1: JSON.stringify({ phase: 3, runSession: 7, criteria: {}, days }) });
  assert.deepEqual(norm(a.bikeSessions().map(s => [s.ds, s.avg, s.level])),
    [['2026-10-01', 90, 12], ['2026-10-04', 93, 12]]);
});

test('RPM記録でレベルが変わったら比較不能の警告を出す', () => {
  // レベルが違うRPMを並べて改善と誤読するのが一番まずい
  const a = app();
  a.setBikeUnit('RPM');
  const prev = { ds: '2026-10-01', avg: 90, level: 12 };
  assert.match(a.bikeLevelWarnHtml(14, prev), /比較できません/);
  assert.equal(a.bikeLevelWarnHtml(12, prev), '');   // 同じレベルなら出さない
  assert.equal(a.bikeLevelWarnHtml(null, prev), ''); // 未入力なら出さない
  assert.equal(a.bikeLevelWarnHtml(14, null), '');   // 前回が無ければ出さない
});

test('ワット記録ではレベルが変わっても警告を出さない', () => {
  // ワットは絶対値なのでレベルが変わっても比較できる
  const a = app();
  assert.equal(a.bikeUnit(), 'W');
  assert.equal(a.bikeLevelWarnHtml(14, { ds: '2026-10-01', avg: 180, level: 12 }), '');
});

test('getDay() は level の無い既存のバイク記録に枠を足す', () => {
  const a = app({ hamrehab_v1: JSON.stringify({
    phase: 3, runSession: 7, criteria: {},
    days: { '2026-10-04': { bike: { w: [180, 180, 180, 180], rpe: 8 } } },
  }) });
  const d = a.getDay('2026-10-04');
  assert.equal(d.bike.level, null);
  assert.equal(d.bike.rpe, 8); // 既存の値は壊さない
});

// ---- RPE 選択 ----

test('setBikeRpe() は同じ値を再度押すと取り消す', () => {
  const a = app();
  a.setBikeRpe(8);
  assert.equal(a.getDay('2026-09-22').bike.rpe, 8);
  a.setBikeRpe(8);
  assert.equal(a.getDay('2026-09-22').bike.rpe, null);
  a.setBikeRpe(9);
  assert.equal(a.getDay('2026-09-22').bike.rpe, 9);
});

test('rpeNoteHtml() は狙い(8〜9)なら「狙いどおり」', () => {
  const a = app();
  assert.match(a.rpeNoteHtml(8), /狙いどおり/);
  assert.match(a.rpeNoteHtml(9), /狙いどおり/);
});

test('rpeNoteHtml() は低すぎ/高すぎで次回の調整方向を出す', () => {
  // 数字だけ残しても後から読み返せないので、助言まで含めて出す
  const a = app();
  assert.match(a.rpeNoteHtml(5), /上げて/);
  assert.match(a.rpeNoteHtml(7), /上げて/);
  assert.match(a.rpeNoteHtml(10), /下げて/);
});

test('rpeNoteHtml() は未選択なら狙いの説明を出す', () => {
  const a = app();
  assert.match(a.rpeNoteHtml(null), /8〜9/);
  assert.match(a.rpeNoteHtml(undefined), /8〜9/);
});

test('RPE は 1〜10 が重複なく定義されている', () => {
  const rpe = app().$('RPE');
  assert.deepEqual(norm(rpe.map(r => r.v)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  rpe.forEach((r) => assert.ok(r.label && r.c, `RPE ${r.v} に label/色が無い`));
});

// ---- 心拍・ゾーン4滞在時間 ----

test('bikeHr() は生理的にありえない値を弾く', () => {
  // 178 を 1780 と打つと基準心拍が壊れ、以降の判定が全部狂う
  const a = app();
  assert.equal(a.bikeHr(178), 178);
  assert.equal(a.bikeHr('178'), 178);
  assert.equal(a.bikeHr(1780), null);
  assert.equal(a.bikeHr(40), null);
  assert.equal(a.bikeHr(''), null);
  assert.equal(a.bikeHr(null), null);
});

test('bikeHrMaxAll() は記録済みの最高心拍の最大値を返す', () => {
  const days = {
    '2026-10-01': { bike: { w: [90, 90, 90, 90], level: 12, hrMax: 172, hrAvg: 160 } },
    '2026-10-04': { bike: { w: [92, 92, 92, 92], level: 12, hrMax: 178, hrAvg: 158 } },
  };
  const a = app({ hamrehab_v1: JSON.stringify({ phase: 3, runSession: 7, criteria: {}, days }) });
  assert.equal(a.bikeHrMaxAll(), 178);
});

test('bikeHrMaxAll() は記録が無ければ null', () => {
  assert.equal(app().bikeHrMaxAll(), null);
});

test('prevSameLevel() は同じレベルの直近回だけを返す', () => {
  // 負荷が違えば心拍が違って当然なので、直前の回と比べてはいけない
  const days = {
    '2026-10-01': { bike: { w: [90, 90, 90, 90], level: 12, hrAvg: 160 } },
    '2026-10-04': { bike: { w: [88, 88, 88, 88], level: 14, hrAvg: 168 } },
    '2026-10-08': { bike: { w: [92, 92, 92, 92], level: 12, hrAvg: 156 } },
  };
  const a = app({ hamrehab_v1: JSON.stringify({ phase: 3, runSession: 7, criteria: {}, days }) });
  assert.equal(a.prevSameLevel('2026-10-11', 12).ds, '2026-10-08');
  assert.equal(a.prevSameLevel('2026-10-11', 14).ds, '2026-10-04');
  assert.equal(a.prevSameLevel('2026-10-11', 20), null); // 未経験のレベル
  assert.equal(a.prevSameLevel('2026-10-11', null), null);
});

test('bikeZ4() は分を受け取り、範囲外を弾く', () => {
  const a = app();
  assert.equal(a.bikeZ4(9), 9);
  assert.equal(a.bikeZ4('8.5'), 8.5);
  assert.equal(a.bikeZ4(0), null);
  assert.equal(a.bikeZ4(90), null); // 4×4で90分はありえない
  assert.equal(a.bikeZ4(''), null);
  assert.equal(a.bikeZ4('abc'), null);
});

test('同じレベルでゾーン4時間が減ったら「レベルを上げろ」と出す', () => {
  // ここが解釈の肝。滞在時間の減少は達成ではなく、刺激低下のサイン
  const days = { '2026-10-01': { bike: { w: [90, 90, 90, 90], level: 12, z4: 9 } } };
  const a = app({ hamrehab_v1: JSON.stringify({ phase: 3, runSession: 7, criteria: {}, days }) });
  const note = a.bikeZ4NoteHtml({ z4: 7, level: 12 }, '2026-10-04');
  assert.match(note, /レベルを1上げて/);
});

test('同じレベルでゾーン4時間を保てていれば上げろとは言わない', () => {
  const days = { '2026-10-01': { bike: { w: [90, 90, 90, 90], level: 12, z4: 9 } } };
  const a = app({ hamrehab_v1: JSON.stringify({ phase: 3, runSession: 7, criteria: {}, days }) });
  const note = a.bikeZ4NoteHtml({ z4: 9.5, level: 12 }, '2026-10-04');
  assert.doesNotMatch(note, /レベルを1上げて/);
});

test('ゾーン4時間が未入力なら目安の説明を出す', () => {
  assert.match(app().bikeZ4NoteHtml({ z4: null, level: 12 }, '2026-10-04'), /8〜10分/);
});

// ---- 各本の終盤心拍（ラップを切らずに取る） ----

test('bikeHrMaxOf/bikeHrAvgOf は4本の値から最高と平均を出す', () => {
  const a = app();
  const b = { hr: [150, 168, 174, 176] };
  assert.equal(a.bikeHrMaxOf(b), 176);
  assert.equal(a.bikeHrAvgOf(b), 167); // 667/4 = 166.75 -> 167
});

test('入力済みの本だけで集計する（途中入力）', () => {
  const a = app();
  const b = { hr: [150, 168, null, null] };
  assert.equal(a.bikeHrMaxOf(b), 168);
  assert.equal(a.bikeHrAvgOf(b), 159);
});

test('範囲外の心拍は集計から除かれる', () => {
  const a = app();
  const b = { hr: [150, 1680, 174, 0] }; // 1680 は打ち間違い
  assert.equal(a.bikeHrMaxOf(b), 174);
});

test('4本が空なら旧形式の hrMax / hrAvg を読む（移行）', () => {
  // 1本も入っていない日に旧データがあれば、それを失わない
  const a = app();
  const b = { hr: [null, null, null, null], hrMax: 178, hrAvg: 162 };
  assert.equal(a.bikeHrMaxOf(b), 178);
  assert.equal(a.bikeHrAvgOf(b), 162);
});

test('4本が入っていれば旧形式より4本の値を優先する', () => {
  const a = app();
  const b = { hr: [150, 168, 174, 176], hrMax: 999, hrAvg: 999 };
  assert.equal(a.bikeHrMaxOf(b), 176);
  assert.equal(a.bikeHrAvgOf(b), 167);
});

test('心拍が1つも無ければ null', () => {
  const a = app();
  assert.equal(a.bikeHrMaxOf({ hr: [null, null, null, null] }), null);
  assert.equal(a.bikeHrMaxOf(undefined), null);
  assert.equal(a.bikeHrAvgOf(null), null);
});

test('getDay() は hr 配列の無い既存のバイク記録に枠を足す', () => {
  const a = app({ hamrehab_v1: JSON.stringify({
    phase: 3, runSession: 7, criteria: {},
    days: { '2026-09-22': { bike: { w: [90, 90, 90, 90], level: 12, hrMax: 178 } } },
  }) });
  const d = a.getDay('2026-09-22');
  assert.deepEqual(norm(d.bike.hr), [null, null, null, null]);
  assert.equal(d.bike.hrMax, 178); // 旧データは残す
});
