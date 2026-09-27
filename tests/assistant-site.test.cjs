/* 公開接続を行わない，組込み設定と安全な初期状態のテスト． */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const site = require('../assets/assistant-site.js');
const ui = require('../assets/assistant.js');
function fixture(endpoint) {
  const container = { dataset: {} };
  const status = { textContent: '準備中' };
  const document = {
    getElementById: (id) => ({ 'assistant-mount': container, 'assistant-availability': status })[id],
    querySelector: () => endpoint === undefined ? null : { content: endpoint },
  };
  return { container, status, document };
}
test('未設定・空欄の接続先ではmountもfetchも行わない', () => {
  for (const endpoint of [undefined, '', '   ']) {
    const { document, status } = fixture(endpoint);
    assert.equal(site.start(document, { mount: () => assert.fail('呼び出し禁止') }), null);
    assert.equal(status.textContent, '準備中');
  }
});
test('有効な設定はmountへ渡すだけで重複起動を避ける', () => {
  const state = fixture('https://example.invalid/api');
  let calls = 0;
  const stub = { mount: (options) => { calls++; assert.equal(options.endpoint, 'https://example.invalid/api'); assert.equal(options.container, state.container); return 'widget'; } };
  assert.equal(site.start(state.document, stub), 'widget');
  assert.equal(site.start(state.document, stub), null);
  assert.equal(calls, 1);
  assert.match(state.status.textContent, /送信.*まで送られません/);
});
test('接続先検証の例外を安全な案内にし，内部値を表示しない', () => {
  const { document, status, container } = fixture('http://invalid.example');
  assert.equal(site.start(document, { mount: ({ endpoint }) => ui.createHttpTransport(endpoint) }), null);
  assert.match(status.textContent, /現在.*利用できません/);
  assert.doesNotMatch(status.textContent, /invalid.example/);
  assert.equal(container.dataset.assistantMounted, undefined);
});
test('UIの読み込み失敗時も本体ページを壊さない', () => {
  const { document, status } = fixture('https://example.invalid');
  assert.equal(site.start(document, undefined), null);
  assert.match(status.textContent, /読み込めません/);
  assert.equal(site.start({ getElementById: () => null }, ui), null);
});
test('HTMLは接続先を空欄に保ち，静的な準備中案内と明示ラベルがある', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /name="portfolio-assistant-endpoint" content=""/);
  assert.match(html, /id="assistant"[^>]+no-print[^>]+aria-labelledby="assistant-title"/);
  assert.match(html, /id="assistant-availability"[^>]+role="status">準備中/);
  assert.match(html, /参照元付きで確認できるAI質問対応を準備しています/);
  assert.match(html, /src="assets\/assistant.js" defer/);
  assert.match(html, /src="assets\/assistant-site.js" defer/);
  const bridge = fs.readFileSync(path.join(__dirname, '../assets/assistant-site.js'), 'utf8');
  assert.doesNotMatch(bridge, /localStorage|sessionStorage|location\.|fetch\(|createMockTransport/);
});
test('起動ボタンは本文中に置き，PDFと印刷には質問対応を出さない', () => {
  const css = fs.readFileSync(path.join(__dirname, '../assets/assistant-site.css'), 'utf8');
  assert.match(css, /#assistant \.pa-launcher \{ position: static/);
  assert.match(css, /body\.pdf-summary #assistant/);
  assert.match(css, /@media print/);
});
