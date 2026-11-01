#!/usr/bin/env python3
"""ポートフォリオHTMLの自動検査。

追加依存なし（標準ライブラリのみ）。外部リンクは --external 指定時のみ、
短いタイムアウトで確認し、一時的な失敗は警告に留める。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from collections import Counter
from dataclasses import dataclass, field
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
    # 「学習実績バッジ」も末尾が「バッジ」なので (?<!バッジ) だけで除外できる
    (r"最大\s*19\.2|26問|1秒以内|その後も改善|(?<!バッジ)実績\s*61\s*種", "研究・Trivium の誤読されやすい表現"),
    (r"倍率が分割数に対して過大|可視区間トリムが抜けていたと特定", "ScriptVEdit の O(N²) を本人が発見したように読める表現"),
    (r"クラウド\s*LLM|再監査", "受託案件の匿名化の説明は、正規表現とローカルLLMの段階に限る"),
    # portfolio-assistant は非公開リポジトリ。リンクやAWS内部の識別子を掲載しない
    (r"github\.com/kojima8924/portfolio-assistant|arn:aws[a-z-]*:|portfolio-assistant-dev\b|execute-api\.[a-z0-9-]+\.amazonaws\.com/(?:models|ask)",
     "portfolio-assistant の非公開リポジトリ・AWS内部識別子・API経路の掲載"),
]

# 表示テキスト（script/style以外）にのみ適用する検査。
# raw HTMLへ適用するとURL（atcoder.jp / paiza.jp）まで誤検出するため分離する。
TEXT_FORBIDDEN_PATTERNS = [
    (r"Atcoder|ATCODER|AtCoder Cyan|AtCoder ?シアン", "AtCoder表記の揺れ（「AtCoder 水色」に統一）"),
    (r"Paiza|PAIZA", "paiza表記の揺れ（小文字「paiza」に統一）"),
    # 「paizaスキルチェック Sランク」以外の書き方（paiza S / paiza S Rank / paiza Sランク等）を検出
    (r"paiza\s+S(?:\s*(?:Rank|ランク))?\b", "paizaランク表記の揺れ（「paizaスキルチェック Sランク」に統一）"),
    (r"(?:AtCoder[^。．.!！?？\n]{0,12}|paiza[^。．.!！?？\n]{0,20})を?取得", "AtCoder/paizaを資格のように「取得」と表現している"),
]
TEXT_REQUIRED_STRINGS = [
    ("AtCoder 水色", "AtCoder実績"),
    ("最高レーティング1541", "AtCoder最高レーティング"),
    ("上位4.24%", "AtCoder順位（現在レーティングでの順位）"),
    ("paizaスキルチェック Sランク", "paiza実績"),
    ("最高レーティング1920", "paiza最高レーティング"),
    ("従来法の約21%まで低減", "研究の21%表現"),
    ("19.2%低減", "HWHMの表現"),
    ("ScriptVEdit", "公式プロジェクト名"),
    ("基本情報技術者 取得（2026年8月）", "資格表記"),
    ("G検定 取得（2026年9月）", "資格表記"),
    ("AWS Certified AI Practitioner 取得（2026年9月）", "資格表記"),
    ("GitHub Foundations 取得（2026年10月）", "資格表記"),
    ("AWS Certified Cloud Practitioner 取得（2026年10月）", "資格表記"),
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

# raw HTML（href等の属性を含む）でしか確認できない必須文字列（存在チェック）。
# 表示テキストで足りるものは TEXT_REQUIRED_STRINGS，Credly は check_credential_links に一本化する。
REQUIRED_STRINGS = [
    ("a.kojima8924@gmail.com", "メール導線"),
    ("github.com/kojima8924", "GitHub導線"),
    ("frobt.2023.1157911", "論文リンク"),
]

# 作品名を押したときは総覧ではなく、その作品へ直接移動する。
# 「AI活用の作品」などの総覧リンクや外部GitHubリンクは対象外。
WORK_ANCHORS = {
    "Clage Cook": "clagecook-card",
    "Trivium": "trivium-card",
    "ChromiumforA": "chromiumfora-card",
    "ScriptVEdit": "scriptvedit-card",
    "portfolio-assistant": "portfolio-assistant-card",
}
# 資格ごとのCredly検証URL（AWS Certified AI Practitioner／AWS Certified Cloud Practitioner）
EXPECTED_CREDLY_AIF = "https://www.credly.com/badges/fb68c752-94ef-46e9-a339-fa398107e3a7/public_url"
EXPECTED_CREDLY_CLF = "https://www.credly.com/badges/0045d984-825f-4110-bc04-3f929dbd961f/public_url"
EXPECTED_CREDLY = {EXPECTED_CREDLY_AIF, EXPECTED_CREDLY_CLF}
VOID_ELEMENTS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}


@dataclass
class _Element:
    tag: str
    attrs: dict[str, str | None]
    ancestors: tuple[_Element, ...]
    text_parts: list[str] = field(default_factory=list)

    def has_class(self, name: str) -> bool:
        return name in (self.attrs.get("class") or "").split()


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
        self.elements: list[_Element] = []
        self._stack: list[_Element] = []
        self._ignored_depth = 0

    def handle_data(self, data: str) -> None:
        for element in self._stack:
            element.text_parts.append(data)
        if not self._ignored_depth:
            self.text_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self._ignored_depth:
            self._ignored_depth -= 1
        # void要素はスタックへ積まない。親をたどって明示された終了タグを閉じる。
        for index in range(len(self._stack) - 1, -1, -1):
            if self._stack[index].tag == tag:
                del self._stack[index:]
                break

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in {"script", "style"}:
            self._ignored_depth += 1
        a = dict(attrs)
        element = _Element(tag, a, tuple(self._stack))
        self.elements.append(element)
        if tag not in VOID_ELEMENTS:
            self._stack.append(element)
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
            self.imgs.append({"src": src, "alt": a.get("alt"), "element": element})
        if tag in ("link",):
            href = a.get("href") or ""
            if href and not href.startswith(("http", "data:")):
                self.local_refs.append(href)


def check_structure(parser: _Parser) -> list[str]:
    """導線とCGの常時表示を検査する。本文の文章やCSSの寸法値は固定しない。"""
    errors: list[str] = []
    for id_, count in Counter(parser.ids).items():
        if count > 1:
            errors.append(f"重複ID: #{id_} ×{count}")

    id_set = set(parser.ids)
    for anchor in parser.anchors:
        if anchor not in id_set:
            errors.append(f"存在しない内部anchor: #{anchor}")

    nav_targets = set()
    for element in parser.elements:
        if element.tag != "a":
            continue
        href = (element.attrs.get("href") or "").strip()
        if any(parent.tag == "nav" for parent in element.ancestors):
            nav_targets.add(href)
        label = " ".join("".join(element.text_parts).split())
        expected = WORK_ANCHORS.get(label)
        if expected and href.startswith("#") and href != f"#{expected}":
            errors.append(f"作品名の内部リンクが作品へ直接移動しない: {label} → {href}（#{expected}を期待）")

    for anchor in ("client", "craft"):
        if f"#{anchor}" not in nav_targets:
            errors.append(f"ナビゲーションからの導線がない: #{anchor}")

    for img in parser.imgs:
        element = img["element"]
        if not any(parent.has_class("fig-band") for parent in element.ancestors):
            continue
        for dimension in ("width", "height"):
            value = element.attrs.get(dimension) or ""
            if not re.fullmatch(r"[0-9]+", value) or int(value) <= 0:
                errors.append(f"帯図の領域予約に正の{dimension}属性が必要: {img['src']}")

    craft_cards = [
        element for element in parser.elements
        if element.has_class("cg-card")
        and any(parent.attrs.get("id") == "craft" for parent in element.ancestors)
    ]
    if len(craft_cards) != 3:
        errors.append(f"#craftのCG作品カードは3件を期待: {len(craft_cards)}件")
    for card in craft_cards:
        label = card.attrs.get("id") or "（IDなし）"
        for element in (*card.ancestors, card):
            if element.tag == "details":
                errors.append(f"CG作品が折りたたみ内にある: {label}")
                break
            if any(element.has_class(name) for name in ("pdf-full-only", "summary-hide")):
                errors.append(f"CG作品が採用向けサマリーの除外対象になっている: {label}")
                break
            if "hidden" in element.attrs:
                errors.append(f"CG作品がhidden属性で非表示になっている: {label}")
                break
    return errors


def check_credential_links(parser: _Parser, html: str) -> list[str]:
    """資格ごとの証明URLを表示リンクと構造化データの両方に保ち、重複掲載の数は問わない。"""
    errors: list[str] = []
    credly_urls = re.findall(r"https?://(?:www\.)?credly\.com/[^\s\"'<>]+", html)
    if set(credly_urls) != EXPECTED_CREDLY:
        errors.append(f"Credlyの検証URLが不一致: {sorted(set(credly_urls))}")
    json_ld = "".join(
        "".join(element.text_parts)
        for element in parser.elements
        if element.tag == "script" and element.attrs.get("type") == "application/ld+json"
    )
    for url in sorted(EXPECTED_CREDLY):
        if url not in parser.external_links:
            errors.append(f"Credlyの検証URLへの表示リンクがない: {url}")
        if url not in json_ld:
            errors.append(f"JSON-LDにCredlyの検証URLがない: {url}")
    return errors


def _normalize_space(text: str) -> str:
    """連続する空白（全角スペース・改行を含む）を半角スペース1つにまとめる。"""
    return " ".join(text.split())


def _container_text(parser: _Parser, label: str) -> str | None:
    """容器（".class" または "#id"）の表示テキストを空白正規化して返す。見つからなければ None。"""
    for element in parser.elements:
        if label.startswith(".") and element.has_class(label[1:]):
            return _normalize_space("".join(element.text_parts))
        if label.startswith("#") and element.attrs.get("id") == label[1:]:
            return _normalize_space("".join(element.text_parts))
    return None


def _pattern_errors(patterns: list[tuple[str, str]], text: str, prefix: str = "") -> list[str]:
    """禁止パターンの一致を「{reason}: {n}件（例: ...）」として返す。"""
    errors: list[str] = []
    for pattern, reason in patterns:
        hits = re.findall(pattern, text)
        if hits:
            errors.append(f"{prefix}{reason}: {len(hits)}件（例: {hits[0]!r}）")
    return errors


def _missing_errors(required: list[tuple[str, str]], text: str, prefix: str = "") -> list[str]:
    """必須文字列の欠落を返す。"""
    return [
        f"{prefix}必須文字列が見つからない（{reason}）: {needle!r}"
        for needle, reason in required
        if needle not in text
    ]


def _percent_wording_errors(text: str, prefix: str = "") -> list[str]:
    """21%の誤解表現: 「…21%低減」は「約21%まで低減」の形以外を弾く（旧表記の22%も同様）。"""
    errors: list[str] = []
    for m in re.finditer(r"2[12][%％](低減|削減|改善)", text):
        context = text[max(0, m.start() - 8): m.end()]
        # 正規表現は『2[12]%低減』に一致するため『約21%まで低減』はそもそも一致しない．
        # context の末尾は必ず『%低減』（%の直後）なので旧条件『に低減』は機能していなかった．
        if "まで" not in context:
            errors.append(f"{prefix}『22%低減』型の誤解表現: …{context}…")
    return errors


def check_credentials(parser: _Parser) -> list[str]:
    """JSON-LD の hasCredential・プロフィール・#career・検査表の資格表記を同期させる。"""
    errors: list[str] = []
    credentials: list = []
    for element in parser.elements:
        if element.tag != "script" or element.attrs.get("type") != "application/ld+json":
            continue
        try:
            data = json.loads("".join(element.text_parts))
        except json.JSONDecodeError as exc:
            return [f"JSON-LDを解析できない: {exc}"]
        main_entity = data.get("mainEntity") if isinstance(data, dict) else None
        if isinstance(main_entity, dict):
            credentials.extend(main_entity.get("hasCredential") or [])

    displays: list[str] = []
    for credential in credentials:
        name = credential.get("name") if isinstance(credential, dict) else None
        date = credential.get("dateCreated") if isinstance(credential, dict) else None
        m = re.fullmatch(r"([0-9]{4})-([0-9]{2})", date or "")
        if not name or not m:
            errors.append(f"JSON-LDのhasCredentialにnameまたはdateCreated（YYYY-MM）がない: {credential!r}")
            continue
        displays.append(_normalize_space(f"{name} 取得（{int(m.group(1))}年{int(m.group(2))}月）"))

    for label, container_name in ((".profile-facts", "プロフィール（.profile-facts）"), ("#career", "#career")):
        text = _container_text(parser, label)
        if text is None:
            errors.append(f"資格表記の容器がない: {label}")
            continue
        for display in displays:
            if display not in text:
                errors.append(f"JSON-LDの資格が{container_name}の表示テキストにない: {display!r}")

    needles = [needle for needle, reason in TEXT_REQUIRED_STRINGS if reason == "資格表記"]
    if len(credentials) != len(needles):
        errors.append(f"JSON-LDのhasCredentialは検査表の資格表記と同じ{len(needles)}件を期待: {len(credentials)}件")
    display_set = set(displays)
    for needle in needles:
        if _normalize_space(needle) not in display_set:
            errors.append(f"検査表の資格表記がJSON-LDのhasCredentialにない: {needle!r}")
    return errors


def check_profile_facts(parser: _Parser) -> list[str]:
    """プロフィール欄の AtCoder 最高レーティング・上位%が検査表の値と一致することを確かめる。"""
    errors: list[str] = []
    expected: list[str] = []
    for needle, reason in TEXT_REQUIRED_STRINGS:
        if reason == "AtCoder最高レーティング":
            m = re.search(r"[0-9]+", needle)
            if m:
                expected.append(f"最高{m.group(0)}")
        elif reason.startswith("AtCoder順位"):
            m = re.search(r"上位[0-9.]+[%％]", needle)
            if m:
                expected.append(m.group(0))
    if len(expected) != 2:
        errors.append(f"検査表からAtCoderの最高レーティング・上位%を取り出せない: {expected!r}")
    text = _container_text(parser, ".profile-facts")
    if text is None:
        return errors + ["AtCoder実績の容器がない: .profile-facts"]
    for value in expected:
        if value not in text:
            errors.append(f"プロフィール（.profile-facts）にAtCoderの値がない: {value!r}")
    return errors


def check_meta_consistency(parser: _Parser) -> list[str]:
    """<title>・OGP・Twitter Card の重複値が一致することを確かめる。"""
    values: dict[str, str] = {}
    for element in parser.elements:
        if element.tag == "title" and "title" not in values:
            values["title"] = _normalize_space("".join(element.text_parts))
        elif element.tag == "meta":
            key = element.attrs.get("property") or element.attrs.get("name") or ""
            if key.startswith(("og:", "twitter:")) and key not in values:
                values[key] = element.attrs.get("content") or ""
    errors: list[str] = []
    keys = ("title", "og:title", "twitter:title", "og:description", "twitter:description",
            "og:image", "twitter:image", "og:image:alt", "twitter:image:alt")
    for key in keys:
        if key not in values:
            errors.append(f"metaがない: {key}")
    pairs = (
        ("title", "og:title"), ("title", "twitter:title"),
        ("og:description", "twitter:description"),
        ("og:image", "twitter:image"),
        ("og:image:alt", "twitter:image:alt"),
    )
    for a, b in pairs:
        if a in values and b in values and values[a] != values[b]:
            errors.append(f"{a}と{b}が不一致: {values[a]!r} / {values[b]!r}")
    return errors


def check_media_labels(parser: _Parser) -> list[str]:
    """「画像を拡大：…」の aria-label と子 img の alt を一致させる（別文言のラベルは対象外）。"""
    errors: list[str] = []
    prefix = "画像を拡大："
    for element in parser.elements:
        if element.tag != "a" or element.attrs.get("data-media-kind") != "image":
            continue
        label = element.attrs.get("aria-label") or ""
        if not label.startswith(prefix):
            continue
        href = element.attrs.get("href") or ""
        img = next(
            (img for img in parser.imgs if any(parent is element for parent in img["element"].ancestors)),
            None,
        )
        if img is None:
            errors.append(f"画像拡大リンクに子imgがない: {href}")
            continue
        rest = _normalize_space(label[len(prefix):])
        alt = _normalize_space(img["alt"] or "")
        if rest != alt:
            errors.append(f"画像拡大リンクのaria-labelとimgのaltが不一致: {href}（aria-label: {rest!r} / alt: {alt!r}）")
    return errors


def check_html_text(parser: _Parser, html: str) -> list[str]:
    """index.html の文言・必須要素・容器間の同期を検査する（出力順は固定）。"""
    errors = _pattern_errors(FORBIDDEN_PATTERNS, html)
    # 表示テキストのみに適用する検査（URLを誤検出しない）
    visible_text = " ".join(parser.text_parts)
    errors += _pattern_errors(TEXT_FORBIDDEN_PATTERNS, visible_text, "[表示テキスト] ")
    errors += _missing_errors(TEXT_REQUIRED_STRINGS, visible_text, "[表示テキスト] ")
    errors += _percent_wording_errors(html)
    # 資格の検証URLは構造化データと表示リンクで一致させる。
    errors += check_credential_links(parser, html)
    errors += _missing_errors(REQUIRED_STRINGS, html)
    # 容器ごとの同期（資格・AtCoder・OGP・画像の説明）
    errors += check_credentials(parser)
    errors += check_profile_facts(parser)
    errors += check_meta_consistency(parser)
    errors += check_media_labels(parser)
    return errors


def check_doc(doc_name: str, text: str) -> list[str]:
    """README等の関連文書の文書間矛盾を検査する。"""
    prefix = f"[{doc_name}] "
    return (
        _pattern_errors(DOC_FORBIDDEN_PATTERNS, text, prefix)
        + _missing_errors(DOC_REQUIRED_STRINGS, text, prefix)
        + _percent_wording_errors(text, prefix)
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--external", action="store_true", help="外部リンクもHEAD/GETで確認する")
    args = ap.parse_args()

    html = INDEX.read_text(encoding="utf-8")
    parser = _Parser()
    parser.feed(html)

    errors = check_structure(parser)
    warnings: list[str] = []

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

    # 7) 禁止パターン・表示テキスト・21%表現・資格リンク・必須文字列・容器間の同期
    errors.extend(check_html_text(parser, html))

    # 8) 関連文書（README等）の文書間矛盾
    for doc_name in ["README.md"]:
        doc_path = PROJECT_ROOT / doc_name
        if not doc_path.is_file():
            errors.append(f"関連文書が存在しない: {doc_name}")
            continue
        errors.extend(check_doc(doc_name, doc_path.read_text(encoding="utf-8")))

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
