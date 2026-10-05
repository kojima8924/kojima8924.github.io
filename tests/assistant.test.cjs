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

test('新しい対話設定を検査し，未提供の旧APIは4往復・20回へ安全に戻す', async () => {
  for (const alter of [
    (value) => { value.interaction.history_messages = 15; },
    (value) => { value.interaction.history_messages = 18; },
    (value) => { value.interaction.daily_requests = 41; },
    (value) => { value.interaction.quick_replies = 'yes'; },
  ]) {
    const value = await catalog(); alter(value);
    assert.throws(() => ui.validateCatalog(value), /catalog_invalid/);
  }
  const legacy = await catalog(); delete legacy.interaction;
  const calls = [];
  const session = ui.createSession(async (route, body) => {
    if (route === '/models') return legacy;
    calls.push(body);
    return { answer: '旧APIの回答', model: { id: body.model }, limit: { remaining_today: 19 } };
  });
  const opened = await session.open();
  assert.deepEqual(opened.interaction, { history_messages: 8, daily_requests: 20, quick_replies: false });
  for (let i = 0; i < 6; i++) await session.ask('旧質問' + i);
  assert.equal(calls.at(-1).history.length, 8);
  assert.equal(calls.at(-1).history[0].content, '旧質問1');
  assert.equal(session.snapshot().remaining, 19);
});

test('空catalogでは選択や送信を無効にし，別候補に切り替えない', async () => {
  let calls = 0;
  const session = ui.createSession(async () => { calls++; return { default_model: null, models: [] }; });
  await session.open();
  assert.equal(session.snapshot().modelId, null);
  await assert.rejects(session.ask('作品について'), /model_unavailable/);
  assert.equal(calls, 1);
});

test('要求にはaliasと直近8往復だけを渡し，回答履歴を1500文字で切る', async () => {
  const calls = [];
  const mock = ui.createMockTransport();
  const session = ui.createSession(async (route, body) => {
    calls.push({ route, body });
    const data = await mock(route, body);
    if (route === '/ask') data.answer = '😀'.repeat(1600);
    return data;
  });
  await session.open();
  for (let i = 0; i < 10; i++) await session.ask('質問' + i);
  const last = calls.at(-1).body;
  assert.deepEqual(Object.keys(last).sort(), ['history', 'model', 'question']);
  assert.equal(last.model, 'sonnet-5');
  assert.equal(last.history.length, 16);
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
  assert.equal(session.snapshot().remaining, 39);
  await session.ask('その研究について');
  assert.equal(calls.at(-1).body.model, 'terra');
  assert.deepEqual(calls.at(-1).body.history, history);
  assert.equal(session.snapshot().history.length, 4);
  session.reset();
  assert.equal(session.snapshot().remaining, 38);
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
  for (let i = 0; i < 40; i++) await session.ask('質問');
  session.select('terra');
  await assert.rejects(session.ask('質問'), (error) => error.status === 429 && error.code === 'ip_daily_limit');
  assert.equal(session.snapshot().remaining, 0);
  assert.equal(session.snapshot().history.length, 16);
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
  // 質問欄に例文の placeholder を設定せず，候補ボタンから送信処理を直接呼ばない．
  assert.doesNotMatch(js, /\.placeholder\s*=|setAttribute\('placeholder'/);
  assert.doesNotMatch(js, /return sendQuestion\(suggestion\)/);
  // 追加済みの候補は aria-pressed で控えめな見た目にする．
  assert.match(css, /\.pa-quick-reply\[aria-pressed="true"\]/);
});

test('質問対象に開発者の公開済み経験を含め，私的な情報と未記載事項を除く', () => {
  const js = fs.readFileSync(path.join(__dirname, '../assets/assistant.js'), 'utf8');
  assert.match(js, /作品・経歴・小嶋明について質問する/);
  assert.match(js, /小嶋明の経験・活動・開発の考え方を，公開資料の範囲で質問できます/);
  assert.match(js, /資料にないことや私的な情報は対象外/);
  assert.match(js, /ポートフォリオ AI質問対応（β）/);
  assert.match(js, /質問によっては回答できない場合もあります/);
  assert.match(js, /本人の担当・実績を推測で補わない方針ですが，誤回答の可能性/);
  // 質問欄の例文 placeholder は候補と紛らわしいため削除した．
  assert.doesNotMatch(js, /例：小嶋明の技術的な強みや，開発で大切にしていることは？/);
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
    setSelectionRange(start, end) { this.selection = [start, end]; }
    scrollIntoView() {}
    get lastElementChild() { return this.children.at(-1); }
  }
  document.createElement = tag => new Node(tag);
  document.body = new Node('body');
  document.find = (name) => {
    function descend(node) { if (node.className.split(' ').includes(name)) return node; for (const child of node.children) { const result = descend(child); if (result) return result; } }
    return descend(document.body);
  };
  document.findAll = (name) => {
    const found = [];
    (function descend(node) { if (node.className.split(' ').includes(name)) found.push(node); node.children.forEach(descend); })(document.body);
    return found;
  };
  return document;
}
// 子孫を含むテキストをまとめて返す．
function textOf(node) { return [node.textContent, ...node.children.map(textOf)].join(' '); }
function hasAncestor(node, ancestor) { for (let parent = node.parent; parent; parent = parent.parent) if (parent === ancestor) return true; return false; }

// 候補の追記を検査するための共通準備．/ask の呼び出しを記録し，ダイアログを開いた状態で返す．
async function openWithCalls() {
  const document = documentFixture();
  const calls = [];
  const mock = ui.createMockTransport();
  const mounted = ui.mount({ document, transport: async (route, body) => {
    calls.push({ route, body }); return mock(route, body);
  } });
  await document.find('pa-launcher').listeners.click();
  const asks = () => calls.filter(call => call.route === '/ask');
  return { document, calls, asks, mounted, question: document.find('pa-question'), form: document.find('pa-form'), replies: document.find('pa-quick-replies'), status: document.find('pa-status') };
}

test('初回案内は履歴へ混ぜず，候補を押しても送信せず入力欄へ追記し，送信ボタンでだけ送る', async () => {
  const { document, calls, asks, mounted, question, form, replies, status } = await openWithCalls();
  const messages = document.find('pa-messages');
  assert.equal(messages.children.length, 1);
  assert.match(messages.children[0].children[1].textContent, /Claude Sonnet 5.*質問をどうぞ/);
  assert.deepEqual(mounted.session.snapshot().history, []);
  assert.equal(replies.hidden, false);
  assert.match(status.textContent, /質問を入力してください．候補を押すと入力欄に追加されます．/);
  assert.doesNotMatch(status.textContent, /候補を選んで/);
  // 例文の placeholder は置かない．
  assert.ok(!question.placeholder);
  assert.equal(question.attributes.placeholder, undefined);
  assert.deepEqual(replies.children.slice(1).map(node => node.textContent), ['小嶋明の技術的な強みは？', '大学院での研究内容を簡潔に教えて', '生成AIを使わずに作った作品は？']);
  const [first, second] = replies.children.slice(1);
  assert.equal(first.className, 'pa-quick-reply');
  assert.ok(replies.children.slice(1).every(node => node.attributes['aria-pressed'] === 'false'));
  // 空白だけの入力欄には候補をそのまま入れる．送信（fetch 相当の /ask）は起きない．
  question.value = '  \n ';
  await first.listeners.click();
  assert.equal(asks().length, 0);
  assert.equal(question.value, '小嶋明の技術的な強みは？');
  assert.equal(first.attributes['aria-pressed'], 'true');
  assert.equal(document.activeElement, question);
  assert.deepEqual(question.selection, [question.value.length, question.value.length]);
  assert.equal(document.find('pa-count').textContent, '12 / 500文字');
  assert.match(status.textContent, /入力欄に追加しました/);
  // 同じ候補を再度押しても二重に追記しない．
  await first.listeners.click();
  assert.equal(question.value, '小嶋明の技術的な強みは？');
  // 別の候補は改行1つの後に追記する．
  await second.listeners.click();
  assert.equal(question.value, '小嶋明の技術的な強みは？\n大学院での研究内容を簡潔に教えて');
  assert.equal(second.attributes['aria-pressed'], 'true');
  assert.equal(replies.children[3].attributes['aria-pressed'], 'false');
  assert.equal(asks().length, 0);
  assert.deepEqual(mounted.session.snapshot().history, []);
  // 送信ボタン（フォーム submit）で，追記した文がそのまま1回だけ送られる．
  await form.listeners.submit({ preventDefault() {} });
  assert.equal(asks().length, 1);
  assert.equal(calls.at(-1).body.question, '小嶋明の技術的な強みは？\n大学院での研究内容を簡潔に教えて');
  assert.deepEqual(calls.at(-1).body.history, []);
  assert.equal(mounted.session.snapshot().history.length, 2);
  assert.equal(messages.children.length, 3);
  assert.equal(question.value, '');
  // 新しい回答の候補で置き換え，追加済みの状態は引き継がない．回答メッセージの中には候補を描画しない．
  assert.equal(document.findAll('pa-quick-replies').length, 1);
  assert.deepEqual(replies.children.slice(1).map(node => node.textContent), ['この研究の概要は？', '生成AI不使用の作品は？', '開発で重視していることは？']);
  assert.ok(replies.children.slice(1).every(node => node.disabled === false && node.attributes['aria-pressed'] === 'false'));
  assert.equal(first.disabled, true);
  assert.ok(document.findAll('pa-quick-reply').every(node => !hasAncestor(node, messages)));
  // 以前の組で追加済みだった候補と同じ文でも，新しい組では追記できる．
  await replies.children[1].listeners.click();
  assert.equal(question.value, 'この研究の概要は？');
  assert.equal(asks().length, 1);
});

test('既存の文には末尾の空白を整えて改行1つで追記し，500文字を超える追記はしない', async () => {
  const { asks, question, replies, status, document } = await openWithCalls();
  const [first, second, third] = replies.children.slice(1);
  question.value = '最初の文  \n\n \t';
  await first.listeners.click();
  assert.equal(question.value, '最初の文\n小嶋明の技術的な強みは？');
  // 追記後が500文字を超える場合は追記せず，状態表示で知らせる．
  const long = 'あ'.repeat(490);
  question.value = long;
  await second.listeners.click();
  assert.equal(question.value, long);
  assert.equal(second.attributes['aria-pressed'], 'false');
  assert.match(status.textContent, /500文字を超えるため，候補を追加しませんでした/);
  // ちょうど500文字（コードポイント）までは追記できる．
  const fill = '𠀋'.repeat(500 - 1 - [...third.textContent].length);
  question.value = fill;
  await third.listeners.click();
  assert.equal(question.value, fill + '\n' + third.textContent);
  assert.equal([...question.value].length, 500);
  assert.equal(document.find('pa-count').textContent, '500 / 500文字');
  assert.equal(question.validityMessage, '');
  assert.equal(asks().length, 0);
});

test('応答待ち中は候補を押しても追記・送信せず，重複送信しない', async () => {
  const { asks, question, form, replies } = await openWithCalls();
  const [first, second] = replies.children.slice(1);
  await first.listeners.click();
  const pending = form.listeners.submit({ preventDefault() {} });
  assert.ok(replies.children.slice(1).every(node => node.disabled));
  assert.equal(submitDisabled(form), true);
  await second.listeners.click();
  assert.equal(question.value, '小嶋明の技術的な強みは？');
  // 応答待ちに重ねた送信も受け付けない．
  await form.listeners.submit({ preventDefault() {} });
  await pending;
  assert.equal(asks().length, 1);
  assert.equal(asks()[0].body.question, '小嶋明の技術的な強みは？');
});
// 送信ボタンの無効状態を返す．
function submitDisabled(form) { return form.children.find(node => node.className === 'pa-form-bottom').children.find(node => node.className === 'pa-submit').disabled; }

test('質問候補は質問欄の直前の専用コンテナに置き，候補がない回答や失敗では隠す', async () => {
  const document = documentFixture();
  const mock = ui.createMockTransport();
  let mode = 'normal';
  ui.mount({ document, transport: async (route, body) => {
    if (route === '/ask' && mode === 'fail') throw Object.assign(new Error('unavailable'), { status: 503 });
    const result = await mock(route, body);
    if (route === '/ask' && mode === 'none') delete result.suggestions;
    if (route === '/ask' && mode === 'html') result.suggestions = ['<img src=x onerror=alert(1)>'];
    return result;
  } });
  const form = document.find('pa-form');
  const replies = document.find('pa-quick-replies');
  const question = document.find('pa-question');
  // form 内で，質問ラベル行の後・textarea の直前に置く．
  assert.equal(replies.parent, form);
  assert.equal(form.children.indexOf(replies) + 1, form.children.indexOf(question));
  assert.ok(form.children.indexOf(document.find('pa-form-head')) < form.children.indexOf(replies));
  assert.equal(replies.attributes['aria-label'], '次の質問候補');
  await document.find('pa-launcher').listeners.click();
  async function ask(text) { question.value = text; await form.listeners.submit({ preventDefault() {} }); }
  mode = 'html'; await ask('質問1');
  assert.equal(replies.children[1].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(replies.children[1].children.length, 0);
  mode = 'none'; await ask('質問2');
  assert.equal(replies.hidden, true);
  assert.equal(replies.children.length, 0);
  mode = 'normal'; await ask('質問3');
  assert.equal(replies.hidden, false);
  assert.equal(replies.children.length, 4);
  mode = 'fail'; await ask('失敗する質問');
  assert.equal(replies.hidden, true);
  assert.equal(replies.children.length, 0);
  assert.equal(question.value, '失敗する質問');
  const messages = document.find('pa-messages');
  for (const item of messages.children) assert.doesNotMatch(textOf(item), /次の質問候補/);
  document.find('pa-reset').listeners.click();
  assert.equal(replies.hidden, false);
  assert.equal(replies.children[1].textContent, '小嶋明の技術的な強みは？');
});

test('ダイアログの常時表示は短い説明・モデル行・会話・質問欄の順に絞る', async () => {
  const document = documentFixture();
  ui.mount({ document, transport: ui.createMockTransport() });
  await document.find('pa-launcher').listeners.click();
  const content = document.find('pa-content');
  assert.deepEqual(content.children.map(node => node.className), ['pa-intro', 'pa-model-row', 'pa-guide', 'pa-messages', 'pa-status', 'pa-form']);
  assert.equal(document.find('pa-intro').textContent, 'β版・品質検証中です．公開資料の範囲で回答し，誤りの可能性があるため参照元をご確認ください．');
  assert.deepEqual(document.find('pa-model-row').children.map(node => node.className), ['pa-model-label', 'pa-select', 'pa-region']);
  assert.match(document.find('pa-region').textContent, /^処理地域：/);
  const guide = document.find('pa-guide');
  assert.equal(guide.tagName, 'details');
  assert.equal(guide.children[0].textContent, 'ご利用にあたって（送信先・会話の扱い・利用回数）');
  const form = document.find('pa-form');
  assert.deepEqual(form.children.map(node => node.className), ['pa-form-head', 'pa-quick-replies', 'pa-question', 'pa-form-bottom', 'pa-help pa-record-notice']);
  assert.ok(document.find('pa-form-head').children.includes(document.find('pa-reset')));
  // 常時表示（折りたたみと会話の外）には詳細説明を出さない．
  const visible = content.children.filter(node => node !== guide && node !== document.find('pa-messages')).map(textOf).join(' ');
  assert.doesNotMatch(visible, /表示ログ|切替だけでは送信しません|日替わりの仮名化識別子|ナレッジ検索はAWS|IP／日|AIツールによる分析/);
  // 残り回数は文字数の隣に短く，詳細は折りたたみ内に置く．
  assert.equal(document.find('pa-remaining').parent, document.find('pa-count').parent);
  assert.equal(document.find('pa-remaining').textContent, '本日上限40回');
  assert.ok(hasAncestor(document.find('pa-limit'), guide));
  assert.match(document.find('pa-limit').textContent, /40回／IP／日（UTC）．残り回数は未確認です．失敗した要求も回数に含まれる場合があります/);
  document.find('pa-question').value = '作品';
  await form.listeners.submit({ preventDefault() {} });
  assert.equal(document.find('pa-remaining').textContent, '本日残り39回');
  assert.match(document.find('pa-limit').textContent, /本日あと39回／40回．日本時間9:00に更新/);
});

test('不正なクイックリプライ形式は回答全体を拒否する', async () => {
  const ready = await catalog();
  const session = ui.createSession(async route => route === '/models' ? ready : {
    answer: '回答', suggestions: ['重複', '重複'], model: { id: 'sonnet-5' },
  });
  await session.open();
  await assert.rejects(session.ask('作品'), /answer_invalid/);
  assert.deepEqual(session.snapshot().history, []);
});

test('画面ログは初回案内とモデル名・全文・出典を保ち，10往復しても消さない', async () => {
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
  assert.match(messages.children[0].children[1].textContent, /ポートフォリオ案内AIです/);
  const firstReply = messages.children[2];
  const firstSource = firstReply.children[2].children[0].children[0];
  assert.equal(firstReply.children[0].textContent, 'Claude Sonnet 5');
  assert.equal(Array.from(firstReply.children[1].textContent).length, 1600);
  assert.equal(firstSource.href, 'https://example.invalid/source-1');
  assert.equal(firstSource.target, '_blank');
  assert.equal(firstSource.rel, 'noopener noreferrer');
  const previousHistory = mounted.session.snapshot().history;
  assert.equal(Array.from(previousHistory[1].content).length, 1500);
  select.value = 'terra'; select.listeners.change();
  assert.equal(messages.children.length, 3);
  assert.equal(messages.children[2], firstReply);
  assert.deepEqual(mounted.session.snapshot().history, previousHistory);
  assert.equal(calls.length, 2);
  assert.match(document.find('pa-status').textContent, /次の送信時に，他モデルとの直近の会話も/);
  await ask('質問1');
  assert.equal(calls.at(-1).body.model, 'terra');
  assert.deepEqual(calls.at(-1).body.history, previousHistory);
  assert.equal(messages.children[4].children[0].textContent, 'GPT-5.6 Terra');
  for (let i = 2; i < 10; i++) await ask('質問' + i);
  assert.equal(messages.children.length, 21);
  assert.equal(messages.children[1].children[1].textContent, '質問0');
  assert.equal(messages.children[2], firstReply);
  assert.equal(firstReply.children[2].children[0].children[0], firstSource);
  assert.equal(firstSource.href, 'https://example.invalid/source-1');
  assert.equal(calls.at(-1).body.history.length, 16);
  assert.equal(calls.at(-1).body.history[0].content, '質問1');
  assert.equal(mounted.session.snapshot().history[0].content, '質問2');
  document.find('pa-close').listeners.click();
  await document.find('pa-launcher').listeners.click();
  assert.equal(messages.children.length, 21);
  assert.equal(calls.length, 11);
});

test('表示ログとAPI文脈の保存範囲を分け，切替後の送信先変更を案内する', async () => {
  const document = documentFixture();
  ui.mount({ document, transport: ui.createMockTransport() });
  await document.find('pa-launcher').listeners.click();
  const notices = textOf(document.find('pa-guide'));
  assert.match(notices, /表示ログはページを開いている間だけ残ります/);
  assert.match(notices, /AIへ送る文脈は直近8往復で，各回答は1500文字まで/);
  assert.match(notices, /再読み込みで消えます/);
  assert.match(notices, /切替だけでは送信しません/);
  assert.match(notices, /他モデルとの直近の会話も選択した回答生成先へ送信/);
  assert.match(notices, /引き継ぎたくない場合は，送信前に会話をリセット/);
  assert.doesNotMatch(notices, /会話をリセットします|直近8往復のみ保持/);
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
  assert.equal(messages.children.length, 1);
  assert.match(messages.children[0].children[1].textContent, /質問をどうぞ/);
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
    await document.find('pa-launcher').listeners.click();
    const privacy = textOf(document.find('pa-guide'));
    assert.match(privacy, /ナレッジ検索はAWS/);
    assert.match(privacy, /選択モデルの設定に応じてAWS・OpenAI・Anthropic/);
    assert.match(privacy, /質問・直近8往復の会話・検索した公開資料を回答生成先へ送信/);
    assert.match(privacy, /実際の送信先と処理地域は選択モデルの案内/);
    assert.match(privacy, /提供元の保持条件は各社の規定/);
    const select = document.find('pa-select');
    assert.equal(select.value, 'qwen-235b');
    assert.deepEqual(select.children.map(option => option.value), value.models.map(model => model.id));
    for (const model of value.models) {
      select.value = model.id;
      select.listeners.change();
      assert.equal(document.find('pa-model-privacy').textContent, model.privacy_notice);
      assert.ok(hasAncestor(document.find('pa-model-privacy'), document.find('pa-guide')));
    }
    assert.deepEqual(calls, ['/models']);
  }
});

test('模擬UIは実際の提供元への送信を示さない', () => {
  const document = documentFixture();
  ui.mount({ document, preview: true, transport: ui.createMockTransport() });
  const privacy = textOf(document.find('pa-guide'));
  assert.match(privacy, /入力した質問はAWSへ送信されません/);
  assert.doesNotMatch(privacy, /回答生成先へ送信します/);
});

const RECORD_NOTICE_TEXT = '誤回答の修正，回答品質の改善，不適切な利用の確認のため，質問と回答の本文を記録します．記録はAIツールによる分析や，本人（小嶋明）が確認することがあります．IPアドレスなど利用者を特定する情報は本文と結び付けて保存せず，記録は90日で削除します．個人情報や社外秘の内容は入力しないでください．';

const RECORD_NOTICE_SHORT_TEXT = '質問と回答は品質改善・不適切な利用の確認のため記録し，90日で削除します．個人情報や社外秘は入力しないでください．';

test('実接続時は短い記録告知を送信ボタンの直後に常時表示し，確定した全文を折りたたみ内に置く', async () => {
  const document = documentFixture();
  ui.mount({ document, transport: ui.createMockTransport() });
  const form = document.find('pa-form');
  const notice = document.find('pa-record-notice');
  assert.ok(notice, '告知が必要');
  // 開く前（未通信）から，折りたたみではなくフォーム内に表示する．
  assert.equal(notice.tagName, 'p');
  assert.equal(notice.parent, form);
  assert.ok(notice.className.split(' ').includes('pa-help'));
  const bottom = document.find('pa-form-bottom');
  assert.ok(bottom.children.includes(document.find('pa-submit')));
  assert.equal(form.children.indexOf(notice), form.children.indexOf(bottom) + 1);
  assert.equal(form.children.at(-1), notice);
  assert.equal(notice.textContent, RECORD_NOTICE_SHORT_TEXT);
  assert.equal(ui.RECORD_NOTICE_SHORT, RECORD_NOTICE_SHORT_TEXT);
  assert.ok(document.find('pa-question').attributes['aria-describedby'].split(' ').includes(notice.id));
  let parent = notice.parent;
  while (parent) { assert.notEqual(parent.tagName, 'details'); parent = parent.parent; }
  // 本人が確定した全文は一字一句そのまま「ご利用にあたって」の中に1回だけ置く．
  const guide = document.find('pa-guide');
  const full = document.find('pa-record-full');
  assert.equal(full.textContent, RECORD_NOTICE_TEXT);
  assert.equal(ui.RECORD_NOTICE, RECORD_NOTICE_TEXT);
  assert.ok(hasAncestor(full, guide));
  assert.equal(document.findAll('pa-record-full').length, 1);
  assert.doesNotMatch(textOf(form), /AIツールによる分析/);
  await document.find('pa-launcher').listeners.click();
  document.find('pa-question').value = '研究について';
  await form.listeners.submit({ preventDefault() {} });
  assert.equal(document.find('pa-record-notice'), notice);
  assert.equal(notice.textContent, RECORD_NOTICE_SHORT_TEXT);
  assert.equal(full.textContent, RECORD_NOTICE_TEXT);
  const privacy = textOf(guide);
  assert.doesNotMatch(privacy, /通常保存せず|履歴データベースやアプリケーションログ/);
  assert.match(privacy, /質問と回答の本文は下記「質問と回答の記録」のとおり記録し，90日で削除します/);
  assert.match(privacy, /このページを開いている間だけブラウザに保持/);
  assert.match(privacy, /日替わりの仮名化識別子/);
  const source = fs.readFileSync(path.join(__dirname, '../assets/assistant.js'), 'utf8');
  assert.doesNotMatch(source, /通常保存せず/);
});

test('模擬プレビューでは本文記録の告知を出さない', async () => {
  const document = documentFixture();
  ui.mount({ document, preview: true, transport: ui.createMockTransport() });
  await document.find('pa-launcher').listeners.click();
  assert.equal(document.find('pa-record-notice'), undefined);
  assert.equal(document.find('pa-record-full'), undefined);
  assert.doesNotMatch(textOf(document.body), /90日で削除/);
  assert.equal(document.find('pa-remaining').textContent, '模擬・本日上限40回');
  assert.equal(document.find('pa-question').attributes['aria-describedby'], document.find('pa-count').id);
});
