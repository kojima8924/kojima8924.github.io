/* 公開サイト用の接続設定．URLパラメータや保存済み設定からは接続先を受け取らない． */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.start(root.document, root.PortfolioAssistant);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function start(document, ui) {
    const container = document.getElementById('assistant-mount');
    const status = document.getElementById('assistant-availability');
    if (!container || !status || container.dataset.assistantMounted) return null;
    const config = document.querySelector('meta[name="portfolio-assistant-endpoint"]');
    const endpoint = config ? (config.content || '').trim() : '';
    // 未設定時はUI本体の初期化も通信も行わず，準備中の案内にする．
    if (!endpoint) {
      status.textContent = '準備中です．現在は質問を送信できません．作品の詳細は各項目のリンクからご覧いただけます．';
      return null;
    }
    if (!ui || typeof ui.mount !== 'function') {
      status.textContent = '質問対応を読み込めませんでした．作品の詳細は各項目のリンクからご確認ください．';
      return null;
    }
    try {
      // mountはボタンを作るだけ．モデル一覧は利用者が開いたときだけ取得する．
      const widget = ui.mount({ document, container, endpoint });
      container.dataset.assistantMounted = 'true';
      status.textContent = 'β版です．ボタンを開くと利用できるモデルを確認します．質問は「送信」を押すまで送られません．個人情報・機密情報は入力しないでください．';
      return widget;
    } catch (_) {
      status.textContent = '現在，質問対応を利用できません．作品の詳細は各項目のリンクからご確認ください．';
      return null;
    }
  }
  return { start };
});
