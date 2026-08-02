#!/usr/bin/env python3
"""Playwright/Chromium でポートフォリオ HTML を PDF に変換する。"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
import threading
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterator
from urllib.parse import quote


PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE = PROJECT_ROOT / "index.html"
DEFAULT_OUTPUT = PROJECT_ROOT / "media" / "Akira_Kojima_Portfolio.pdf"


class _QuietRequestHandler(SimpleHTTPRequestHandler):
    """通常のアクセスログを抑制するローカル配信用ハンドラ。"""

    def log_message(self, _format: str, *args: object) -> None:
        pass


class _LocalHttpServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


@contextmanager
def _serve(directory: Path) -> Iterator[tuple[str, _LocalHttpServer]]:
    handler = partial(_QuietRequestHandler, directory=str(directory))
    server = _LocalHttpServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(
        target=server.serve_forever,
        name="portfolio-pdf-http-server",
        daemon=True,
    )
    thread.start()
    host, port = server.server_address[:2]

    try:
        yield f"http://{host}:{port}", server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _server_location(source: Path) -> tuple[Path, str]:
    """配信ルートと、そのルートから見た source の URL パスを返す。"""

    try:
        relative_source = source.relative_to(PROJECT_ROOT)
        server_root = PROJECT_ROOT
    except ValueError:
        server_root = source.parent
        relative_source = Path(source.name)

    url_path = quote(relative_source.as_posix(), safe="/")
    return server_root, url_path


def _wait_until_ready(page: object, timeout_ms: int) -> list[str]:
    """印刷に必要なスタイル、フォント、画像の読込完了を待つ。"""

    page.eval_on_selector_all(
        'img[loading="lazy"]',
        "images => images.forEach(image => { image.loading = 'eager'; })",
    )
    page.wait_for_function(
        """
        () => [...document.querySelectorAll('link[rel~="stylesheet"]')]
          .every(link => Boolean(link.sheet))
        """,
        timeout=timeout_ms,
    )
    page.wait_for_function(
        "() => !document.fonts || document.fonts.status === 'loaded'",
        timeout=timeout_ms,
    )
    page.wait_for_function(
        """
        () => [...document.images]
          .filter(image => {
            const style = getComputedStyle(image);
            return style.display !== 'none'
              && style.visibility !== 'hidden'
              && image.getClientRects().length > 0;
          })
          .every(image => image.complete)
        """,
        timeout=timeout_ms,
    )
    page.evaluate(
        """
        async () => {
          const decodes = [...document.images]
            .filter(image => {
              const style = getComputedStyle(image);
              const visible = style.display !== 'none'
                && style.visibility !== 'hidden'
                && image.getClientRects().length > 0;
              return visible && image.complete && image.naturalWidth > 0;
            })
            .map(image => image.decode().catch(() => undefined));
          await Promise.all(decodes);
        }
        """
    )

    return page.eval_on_selector_all(
        "img",
        """
        images => images
          .filter(image => {
            const style = getComputedStyle(image);
            const visible = style.display !== 'none'
              && style.visibility !== 'hidden'
              && image.getClientRects().length > 0;
            return visible && image.naturalWidth === 0;
          })
          .map(image => image.currentSrc || image.src || '(srcなし)')
        """,
    )


def _write_pdf_atomically(page: object, output: Path) -> int:
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output.stem}-",
        suffix=".tmp.pdf",
        dir=output.parent,
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)

    try:
        page.pdf(
            path=str(temporary_path),
            format="A4",
            prefer_css_page_size=True,
            print_background=True,
            landscape=False,
            display_header_footer=False,
        )

        size = temporary_path.stat().st_size
        with temporary_path.open("rb") as stream:
            signature = stream.read(5)
        if signature != b"%PDF-" or size < 1024:
            raise RuntimeError("Chromium が有効な PDF を生成しませんでした。")

        os.replace(temporary_path, output)
        return size
    finally:
        temporary_path.unlink(missing_ok=True)


def make_pdf(source: Path, output: Path, timeout_seconds: float) -> int:
    try:
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError(
            "Playwright がありません。`python -m pip install -r requirements-pdf.txt` "
            "と `python -m playwright install chromium` を実行してください。"
        ) from exc

    if timeout_seconds <= 0:
        raise ValueError("--timeout は 0 より大きい秒数を指定してください。")

    source = source.expanduser().resolve()
    output = output.expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"入力 HTML が見つかりません: {source}")
    if source.suffix.lower() not in {".html", ".htm"}:
        raise ValueError(f"入力には HTML ファイルを指定してください: {source}")
    if output.suffix.lower() != ".pdf":
        raise ValueError(f"出力には .pdf ファイルを指定してください: {output}")
    if source == output:
        raise ValueError("入力と出力に同じパスは指定できません。")

    server_root, url_path = _server_location(source)
    timeout_ms = round(timeout_seconds * 1000)
    page_errors: list[str] = []

    with _serve(server_root) as (base_url, _server):
        source_url = f"{base_url}/{url_path}"
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    context = browser.new_context(
                        viewport={"width": 1440, "height": 900},
                        color_scheme="light",
                    )
                    page = context.new_page()
                    page.on("pageerror", lambda error: page_errors.append(str(error)))
                    page.emulate_media(media="print", color_scheme="light")
                    page.goto(
                        source_url,
                        wait_until="domcontentloaded",
                        timeout=timeout_ms,
                    )
                    missing_images = _wait_until_ready(page, timeout_ms)
                    if missing_images:
                        details = "\n  - ".join(missing_images)
                        raise RuntimeError(
                            f"印刷対象の画像を読み込めませんでした:\n  - {details}"
                        )

                    size = _write_pdf_atomically(page, output)
                    context.close()
                finally:
                    browser.close()
        except PlaywrightTimeoutError as exc:
            raise RuntimeError(
                f"ページの読込が {timeout_seconds:g} 秒以内に完了しませんでした: "
                f"{source_url}"
            ) from exc
        except Exception as exc:
            if "Executable doesn't exist" in str(exc):
                raise RuntimeError(
                    "Playwright Chromium がありません。"
                    "`python -m playwright install chromium` を実行してください。"
                ) from exc
            raise

    if page_errors:
        print("警告: ページ内 JavaScript エラー:", file=sys.stderr)
        for message in page_errors:
            print(f"  - {message}", file=sys.stderr)

    return size


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="ローカルのポートフォリオ HTML を Chromium で A4 PDF に変換します。",
    )
    parser.add_argument(
        "--source",
        "-s",
        type=Path,
        default=DEFAULT_SOURCE,
        help=f"入力 HTML（既定: {DEFAULT_SOURCE}）",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"出力 PDF（既定: {DEFAULT_OUTPUT}）",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=90.0,
        metavar="SECONDS",
        help="ページ読込のタイムアウト秒数（既定: 90）",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    try:
        size = make_pdf(args.source, args.output, args.timeout)
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"PDF生成失敗: {exc}", file=sys.stderr)
        return 1

    output = args.output.expanduser().resolve()
    print(f"PDF生成完了: {output} ({size / (1024 * 1024):.1f} MiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
