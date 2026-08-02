#!/usr/bin/env python3
"""HTML/CSSだけでSNS共有用のOGP画像を生成する。"""

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
    color: #f6f9ff;
    font-family: "Segoe UI", "Noto Sans JP", "Yu Gothic UI", sans-serif;
    background:
      radial-gradient(circle at 82% 42%, rgba(24, 189, 230, .16), transparent 30%),
      linear-gradient(135deg, #07111d 0%, #0a1625 54%, #07101a 100%);
  }
  body::before {
    content: "";
    position: absolute;
    inset: 0;
    opacity: .18;
    background-image:
      linear-gradient(rgba(114, 153, 183, .16) 1px, transparent 1px),
      linear-gradient(90deg, rgba(114, 153, 183, .16) 1px, transparent 1px);
    background-size: 36px 36px;
  }
  .frame {
    position: relative;
    width: 100%;
    height: 100%;
    border: 1px solid rgba(130, 180, 215, .25);
  }
  .copy {
    position: absolute;
    left: 72px;
    top: 66px;
    width: 520px;
  }
  .kicker {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    color: #75ddf2;
    font-size: 19px;
    font-weight: 700;
    letter-spacing: .22em;
  }
  .kicker::before { content: ""; width: 38px; height: 3px; background: #f5b94f; }
  h1 {
    margin: 27px 0 4px;
    font-size: 70px;
    line-height: .98;
    letter-spacing: .035em;
    font-weight: 800;
  }
  .jp {
    margin-top: 26px;
    color: #fff;
    font-size: 37px;
    line-height: 1.2;
    font-weight: 750;
  }
  .sub {
    margin: 13px 0 0;
    color: #a9bbcb;
    font-size: 17px;
    font-weight: 650;
    letter-spacing: .11em;
  }
  .pill-row { display: flex; gap: 10px; margin-top: 36px; }
  .pill {
    padding: 9px 15px;
    border: 1px solid rgba(117, 221, 242, .38);
    border-radius: 999px;
    background: rgba(13, 35, 54, .72);
    color: #d8e5ef;
    font-size: 15px;
    font-weight: 650;
  }
  .system {
    position: absolute;
    left: 620px;
    top: 55px;
    width: 520px;
    height: 520px;
  }
  .hub {
    position: absolute;
    left: 194px;
    top: 190px;
    z-index: 3;
    width: 138px;
    height: 138px;
    display: grid;
    place-items: center;
    border: 2px solid #75ddf2;
    border-radius: 50%;
    color: #f7fbff;
    background: #0d2134;
    box-shadow: 0 0 0 12px rgba(44, 186, 221, .08), 0 18px 45px rgba(0, 0, 0, .35);
    text-align: center;
    font-size: 17px;
    line-height: 1.18;
    font-weight: 800;
    letter-spacing: .08em;
  }
  .hub small { display: block; margin-top: 5px; color: #75ddf2; font-size: 11px; letter-spacing: .14em; }
  .node {
    position: absolute;
    z-index: 2;
    width: 170px;
    min-height: 76px;
    padding: 14px 16px;
    border: 1px solid rgba(126, 172, 204, .45);
    border-radius: 15px;
    background: linear-gradient(145deg, rgba(17, 40, 60, .98), rgba(10, 26, 42, .98));
    box-shadow: 0 14px 32px rgba(0, 0, 0, .25);
    font-size: 17px;
    font-weight: 750;
  }
  .node span { display: block; margin-top: 5px; color: #8fa9bd; font-size: 12px; font-weight: 550; }
  .n1 { left: 18px; top: 30px; }
  .n2 { right: 4px; top: 34px; }
  .n3 { left: 0; top: 385px; }
  .n4 { right: 0; top: 385px; }
  .n5 { left: 176px; top: 432px; }
  .line {
    position: absolute;
    z-index: 1;
    height: 2px;
    background: linear-gradient(90deg, rgba(117, 221, 242, .25), #75ddf2);
    transform-origin: left center;
  }
  .l1 { left: 135px; top: 126px; width: 145px; transform: rotate(44deg); }
  .l2 { left: 307px; top: 220px; width: 153px; transform: rotate(-48deg); }
  .l3 { left: 123px; top: 401px; width: 157px; transform: rotate(-47deg); }
  .l4 { left: 308px; top: 303px; width: 154px; transform: rotate(45deg); }
  .l5 { left: 262px; top: 320px; width: 112px; transform: rotate(90deg); }
  .dot {
    position: absolute;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #f5b94f;
    box-shadow: 0 0 14px rgba(245, 185, 79, .7);
  }
  .d1 { left: 74px; top: 151px; }
  .d2 { right: 89px; top: 173px; }
  .d3 { left: 88px; bottom: 126px; }
  .d4 { right: 85px; bottom: 122px; }
  .footer {
    position: absolute;
    left: 72px;
    bottom: 42px;
    color: #70879a;
    font-size: 14px;
    letter-spacing: .08em;
  }
</style>
</head>
<body>
  <div class="frame">
    <main class="copy">
      <div class="kicker">PORTFOLIO</div>
      <h1>AKIRA<br>KOJIMA</h1>
      <div class="jp">AI × 個人開発</div>
      <p class="sub">SOFTWARE ENGINEERING / MACHINE LEARNING</p>
      <div class="pill-row">
        <span class="pill">AI Tools</span>
        <span class="pill">Systems</span>
        <span class="pill">Research</span>
      </div>
    </main>
    <section class="system" aria-hidden="true">
      <div class="line l1"></div><div class="line l2"></div><div class="line l3"></div>
      <div class="line l4"></div><div class="line l5"></div>
      <div class="dot d1"></div><div class="dot d2"></div><div class="dot d3"></div><div class="dot d4"></div>
      <div class="hub">AI<br>ECOSYSTEM<small>DAILY TOOLS</small></div>
      <div class="node n1">Clage Cook<span>4-AI conference</span></div>
      <div class="node n2">ChromiumforA<span>AI-enhanced browser</span></div>
      <div class="node n3">scriptvedit<span>AI-ready video DSL</span></div>
      <div class="node n4">Calcpy<span>Python calculator</span></div>
      <div class="node n5">Research<span>ML × sensing</span></div>
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

