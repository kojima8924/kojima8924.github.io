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

test('モデル切替は履歴と共通回数を維持し，次の送信に以前のモデルとの会話を渡す', async () => {
  const calls = [];
  const mock = ui.createMockTransport();
  const session = ui.createSession(async (route, body) => { calls.push({ route, body }); return mock(route, body); });
  await session.open(); await session.ask('作品');
  const history = session.snapshot().history;
  const beforeSwitch = calls.length;
  session.select('terra');
  assert.deepEqual(session.snapshot().history, history);
  assert.equal(calls.length, beforeSwitch);
  assert.equal(session.snapshot().remaining, 19);
  await session.ask('その研究について');
  assert.equal(calls.at(-1).body.model, 'terra');
  assert.deepEqual(calls.at(-1).body.history, history);
  assert.equal(session.snapshot().history.length, 4);
  session.reset();
  assert.equal(session.snapshot().remaining, 18);
  assert.equal(session.snapshot().history.length, 0);
  await session.ask('新しい質問');
  assert.deepEqual(calls.at(-1).body.history, []);
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
  assert.equal(session.snapshot().modelId, 'sonnet-5');
  assert.deepEqual(session.snapshot().history, []);
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

test('切替後の失敗でもそれ以前のモデルとの履歴を保持し，次の明示送信でだけ再利用する', async () => {
  const mock = ui.createMockTransport();
  const calls = [];
  let fail = false;
  const session = ui.createSession(async (route, body) => {
    calls.push({ route, body });
    if (route === '/ask' && fail) throw Object.assign(new Error('unavailable'), { status: 503 });
    return mock(route, body);
  });
  await session.open(); await session.ask('作品');
  const previous = session.snapshot().history;
  session.select('terra'); fail = true;
  await assert.rejects(session.ask('その担当は？'));
  assert.deepEqual(session.snapshot().history, previous);
  assert.equal(session.snapshot().modelId, 'terra');
  assert.equal(session.snapshot().busy, false);
  assert.equal(calls.filter(call => call.route === '/ask').length, 2);
  fail = false; await session.ask('説明を続けて');
  assert.deepEqual(calls.at(-1).body.history, previous);
  assert.equal(session.snapshot().history.length, 4);
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
  assert.equal(session.snapshot().history.length, 8);
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

test('質問対象に開発者の公開済み経験を含め，私的な情報と未記載事項を除く', () => {
  const js = fs.readFileSync(path.join(__dirname, '../assets/assistant.js'), 'utf8');
  assert.match(js, /作品・経歴・小嶋明について質問する/);
  assert.match(js, /小嶋明の経験・活動・開発の考え方を，公開資料の範囲で質問できます/);
  assert.match(js, /資料にないことや私的な情報は対象外/);
  assert.match(js, /ポートフォリオ AI質問対応（β）/);
  assert.match(js, /質問によっては回答できない場合もあります/);
  assert.match(js, /本人の担当・実績を推測で補わない方針ですが，誤回答の可能性/);
  assert.match(js, /例：小嶋明の技術的な強みや，開発で大切にしていることは？/);
});

test('Qwen限定catalogではQwenだけを使い，未提供の候補を選択しない', async () => {
  const mock = ui.createMockTransport();
  const catalog = await mock('/models');
  catalog.models = catalog.models.filter(model => model.id === 'qwen-235b');
  catalog.default_model = 'qwen-235b';
  const requests = [];
  const session = ui.createSession(async (route, body) => {
    requests.push({ route, body });
    return route === '/models' ? catalog : mock(route, body);
  });
  assert.deepEqual((await session.open()).models.map(model => model.id), ['qwen-235b']);
  assert.throws(() => session.select('sonnet-5'), /model_invalid/);
  await session.ask('公開資料にある研究を教えてください');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.model, 'qwen-235b');
});

test('公開βの3モデルcatalogではQwenを標準とし，GLMとKimiも明示選択できる', async () => {
  const value = await catalog();
  const aliases = ['qwen-235b', 'glm-5', 'kimi-k2-5'];
  value.models = value.models.filter(model => aliases.includes(model.id));
  value.default_model = 'qwen-235b';
  const session = ui.createSession(async () => value);
  assert.deepEqual((await session.open()).models.map(model => model.id), aliases);
  assert.equal(session.snapshot().modelId, 'qwen-235b');
  for (const alias of aliases) {
    session.select(alias);
    assert.equal(session.snapshot().modelId, alias);
  }
  assert.throws(() => session.select('sonnet-5'), /model_invalid/);
  assert.throws(() => session.select('terra'), /model_invalid/);
});

// 表示分岐だけを確認する小さなDOM代替．外観確認は実ブラウザで別途行う．
function documentFixture() {
  const document = {};
  class Node {
    constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.textContent = ''; this.className = ''; }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; if (this.listeners.close) this.listeners.close(); }
    setCustomValidity(value) { this.validityMessage = value; }
    scrollIntoView() {}
    get lastElementChild() { return this.children.at(-1); }
  }
  document.createElement = tag => new Node(tag);
  document.body = new Node('body');
  document.find = (name) => {
    function descend(node) { if (node.className.split(' ').includes(name)) return node; for (const child of node.children) { const result = descend(child); if (result) return result; } }
    return descend(document.body);
  };
  return document;
}

test('画面ログはモデル切替後もモデル名・全文・出典を保ち，6往復しても消さない', async () => {
  const document = documentFixture();
  const mock = ui.createMockTransport();
  const calls = [];
  let answers = 0;
  const mounted = ui.mount({ document, transport: async (route, body) => {
    calls.push({ route, body });
    const result = await mock(route, body);
    if (route === '/ask') {
      answers++;
      result.answer = answers === 1 ? '😀'.repeat(1600) : '回答' + answers;
      result.sources = [{ n: 1, label: '出典' + answers, url: 'https://example.invalid/source-' + answers }];
    }
    return result;
  } });
  await document.find('pa-launcher').listeners.click();
  const messages = document.find('pa-messages');
  const select = document.find('pa-select');
  const question = document.find('pa-question');
  const form = document.find('pa-form');
  async function ask(text) { question.value = text; await form.listeners.submit({ preventDefault() {} }); }
  await ask('質問0');
  const firstReply = messages.children[1];
  const firstSource = firstReply.children[2].children[0].children[0];
  assert.equal(firstReply.children[0].textContent, 'Claude Sonnet 5');
  assert.equal(Array.from(firstReply.children[1].textContent).length, 1600);
  assert.equal(firstSource.href, 'https://example.invalid/source-1');
  assert.equal(firstSource.target, '_blank');
  assert.equal(firstSource.rel, 'noopener noreferrer');
  const previousHistory = mounted.session.snapshot().history;
  assert.equal(Array.from(previousHistory[1].content).length, 1500);
  select.value = 'terra'; select.listeners.change();
  assert.equal(messages.children.length, 2);
  assert.equal(messages.children[1], firstReply);
  assert.deepEqual(mounted.session.snapshot().history, previousHistory);
  assert.equal(calls.length, 2);
  assert.match(document.find('pa-status').textContent, /次の送信時に，他モデルとの直近の会話も/);
  await ask('質問1');
  assert.equal(calls.at(-1).body.model, 'terra');
  assert.deepEqual(calls.at(-1).body.history, previousHistory);
  assert.equal(messages.children[3].children[0].textContent, 'GPT-5.6 Terra');
  for (let i = 2; i < 6; i++) await ask('質問' + i);
  assert.equal(messages.children.length, 12);
  assert.equal(messages.children[0].children[1].textContent, '質問0');
  assert.equal(messages.children[1], firstReply);
  assert.equal(firstReply.children[2].children[0].children[0], firstSource);
  assert.equal(firstSource.href, 'https://example.invalid/source-1');
  assert.equal(calls.at(-1).body.history.length, 8);
  assert.equal(calls.at(-1).body.history[0].content, '質問1');
  assert.equal(mounted.session.snapshot().history[0].content, '質問2');
  document.find('pa-close').listeners.click();
  await document.find('pa-launcher').listeners.click();
  assert.equal(messages.children.length, 12);
  assert.equal(calls.length, 7);
});

test('表示ログとAPI文脈の保存範囲を分け，切替後の送信先変更を案内する', async () => {
  const document = documentFixture();
  ui.mount({ document, transport: ui.createMockTransport() });
  const notices = document.find('pa-content').children.filter(node => node.className === 'pa-help')
    .map(node => node.textContent).join(' ');
  assert.match(notices, /表示ログはページを開いている間だけ残ります/);
  assert.match(notices, /AIへ送る文脈は直近4往復で，各回答は1500文字まで/);
  assert.match(notices, /再読み込みで消えます/);
  assert.match(notices, /切替だけでは送信しません/);
  assert.match(notices, /他モデルとの直近の会話も選択した回答生成先へ送信/);
  assert.match(notices, /引き継ぎたくない場合は，送信前に会話をリセット/);
  assert.doesNotMatch(notices, /会話をリセットします|直近4往復のみ保持/);
});

test('応答待ちは切替・resetを無効にし，失敗しても以前の画面ログと履歴を保持する', async () => {
  const document = documentFixture();
  const mock = ui.createMockTransport();
  let rejectRequest, fail = false;
  let asks = 0;
  const mounted = ui.mount({ document, transport: async (route, body) => {
    if (route === '/ask') {
      asks++;
      if (fail) return new Promise((resolve, reject) => { rejectRequest = reject; });
    }
    return mock(route, body);
  } });
  await document.find('pa-launcher').listeners.click();
  const question = document.find('pa-question');
  const form = document.find('pa-form');
  const select = document.find('pa-select');
  const reset = document.find('pa-reset');
  const messages = document.find('pa-messages');
  question.value = '最初の質問'; await form.listeners.submit({ preventDefault() {} });
  const priorNodes = [...messages.children];
  const priorHistory = mounted.session.snapshot().history;
  select.value = 'terra'; select.listeners.change();
  fail = true; question.value = '失敗する質問';
  const pending = form.listeners.submit({ preventDefault() {} });
  assert.equal(select.disabled, true);
  assert.equal(reset.disabled, true);
  assert.equal(document.find('pa-submit').disabled, true);
  assert.throws(() => mounted.session.select('qwen-235b'), /busy/);
  assert.throws(() => mounted.session.reset(), /busy/);
  await form.listeners.submit({ preventDefault() {} });
  assert.equal(asks, 2);
  rejectRequest(Object.assign(new Error('failed'), { status: 503 })); await pending;
  assert.deepEqual(messages.children, priorNodes);
  assert.deepEqual(mounted.session.snapshot().history, priorHistory);
  assert.equal(mounted.session.snapshot().modelId, 'terra');
  assert.equal(question.value, '失敗する質問');
  assert.equal(select.disabled, false);
  assert.equal(reset.disabled, false);
  assert.match(document.find('pa-status').textContent, /自動再送はしません/);
  reset.listeners.click();
  assert.equal(messages.children.length, 0);
  assert.deepEqual(mounted.session.snapshot().history, []);
  assert.equal(mounted.session.snapshot().modelId, 'terra');
  assert.equal(question.value, '');
  assert.equal(asks, 2);
});

test('新しくページを開いたUIには以前の会話を復元しない', async () => {
  const document = documentFixture();
  const first = ui.mount({ document, transport: ui.createMockTransport() });
  await document.find('pa-launcher').listeners.click();
  document.find('pa-question').value = '作品';
  await document.find('pa-form').listeners.submit({ preventDefault() {} });
  assert.equal(first.session.snapshot().history.length, 2);
  const newDocument = documentFixture();
  const second = ui.mount({ document: newDocument, transport: ui.createMockTransport() });
  assert.equal(newDocument.find('pa-messages').children.length, 0);
  assert.deepEqual(second.session.snapshot().history, []);
});

test('3／5モデルで選択した生成先の説明を表示し，切替だけで質問送信しない', async () => {
  for (const aliases of [['qwen-235b', 'glm-5', 'kimi-k2-5'], ui.ALIASES]) {
    const document = documentFixture();
    const value = await catalog();
    value.models = value.models.filter(model => aliases.includes(model.id));
    value.default_model = 'qwen-235b';
    for (const model of value.models) model.privacy_notice = model.id === 'terra'
      ? '回答生成先はOpenAIの直接APIです．'
      : model.id === 'sonnet-5' ? '回答生成先はAnthropicの直接APIです．' : '回答生成先はAWSです．';
    const calls = [];
    ui.mount({ document, transport: async route => { calls.push(route); return value; } });
    assert.deepEqual(calls, []);
    const privacy = document.find('pa-privacy').children.map(node => node.textContent).join(' ');
    assert.match(privacy, /ナレッジ検索はAWS/);
    assert.match(privacy, /選択モデルの設定に応じてAWS・OpenAI・Anthropic/);
    assert.match(privacy, /質問・直近4往復の会話・検索した公開資料を回答生成先へ送信/);
    assert.match(privacy, /実際の送信先と処理地域は選択モデルの案内/);
    assert.match(privacy, /提供元の保持条件は各社の規定/);
    await document.find('pa-launcher').listeners.click();
    const select = document.find('pa-select');
    assert.equal(select.value, 'qwen-235b');
    assert.deepEqual(select.children.map(option => option.value), value.models.map(model => model.id));
    for (const model of value.models) {
      select.value = model.id;
      select.listeners.change();
      assert.equal(document.find('pa-privacy').children[1].textContent, model.privacy_notice);
    }
    assert.deepEqual(calls, ['/models']);
  }
});

test('模擬UIは実際の提供元への送信を示さない', () => {
  const document = documentFixture();
  ui.mount({ document, preview: true, transport: ui.createMockTransport() });
  const privacy = document.find('pa-privacy').children.map(node => node.textContent).join(' ');
  assert.match(privacy, /入力した質問はAWSへ送信されません/);
  assert.doesNotMatch(privacy, /回答生成先へ送信します/);
});
