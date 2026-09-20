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
from urllib.parse import quote, urlsplit, urlunsplit


PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE = PROJECT_ROOT / "index.html"
DEFAULT_OUTPUT = PROJECT_ROOT / "media" / "Akira_Kojima_Portfolio.pdf"
DEFAULT_SUMMARY_OUTPUT = PROJECT_ROOT / "media" / "Akira_Kojima_Portfolio_Summary.pdf"
PUBLIC_SITE_URL = "https://kojima8924.github.io/"


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

    # アコーディオンを開いて過去作品も印刷対象に含める。
    # 閉じたままだと中の遅延読込画像が「非表示」扱いになり待機対象から漏れるため、
    # 画像のeager化より先に開く必要がある。
    page.evaluate(
        "document.querySelectorAll('details').forEach(detail => { detail.open = true; })"
    )
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


PDF_METADATA = {
    "summary": {
        "title": "Akira Kojima Portfolio Summary",
        "author": "Akira Kojima",
        "subject": "Research, Hand-Coded Graphics and AI-Assisted Development Summary",
    },
    "full": {
        "title": "Akira Kojima Portfolio",
        "author": "Akira Kojima",
        "subject": "Research, Hand-Coded Graphics and AI-Assisted Development Portfolio",
    },
}


# 再圧縮しない画像（資格のデジタルバッジ。AWS の利用ルール上、画質を落とす改変もしない）
UNALTERED_IMAGES = [Path(__file__).resolve().parent / "media" / "badge-aws-ai-practitioner.png"]


def _find_unaltered_images(document) -> list:
    """UNALTERED_IMAGES と同じ寸法・アルファ付きの埋め込み画像を (ページ番号, xref, 元ファイル) で返す。"""
    import pymupdf

    targets = []
    for path in UNALTERED_IMAGES:
        if path.exists():
            pix = pymupdf.Pixmap(str(path))
            targets.append((path, pix.width, pix.height))
    found = []
    for page in document:
        for info in page.get_images(full=True):
            xref, smask, width, height = info[0], info[1], info[2], info[3]
            for path, tw, th in targets:
                if smask and (width, height) == (tw, th):
                    found.append((page.number, xref, path))
    return found


# 帯図の中のサービスロゴ（Dify など 200px 前後の小さな画像）は、再圧縮で 150dpi 基準に縮めると
# 数ピクセルまで潰れる（2026-09-19 に Dify ロゴが 4×4px になったのを確認）。小さい画像は元のまま戻す
SMALL_IMAGE_MAX_PX = 256


def _find_small_images(document) -> list:
    """アルファを持たない小さな埋め込み画像を (ページ番号, 配置矩形, 元の画像バイト列) で返す。

    rewrite_images は画像を新しい xref に置き換えることがあるので、再圧縮後は xref ではなく
    ページ上の配置矩形で同じ画像を探して戻す。
    """
    found = []
    cache = {}
    for page in document:
        for info in page.get_image_info(xrefs=True):
            xref = info.get("xref") or 0
            if xref <= 0 or max(info["width"], info["height"]) > SMALL_IMAGE_MAX_PX:
                continue
            if document.xref_get_key(xref, "SMask")[0] != "null":
                continue
            if xref not in cache:
                extracted = document.extract_image(xref)
                cache[xref] = extracted.get("image") if extracted else None
            if cache[xref]:
                found.append((page.number, tuple(round(v, 1) for v in info["bbox"]), cache[xref]))
    return found


def _restore_small_images(document, small: list) -> None:
    for page_number, bbox, data in small:
        page = document[page_number]
        for info in page.get_image_info(xrefs=True):
            if tuple(round(v, 1) for v in info["bbox"]) == bbox and (info.get("xref") or 0) > 0:
                page.replace_image(info["xref"], stream=data)
                break


def _public_pdf_uri(uri: str, local_origin: str) -> str:
    """今回の生成用サーバーに向くURIだけを公開URLへ移す．"""
    try:
        source = urlsplit(local_origin)
        target = urlsplit(uri)
    except ValueError:
        return uri

    # 同じlocalhostでも別サービスのリンクは変更しない．完全なorigin一致が必要．
    if source.scheme != "http" or source.hostname not in {"127.0.0.1", "localhost", "::1"}:
        return uri
    if (target.scheme, target.netloc) != (source.scheme, source.netloc):
        return uri

    public = urlsplit(PUBLIC_SITE_URL)
    return urlunsplit((public.scheme, public.netloc, target.path or "/", target.query, target.fragment))


def _rewrite_local_pdf_links(document, local_origin: str) -> int:
    """画像・資料へのローカルHTTPリンクを直し，内部ページ移動や外部リンクは保持する．"""
    import pymupdf

    updated = 0
    for page in document:
        for link in page.get_links():
            if link.get("kind") != pymupdf.LINK_URI or not link.get("uri"):
                continue
            public_uri = _public_pdf_uri(link["uri"], local_origin)
            if public_uri != link["uri"]:
                page.update_link({**link, "uri": public_uri})
                updated += 1
    return updated


def _compress_pdf_images(output: Path, mode: str = "full", *, local_origin: str | None = None) -> int:
    """埋め込み画像を印刷十分な解像度へ再圧縮し、配布しやすいサイズに抑える。

    あわせてメタデータを設定し，生成用サーバーのURIを公開サイトへ向ける．
    """

    try:
        import pymupdf
    except ImportError as exc:
        raise RuntimeError(
            "PyMuPDF がありません。`python -m pip install -r requirements-pdf.txt` "
            "を実行してください。"
        ) from exc

    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output.stem}-compress-",
        suffix=".tmp.pdf",
        dir=output.parent,
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)

    try:
        with pymupdf.open(output) as document:
            metadata = dict(document.metadata or {})
            metadata.update(PDF_METADATA.get(mode, PDF_METADATA["full"]))
            document.set_metadata(metadata)
            keep = _find_unaltered_images(document)
            small = _find_small_images(document)
            document.rewrite_images(
                dpi_threshold=180,
                dpi_target=150,
                quality=80,
                lossy=True,
                lossless=True,
            )
            for page_number, xref, path in keep:
                document[page_number].replace_image(xref, filename=str(path))
            _restore_small_images(document, small)
            if local_origin is not None:
                _rewrite_local_pdf_links(document, local_origin)
            document.ez_save(str(temporary_path))

        size = temporary_path.stat().st_size
        with temporary_path.open("rb") as stream:
            signature = stream.read(5)
        if signature != b"%PDF-" or size < 1024:
            raise RuntimeError("画像再圧縮後の PDF が不正です。")

        os.replace(temporary_path, output)
        return size
    finally:
        temporary_path.unlink(missing_ok=True)


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


def _count_pages(output: Path) -> int:
    """生成後のPDFの実ページ数を返す（README記載との整合確認用）。"""

    import pymupdf

    with pymupdf.open(output) as document:
        return document.page_count


def make_pdf(source: Path, output: Path, timeout_seconds: float, mode: str = "full") -> int:
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
                    if mode == "summary":
                        # 採用向けサマリー: .pdf-full-only を print CSS で非表示にする
                        page.evaluate(
                            "document.body.classList.add('pdf-summary')"
                        )
                    missing_images = _wait_until_ready(page, timeout_ms)
                    if missing_images:
                        details = "\n  - ".join(missing_images)
                        raise RuntimeError(
                            f"印刷対象の画像を読み込めませんでした:\n  - {details}"
                        )

                    _write_pdf_atomically(page, output)
                    size = _compress_pdf_images(output, mode, local_origin=base_url)
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
    parser.add_argument(
        "--mode",
        choices=("summary", "full", "both"),
        default="both",
        help="summary=採用向け（.pdf-full-only を除外）/ full=完全版 / both=両方（既定）",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()

    jobs: list[tuple[str, Path]] = []
    if args.mode in ("full", "both"):
        jobs.append(("full", args.output))
    if args.mode in ("summary", "both"):
        summary_output = (
            DEFAULT_SUMMARY_OUTPUT
            if args.output == DEFAULT_OUTPUT
            else args.output.with_name(f"{args.output.stem}_Summary.pdf")
        )
        jobs.append(("summary", summary_output))

    for mode, output in jobs:
        try:
            size = make_pdf(args.source, output, args.timeout, mode=mode)
            pages = _count_pages(output.expanduser().resolve())
        except (OSError, RuntimeError, ValueError) as exc:
            print(f"PDF生成失敗（{mode}）: {exc}", file=sys.stderr)
            return 1
        resolved = output.expanduser().resolve()
        print(
            f"PDF生成完了（{mode}）: {resolved} "
            f"({size / (1024 * 1024):.1f} MiB / {pages}ページ)"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
