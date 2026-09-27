/* 標準Nodeだけで実行する無通信のUI・状態遷移テスト． */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ui = require('../assets/assistant.js');

async function catalog() { return ui.createMockTransport()('/models'); }

test('セッション生成時には通信せず，開く操作でcatalogだけを1回取得する', async () => {
  const calls = [];
  const mock = ui.createMockTransport();
  const session = ui.createSession(async (...args) => { calls.push(args); return mock(...args); });
  assert.equal(calls.length, 0);
  await session.open(); await session.open();
  assert.deepEqual(calls.map(([route]) => route), ['/models']);
  assert.equal(session.snapshot().modelId, 'sonnet-5');
});

test('catalogにないaliasとAWSモデルIDを拒否する', async () => {
  const value = await catalog(); value.models = [value.models[0]];
  const session = ui.createSession(async () => value);
  await session.open();
  assert.throws(() => session.select('terra'), /model_invalid/);
  assert.throws(() => session.select('anthropic.arbitrary-model'), /model_invalid/);
});

test('不明・重複alias，不足した説明，不整合なdefaultをcatalogで拒否する', async () => {
  for (const alter of [
    (value) => { value.models[0].id = 'unknown'; },
    (value) => { value.models[1].id = value.models[0].id; },
    (value) => { value.models[0].privacy_notice = ''; },
    (value) => { value.default_model = 'unknown'; },
  ]) {
    const value = await catalog(); alter(value);
    assert.throws(() => ui.validateCatalog(value), /catalog_invalid/);
  }
});

test('空catalogでは選択や送信を無効にし，別候補に切り替えない', async () => {
  let calls = 0;
  const session = ui.createSession(async () => { calls++; return { default_model: null, models: [] }; });
  await session.open();
  assert.equal(session.snapshot().modelId, null);
  await assert.rejects(session.ask('作品について'), /model_unavailable/);
  assert.equal(calls, 1);
});

test('要求にはaliasと直近4往復だけを渡し，回答履歴を1500文字で切る', async () => {
  const calls = [];
  const mock = ui.createMockTransport();
  const session = ui.createSession(async (route, body) => {
    calls.push({ route, body });
    const data = await mock(route, body);
    if (route === '/ask') data.answer = '😀'.repeat(1600);
    return data;
  });
  await session.open();
  for (let i = 0; i < 6; i++) await session.ask('質問' + i);
  const last = calls.at(-1).body;
  assert.deepEqual(Object.keys(last).sort(), ['history', 'model', 'question']);
  assert.equal(last.model, 'sonnet-5');
  assert.equal(last.history.length, 8);
  assert.equal(last.history[0].content, '質問1');
  assert.equal(Array.from(last.history[1].content).length, 1500);
  assert.equal(session.snapshot().history[0].content, '質問2');
});

test('質問上限はUnicodeコードポイントで数え，超過時は通信しない', async () => {
  let calls = 0;
  const mock = ui.createMockTransport();
  const session = ui.createSession(async (...args) => { calls++; return mock(...args); });
  await session.open();
  await session.ask('😀'.repeat(500));
  await assert.rejects(session.ask('😀'.repeat(501)), /question_invalid/);
  await assert.rejects(session.ask('   '), /question_invalid/);
  assert.equal(calls, 2);
});

test('モデル切替とリセットは会話だけを消し，共通回数を維持する', async () => {
  const session = ui.createSession(ui.createMockTransport());
  await session.open(); await session.ask('作品');
  session.select('terra');
  assert.equal(session.snapshot().history.length, 0);
  assert.equal(session.snapshot().remaining, 19);
  await session.ask('研究'); session.reset();
  assert.equal(session.snapshot().remaining, 18);
  assert.equal(session.snapshot().history.length, 0);
});

test('snapshotで取得した履歴を書き換えても内部履歴は変わらない', async () => {
  const session = ui.createSession(ui.createMockTransport());
  await session.open(); await session.ask('作品');
  session.snapshot().history[0].content = '改変';
  assert.equal(session.snapshot().history[0].content, '作品');
});

test('応答待ちの二重送信・モデル変更・リセットを拒否する', async () => {
  let resolve;
  const ready = await catalog();
  const session = ui.createSession((route) => route === '/models' ? ready : new Promise((done) => { resolve = done; }));
  await session.open();
  const pending = session.ask('作品');
  await assert.rejects(session.ask('再送'), /busy/);
  assert.throws(() => session.select('terra'), /busy/);
  assert.throws(() => session.reset(), /busy/);
  resolve({ answer: '回答', model: { id: 'sonnet-5' } }); await pending;
  assert.equal(session.snapshot().busy, false);
});

test('エラー時には再送・モデル切替をせず，失敗した履歴を残さない', async () => {
  let asks = 0;
  const ready = await catalog();
  const session = ui.createSession(async (route) => {
    if (route === '/models') return ready;
    asks++; throw Object.assign(new Error('not returned to user'), { status: 503 });
  });
  await session.open(); await assert.rejects(session.ask('作品'));
  assert.equal(asks, 1);
  assert.equal(session.snapshot().modelId, 'sonnet-5');
  assert.equal(session.snapshot().history.length, 0);
  assert.equal(session.snapshot().busy, false);
});

test('異なるモデルの回答は採用しない', async () => {
  const ready = await catalog();
  const session = ui.createSession(async (route) => route === '/models' ? ready : { answer: '回答', model: { id: 'terra' } });
  await session.open(); await assert.rejects(session.ask('作品'), /answer_invalid/);
  assert.equal(session.snapshot().history.length, 0);
});

test('上限エラーは全モデル共通の残り0として保持する', async () => {
  const session = ui.createSession(ui.createMockTransport());
  await session.open();
  for (let i = 0; i < 20; i++) await session.ask('質問');
  session.select('terra');
  await assert.rejects(session.ask('質問'), (error) => error.status === 429 && error.code === 'ip_daily_limit');
  assert.equal(session.snapshot().remaining, 0);
  assert.equal(session.snapshot().history.length, 0);
});

test('HTTP接続はHTTPS明示必須で，初期化だけではfetchを呼ばない', () => {
  let calls = 0;
  ui.createHttpTransport('https://example.invalid/api', () => { calls++; });
  assert.equal(calls, 0);
  for (const endpoint of [undefined, '/api', 'http://example.invalid', 'https://user:pass@example.invalid', 'https://example.invalid/?x=1', 'https://example.invalid/#x']) {
    assert.throws(() => ui.createHttpTransport(endpoint), /endpoint_invalid/);
  }
});

test('HTTPは同じ明示接続先だけを使い，資格情報を送らずredirectを拒否する', async () => {
  const calls = [];
  const http = ui.createHttpTransport('https://example.invalid/api/', async (url, options) => {
    calls.push({ url, options }); return { ok: true, json: async () => ({}) };
  });
  await http('/models'); await http('/ask', { question: '作品', history: [], model: 'sonnet-5' });
  assert.deepEqual(calls.map((call) => call.url), ['https://example.invalid/api/models', 'https://example.invalid/api/ask']);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.credentials, 'omit');
  assert.equal(calls[1].options.redirect, 'error');
  assert.equal(calls[1].options.referrerPolicy, 'no-referrer');
  await assert.rejects(http('/unexpected'), /route_invalid/);
  assert.equal(calls.length, 2);
});

test('HTTP障害は1回で終了し，サーバー本文をエラー文に転載しない', async () => {
  let calls = 0;
  const http = ui.createHttpTransport('https://example.invalid', async () => {
    calls++; return { ok: false, status: 503, json: async () => ({ error: { message: '<script>bad</script>' } }) };
  });
  await assert.rejects(http('/ask', {}), (error) => !ui.errorMessage(error).includes('<script>'));
  assert.equal(calls, 1);
});

test('参照リンクは資格情報なしHTTPSだけを許可する', () => {
  assert.equal(ui.safeHttps('https://example.invalid/path#ref'), 'https://example.invalid/path#ref');
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', '/relative', 'http://example.invalid', 'https://user:pass@example.invalid']) assert.equal(ui.safeHttps(url), null);
});

test('実APIの処理地域識別子を説明文に変換する', () => {
  assert.equal(ui.regionLabel('global'), 'グローバル推論（国外処理あり）');
  assert.equal(ui.regionLabel('ap-northeast-1'), '東京');
  assert.equal(ui.regionLabel('未確認'), '未確認');
});

test('模擬catalogの標準モデル名と出典番号を本体契約にそろえる', async () => {
  const mock = ui.createMockTransport();
  const value = await mock('/models');
  assert.equal(value.models[0].label, 'Claude Sonnet 5');
  const answer = await mock('/ask', { question: '作品', history: [], model: 'sonnet-5' });
  assert.equal(answer.sources[0].n, 1);
});

test('組込みUIは安全な描画とテーマ・印刷を維持する', () => {
  const js = fs.readFileSync(path.join(__dirname, '../assets/assistant.js'), 'utf8');
  assert.doesNotMatch(js, /innerHTML|localStorage|sessionStorage|indexedDB|sendBeacon/);
  assert.match(js, /\.showModal\(\)/);
  const css = fs.readFileSync(path.join(__dirname, '../assets/assistant.css'), 'utf8');
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /body\.pdf-summary/);
  assert.match(css, /@media print/);
});
