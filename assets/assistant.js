/* β版の再利用用UI．開く操作がない限り通信しない． */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PortfolioAssistant = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ALIASES = Object.freeze(['sonnet-5', 'terra', 'qwen-235b', 'glm-5', 'kimi-k2-5']);
  // 旧APIを先に公開済みのUIから安全に利用できるよう，/modelsに新設定がない間は旧上限へ戻す．
  const LEGACY_DAILY_LIMIT = 20;
  const LEGACY_HISTORY_MESSAGES = 8;
  const DAILY_LIMIT = 40;
  const HISTORY_MESSAGES = 16;
  // 実接続時だけ送信欄の直後に常時表示する，本文記録の告知（文言は一字一句この文で固定）．
  const RECORD_NOTICE = '誤回答の修正，回答品質の改善，不適切な利用の確認のため，質問と回答の本文を記録します．記録はAIツールによる分析や，本人（小嶋明）が確認することがあります．IPアドレスなど利用者を特定する情報は本文と結び付けて保存せず，記録は90日で削除します．個人情報や社外秘の内容は入力しないでください．';
  const STARTER_SUGGESTIONS = Object.freeze([
    '小嶋明の技術的な強みは？',
    '研究内容を簡潔に教えて',
    '生成AIを使わずに作った作品は？',
  ]);
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
    let interaction = { history_messages: LEGACY_HISTORY_MESSAGES, daily_requests: LEGACY_DAILY_LIMIT, quick_replies: false };
    if (value.interaction !== undefined) {
      const settings = value.interaction;
      if (!settings || !Number.isInteger(settings.history_messages) || settings.history_messages < 2 || settings.history_messages > HISTORY_MESSAGES ||
          settings.history_messages % 2 || !Number.isInteger(settings.daily_requests) || settings.daily_requests < 1 || settings.daily_requests > DAILY_LIMIT ||
          typeof settings.quick_replies !== 'boolean') throw new Error('catalog_invalid');
      interaction = { history_messages: settings.history_messages, daily_requests: settings.daily_requests, quick_replies: settings.quick_replies };
    }
    return { default_model: models.length ? value.default_model : null, models, interaction };
  }

  function validateSuggestions(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 3) throw new Error('answer_invalid');
    const seen = new Set();
    return value.map((item) => {
      if (!validText(item, 80) || /[\r\n]/.test(item) || seen.has(item.trim())) throw new Error('answer_invalid');
      item = item.trim(); seen.add(item); return item;
    });
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
        modelId = id;
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
          answer.suggestions = validateSuggestions(answer.suggestions);
          history = history.concat([
            { role: 'user', content: question },
            { role: 'assistant', content: clipped(answer.answer, 1500) },
          ]).slice(-catalog.interaction.history_messages);
          if (answer.limit && Number.isInteger(answer.limit.remaining_today) && answer.limit.remaining_today >= 0 && answer.limit.remaining_today <= catalog.interaction.daily_requests) {
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

  function errorMessage(error, dailyLimit) {
    if (error.status === 429 && error.code === 'ip_daily_limit') return '本日の利用上限（全モデル共通' + (dailyLimit || LEGACY_DAILY_LIMIT) + '回）に達しました．日本時間9:00に戻ります．';
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
    const suffix = String(Date.now()) + '-' + String(Math.random()).slice(2, 8);
    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function button(text, className) { const node = element('button', className, text); node.type = 'button'; return node; }
    const launcher = button(options.preview ? '模擬アシスタントを開く' : '作品・経歴・小嶋明について質問する', 'pa-launcher');
    launcher.setAttribute('aria-haspopup', 'dialog');
    const dialog = element('dialog', 'pa-dialog');
    dialog.id = 'pa-dialog-' + suffix;
    launcher.setAttribute('aria-controls', dialog.id);
    const heading = element('h2', '', options.preview ? 'AI質問対応 · 模擬プレビュー' : 'ポートフォリオ AI質問対応（β）');
    heading.id = 'pa-heading-' + suffix;
    dialog.setAttribute('aria-labelledby', heading.id);
    const header = element('header', 'pa-header');
    const close = button('閉じる', 'pa-close');
    header.append(heading, close);
    const content = element('div', 'pa-content');
    const intro = element('p', 'pa-intro', options.preview
      ? 'ローカルの操作確認用です．回答・利用回数は模擬表示で，外部通信やモデル実行はありません．'
      : 'β版・品質検証中です．作品・経歴のほか，小嶋明の経験・活動・開発の考え方を，公開資料の範囲で質問できます．資料にないことや私的な情報は対象外です．本人の担当・実績を推測で補わない方針ですが，誤回答の可能性があります．必ず参照元をご確認ください．質問によっては回答できない場合もあります．');
    const label = element('label', 'pa-model-label', '回答モデル');
    const select = element('select', 'pa-select');
    select.id = 'pa-model-' + suffix;
    label.htmlFor = select.id;
    const region = element('p', 'pa-region');
    const switchNotice = element('p', 'pa-help', options.preview
      ? 'モデルを切り替えても会話は残ります．このプレビューでは外部送信しません．利用回数は全モデルで共通です．'
      : 'モデルを切り替えても会話は残り，切替だけでは送信しません．次の送信時には，他モデルとの直近の会話も選択した回答生成先へ送信します．引き継ぎたくない場合は，送信前に会話をリセットしてください．利用回数は全モデルで共通です．');
    const privacy = element('details', 'pa-privacy');
    const privacySummary = element('summary', '', '送信内容・処理地域について');
    const privacyText = element('p');
    const processingNotice = (rounds) => 'ナレッジ検索はAWS，回答生成は選択モデルの設定に応じてAWS・OpenAI・Anthropicで処理します．質問・直近' + rounds + '往復の会話・検索した公開資料を回答生成先へ送信します．実際の送信先と処理地域は選択モデルの案内をご確認ください．提供元の保持条件は各社の規定に従います．';
    const privacySuffix = options.preview
      ? 'ここで入力した質問はAWSへ送信されません．実接続時の案内文は利用条件の確認後に確定します．個人情報や機密情報は入力しないでください．'
      : '画面の会話はこのページを開いている間だけブラウザに保持します．質問と回答の本文は送信欄の下の案内のとおり記録し，90日で削除します．利用回数の管理には日替わりの仮名化識別子を用います．期限を過ぎた回数記録は自動削除の対象になります．個人情報や機密情報は入力しないでください．';
    const sharedPrivacy = element('p', '', options.preview ? privacySuffix : processingNotice(LEGACY_HISTORY_MESSAGES / 2) + privacySuffix);
    privacy.append(privacySummary, privacyText, sharedPrivacy);
    const historyNotice = element('p', 'pa-help', '表示ログはページを開いている間だけ残ります．送信する会話範囲はモデル確認後に表示します．会話のリセット・ページの再読み込みで消えます．');
    const messages = element('div', 'pa-messages');
    messages.setAttribute('aria-label', '会話');
    const status = element('p', 'pa-status', '開くと利用可能なモデルを確認します．');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const limit = element('p', 'pa-limit', '利用上限はモデル確認後に表示します．');
    const reset = button('会話をリセット', 'pa-reset');
    const tools = element('div', 'pa-tools'); tools.append(limit, reset);
    const form = element('form', 'pa-form');
    const questionLabel = element('label', '', '質問');
    const question = element('textarea', 'pa-question');
    question.id = 'pa-question-' + suffix; questionLabel.htmlFor = question.id;
    question.rows = 3; question.placeholder = '例：小嶋明の技術的な強みや，開発で大切にしていることは？'; question.maxLength = 1000;
    const count = element('span', 'pa-count', '0 / 500文字'); count.id = 'pa-count-' + suffix;
    question.setAttribute('aria-describedby', count.id);
    const submit = element('button', 'pa-submit', options.preview ? '模擬回答を表示' : '送信'); submit.type = 'submit';
    const formBottom = element('div', 'pa-form-bottom'); formBottom.append(count, submit);
    form.append(questionLabel, question, formBottom);
    // 記録の告知は送信ボタンの直後に折りたたまず置く．模擬プレビューは本文を記録しないので出さない．
    if (!options.preview) {
      const recordNotice = element('p', 'pa-help pa-record-notice', RECORD_NOTICE);
      recordNotice.id = 'pa-record-' + suffix;
      question.setAttribute('aria-describedby', count.id + ' ' + recordNotice.id);
      form.append(recordNotice);
    }
    content.append(intro, label, select, region, switchNotice, privacy, historyNotice, messages, status, tools, form);
    dialog.append(header, content); host.append(launcher, dialog);
    (options.container || document.body).append(host);

    function update() {
      const state = session.snapshot();
      const selected = state.catalog && state.catalog.models.find((model) => model.id === state.modelId);
      const interaction = state.catalog ? state.catalog.interaction : { history_messages: LEGACY_HISTORY_MESSAGES, daily_requests: LEGACY_DAILY_LIMIT };
      const historyRounds = interaction.history_messages / 2;
      select.disabled = state.busy || !selected; question.disabled = state.busy || !selected;
      submit.disabled = state.busy || !selected; reset.disabled = state.busy;
      dialog.setAttribute('aria-busy', String(state.busy));
      region.textContent = selected ? '処理地域：' + regionLabel(selected.processing_region) : '利用可能なモデルはまだ確認できていません．';
      privacyText.textContent = selected ? selected.privacy_notice : 'モデル選択後に，処理地域と保持条件の案内を表示します．';
      if (!options.preview) sharedPrivacy.textContent = processingNotice(historyRounds) + privacySuffix;
      historyNotice.textContent = '表示ログはページを開いている間だけ残ります．' + (options.preview ? '模擬回答' : 'AI') + 'へ送る文脈は直近' + historyRounds + '往復で，各回答は1500文字までです．会話のリセット・ページの再読み込みで消えます．';
      limit.textContent = state.remaining !== null
        ? (options.preview ? '模擬・' : '') + '全モデル共通：本日あと' + state.remaining + '回／' + interaction.daily_requests + '回．日本時間9:00に更新．'
        : '全モデル共通：' + interaction.daily_requests + '回／IP／日（UTC）．残り回数は未確認です．失敗した要求も回数に含まれる場合があります．';
      activeQuickReplyButtons.forEach((node) => { node.disabled = state.busy || !selected; });
    }
    let activeQuickReplyButtons = [];
    function deactivateQuickReplies() {
      activeQuickReplyButtons.forEach((node) => { node.disabled = true; });
      activeQuickReplyButtons = [];
    }
    function clearMessages() { deactivateQuickReplies(); messages.replaceChildren(); }
    function addMessage(role, text, sources, truncated, modelLabel, suggestions) {
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
      if (role === 'assistant' && Array.isArray(suggestions) && suggestions.length) {
        deactivateQuickReplies();
        const group = element('div', 'pa-quick-replies');
        group.setAttribute('aria-label', '次の質問候補');
        group.append(element('p', 'pa-quick-replies-label', '次の質問候補'));
        for (const suggestion of suggestions) {
          const reply = button(suggestion, 'pa-quick-reply');
          reply.addEventListener('click', () => {
            question.value = suggestion;
            count.textContent = characters(suggestion).length + ' / 500文字';
            return sendQuestion(suggestion);
          });
          activeQuickReplyButtons.push(reply); group.append(reply);
        }
        item.append(group);
      }
      messages.append(item);
    }
    function addGreeting() {
      const state = session.snapshot();
      const selected = state.catalog && state.catalog.models.find((model) => model.id === state.modelId);
      if (!selected) return;
      addMessage('assistant', '私は「' + selected.label + '」を使うポートフォリオ案内AIです．作品・経歴・小嶋明について，質問をどうぞ！', undefined, false, selected.label, STARTER_SUGGESTIONS);
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
        if (catalog.models.length && !messages.children.length) addGreeting();
      } catch (error) { status.textContent = errorMessage(error, session.snapshot().catalog && session.snapshot().catalog.interaction.daily_requests); }
      update();
    });
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => launcher.focus());
    select.addEventListener('change', () => {
      session.select(select.value); update();
      if (!session.snapshot().history.length) { clearMessages(); addGreeting(); }
      status.textContent = options.preview
        ? 'モデルを変更しました．会話と利用回数は引き継ぎます．外部送信はしません．'
        : 'モデルを変更しました．会話と利用回数は引き継ぎます．次の送信時に，他モデルとの直近の会話も選択した回答生成先へ送ります．';
    });
    reset.addEventListener('click', () => { session.reset(); clearMessages(); addGreeting(); question.value = ''; question.setCustomValidity(''); count.textContent = '0 / 500文字'; status.textContent = '会話をリセットしました．利用回数はリセットされません．'; update(); question.focus(); });
    question.addEventListener('input', () => { const size = characters(question.value.trim()).length; count.textContent = size + ' / 500文字'; question.setCustomValidity(size > 500 ? '500文字以内で入力してください．' : ''); });
    async function sendQuestion(value) {
      if (session.snapshot().busy) return;
      const text = value.trim();
      if (!validText(text, 500)) { status.textContent = '質問を1〜500文字で入力してください．'; question.focus(); return; }
      deactivateQuickReplies();
      status.textContent = options.preview ? '模擬回答を表示しています…' : '回答を待っています…';
      const pending = session.ask(text); update();
      try {
        const answer = await pending;
        const selected = session.snapshot().catalog.models.find((model) => model.id === answer.model.id);
        addMessage('user', text);
        addMessage('assistant', answer.answer, answer.sources, answer.truncated, selected.label + (options.preview ? ' · 模擬回答' : ''), answer.suggestions);
        question.value = ''; count.textContent = '0 / 500文字'; question.setCustomValidity('');
        status.textContent = '回答を表示しました．参照元もご確認ください．';
        messages.lastElementChild.scrollIntoView({ block: 'nearest' });
      } catch (error) { status.textContent = errorMessage(error, session.snapshot().catalog && session.snapshot().catalog.interaction.daily_requests); }
      update();
      if (dialog.open && !question.disabled) question.focus();
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await sendQuestion(question.value);
    });
    update();
    return { session, host, dialog };
  }

  function createMockTransport() {
    let used = 0;
    const names = ['Claude Sonnet 5', 'GPT-5.6 Terra', 'Qwen3 235B A22B 2507', 'GLM 5', 'Kimi K2.5'];
    const catalog = { default_model: 'sonnet-5', interaction: { history_messages: HISTORY_MESSAGES, daily_requests: DAILY_LIMIT, quick_replies: true }, models: ALIASES.map((id, index) => ({
      id, label: names[index],
      processing_region: index < 2 ? 'グローバル推論（国外処理あり） · 模擬設定' : '東京を想定 · 経路未検証の模擬設定',
      privacy_notice: 'これは候補モデルの模擬表示です．契約・保持条件・利用可否を確認済みであることを示すものではありません．',
    })) };
    return async function (path, body) {
      if (path === '/models') return validateCatalog(catalog);
      if (path !== '/ask' || !body || !ALIASES.includes(body.model)) throw new Error('model_invalid');
      if (used >= DAILY_LIMIT) { const error = new Error('limit'); error.status = 429; error.code = 'ip_daily_limit'; throw error; }
      used += 1;
      const tomorrow = new Date(); tomorrow.setUTCHours(24, 0, 0, 0);
      return {
        answer: 'これは操作確認用の固定回答です．入力された質問への実際のAI回答ではありません．\n\n公開済み資料を参照した回答と，根拠リンクをこの位置に表示する想定です．モデルを切り替えても，模擬回答の品質差や実行速度は評価できません．',
        suggestions: ['この研究の概要は？', '生成AI不使用の作品は？', '開発で重視していることは？'],
        sources: [{ n: 1, label: 'ポートフォリオ（外部サイト）', url: 'https://kojima8924.github.io/' }],
        truncated: false, limit: { remaining_today: DAILY_LIMIT - used, resets_at: tomorrow.toISOString() },
        model: { ...catalog.models.find((model) => model.id === body.model) },
      };
    };
  }
  return { ALIASES, RECORD_NOTICE, regionLabel, safeHttps, validateCatalog, validateSuggestions, createHttpTransport, createSession, createMockTransport, errorMessage, mount };
});
