/* 標準Nodeだけで検査するメディアビューアーの回帰テスト．外部通信は行わない． */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const viewer = require('../assets/media-viewer.js');

const BASE = 'https://kojima8924.github.io/';
const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const camel = (name) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

// 実装で必要なDOM操作だけを再現する．画像・iframeのsrc代入は通信しない．
class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document;
    this.attributes = new Map(); this.children = []; this.parentElement = null;
    this.style = {}; this.dataset = {}; this.listeners = new Map(); this._text = '';
    this.disabled = false; this.hidden = false; this.clientWidth = 900; this.clientHeight = 600;
    this.scrollLeft = 0; this.scrollTop = 0; this.pauseCalls = 0; this.loadCalls = 0;
    this.complete = true; this.naturalWidth = 1200; this.naturalHeight = 800;
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(' '); },
      toggle: (name, force) => { const add = force ?? !this.classList.contains(name); this.classList[add ? 'add' : 'remove'](name); return add; },
    };
  }
  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', value); }
  get id() { return this.getAttribute('id') || ''; }
  set id(value) { this.setAttribute('id', value); }
  get href() { return this.getAttribute('href') ? new URL(this.getAttribute('href'), this.ownerDocument.baseURI).href : ''; }
  set href(value) { this.setAttribute('href', value); }
  get src() { return this.getAttribute('src') ? new URL(this.getAttribute('src'), this.ownerDocument.baseURI).href : ''; }
  set src(value) { this.setAttribute('src', value); }
  get currentSrc() { return this.src; }
  get alt() { return this.getAttribute('alt') || ''; }
  set alt(value) { this.setAttribute('alt', value); }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentElement?.isConnected); }
  get parentNode() { return this.parentElement; }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() { const list = this.parentElement?.children || []; return list[list.indexOf(this) + 1] || null; }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) this.dataset[camel(name.slice(5))] = String(value);
    if (name === 'hidden') this.hidden = true;
    if (name === 'disabled') this.disabled = true;
    if (name === 'tabindex') this.tabIndex = Number(value);
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name.startsWith('data-')) delete this.dataset[camel(name.slice(5))];
    if (name === 'hidden') this.hidden = false;
  }
  append(...children) { for (const child of children) { if (typeof child === 'string') { this._text += child; continue; } child.remove(); child.parentElement = this; this.children.push(child); } }
  appendChild(child) { this.append(child); return child; }
  prepend(...children) { for (const child of children.reverse()) { child.remove(); child.parentElement = this; this.children.unshift(child); } }
  replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...children); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); this.parentElement = null; }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  matches(selector) {
    return selector.split(',').some((part) => {
      let simple = part.trim();
      const negative = [...simple.matchAll(/:not\(([^)]+)\)/g)];
      if (negative.some((match) => this.matches(match[1]))) return false;
      simple = simple.replace(/:not\([^)]+\)/g, '');
      const tag = simple.match(/^[a-z][\w-]*/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      for (const match of simple.matchAll(/([.#])([\w-]+)/g)) {
        if (match[1] === '.' && !this.classList.contains(match[2])) return false;
        if (match[1] === '#' && this.id !== match[2]) return false;
      }
      for (const match of simple.matchAll(/\[([\w-]+)(?:([~^$*]?=)["']?([^\]"']*)["']?)?\]/g)) {
        const value = this.getAttribute(match[1]);
        if (value === null) return false;
        if (!match[2]) continue;
        const wanted = match[3];
        if (match[2] === '=' && value !== wanted) return false;
        if (match[2] === '^=' && !value.startsWith(wanted)) return false;
        if (match[2] === '$=' && !value.endsWith(wanted)) return false;
        if (match[2] === '*=' && !value.includes(wanted)) return false;
      }
      return true;
    });
  }
  closest(selector) { for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current; return null; }
  querySelectorAll(selector) {
    const result = [];
    const alternatives = selector.split(',').map((part) => part.trim().split(/\s+(?![^\[]*\])/));
    const visit = (node) => {
      for (const child of node.children) {
        if (alternatives.some((parts) => {
          if (!child.matches(parts.at(-1))) return false;
          let ancestor = child.parentElement;
          for (let i = parts.length - 2; i >= 0; i--) { while (ancestor && !ancestor.matches(parts[i])) ancestor = ancestor.parentElement; if (!ancestor) return false; ancestor = ancestor.parentElement; }
          return true;
        })) result.push(child);
        visit(child);
      }
    };
    visit(this); return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
  removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== callback)); }
  emit(type, properties = {}) {
    const event = { type, target: this, currentTarget: this, button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...properties };
    for (const callback of [...(this.listeners.get(type) || [])]) callback(event);
    return event;
  }
  focus(options) { this.ownerDocument.activeElement = this; this.focusOptions = options; }
  getBoundingClientRect() { return { width: this.clientWidth, height: this.clientHeight }; }
  pause() { this.pauseCalls++; }
  load() { this.loadCalls++; }
}

function fixture(html = '') {
  const document = { baseURI: BASE, activeElement: null, readyState: 'complete' };
  document.body = new Element('body', document);
  document.createElement = (tag) => new Element(tag, document);
  document.getElementById = (id) => document.body.querySelector('#' + id);
  document.querySelectorAll = (selector) => document.body.querySelectorAll(selector);
  document.querySelector = (selector) => document.body.querySelector(selector);
  const events = new Element('document', document);
  document.addEventListener = events.addEventListener.bind(events);
  document.removeEventListener = events.removeEventListener.bind(events);
  document.emit = events.emit.bind(events);
  const window = new Element('window', document);
  window.innerWidth = 960; window.innerHeight = 800;
  window.setTimeout = () => 1; window.clearTimeout = () => {};
  window.requestAnimationFrame = (callback) => { callback(); return 1; };
  document.defaultView = window;
  // HTML本文だけを読み，script/style/commentをDOM fixtureへ混入させない．
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
  const clean = body.replace(/<!--[^]*?-->|<(script|style)\b[^>]*>[^]*?<\/\1>/gi, '');
  const stack = [document.body];
  const voids = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
  for (const token of clean.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) {
    if (!token[0].startsWith('<')) { stack.at(-1)._text += token[0]; continue; }
    const name = token[0].match(/^<\/?([\w-]+)/)[1];
    if (token[0].startsWith('</')) { while (stack.length > 1) if (stack.pop().tagName === name.toUpperCase()) break; continue; }
    const element = document.createElement(name);
    const attrs = token[0].slice(token[0].indexOf(name) + name.length, -1);
    for (const attr of attrs.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) element.setAttribute(attr[1], attr[2] ?? attr[3] ?? attr[4] ?? '');
    stack.at(-1).append(element);
    if (!voids.test(name) && !token[0].endsWith('/>')) stack.push(element);
  }
  return { document, window, overlay: document.getElementById('lightbox') };
}

function linkFixture(kind = 'image', source = 'media/one.png', extra = '') {
  return fixture(`<main><article id="one"><h3>作品</h3><a data-media-kind="${kind}" href="${source}" ${extra}><img src="media/thumb.png" alt="作品の説明" width="1200" height="800"></a></article></main><aside inert></aside><div id="lightbox" role="dialog" aria-modal="true" aria-hidden="true" inert></div>`);
}

function byLabel(root, label) { const found = root.querySelector(`[aria-label="${label}"]`); assert.ok(found, `操作がある: ${label}`); return found; }
function mount(state) { return viewer.mount(state.document, state.window); }

test('モジュールの読込だけではDOM・通信に依存せず，APIを公開する', () => {
  for (const name of ['mount', 'describeMedia', 'isPlainActivation']) assert.equal(typeof viewer[name], 'function');
  assert.doesNotMatch(read('assets/media-viewer.js'), /\bfetch\s*\(|XMLHttpRequest|sendBeacon|innerHTML\s*=/);
});

test('通常操作だけをモーダルへ取り込み，修飾キー・中クリックを保つ', () => {
  assert.equal(viewer.isPlainActivation({ button: 0 }), true);
  for (const flags of [{ button: 1 }, { button: 2 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) assert.equal(viewer.isPlainActivation({ button: 0, ...flags }), false);
});

test('画像は同一originのmedia配下のみで，外部・資格情報・危険なschemeを拒否する', () => {
  for (const source of ['media/one.png', 'media/two.webp?v=caption', BASE + 'media/one.svg']) {
    const state = linkFixture('image', source);
    const media = viewer.describeMedia(state.document.querySelector('a'), BASE);
    assert.equal(media.kind, 'image'); assert.equal(media.src, new URL(source, BASE).href);
  }
  for (const source of ['javascript:alert(1)', 'data:image/svg+xml,bad', 'https://evil.invalid/media/a.png', 'https://user:secret@kojima8924.github.io/media/a.png', '/secrets/a.png', 'media/../../private.png', 'http://kojima8924.github.io/media/a.png']) {
    const state = linkFixture('image', source);
    assert.equal(viewer.describeMedia(state.document.querySelector('a'), BASE), null, source);
  }
});

test('動画は正規nico動画URLとdata-nicoの一致から固定embed先を作る', () => {
  const state = linkFixture('video', 'https://www.nicovideo.jp/watch/sm46610886', 'data-nico="sm46610886"');
  const media = viewer.describeMedia(state.document.querySelector('a'), BASE);
  assert.equal(media.kind, 'video'); assert.equal(media.src, 'https://embed.nicovideo.jp/watch/sm46610886');
  for (const [source, id] of [
    ['https://evil.invalid/watch/sm46610886', 'sm46610886'],
    ['https://www.nicovideo.jp.evil.invalid/watch/sm46610886', 'sm46610886'],
    ['https://user:pass@www.nicovideo.jp/watch/sm46610886', 'sm46610886'],
    ['http://www.nicovideo.jp/watch/sm46610886', 'sm46610886'],
    ['https://www.nicovideo.jp/watch/sm46610886', 'sm1'],
    ['https://www.nicovideo.jp/watch/sm46610886', '../sm46610886'],
  ]) {
    const item = linkFixture('video', source, `data-nico="${id}"`);
    assert.equal(viewer.describeMedia(item.document.querySelector('a'), BASE), null, `${source} ${id}`);
  }
});

test('画像を開くと背景をinert化し，閉じると既存状態・スクロール・フォーカスを戻す', () => {
  const state = linkFixture(); state.document.body.style.overflow = 'auto';
  const api = mount(state); const link = state.document.querySelector('a');
  api.open(link);
  assert.equal(state.overlay.getAttribute('aria-hidden'), 'false');
  assert.equal(state.overlay.hasAttribute('inert'), false);
  assert.equal(state.document.querySelector('main').hasAttribute('inert'), true);
  assert.equal(state.document.body.style.overflow, 'hidden');
  assert.ok(state.overlay.contains(state.document.activeElement));
  api.close();
  assert.equal(state.overlay.getAttribute('aria-hidden'), 'true');
  assert.equal(state.overlay.hasAttribute('inert'), true);
  assert.equal(state.document.querySelector('main').hasAttribute('inert'), false);
  assert.equal(state.document.querySelector('aside').hasAttribute('inert'), true);
  assert.equal(state.document.body.style.overflow, 'auto');
  assert.equal(state.document.activeElement, link);
  assert.deepEqual(link.focusOptions, { preventScroll: true });
  assert.equal(state.overlay.children.length, 0);
});

test('通常クリックは同じページで開き，修飾クリックとdestroy後は元のリンク操作を保つ', () => {
  const state = linkFixture(); const api = mount(state); const link = state.document.querySelector('a');
  const modified = link.emit('click', { ctrlKey: true });
  assert.equal(modified.defaultPrevented, false);
  assert.equal(state.overlay.getAttribute('aria-hidden'), 'true');
  const ordinary = link.emit('click');
  assert.equal(ordinary.defaultPrevented, true);
  assert.equal(state.overlay.getAttribute('aria-hidden'), 'false');
  api.destroy();
  assert.equal(state.overlay.getAttribute('aria-hidden'), 'true');
  assert.equal(link.emit('click').defaultPrevented, false);
  assert.equal(state.overlay.getAttribute('aria-hidden'), 'true');
});

test('Escで閉じ，Tab/Shift+Tabはモーダルの両端を循環する', () => {
  const state = linkFixture(); const api = mount(state); api.open(state.document.querySelector('a'));
  const controls = state.overlay.querySelectorAll('button, a[href], iframe, video[controls], [tabindex]:not([tabindex="-1"])').filter((element) => !element.disabled && !element.hidden);
  assert.ok(controls.length > 2);
  controls.at(-1).focus(); const tab = state.document.emit('keydown', { key: 'Tab' });
  assert.equal(tab.defaultPrevented, true); assert.equal(state.document.activeElement, controls[0]);
  controls[0].focus(); const back = state.document.emit('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(back.defaultPrevented, true); assert.equal(state.document.activeElement, controls.at(-1));
  state.document.emit('keydown', { key: 'Escape' });
  assert.equal(state.overlay.getAttribute('aria-hidden'), 'true');
});

test('画像の拡大・縮小・全体表示は独立し，表示幅を変更する', () => {
  const state = linkFixture(); const api = mount(state); api.open(state.document.querySelector('a'));
  const stage = state.overlay.querySelector('.lightbox-stage');
  const initial = Number.parseFloat(stage.style.width);
  assert.ok(initial > 0);
  byLabel(state.overlay, '画像を拡大').emit('click');
  assert.ok(Number.parseFloat(stage.style.width) > initial);
  byLabel(state.overlay, '画像全体を表示').emit('click');
  assert.equal(Number.parseFloat(stage.style.width), initial);
  assert.equal(byLabel(state.overlay, '画像を縮小').disabled, true);
});

test('動画は開くまでiframeを作らず，配信元の補助リンクを残し閉じるとiframeを破棄する', () => {
  const state = linkFixture('video', 'https://www.nicovideo.jp/watch/sm46610886', 'data-nico="sm46610886"');
  const api = mount(state); assert.equal(state.overlay.querySelector('iframe'), null);
  api.open(state.document.querySelector('a'));
  const iframe = state.overlay.querySelector('iframe'); assert.ok(iframe);
  assert.equal(iframe.src, 'https://embed.nicovideo.jp/watch/sm46610886');
  const source = state.overlay.querySelector('a[href]');
  assert.equal(source.href, 'https://www.nicovideo.jp/watch/sm46610886');
  assert.match(source.rel, /noopener/); assert.match(source.rel, /noreferrer/);
  assert.match(source.textContent, /配信元|動画ページ/);
  api.close(); assert.equal(state.overlay.querySelector('iframe'), null); assert.equal(iframe.isConnected, false);
});

test('動画は横向きの低い表示領域でも16:9で収まり，縦向きへのリサイズに追従する', () => {
  const state = linkFixture('video', 'https://www.nicovideo.jp/watch/sm46610886', 'data-nico="sm46610886"');
  const api = mount(state); api.open(state.document.querySelector('a'));
  const viewport = state.overlay.querySelector('.lightbox-viewport');
  const iframe = state.overlay.querySelector('iframe');
  // CSSレイアウト自体は実ブラウザで確認する．ここでは得られた閲覧領域を入力する．
  for (const [availableWidth, availableHeight] of [[812, 185], [370, 600], [1248, 675]]) {
    viewport.clientWidth = availableWidth; viewport.clientHeight = availableHeight;
    state.window.emit('resize');
    const width = Number.parseFloat(iframe.style.width);
    const height = Number.parseFloat(iframe.style.height);
    assert.ok(width > 0 && height > 0, '縦横の寸法を設定する');
    assert.ok(width <= availableWidth && height <= availableHeight, '表示領域をはみ出さない');
    assert.ok(Math.abs(width / height - 16 / 9) < 0.001, '高さだけを縮めて動画を歪めない');
  }
  api.close(); const closedSize = [iframe.style.width, iframe.style.height];
  viewport.clientHeight = 100; state.window.emit('resize');
  assert.deepEqual([iframe.style.width, iframe.style.height], closedSize, '閉鎖後の動画は更新しない');
});

test('画像の読込失敗でも閉じる操作と代替案内が残る', () => {
  const state = linkFixture(); const api = mount(state); api.open(state.document.querySelector('a'));
  state.overlay.querySelector('img').emit('error');
  assert.match(state.overlay.textContent, /読み込|表示でき/);
  state.window.emit('resize');
  assert.equal(byLabel(state.overlay, '画像を拡大').disabled, true);
  assert.equal(byLabel(state.overlay, '画像を縮小').disabled, true);
  byLabel(state.overlay, '拡大表示を閉じる').emit('click');
  assert.equal(state.overlay.getAttribute('aria-hidden'), 'true');
});

test('遅れて届く画像イベントは閉じたモーダルを復活させず，印刷開始でも停止する', () => {
  const state = linkFixture(); const api = mount(state); const link = state.document.querySelector('a');
  api.open(link); const image = state.overlay.querySelector('img');
  state.window.emit('beforeprint');
  assert.equal(state.overlay.getAttribute('aria-hidden'), 'true');
  image.emit('load'); image.emit('error'); state.window.emit('resize');
  assert.equal(state.overlay.children.length, 0);
  assert.equal(state.document.activeElement, link);
});

test('不正なメディアやモーダル欠落で通常のページを壊さない', () => {
  const state = linkFixture('video', 'https://evil.invalid/watch/sm1', 'data-nico="sm1"');
  const api = mount(state); api.open(state.document.querySelector('a'));
  assert.equal(state.overlay.getAttribute('aria-hidden'), 'true');
  assert.equal(state.document.body.style.overflow, undefined);
  assert.doesNotThrow(() => mount(fixture('<main>本文</main>')));
});

test('HTMLの全作品画像が統一導線を持ち，資格バッジを対象に含めない', () => {
  const state = fixture(read('index.html')); const api = mount(state);
  const images = state.document.querySelectorAll('.media-hero img, .media-thumb img, .media-phone img, .cfa-shot img, .flow-shot img, .fig-band img, .cg-media img');
  assert.ok(images.length >= 30, `対象画像数: ${images.length}`);
  for (const image of images) {
    const link = image.closest('a[data-media-kind]');
    assert.ok(link, `${image.getAttribute('src')}: メディアリンクがある`);
    assert.ok(viewer.describeMedia(link, BASE), `${image.getAttribute('src')}: 許可されたメディア`);
    assert.match(link.textContent, /動画を見る|画像を拡大/, `${image.getAttribute('src')}: 常時ラベルがある`);
    assert.equal(link.getAttribute('aria-haspopup'), 'dialog');
    assert.equal(link.emit('click').defaultPrevented, true, `${image.getAttribute('src')}: 通常クリックは遷移しない`);
    assert.equal(state.overlay.getAttribute('aria-hidden'), 'false');
    assert.ok(state.overlay.querySelector(link.dataset.mediaKind === 'video' ? 'iframe' : 'img'));
    api.close();
  }
  const badge = state.document.querySelector('.cert-badge');
  assert.ok(badge); assert.equal(badge.hasAttribute('data-media-kind'), false);
  assert.equal(badge.getAttribute('target'), '_blank');
});

test('ScriptVEditとCG2作品は動画，シャドウマッピングは画像拡大に統一する', () => {
  const state = fixture(read('index.html'));
  for (const [id, kind, token] of [
    ['scriptvedit-card', 'video', 'sm46610886'],
    ['raytrace-python-card', 'video', 'sm45922410'],
    ['raytrace-csg-card', 'video', 'sm45922403'],
    ['shadowmap-card', 'image', 'media/shadowmap.jpg'],
  ]) {
    const section = state.document.getElementById(id); const image = section.querySelector('img');
    const link = image.closest('a[data-media-kind]');
    assert.ok(link, id); assert.equal(link.dataset.mediaKind, kind, id);
    assert.ok(link.href.includes(token));
    assert.match(link.textContent, kind === 'video' ? /動画を見る/ : /画像を拡大/);
  }
  assert.doesNotMatch(read('index.html'), /画像を開く ↗/);
  assert.match(read('index.html'), /src="assets\/media-viewer.js"[^>]*defer/);
});

test('同一作品の複数画像は前後に移動でき，説明と枚数を更新する', () => {
  const state = fixture(read('index.html')); const api = mount(state);
  const group = state.document.getElementById('trivium-card');
  const links = group.querySelectorAll('a[data-media-kind="image"]'); assert.ok(links.length >= 2);
  api.open(links[0]);
  const first = state.overlay.querySelector('img').src;
  byLabel(state.overlay, '次のメディア').emit('click');
  assert.notEqual(state.overlay.querySelector('img').src, first);
  assert.ok(state.overlay.querySelector('.lightbox-caption').textContent.trim());
  assert.match(state.overlay.querySelector('.lightbox-position').textContent, /2\s*\/\s*\d+/);
  byLabel(state.overlay, '前のメディア').emit('click');
  assert.equal(state.overlay.querySelector('img').src, first);
  api.close(); assert.equal(state.document.activeElement, links[0]);
});

test('ScriptVEditの同じ動画への複数導線は重複せず，画像へ切り替えると再生を止める', () => {
  const state = fixture(read('index.html')); const api = mount(state);
  const article = state.document.getElementById('scriptvedit-card');
  const link = article.querySelector('a[data-media-kind="video"]');
  api.open(link);
  const iframe = state.overlay.querySelector('iframe'); assert.ok(iframe);
  assert.match(state.overlay.querySelector('.lightbox-position').textContent, /^1\s*\/\s*3\b/);
  assert.equal(byLabel(state.overlay, '前のメディア').disabled, true);
  byLabel(state.overlay, '次のメディア').emit('click');
  assert.equal(iframe.isConnected, false); assert.equal(state.overlay.querySelector('iframe'), null);
  assert.ok(state.overlay.querySelector('img'));
  byLabel(state.overlay, '次のメディア').emit('click');
  assert.equal(byLabel(state.overlay, '次のメディア').disabled, true);
  api.close(); assert.equal(state.document.activeElement, link);
});
