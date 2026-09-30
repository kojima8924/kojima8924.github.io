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
    assert.match(status.textContent, /^準備中です．現在は質問を送信できません/);
  }
});
test('有効な設定はmountへ渡すだけで重複起動を避ける', () => {
  const state = fixture('https://example.invalid/api');
  let calls = 0;
  const stub = { mount: (options) => { calls++; assert.equal(options.endpoint, 'https://example.invalid/api'); assert.equal(options.container, state.container); return 'widget'; } };
  assert.equal(site.start(state.document, stub), 'widget');
  assert.equal(site.start(state.document, stub), null);
  assert.equal(calls, 1);
  assert.match(state.status.textContent, /β版/);
  assert.match(state.status.textContent, /送信.*まで送られません/);
  assert.match(state.status.textContent, /個人情報・機密情報は入力しない/);
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
test('HTMLは公開βの接続先を明示し，無通信の初期化と静的な代替案内を維持する', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const endpoint = html.match(/name="portfolio-assistant-endpoint" content="([^"]+)"/)[1];
  assert.equal(endpoint, 'https://9m4lkt83ab.execute-api.ap-northeast-1.amazonaws.com');
  assert.doesNotThrow(() => ui.createHttpTransport(endpoint, () => assert.fail('初期化時の通信は禁止')));
  assert.match(html, /id="assistant"[^>]+no-print[^>]+aria-labelledby="assistant-title"/);
  assert.match(html, /id="assistant-availability"[^>]+role="status">質問欄の表示にはJavaScriptが必要/);
  assert.match(html, /β版・品質検証中/);
  assert.match(html, /質問によっては回答できない場合もあります/);
  assert.match(html, /研究・作品・経歴に加え，公開資料にある経験・活動・開発の考え方も/);
  assert.match(html, /資料にないことや私的な情報は対象外/);
  assert.match(html, /担当範囲や実績の説明にも誤りがあり得るため，必ず参照元/);
  assert.match(html, /src="assets\/assistant\.js\?v=20260929-history" defer/);
  assert.match(html, /src="assets\/assistant-site\.js\?v=20260929-beta2" defer/);
  const bridge = fs.readFileSync(path.join(__dirname, '../assets/assistant-site.js'), 'utf8');
  assert.doesNotMatch(bridge, /localStorage|sessionStorage|location\.|fetch\(|createMockTransport/);
  const js = fs.readFileSync(path.join(__dirname, '../assets/assistant.js'), 'utf8');
  assert.doesNotMatch(js + bridge, /localTrial|__trial|127\.0\.0\.1|OPENAI_API_KEY|ANTHROPIC_API_KEY/);
});
test('起動ボタンは本文中に置き，PDFと印刷には質問対応を出さない', () => {
  const css = fs.readFileSync(path.join(__dirname, '../assets/assistant-site.css'), 'utf8');
  assert.match(css, /#assistant \.pa-launcher \{ position: static/);
  assert.match(css, /body\.pdf-summary #assistant/);
  assert.match(css, /@media print/);
});

test('AI質問欄はプロフィール後・研究直前に一度だけ置き，ナビにも案内する', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)[1];
  const sections = [...main.matchAll(/<section\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(sections.slice(0, 2), ['assistant', 'research']);
  assert.equal(sections.filter((id) => id === 'assistant').length, 1);
  assert.ok(html.indexOf('</header>') < html.indexOf('<section id="assistant"'));
  assert.match(html, /id="assistant-title"[^>]*>AIに作品・経歴・小嶋明について質問する<\/h2>/);
  const nav = html.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/)[1];
  assert.match(nav, /<li class="nav-item no-print"><a class="nav-link" href="#assistant">AIに質問<\/a><\/li>/);
  assert.ok(nav.indexOf('href="#assistant"') < nav.indexOf('href="#research"'));
});
