#!/usr/bin/env python3
"""HTML/CSSだけでSNS共有用のOGP画像を生成する．"""

from __future__ import annotations

import argparse
import os
import struct
import sys
import tempfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT = PROJECT_ROOT / "media" / "ogp-portfolio.png"
WIDTH = 1200
HEIGHT = 630

HTML = r"""
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; margin: 0; overflow: hidden; }
  body {
    color: #edf1f4;
    font-family: "Segoe UI", "Noto Sans JP", "Yu Gothic UI", sans-serif;
    background: #111923;
  }
  .frame {
    position: relative;
    width: 100%;
    height: 100%;
    border: 1px solid rgba(220, 229, 236, .14);
  }
  .copy {
    position: absolute;
    left: 64px;
    top: 64px;
    width: 506px;
  }
  .kicker {
    display: inline-flex;
    align-items: center;
    gap: 13px;
    color: #a5c1d0;
    font-size: 17px;
    font-weight: 700;
    letter-spacing: .2em;
  }
  .kicker::before { content: ""; width: 32px; height: 2px; background: #b9a06c; }
  h1 {
    margin: 28px 0 0;
    font-size: 70px;
    line-height: 1.02;
    letter-spacing: .025em;
    font-weight: 720;
  }
  .jp {
    margin-top: 26px;
    color: #e7ebee;
    font-size: 34px;
    line-height: 1.45;
    font-weight: 650;
  }
  .sub {
    margin: 18px 0 0;
    color: #aab6c0;
    font-size: 20px;
    line-height: 1.6;
    font-weight: 500;
  }
  .pill-row { display: flex; gap: 9px; margin-top: 25px; }
  .pill {
    padding: 8px 13px;
    border: 1px solid rgba(158, 184, 199, .3);
    border-radius: 7px;
    color: #b8c3cc;
    background: transparent;
    font-size: 16px;
    font-weight: 550;
  }
  .summary-panel {
    position: absolute;
    left: 620px;
    top: 64px;
    width: 516px;
    height: 502px;
    padding-left: 36px;
    border-left: 1px solid rgba(184, 199, 210, .25);
  }
  .panel-label {
    margin-bottom: 16px;
    color: #a0afbb;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: .2em;
  }
  .focus-row {
    display: grid;
    grid-template-columns: 24px 1fr;
    gap: 12px;
    padding: 14px 0 16px;
    border-top: 1px solid rgba(184, 199, 210, .16);
  }
  .focus-row .no {
    padding-top: 4px;
    color: #a0afbb;
    font-size: 15px;
    letter-spacing: .08em;
  }
  .focus-row strong {
    display: block;
    color: #e7ebee;
    font-size: 25px;
    font-weight: 650;
  }
  .focus-row small {
    display: block;
    margin-top: 6px;
    color: #aab6c0;
    font-size: 17px;
    line-height: 1.55;
  }
  .footer {
    position: absolute;
    left: 64px;
    bottom: 35px;
    color: #9aabb8;
    font-size: 16px;
    letter-spacing: .08em;
  }
</style>
</head>
<body>
  <div class="frame">
    <main class="copy">
      <div class="kicker">PORTFOLIO</div>
      <h1>AKIRA<br>KOJIMA</h1>
      <div class="jp">自力実装を土台に，<br>設計と検証へ</div>
      <p class="sub">小嶋 明 ｜ ソフトウェアエンジニア<br>研究・CGから，受託・AI活用アプリへ</p>
      <div class="pill-row">
        <span class="pill">Python</span>
        <span class="pill">C++ / GLSL</span>
        <span class="pill">AI Agents</span>
      </div>
    </main>
    <section class="summary-panel" aria-label="主な領域">
      <div class="panel-label">EXPERIENCE &amp; WORKS</div>
      <div class="focus-row">
        <span class="no">01</span>
        <div><strong>研究｜機械学習 × 触覚計測</strong><small>実装・解析・定量評価<br>査読付き筆頭論文</small></div>
      </div>
      <div class="focus-row">
        <span class="no">02</span>
        <div><strong>受託｜LINE応答AI</strong><small>要件・仕様・安全設計・検証<br>実装はAIエージェントへ委任</small></div>
      </div>
      <div class="focus-row">
        <span class="no">03</span>
        <div><strong>CG｜生成AI不使用の自力実装</strong><small>Python／C++／GLSL<br>レイトレーシング・シャドウマッピング</small></div>
      </div>
      <div class="focus-row">
        <span class="no">04</span>
        <div><strong>AI活用｜個人開発・OSS</strong><small>仕様・設計判断，レビュー・実環境検証<br>実装はAIエージェントへ委任</small></div>
      </div>
    </section>
    <div class="footer">KOJIMA8924.GITHUB.IO</div>
  </div>
</body>
</html>
"""


def _png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as stream:
        signature = stream.read(24)
    if signature[:8] != b"\x89PNG\r\n\x1a\n" or signature[12:16] != b"IHDR":
        raise RuntimeError("有効なPNGを生成できませんでした。")
    return struct.unpack(">II", signature[16:24])


def make_ogp(output: Path) -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError(
            "Playwrightがありません。`python -m pip install -r requirements-pdf.txt` と "
            "`python -m playwright install chromium` を実行してください。"
        ) from exc

    output = output.expanduser().resolve()
    if output.suffix.lower() != ".png":
        raise ValueError("出力には.pngファイルを指定してください。")
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output.stem}-",
        suffix=".tmp.png",
        dir=output.parent,
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                page = browser.new_page(
                    viewport={"width": WIDTH, "height": HEIGHT},
                    device_scale_factor=1,
                )
                page.set_content(HTML, wait_until="load")
                page.screenshot(
                    path=str(temporary_path),
                    animations="disabled",
                    caret="hide",
                )
            finally:
                browser.close()

        dimensions = _png_size(temporary_path)
        if dimensions != (WIDTH, HEIGHT):
            raise RuntimeError(f"画像サイズが不正です: {dimensions[0]}x{dimensions[1]}")
        os.replace(temporary_path, output)
        return output.stat().st_size
    finally:
        temporary_path.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="非生成AIのHTML/CSS製OGP画像を生成します。")
    parser.add_argument("--output", "-o", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    try:
        size = make_ogp(args.output)
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"OGP生成失敗: {exc}", file=sys.stderr)
        return 1
    print(f"OGP生成完了: {args.output.expanduser().resolve()} ({size / 1024:.1f} KiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

