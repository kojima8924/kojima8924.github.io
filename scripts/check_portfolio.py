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
    # 21%（旧22%）表現は文脈依存のためFORBIDDENでは扱わず、mainで前後文脈を見て検査する
    (r"ScriptVedit|Scriptvedit|ChromiumForA|chromiumfora(?![-_])", "プロジェクト名の表記揺れ"),
    (r">\s*Repo\s*<|>\s*Video\s*<|>\s*Private\s*<|>\s*Print\s*<", "英語ラベル（GitHub/デモ動画/非公開へ統一）"),
    (r"課題設定から実機検証まで|使い続けられる形|鵜呑みにせず|単なるデモではなく", "抽象的な包括表現が残存"),
    (r"ダメ出し", "口語的表現（レビュー・修正方針の指示 等へ）"),
    # 2026-09-19 の外部レビューと再調査で「書かない」と決めた表現（alt も対象にするため raw HTML に掛ける。根拠は slide の facts.md）
    (r"安全コーパス|AI沈黙|沈黙保証|不可逆化|外部LLMなしで処理", "受託案件の強すぎる表現（facts.md の言い換えを使う）"),
    (r"切替条件を見直|発火を抑制|ナレッジを整理して(?:網羅|改善)|正答率", "受託案件の改善理由・指標の誤った書き方（検索設定の変更・確認項目の網羅率）"),
    (r"API契約|イベント契約", "Clage Cook の「契約」表記（API仕様・統一イベント形式へ）"),
    (r"最大\s*19\.2|26問|1秒以内|その後も改善|(?<!バッジ)(?<!学習実績バッジ)実績\s*61\s*種", "研究・Trivium の誤読されやすい表現"),
    (r"倍率が分割数に対して過大|可視区間トリムが抜けていたと特定", "ScriptVEdit の O(N²) を本人が発見したように読める表現"),
    (r"クラウドLLM|クラウド\s*LLM|再監査", "受託案件の匿名化の説明は、正規表現とローカルLLMの段階に限る"),
]

# 表示テキスト（script/style以外）にのみ適用する検査。
# raw HTMLへ適用するとURL（atcoder.jp / paiza.jp）まで誤検出するため分離する。
TEXT_FORBIDDEN_PATTERNS = [
    (r"Atcoder|ATCODER|AtCoder Cyan|AtCoder ?シアン", "AtCoder表記の揺れ（「AtCoder 水色」に統一）"),
    (r"Paiza|PAIZA", "paiza表記の揺れ（小文字「paiza」に統一）"),
    # 「paizaスキルチェック Sランク」以外の書き方（paiza S / paiza S Rank / paiza Sランク等）を検出
    (r"paiza\s+S(?:\s*(?:Rank|ランク))?\b", "paizaランク表記の揺れ（「paizaスキルチェック Sランク」に統一）"),
    (r"(?:AtCoder[^。]{0,12}|paiza[^。]{0,20})を?取得", "AtCoder/paizaを資格のように「取得」と表現している"),
]
TEXT_REQUIRED_STRINGS = [
    ("AtCoder 水色（最高レーティング1440。2026年9月時点で上位6.27%）", "AtCoder実績（6.27%は現在レーティングでの順位）"),
    ("paizaスキルチェック Sランク", "paiza実績"),
    ("最高レーティング1920", "paiza最高レーティング"),
    ("従来法の約21%まで低減", "研究の21%表現"),
    ("19.2%低減", "HWHMの表現"),
    ("ScriptVEdit", "公式プロジェクト名"),
    ("基本情報技術者 取得（2026年8月）", "資格表記"),
    ("AWS Certified AI Practitioner 取得（2026年9月）", "資格表記"),
]

# README等の関連文書にも適用する検査（index.htmlとの文書間矛盾の検出）
DOC_FORBIDDEN_PATTERNS = [
    (r"ScriptVedit|Scriptvedit|ChromiumForA", "プロジェクト名の表記揺れ"),
    (r"仕様・テスト・検証は本人|受入テストを自分で", "ScriptVEditの担当範囲の旧記述（実態と不一致）"),
    (r"ダメ出し", "口語的表現"),
]
DOC_REQUIRED_STRINGS = [
    ("約21%まで低減", "研究の21%表現"),
    ("ScriptVEdit", "公式プロジェクト名"),
]

# 表示テキストとして必要な語（存在チェック）
REQUIRED_STRINGS = [
    ("従来法の約21%まで低減", "研究の21%表現"),
    ("19.2%低減", "HWHMの表現"),
    ("ScriptVEdit", "公式プロジェクト名"),
    ("a.kojima8924@gmail.com", "メール導線"),
    ("credly.com/badges/fb68c752-94ef-46e9-a339-fa398107e3a7", "AWS認定の検証リンク（Credly）"),
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
        self.text_parts: list[str] = []       # 表示テキスト（script/style除く）
        self._ignored_depth = 0

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth:
            self.text_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self._ignored_depth:
            self._ignored_depth -= 1

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in {"script", "style"}:
            self._ignored_depth += 1
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

    # 7a) 表示テキストのみに適用する検査（URLを誤検出しない）
    visible_text = " ".join(parser.text_parts)
    for pattern, reason in TEXT_FORBIDDEN_PATTERNS:
        hits = re.findall(pattern, visible_text)
        if hits:
            errors.append(f"[表示テキスト] {reason}: {len(hits)}件（例: {hits[0]!r}）")
    for needle, reason in TEXT_REQUIRED_STRINGS:
        if needle not in visible_text:
            errors.append(f"[表示テキスト] 必須文字列が見つからない（{reason}）: {needle!r}")

    # 7b) 21%の誤解表現: 「…21%低減」は「約21%まで低減」の形以外を弾く（旧表記の22%も同様）
    for m in re.finditer(r"2[12][%％](低減|削減|改善)", html):
        context = html[max(0, m.start() - 8): m.end()]
        if "まで" not in context and "に低減" not in context:
            errors.append(f"『22%低減』型の誤解表現: …{context}…")

    # 7c) 資格の検証URL（Credly）は JSON-LD・Hero・バッジ・検証リンクの4箇所で完全一致させる
    credly_urls = re.findall(r"https?://(?:www\.)?credly\.com/[^\s\"'<>]+", html)
    expected_credly = "https://www.credly.com/badges/fb68c752-94ef-46e9-a339-fa398107e3a7/public_url"
    if set(credly_urls) != {expected_credly} or len(credly_urls) != 4:
        errors.append(f"Credly の検証URLが不一致または箇所数が違う（4箇所の完全一致を期待）: {sorted(set(credly_urls))} ×{len(credly_urls)}")

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
        for m in re.finditer(r"2[12][%％](低減|削減|改善)", doc):
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
