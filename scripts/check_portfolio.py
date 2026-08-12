#!/usr/bin/env python3
"""ポートフォリオHTMLの自動検査。

追加依存なし（標準ライブラリのみ）。外部リンクは --external 指定時のみ、
短いタイムアウトで確認し、一時的な失敗は警告に留める。
"""

from __future__ import annotations

import argparse
import re
import sys
import urllib.request
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
INDEX = PROJECT_ROOT / "index.html"

# 表記揺れ・残存禁止パターン（正規表現, 説明）
FORBIDDEN_PATTERNS = [
    (r"img\.shields\.io", "shields.ioバッジが残存"),
    (r"aisum-|ai-summary|AIによる要約", "AI要約関連の文字列が残存"),
    (r"\border-(?:1|2|3|4|5|last|first)\b", "CSS orderクラス（DOM順と視覚順の乖離）"),
    (r"本人の設計|本人の責任範囲|発展・証拠・状態", "テンプレート的な旧ラベルが残存"),
    # 22%表現は文脈依存のためFORBIDDENでは扱わず、mainで前後文脈を見て検査する
    (r"ScriptVedit|Scriptvedit|ChromiumForA|chromiumfora(?![-_])", "プロジェクト名の表記揺れ"),
    (r">\s*Repo\s*<|>\s*Video\s*<|>\s*Private\s*<|>\s*Print\s*<", "英語ラベル（GitHub/デモ動画/非公開へ統一）"),
    (r"課題設定から実機検証まで|使い続けられる形|鵜呑みにせず|単なるデモではなく", "抽象的な包括表現が残存"),
    (r"ダメ出し", "口語的表現（レビュー・修正方針の指示 等へ）"),
]

# README等の関連文書にも適用する検査（index.htmlとの文書間矛盾の検出）
DOC_FORBIDDEN_PATTERNS = [
    (r"ScriptVedit|Scriptvedit|ChromiumForA", "プロジェクト名の表記揺れ"),
    (r"仕様・テスト・検証は本人|受入テストを自分で", "ScriptVEditの担当範囲の旧記述（実態と不一致）"),
    (r"ダメ出し", "口語的表現"),
]
DOC_REQUIRED_STRINGS = [
    ("約22%まで低減", "研究の22%表現"),
    ("ScriptVEdit", "公式プロジェクト名"),
]

# 表示テキストとして必要な語（存在チェック）
REQUIRED_STRINGS = [
    ("従来法の約22%まで低減", "研究の22%表現"),
    ("最大19.2%低減", "HWHMの表現"),
    ("ScriptVEdit", "公式プロジェクト名"),
    ("a.kojima8924@gmail.com", "メール導線"),
    ("github.com/kojima8924", "GitHub導線"),
    ("frobt.2023.1157911", "論文リンク"),
]


class _Parser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []
        self.anchors: list[str] = []          # href="#..."
        self.local_refs: list[str] = []       # ローカルファイル参照
        self.imgs: list[dict] = []
        self.blank_links: list[str] = []      # target=_blank で rel 不足
        self.empty_hrefs = 0
        self.external_links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        a = dict(attrs)
        if "id" in a:
            self.ids.append(a["id"])
        if tag == "a":
            href = (a.get("href") or "").strip()
            if not href:
                self.empty_hrefs += 1
            elif href.startswith("#"):
                if href != "#":
                    self.anchors.append(href[1:])
            elif href.startswith(("http://", "https://")):
                self.external_links.append(href)
                if a.get("target") == "_blank":
                    rel = a.get("rel") or ""
                    if "noopener" not in rel or "noreferrer" not in rel:
                        self.blank_links.append(href)
            elif not href.startswith("mailto:"):
                self.local_refs.append(href)
        if tag == "img":
            src = a.get("src") or ""
            if not src.startswith(("http", "data:")):
                self.local_refs.append(src)
            self.imgs.append({"src": src, "alt": a.get("alt")})
        if tag in ("link",):
            href = a.get("href") or ""
            if href and not href.startswith(("http", "data:")):
                self.local_refs.append(href)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--external", action="store_true", help="外部リンクもHEAD/GETで確認する")
    args = ap.parse_args()

    html = INDEX.read_text(encoding="utf-8")
    parser = _Parser()
    parser.feed(html)

    errors: list[str] = []
    warnings: list[str] = []

    # 1) 重複ID
    for id_, count in Counter(parser.ids).items():
        if count > 1:
            errors.append(f"重複ID: #{id_} ×{count}")

    # 2) 存在しない内部anchor
    id_set = set(parser.ids)
    for anchor in parser.anchors:
        if anchor not in id_set:
            errors.append(f"存在しない内部anchor: #{anchor}")

    # 3) ローカル参照の実在
    for ref in parser.local_refs:
        path = (PROJECT_ROOT / ref.split("#")[0].split("?")[0]).resolve()
        if not path.is_file():
            errors.append(f"ローカルファイルが存在しない: {ref}")

    # 4) altのない画像
    for img in parser.imgs:
        if img["alt"] is None or img["alt"].strip() == "":
            errors.append(f"altのない画像: {img['src']}")

    # 5) 空href
    if parser.empty_hrefs:
        errors.append(f"空のhref: {parser.empty_hrefs}件")

    # 6) rel不足の_blank
    for href in parser.blank_links:
        errors.append(f"target=_blank で rel=noopener noreferrer 不足: {href}")

    # 7) 禁止パターン
    for pattern, reason in FORBIDDEN_PATTERNS:
        hits = re.findall(pattern, html)
        if hits:
            errors.append(f"{reason}: {len(hits)}件（例: {hits[0]!r}）")

    # 7b) 22%の誤解表現: 「…22%低減」は「約22%まで低減」の形以外を弾く
    for m in re.finditer(r"22[%％](低減|削減|改善)", html):
        context = html[max(0, m.start() - 8): m.end()]
        if "まで" not in context and "に低減" not in context:
            errors.append(f"『22%低減』型の誤解表現: …{context}…")

    # 8) 必須文字列
    for needle, reason in REQUIRED_STRINGS:
        if needle not in html:
            errors.append(f"必須文字列が見つからない（{reason}）: {needle!r}")

    # 8b) 関連文書（README等）の文書間矛盾
    for doc_name in ["README.md"]:
        doc_path = PROJECT_ROOT / doc_name
        if not doc_path.is_file():
            errors.append(f"関連文書が存在しない: {doc_name}")
            continue
        doc = doc_path.read_text(encoding="utf-8")
        for pattern, reason in DOC_FORBIDDEN_PATTERNS:
            hits = re.findall(pattern, doc)
            if hits:
                errors.append(f"[{doc_name}] {reason}: {len(hits)}件（例: {hits[0]!r}）")
        for needle, reason in DOC_REQUIRED_STRINGS:
            if needle not in doc:
                errors.append(f"[{doc_name}] 必須文字列が見つからない（{reason}）: {needle!r}")
        for m in re.finditer(r"22[%％](低減|削減|改善)", doc):
            context = doc[max(0, m.start() - 8): m.end()]
            if "まで" not in context and "に低減" not in context:
                errors.append(f"[{doc_name}] 『22%低減』型の誤解表現: …{context}…")

    # 9) 外部リンク（任意）
    if args.external:
        seen = set()
        for url in parser.external_links:
            if url in seen:
                continue
            seen.add(url)
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    if resp.status >= 400:
                        warnings.append(f"外部リンク {resp.status}: {url}")
            except Exception as exc:  # 一時失敗は警告のみ（全体を壊さない）
                warnings.append(f"外部リンク到達失敗（{type(exc).__name__}）: {url}")

    for w in warnings:
        print(f"[warn] {w}")
    if errors:
        for e in errors:
            print(f"[NG]   {e}")
        print(f"\n検査失敗: エラー{len(errors)}件 / 警告{len(warnings)}件")
        return 1
    print(f"検査OK: エラー0件 / 警告{len(warnings)}件 "
          f"(ID {len(parser.ids)}個, 画像 {len(parser.imgs)}枚, 外部リンク {len(set(parser.external_links))}件)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
