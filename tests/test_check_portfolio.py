import re
import unittest

from scripts import check_portfolio


VALID_STRUCTURE = """
<nav><a href="#client">受託案件</a><a href="#craft">CG作品</a></nav>
<section id="client"></section>
<section id="craft">
  <article id="cg-python" class="card cg-card"></article>
  <article id="cg-shadow" class="card cg-card"></article>
  <article id="cg-glsl" class="card cg-card"></article>
</section>
<section id="works">
  <article id="clagecook-card"></article>
  <article id="trivium-card"></article>
  <article id="chromiumfora-card"></article>
  <article id="scriptvedit-card"></article>
</section>
<figure class="fig-band"><img src="figure.svg" width="1280" height="360"></figure>
"""


def parse(html: str) -> check_portfolio._Parser:
    parser = check_portfolio._Parser()
    parser.feed(html)
    return parser


class 構造検査テスト(unittest.TestCase):
    def check(self, html: str) -> list[str]:
        return check_portfolio.check_structure(parse(html))

    def test_正常構造はエラーなし(self) -> None:
        self.assertEqual(self.check(VALID_STRUCTURE), [])

    def test_ナビと本文いずれの内部リンク切れも検出する(self) -> None:
        for link in ('<nav><a href="#missing">未作成</a></nav>', '<a href="#missing">未作成</a>'):
            with self.subTest(link=link):
                errors = self.check(VALID_STRUCTURE + link)
                self.assertIn("存在しない内部anchor: #missing", errors)

    def test_重複idを検出する(self) -> None:
        errors = self.check(VALID_STRUCTURE + '<section id="client"></section>')
        self.assertIn("重複ID: #client ×2", errors)

    def test_受託と自力実装へのナビが必要(self) -> None:
        html = VALID_STRUCTURE.replace("<nav>", "<div>").replace("</nav>", "</div>")
        errors = self.check(html)
        self.assertIn("ナビゲーションからの導線がない: #client", errors)
        self.assertIn("ナビゲーションからの導線がない: #craft", errors)

    def test_帯図の両寸法を要求する(self) -> None:
        for dimension, value in (("width", "1280"), ("height", "360")):
            with self.subTest(dimension=dimension):
                html = VALID_STRUCTURE.replace(f' {dimension}="{value}"', "")
                self.assertTrue(any(f"正の{dimension}属性" in error for error in self.check(html)))

    def test_帯図の寸法は正の整数のみ(self) -> None:
        for value in ("0", "-1", "auto", "100%", "1.5", ""):
            with self.subTest(value=value):
                html = VALID_STRUCTURE.replace('width="1280"', f'width="{value}"')
                self.assertTrue(any("正のwidth属性" in error for error in self.check(html)))

    def test_帯図以外の画像はこの寸法契約の対象外(self) -> None:
        html = VALID_STRUCTURE + '<figure><img src="photo.jpg"></figure>'
        self.assertEqual(self.check(html), [])

    def test_void要素や自己終了タグで帯図の親を誤認しない(self) -> None:
        html = VALID_STRUCTURE.replace('<img src="figure.svg"', '<br><img src="figure.svg"')
        html += '<hr/><figure><img src="photo.jpg" /></figure>'
        self.assertEqual(self.check(html), [])

    def test_cgカードの欠落を検出する(self) -> None:
        html = VALID_STRUCTURE.replace('<article id="cg-glsl" class="card cg-card"></article>', "")
        self.assertIn("#craftのCG作品カードは3件を期待: 2件", self.check(html))

    def test_cgカードを別セクションへ移すと検出する(self) -> None:
        html = VALID_STRUCTURE.replace('id="craft"', 'id="archive"')
        self.assertIn("#craftのCG作品カードは3件を期待: 0件", self.check(html))

    def test_cgは開閉状態によらずdetails内に置けない(self) -> None:
        for opening in ("<details>", "<details open>"):
            with self.subTest(opening=opening):
                html = opening + VALID_STRUCTURE + "</details>"
                errors = self.check(html)
                self.assertEqual(sum("CG作品が折りたたみ内" in error for error in errors), 3)

    def test_cgの親階層をsummary除外にできない(self) -> None:
        for excluded_class in ("pdf-full-only", "summary-hide"):
            with self.subTest(excluded_class=excluded_class):
                html = VALID_STRUCTURE.replace('id="craft"', f'id="craft" class="{excluded_class}"')
                errors = self.check(html)
                self.assertEqual(sum("採用向けサマリーの除外" in error for error in errors), 3)

    def test_cgカード自体もsummary除外にできない(self) -> None:
        html = VALID_STRUCTURE.replace('id="cg-python" class="card cg-card"', 'id="cg-python" class="card cg-card summary-hide"')
        errors = self.check(html)
        self.assertIn("CG作品が採用向けサマリーの除外対象になっている: cg-python", errors)

    def test_hidden属性によるcg非表示を検出する(self) -> None:
        html = VALID_STRUCTURE.replace('id="craft"', 'id="craft" hidden')
        self.assertEqual(sum("CG作品がhidden属性" in error for error in self.check(html)), 3)

    def test_補足作品は折りたたみやsummary除外を許容する(self) -> None:
        html = VALID_STRUCTURE + '<details class="pdf-full-only"><article>補足作品</article></details>'
        self.assertEqual(self.check(html), [])

    def test_作品名の内部リンクは各作品を指す(self) -> None:
        for name, anchor in check_portfolio.WORK_ANCHORS.items():
            with self.subTest(name=name):
                direct = VALID_STRUCTURE + f'<a href="#{anchor}"><span>{name}</span></a>'
                self.assertEqual(self.check(direct), [])
                general = VALID_STRUCTURE + f'<a href="#works"><span>{name}</span></a>'
                self.assertTrue(any("作品へ直接移動しない" in error for error in self.check(general)))

    def test_総覧リンクと作品名の外部リンクは許容する(self) -> None:
        html = VALID_STRUCTURE + '<a href="#works">AIを活用した作品</a><a href="https://example.com">Trivium</a>'
        self.assertEqual(self.check(html), [])

    def test_scriptとstyleは表示テキストに混ぜない(self) -> None:
        parser = parse('<style>.a {color:red}</style><p>本文</p><script>const a="内部";</script>')
        self.assertEqual("".join(parser.text_parts), "本文")


class 資格リンク検査テスト(unittest.TestCase):
    def check(self, html: str) -> list[str]:
        return check_portfolio.check_credential_links(parse(html), html)

    def test_掲載回数を固定せずURL一致を確認する(self) -> None:
        url = check_portfolio.EXPECTED_CREDLY
        metadata = f'<script type="application/ld+json">{{"url":"{url}"}}</script>'
        for count in (1, 2, 4):
            with self.subTest(count=count):
                html = metadata + f'<a href="{url}">資格証明</a>' * count
                self.assertEqual(self.check(html), [])

    def test_異なる資格URLを検出する(self) -> None:
        errors = self.check('<a href="https://www.credly.com/badges/wrong/public_url">資格証明</a>')
        self.assertTrue(any("検証URLが不一致" in error for error in errors))

    def test_構造化データのみでは表示リンク欠落を検出する(self) -> None:
        url = check_portfolio.EXPECTED_CREDLY
        errors = self.check(f'<script type="application/ld+json">{{"url":"{url}"}}</script>')
        self.assertIn("Credlyの検証URLへの表示リンクがない", errors)

    def test_表示リンクのみでは構造化データ欠落を検出する(self) -> None:
        errors = self.check(f'<a href="{check_portfolio.EXPECTED_CREDLY}">資格証明</a>')
        self.assertIn("JSON-LDにCredlyの検証URLがない", errors)


class Paiza表記検査テスト(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pattern = next(
            pattern
            for pattern, reason in check_portfolio.TEXT_FORBIDDEN_PATTERNS
            if reason.startswith("paizaランク表記の揺れ")
        )

    def test_誤った4表記を検出する(self) -> None:
        for text in ("paiza S", "paiza S Rank", "paiza Sランク", "paiza S ランク"):
            with self.subTest(text=text):
                self.assertIsNotNone(re.search(self.pattern, text))

    def test_正規表記は検出しない(self) -> None:
        self.assertIsNone(re.search(self.pattern, "paizaスキルチェック Sランク"))


class プログラミング実績表記検査テスト(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pattern = next(
            pattern
            for pattern, reason in check_portfolio.TEXT_FORBIDDEN_PATTERNS
            if reason.startswith("AtCoder/paizaを資格")
        )

    def test_実績を資格取得扱いする表現を検出する(self) -> None:
        for text in ("AtCoder 水色を取得", "paizaスキルチェック Sランクを取得"):
            with self.subTest(text=text):
                self.assertIsNotNone(re.search(self.pattern, text))

    def test_次の文の資格取得は句読点によらず誤検出しない(self) -> None:
        for separator in ("。", "．", ".", "！", "?", "\n"):
            with self.subTest(separator=separator):
                self.assertIsNone(re.search(self.pattern, f"AtCoder 水色{separator}基本情報を取得"))


if __name__ == "__main__":
    unittest.main()
