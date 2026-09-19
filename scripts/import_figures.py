#!/usr/bin/env python3
"""slide リポジトリで作った帯図（PDF）を SVG に変換して media/fig/ へ取り込む。

図の正本は C:\\code\\slide\\cases\\2026-09-18_CV・ポートフォリオ図版\\（1デッキ=図1枚）と
C:\\code\\slide\\cases\\2026-09-18_履歴書用_受託案件構成図\\ にある。図を直すときは slide 側を直して
`python C:\\code\\slide\\tools\\slide.py check <html>` で PDF を作り直し、このスクリプトを再実行する。

SVG は文字をパス化する（閲覧側に源真ゴシックが無くても崩れない）。座標の桁を落として容量を抑える。
使い方: python scripts/import_figures.py [--check]
  --check  書き込まず、slide 側の PDF から生成した SVG と media/fig/*.svg の内容を比較する
"""
from __future__ import annotations

import argparse
import os
import re
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "media" / "fig"
SLIDE_CASES = Path(r"C:\code\slide\cases")

# 出力名（ASCII）→ slide 側の PDF。ポートフォリオの <img src="media/fig/<name>.svg"> と対応させる
FIGURES: dict[str, Path] = {
    "clinic-flow": SLIDE_CASES / "2026-09-18_履歴書用_受託案件構成図" / "2026-09-18_受託案件システム構成図.pdf",
    "career-timeline": SLIDE_CASES / "2026-09-18_CV・ポートフォリオ図版" / "2026-09-18_図_経歴タイムライン.pdf",
    "clinic-results": SLIDE_CASES / "2026-09-18_CV・ポートフォリオ図版" / "2026-09-18_図_受託案件の改善実績.pdf",
    "trivium-flow": SLIDE_CASES / "2026-09-18_CV・ポートフォリオ図版" / "2026-09-18_図_Trivium構成と作問検証.pdf",
    "clagecook-flow": SLIDE_CASES / "2026-09-18_CV・ポートフォリオ図版" / "2026-09-18_図_ClageCook会議フロー.pdf",
    "scriptvedit-flow": SLIDE_CASES / "2026-09-18_CV・ポートフォリオ図版" / "2026-09-18_図_ScriptVEditパイプライン.pdf",
    "research-flow": SLIDE_CASES / "2026-09-18_CV・ポートフォリオ図版" / "2026-09-18_図_研究の手法と結果.pdf",
}

_NUM = re.compile(r"(-?\d+\.\d{3,})")


def _round_numbers(svg: str) -> str:
    """パス座標の小数を2桁に落とす（見た目は変わらず容量が3〜4割減る）。"""
    return _NUM.sub(lambda m: f"{float(m.group(1)):.2f}", svg)


def _render_svg(pdf: Path) -> str:
    """PDFを、保存時と同じ条件でSVG文字列へ変換する。"""
    try:
        import fitz  # PyMuPDF
    except ImportError as exc:  # pragma: no cover
        raise SystemExit("PyMuPDF が必要です: python -m pip install pymupdf") from exc

    with fitz.open(pdf) as doc:
        if len(doc) != 1:
            raise SystemExit(f"{pdf.name}: 1ページのはずが {len(doc)} ページ")
        svg = doc[0].get_svg_image(text_as_path=True)
    svg = _round_numbers(svg)
    # 図の意味はページ側の alt / 本文で説明するので、装飾画像として扱えるよう role を付ける
    return svg.replace("<svg ", '<svg role="img" ', 1)


def convert(name: str, pdf: Path) -> Path:
    svg = _render_svg(pdf)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{name}.svg"
    fd, temp_name = tempfile.mkstemp(dir=OUT_DIR, prefix=f".{name}-", suffix=".tmp")
    os.close(fd)
    temp = Path(temp_name)
    try:
        temp.write_text(svg, encoding="utf-8", newline="\r\n")  # 他のファイルと同じ CRLF
        temp.replace(out)
    except BaseException:
        temp.unlink(missing_ok=True)
        raise
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="変換せず、更新が必要な図を列挙する")
    ap.add_argument("names", nargs="*", help="取り込む図の名前（省略時は全部）")
    args = ap.parse_args()

    targets = {k: v for k, v in FIGURES.items() if not args.names or k in args.names}
    unknown = set(args.names) - set(FIGURES)
    if unknown:
        raise SystemExit(f"未知の図: {', '.join(sorted(unknown))}（候補: {', '.join(FIGURES)}）")

    missing_sources = [(name, pdf) for name, pdf in targets.items() if not pdf.is_file()]
    if missing_sources:
        for name, pdf in missing_sources:
            print(f"[missing] {name}: 参照元 PDF がありません → {pdf}")
        if args.check:
            print("更新が必要な図: 未確認（参照元 PDF が欠損）")
        print("参照元 PDF の欠損:", len(missing_sources))
        return 1

    stale = 0
    for name, pdf in targets.items():
        out = OUT_DIR / f"{name}.svg"
        if args.check:
            if not out.is_file():
                print(f"[stale] {name}: 出力 SVG がありません → {out}")
                stale += 1
            elif _render_svg(pdf) != out.read_text(encoding="utf-8"):
                print(f"[stale] {name}: {pdf.name} の内容が {out.name} に反映されていません")
                stale += 1
            continue
        out = convert(name, pdf)
        print(f"[ok] {name}: {pdf.name} → {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KiB)")
    if args.check:
        print("更新が必要な図:", stale)
        print("参照元 PDF の欠損: 0")
        return 1 if stale else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
