/* 公開前の再利用用UI．開く操作がない限り通信しない． */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PortfolioAssistant = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ALIASES = Object.freeze(['sonnet-5', 'terra', 'qwen-235b', 'glm-5', 'kimi-k2-5']);
  const characters = (text) => Array.from(text);
  const clipped = (text, maximum) => characters(text).slice(0, maximum).join('');
  const validText = (value, maximum) => typeof value === 'string' && value.trim() && characters(value).length <= maximum;
  const regionLabel = (region) => ({ global: 'グローバル推論（国外処理あり）', 'ap-northeast-1': '東京' })[region] || region;

  function safeHttps(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch (_) { return null; }
  }

  function validateCatalog(value) {
    if (!value || !Array.isArray(value.models) || value.models.length > ALIASES.length) throw new Error('catalog_invalid');
    const seen = new Set();
    const models = value.models.map((model) => {
      if (!model || !ALIASES.includes(model.id) || seen.has(model.id) ||
          !validText(model.label, 100) || !validText(model.processing_region, 500) || !validText(model.privacy_notice, 2000)) {
        throw new Error('catalog_invalid');
      }
      seen.add(model.id);
      return { id: model.id, label: model.label, processing_region: model.processing_region, privacy_notice: model.privacy_notice };
    });
    if (models.length && !seen.has(value.default_model)) throw new Error('catalog_invalid');
    return { default_model: models.length ? value.default_model : null, models };
  }

  function createHttpTransport(endpoint, fetcher) {
    const address = safeHttps(endpoint);
    if (!address) throw new Error('endpoint_invalid');
    const base = new URL(address);
    if (base.search || base.hash) throw new Error('endpoint_invalid');
    const prefix = base.href.replace(/\/$/, '');
    return async function (path, body) {
      if (path !== '/models' && path !== '/ask') throw new Error('route_invalid');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await (fetcher || globalThis.fetch)(prefix + path, {
          method: path === '/models' ? 'GET' : 'POST',
          headers: body ? { 'Content-Type': 'application/json' } : {},
          ...(body ? { body: JSON.stringify(body) } : {}),
          credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
          redirect: 'error', signal: controller.signal,
        });
        let data;
        try { data = await response.json(); } catch (_) { data = {}; }
        if (!response.ok) {
          const error = new Error('request_failed');
          error.status = response.status;
          error.code = data.error && data.error.code;
          throw error;
        }
        return data;
      } finally { clearTimeout(timer); }
    };
  }

  function createSession(transport) {
    let catalog = null, modelId = null, history = [], busy = false, remaining = null, resetsAt = null;
    return {
      snapshot() { return { catalog, modelId, history: history.map((item) => ({ ...item })), busy, remaining, resetsAt }; },
      async open() {
        if (catalog) return catalog;
        if (busy) throw new Error('busy');
        busy = true;
        try {
          catalog = validateCatalog(await transport('/models'));
          modelId = catalog.default_model;
          return catalog;
        } finally { busy = false; }
      },
      select(id) {
        if (busy) throw new Error('busy');
        if (!catalog || !catalog.models.some((model) => model.id === id)) throw new Error('model_invalid');
        if (id !== modelId) { modelId = id; history = []; }
      },
      reset() { if (busy) throw new Error('busy'); history = []; },
      async ask(question) {
        if (busy) throw new Error('busy');
        if (!modelId || !catalog) throw new Error('model_unavailable');
        if (typeof question !== 'string' || !validText(question.trim(), 500)) throw new Error('question_invalid');
        question = question.trim();
        busy = true;
        try {
          const answer = await transport('/ask', { question, history: history.map((item) => ({ ...item })), model: modelId });
          if (!answer || !validText(answer.answer, 30000) || !answer.model || answer.model.id !== modelId) throw new Error('answer_invalid');
          history = history.concat([
            { role: 'user', content: question },
            { role: 'assistant', content: clipped(answer.answer, 1500) },
          ]).slice(-8);
          if (answer.limit && Number.isInteger(answer.limit.remaining_today) && answer.limit.remaining_today >= 0 && answer.limit.remaining_today <= 20) {
            remaining = answer.limit.remaining_today;
            resetsAt = answer.limit.resets_at;
          }
          return answer;
        } catch (error) {
          if (error.status === 429 && error.code === 'ip_daily_limit') remaining = 0;
          else remaining = null;
          throw error;
        } finally { busy = false; }
      },
    };
  }

  function errorMessage(error) {
    if (error.status === 429 && error.code === 'ip_daily_limit') return '本日の利用上限（全モデル共通20回）に達しました．日本時間9:00に戻ります．';
    if (error.status === 429 || error.status >= 500) return '混雑しているか，一時停止しています．自動再送はしません．';
    if (error.name === 'AbortError') return '時間内に応答がありませんでした．処理済みの可能性があるため自動再送はしません．';
    if (error.message === 'question_invalid') return '質問を1〜500文字で入力してください．';
    if (['catalog_invalid', 'answer_invalid'].includes(error.message)) return '応答の形式を確認できませんでした．自動再送や別モデルへの切替はしません．';
    if (error.status === 400 || error.status === 413) return '要求を受け付けられませんでした．入力を確認してください．';
    return '接続できないか，モデルを利用できません．自動再送はしません．';
  }

  function mount(options) {
    const document = options.document || globalThis.document;
    const transport = options.transport || createHttpTransport(options.endpoint);
    const session = createSession(transport);
    const host = document.createElement('section');
    host.className = 'pa-widget no-print';
    let sequence = 0;
    const suffix = String(Date.now()) + '-' + String(Math.random()).slice(2, 8);
    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function button(text, className) { const node = element('button', className, text); node.type = 'button'; return node; }
    const launcher = button(options.preview ? '模擬アシスタントを開く' : '作品について質問する', 'pa-launcher');
    launcher.setAttribute('aria-haspopup', 'dialog');
    const dialog = element('dialog', 'pa-dialog');
    dialog.id = 'pa-dialog-' + suffix;
    launcher.setAttribute('aria-controls', dialog.id);
    const heading = element('h2', '', options.preview ? 'AI質問対応 · 模擬プレビュー' : 'ポートフォリオ AI質問対応');
    heading.id = 'pa-heading-' + suffix;
    dialog.setAttribute('aria-labelledby', heading.id);
    const header = element('header', 'pa-header');
    const close = button('閉じる', 'pa-close');
    header.append(heading, close);
    const content = element('div', 'pa-content');
    const intro = element('p', 'pa-intro', options.preview
      ? 'ローカルの操作確認用です．回答・利用回数は模擬表示で，外部通信やモデル実行はありません．'
      : '公開済みの作品情報を根拠に回答します．AIの回答は誤ることがあるため，参照元もご確認ください．');
    const label = element('label', 'pa-model-label', '回答モデル');
    const select = element('select', 'pa-select');
    select.id = 'pa-model-' + suffix;
    label.htmlFor = select.id;
    const region = element('p', 'pa-region');
    const switchNotice = element('p', 'pa-help', 'モデルを切り替えると会話をリセットします．利用回数は全モデルで共通です．');
    const privacy = element('details', 'pa-privacy');
    const privacySummary = element('summary', '', '送信内容・処理地域について');
    const privacyText = element('p');
    const sharedPrivacy = element('p', '', options.preview
      ? 'ここで入力した質問はAWSへ送信されません．実接続時の案内文は利用条件の確認後に確定します．個人情報や機密情報は入力しないでください．'
      : '質問と直近4往復の会話は回答生成のためAWSへ送信されます．本アプリでは本文を履歴データベースやアプリケーションログに通常保存せず，会話はこのページを開いている間だけブラウザに保持します．利用回数の管理には日替わりの仮名化識別子を用います．期限を過ぎた回数記録は自動削除の対象になります．個人情報や機密情報は入力しないでください．');
    privacy.append(privacySummary, privacyText, sharedPrivacy);
    const historyNotice = element('p', 'pa-help', '会話は直近4往復のみ保持します．');
    const messages = element('div', 'pa-messages');
    messages.setAttribute('aria-label', '会話');
    const status = element('p', 'pa-status', '開くと利用可能なモデルを確認します．');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const limit = element('p', 'pa-limit', '全モデル共通：20回／IP／日（UTC）．残り回数は回答後に表示します．');
    const reset = button('会話をリセット', 'pa-reset');
    const tools = element('div', 'pa-tools'); tools.append(limit, reset);
    const form = element('form', 'pa-form');
    const questionLabel = element('label', '', '質問');
    const question = element('textarea', 'pa-question');
    question.id = 'pa-question-' + suffix; questionLabel.htmlFor = question.id;
    question.rows = 3; question.placeholder = '例：生成AIを使わず実装した作品は？'; question.maxLength = 1000;
    const count = element('span', 'pa-count', '0 / 500文字'); count.id = 'pa-count-' + suffix;
    question.setAttribute('aria-describedby', count.id);
    const submit = element('button', 'pa-submit', options.preview ? '模擬回答を表示' : '送信'); submit.type = 'submit';
    const formBottom = element('div', 'pa-form-bottom'); formBottom.append(count, submit);
    form.append(questionLabel, question, formBottom);
    content.append(intro, label, select, region, switchNotice, privacy, historyNotice, messages, status, tools, form);
    dialog.append(header, content); host.append(launcher, dialog);
    (options.container || document.body).append(host);

    function update() {
      const state = session.snapshot();
      const selected = state.catalog && state.catalog.models.find((model) => model.id === state.modelId);
      select.disabled = state.busy || !selected; question.disabled = state.busy || !selected;
      submit.disabled = state.busy || !selected; reset.disabled = state.busy;
      dialog.setAttribute('aria-busy', String(state.busy));
      region.textContent = selected ? '処理地域：' + regionLabel(selected.processing_region) : '利用可能なモデルはまだ確認できていません．';
      privacyText.textContent = selected ? selected.privacy_notice : 'モデル選択後に，処理地域と保持条件の案内を表示します．';
      limit.textContent = state.remaining !== null
        ? (options.preview ? '模擬・' : '') + '全モデル共通：本日あと' + state.remaining + '回／20回．日本時間9:00に更新．'
        : '全モデル共通：20回／IP／日（UTC）．残り回数は未確認です．失敗した要求も回数に含まれる場合があります．';
    }
    function clearMessages() { messages.replaceChildren(); sequence = 0; }
    function addMessage(role, text, sources, truncated, modelLabel) {
      const item = element('article', 'pa-message pa-message-' + role);
      const title = element('h3', '', role === 'user' ? 'あなた' : modelLabel || '回答');
      item.append(title, element('p', 'pa-answer', text));
      if (Array.isArray(sources)) {
        const list = element('ul', 'pa-sources');
        for (const source of sources.slice(0, 5)) {
          const href = source && safeHttps(source.url);
          if (!href || !validText(source.label, 300)) continue;
          const number = Number.isInteger(source.n) && source.n >= 1 && source.n <= 5 ? '[' + source.n + '] ' : '';
          const link = element('a', '', number + source.label + ' ↗');
          link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
          const row = element('li'); row.append(link); list.append(row);
        }
        if (list.children.length) item.append(list);
      }
      if (truncated) item.append(element('p', 'pa-help', '回答が長いため途中で終わりました．'));
      messages.append(item);
      if (++sequence > 8) messages.firstElementChild.remove();
    }
    launcher.addEventListener('click', async () => {
      if (!dialog.open) dialog.showModal();
      close.focus();
      if (session.snapshot().catalog) return;
      status.textContent = '利用可能なモデルを確認しています…';
      const pending = session.open(); update();
      try {
        const catalog = await pending;
        select.replaceChildren();
        catalog.models.forEach((model) => { const option = element('option', '', model.label); option.value = model.id; select.append(option); });
        select.value = catalog.default_model || '';
        status.textContent = catalog.models.length ? '質問を入力してください．モデル切替で自動送信はされません．' : '現在利用できるモデルはありません．';
      } catch (error) { status.textContent = errorMessage(error); }
      update();
    });
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => launcher.focus());
    select.addEventListener('change', () => {
      session.select(select.value); clearMessages(); update();
      status.textContent = 'モデルを変更し，会話をリセットしました．利用回数は引き継ぎます．';
    });
    reset.addEventListener('click', () => { session.reset(); clearMessages(); question.value = ''; question.setCustomValidity(''); count.textContent = '0 / 500文字'; status.textContent = '会話をリセットしました．利用回数はリセットされません．'; update(); question.focus(); });
    question.addEventListener('input', () => { const size = characters(question.value.trim()).length; count.textContent = size + ' / 500文字'; question.setCustomValidity(size > 500 ? '500文字以内で入力してください．' : ''); });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (session.snapshot().busy) return;
      const text = question.value.trim();
      if (!validText(text, 500)) { status.textContent = '質問を1〜500文字で入力してください．'; question.focus(); return; }
      status.textContent = options.preview ? '模擬回答を表示しています…' : '回答を待っています…';
      const pending = session.ask(text); update();
      try {
        const answer = await pending;
        const selected = session.snapshot().catalog.models.find((model) => model.id === answer.model.id);
        addMessage('user', text);
        addMessage('assistant', answer.answer, answer.sources, answer.truncated, selected.label + (options.preview ? ' · 模擬回答' : ''));
        question.value = ''; count.textContent = '0 / 500文字'; question.setCustomValidity('');
        status.textContent = '回答を表示しました．参照元もご確認ください．';
        messages.lastElementChild.scrollIntoView({ block: 'nearest' });
      } catch (error) { status.textContent = errorMessage(error); }
      update();
      if (dialog.open && !question.disabled) question.focus();
    });
    update();
    return { session, host, dialog };
  }

  function createMockTransport() {
    let used = 0;
    const names = ['Claude Sonnet 5', 'GPT-5.6 Terra', 'Qwen3 235B A22B 2507', 'GLM 5', 'Kimi K2.5'];
    const catalog = { default_model: 'sonnet-5', models: ALIASES.map((id, index) => ({
      id, label: names[index],
      processing_region: index < 2 ? 'グローバル推論（国外処理あり） · 模擬設定' : '東京を想定 · 経路未検証の模擬設定',
      privacy_notice: 'これは候補モデルの模擬表示です．契約・保持条件・利用可否を確認済みであることを示すものではありません．',
    })) };
    return async function (path, body) {
      if (path === '/models') return validateCatalog(catalog);
      if (path !== '/ask' || !body || !ALIASES.includes(body.model)) throw new Error('model_invalid');
      if (used >= 20) { const error = new Error('limit'); error.status = 429; error.code = 'ip_daily_limit'; throw error; }
      used += 1;
      const tomorrow = new Date(); tomorrow.setUTCHours(24, 0, 0, 0);
      return {
        answer: 'これは操作確認用の固定回答です．入力された質問への実際のAI回答ではありません．\n\n公開済み資料を参照した回答と，根拠リンクをこの位置に表示する想定です．モデルを切り替えても，模擬回答の品質差や実行速度は評価できません．',
        sources: [{ n: 1, label: 'ポートフォリオ（外部サイト）', url: 'https://kojima8924.github.io/' }],
        truncated: false, limit: { remaining_today: 20 - used, resets_at: tomorrow.toISOString() },
        model: { ...catalog.models.find((model) => model.id === body.model) },
      };
    };
  }
  return { ALIASES, regionLabel, safeHttps, validateCatalog, createHttpTransport, createSession, createMockTransport, errorMessage, mount };
});
