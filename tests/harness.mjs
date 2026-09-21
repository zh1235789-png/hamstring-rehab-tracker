// index.html の <script> を取り出し、最小限のDOM/localStorageスタブ上で評価して
// 中の関数を取り出す。アプリ本体は一切変更しない。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));

// 触られても落ちない万能スタブ（プロパティ読みも呼び出しも通す）
function stub() {
  const f = function () { return stub(); };
  return new Proxy(f, {
    get(_t, k) {
      if (k === Symbol.toPrimitive || k === 'toString') return () => '';
      if (k === 'length') return 0;
      if (k === 'value' || k === 'innerHTML' || k === 'textContent') return '';
      if (k === 'files' || k === 'children' || k === 'classList') return stub();
      if (k === 'dataset' || k === 'style') return stub();
      return stub();
    },
    set() { return true; },
    apply() { return stub(); },
    has() { return true; },
  });
}

// vm realm の外に値を持ち出すときはこれを通す。
// realm を跨ぐと Array/Object のプロトタイプが違い、assert.deepEqual が
// "same structure but are not reference-equal" で落ちるため。
export const norm = (v) => JSON.parse(JSON.stringify(v));

export function loadApp({ today = null, storage = {} } = {}) {
  const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
  // 将来 <script> が増えても壊れないよう、非貪欲に全ブロックを連結する
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (blocks.length === 0) throw new Error('index.html に <script> が見つかりません');
  const source = blocks.join('\n;\n');

  const store = { ...storage };
  const ctx = {
    console,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    document: stub(),
    window: stub(),
    location: { hash: '', href: 'http://localhost/' },
    navigator: { userAgent: 'node' },
    alert: () => {}, confirm: () => true, prompt: () => null,
    setTimeout, clearTimeout, setInterval, clearInterval,
    structuredClone,
    fetch: async () => { throw new Error('fetch はテストでは使えません'); },
    FileReader: stub(),
    speechSynthesis: stub(),
    SpeechSynthesisUtterance: stub(),
    AudioContext: stub(),
    webkitAudioContext: stub(),
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    matchMedia: () => stub(),
    Date: today
      ? class extends Date {
          constructor(...a) { if (a.length === 0) super(today); else super(...a); }
          static now() { return new Date(today).getTime(); }
        }
      : Date,
  };
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);

  // 末尾の初期化（render等）が落ちても、関数定義は既に済んでいるので握り潰す
  try {
    vm.runInContext(source, ctx, { filename: 'index.html<script>' });
  } catch (e) {
    ctx.__initError = e;
  }
  ctx.__store = store;
  // トップレベルの let/const はグローバルオブジェクトに載らないので、
  // 同じコンテキストで式を評価して取り出せるようにする（例: app.$('S')）
  ctx.$ = (expr) => vm.runInContext(expr, ctx, { filename: 'eval' });
  return ctx;
}
