/* 作品メディアの拡大表示．外部動画は利用者が開いた後にだけ読み込む． */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.PortfolioMediaViewer = api;
    api.mount(root.document, root);
  }
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";

  function isPlainActivation(event) {
    return !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && (event.button === undefined || event.button === 0);
  }

  function describeMedia(link, baseURI) {
    const image = link.querySelector("img");
    const kind = link.dataset.mediaKind || (link.dataset.nico ? "video" : "");
    const source = link.getAttribute("href");
    let url;
    let base;
    try { base = new URL(baseURI); url = new URL(source, base); } catch (_) { return null; }
    if (!source || !["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const owner = link.closest(".archive-item, article, #chromiumfora-card");
    const title = owner?.querySelector("h3, h4, summary")?.textContent.trim() || "作品";
    const caption = link.dataset.mediaCaption || link.closest("figure")?.querySelector("figcaption")?.textContent.trim() || image?.alt || link.getAttribute("aria-label") || title;
    if (kind === "video") {
      const id = link.dataset.nico;
      if (!/^sm[0-9]+$/.test(id || "") || url.origin !== "https://www.nicovideo.jp" || url.pathname !== "/watch/" + id || url.search || url.hash) return null;
      return { kind, src:"https://embed.nicovideo.jp/watch/" + id, source:url.href, title, caption, key:"video:" + id };
    }
    if (kind !== "image" || !image || url.origin !== base.origin || !url.pathname.startsWith(new URL("media/", base).pathname)) return null;
    return { kind, src:url.href, source:url.href, title, caption, key:"image:" + url.href };
  }

  function mount(document, window) {
    const overlay = document.getElementById("lightbox");
    if (!overlay) return null;
    const selectors = "a[data-media-kind], a.btn-video[data-nico]";
    const links = [...document.querySelectorAll(selectors)];
    const removers = [];
    let lastTrigger = null;
    let background = [];
    let previousOverflow = "";
    let resizeImage = null;
    let gallery = [];
    let position = 0;
    let active = false;
    let renderSequence = 0;

    function listen(element, event, handler) {
      element.addEventListener(event, handler);
      removers.push(() => element.removeEventListener(event, handler));
    }
    function control(label, text, action) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.setAttribute("aria-label", label);
      button.addEventListener("click", action);
      return button;
    }
    function externalLink(url, label) {
      const link = document.createElement("a");
      link.href = url;
      link.textContent = label;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      return link;
    }
    function stopMedia() {
      overlay.querySelectorAll("video").forEach(video => video.pause());
      // iframeをDOMから外すことで，閉じた後や画像へ切り替えた後の再生を止める．
      overlay.replaceChildren();
      resizeImage = null;
    }
    function close() {
      if (!active) return;
      active = false;
      renderSequence += 1;
      stopMedia();
      overlay.classList.remove("active", "is-video");
      overlay.setAttribute("aria-hidden", "true");
      overlay.setAttribute("inert", "");
      document.body.style.overflow = previousOverflow;
      background.forEach(([element, wasInert]) => { if (!wasInert) element.removeAttribute("inert"); });
      const trigger = lastTrigger;
      lastTrigger = null;
      gallery = [];
      trigger?.focus({ preventScroll:true });
    }

    function render(initial) {
      const sequence = ++renderSequence;
      const { link, media } = gallery[position];
      const focusedLabel = document.activeElement?.getAttribute("aria-label");
      stopMedia();
      overlay.classList.toggle("is-video", media.kind === "video");
      overlay.setAttribute("aria-label", media.title + "の" + (media.kind === "video" ? "動画" : "画像") + "を拡大表示");
      const toolbar = document.createElement("div");
      toolbar.className = "lightbox-toolbar";
      if (gallery.length > 1) {
        const previous = control("前のメディア", "←", () => { position -= 1; render(false); });
        const next = control("次のメディア", "→", () => { position += 1; render(false); });
        previous.disabled = position === 0;
        next.disabled = position === gallery.length - 1;
        toolbar.append(previous, next);
      }
      const viewport = document.createElement("div");
      viewport.className = "lightbox-viewport";
      const meta = document.createElement("div");
      meta.className = "lightbox-meta";
      const counter = document.createElement("span");
      counter.className = "lightbox-position";
      counter.textContent = (position + 1) + " / " + gallery.length + " · " + (media.kind === "video" ? "動画" : "画像");
      const caption = document.createElement("p");
      caption.className = "lightbox-caption";
      caption.setAttribute("aria-live", "polite");
      caption.textContent = media.caption;
      meta.append(counter, caption);
      const help = document.createElement("p");
      help.className = "lightbox-help";

      if (media.kind === "video") {
        const iframe = document.createElement("iframe");
        iframe.src = media.src;
        iframe.title = media.title + "の動画";
        iframe.allow = "autoplay; fullscreen";
        iframe.allowFullscreen = true;
        iframe.referrerPolicy = "strict-origin-when-cross-origin";
        viewport.append(iframe);
        function measureVideo() {
          if (!active || sequence !== renderSequence) return;
          // 横向き画面では高さが先に制限されるため，幅も縮めて16:9を保つ．
          const width = Math.max(1, Math.min(viewport.clientWidth, viewport.clientHeight * 16 / 9));
          iframe.style.width = width + "px";
          iframe.style.height = (width * 9 / 16) + "px";
        }
        resizeImage = measureVideo;
        window.requestAnimationFrame(measureVideo);
        toolbar.append(externalLink(media.source, "配信元で見る ↗"));
        help.textContent = "再生できない場合は「配信元で見る」から開けます．";
        // 埋め込み先へフォーカスが入った際も，その直後に閉じる操作を用意する．
        const videoClose = control("動画を閉じる", "動画を閉じる", close);
        videoClose.className = "lightbox-video-close";
        meta.append(help, videoClose);
      } else {
        const original = link.querySelector("img");
        const image = document.createElement("img");
        image.alt = original.alt || "";
        const stage = document.createElement("div");
        stage.className = "lightbox-stage";
        stage.append(image);
        viewport.append(stage);
        viewport.tabIndex = 0;
        viewport.setAttribute("role", "region");
        viewport.setAttribute("aria-label", "画像表示領域．拡大時は上下左右にスクロールできます");
        let width = 0, fitWidth = 1, maximum = 1, fitMode = true, failed = false;
        const zoomOut = control("画像を縮小", "−", () => setWidth(width / 1.5));
        const zoomIn = control("画像を拡大", "＋", () => setWidth(width * 1.5));
        const fit = control("画像全体を表示", "全体", () => setWidth(fitWidth));
        toolbar.append(zoomOut, zoomIn, fit, externalLink(media.source, "原画像 ↗"));
        function setWidth(next, centered = true) {
          const before = width || next;
          const x = (viewport.scrollLeft + viewport.clientWidth / 2) / before;
          const y = (viewport.scrollTop + viewport.clientHeight / 2) / before;
          width = Math.max(fitWidth, Math.min(maximum, next));
          stage.style.width = width + "px";
          fitMode = Math.abs(width - fitWidth) < 1;
          zoomOut.disabled = fitMode;
          zoomIn.disabled = width >= maximum - 1;
          if (centered) {
            viewport.scrollLeft = x * width - viewport.clientWidth / 2;
            viewport.scrollTop = y * width - viewport.clientHeight / 2;
          }
        }
        function measure(first = false) {
          if (!active || sequence !== renderSequence || failed) return;
          const naturalWidth = image.naturalWidth || original.naturalWidth || Number(original.getAttribute("width")) || 1280;
          const naturalHeight = image.naturalHeight || original.naturalHeight || Number(original.getAttribute("height")) || 720;
          fitWidth = Math.max(1, Math.min(naturalWidth, viewport.clientWidth, viewport.clientHeight * naturalWidth / naturalHeight));
          maximum = Math.max(naturalWidth * 3, viewport.clientWidth * 4);
          // 横長の構成図は可読幅から開始し，画像のスクロールで読めるようにする．
          const readable = link.closest(".fig-band") ? Math.max(fitWidth, Math.min(900, naturalWidth)) : fitWidth;
          setWidth(first ? readable : (fitMode ? fitWidth : width), false);
        }
        image.addEventListener("load", () => measure(true), { once:true });
        image.addEventListener("error", () => {
          if (!active || sequence !== renderSequence) return;
          failed = true;
          resizeImage = null;
          const error = document.createElement("p");
          error.className = "lightbox-error";
          error.textContent = "画像を読み込めませんでした．「原画像」からも確認できます．";
          viewport.replaceChildren(error);
          zoomOut.disabled = zoomIn.disabled = fit.disabled = true;
        }, { once:true });
        image.src = media.src;
        resizeImage = () => measure(false);
        help.textContent = "拡大後はスワイプ・スクロール・矢印キーで移動できます．";
        meta.append(help);
        // DOM配置後に表示領域の大きさを測る．
        window.requestAnimationFrame(() => measure(true));
      }
      const closeButton = control("拡大表示を閉じる", "×", close);
      closeButton.className = "lightbox-close";
      toolbar.append(closeButton);
      overlay.append(toolbar, viewport, meta);
      const restore = !initial && [...toolbar.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === focusedLabel && !button.disabled);
      (restore || closeButton).focus({ preventScroll:true });
    }

    function open(link) {
      const media = describeMedia(link, document.baseURI);
      if (!media) return false;
      if (active) close();
      const owner = link.closest(".archive-item, article, #chromiumfora-card") || link;
      const candidates = owner === link ? [link] : [...owner.querySelectorAll(selectors)];
      const seen = new Map();
      candidates.forEach(candidate => {
        const item = describeMedia(candidate, document.baseURI);
        if (!item) return;
        const old = seen.get(item.key);
        // 同じ動画の本文ボタンとサムネイルは1項目にまとめ，画像付きの説明を使う．
        if (!old || candidate.querySelector("img")) seen.set(item.key, { link:candidate, media:item });
      });
      gallery = [...seen.values()];
      position = gallery.findIndex(item => item.media.key === media.key);
      if (position < 0) return false;
      lastTrigger = link;
      background = [...document.body.children].filter(element => element !== overlay && element.tagName !== "SCRIPT").map(element => [element, element.hasAttribute("inert")]);
      background.forEach(([element]) => element.setAttribute("inert", ""));
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      active = true;
      overlay.removeAttribute("inert");
      overlay.classList.add("active");
      overlay.setAttribute("aria-hidden", "false");
      render(true);
      return true;
    }

    links.forEach(link => {
      if (!describeMedia(link, document.baseURI)) return;
      link.setAttribute("aria-haspopup", "dialog");
      listen(link, "click", event => {
        if (isPlainActivation(event) && open(link)) event.preventDefault();
      });
    });
    listen(overlay, "click", event => { if (event.target === overlay) close(); });
    listen(window, "resize", () => { if (resizeImage) resizeImage(); });
    listen(window, "beforeprint", close);
    listen(document, "keydown", event => {
      if (!active) return;
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...overlay.querySelectorAll("button, a[href], iframe, video[controls], [tabindex]:not([tabindex='-1'])")].filter(element => !element.disabled);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    return { open, close, destroy() { close(); removers.forEach(remove => remove()); } };
  }

  return { mount, describeMedia, isPlainActivation };
});
