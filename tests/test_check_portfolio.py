import json
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
  <article id="portfolio-assistant-card"></article>
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

    AIF = check_portfolio.EXPECTED_CREDLY_AIF
    CLF = check_portfolio.EXPECTED_CREDLY_CLF

    @staticmethod
    def metadata(*urls: str) -> str:
        body = ",".join(f'{{"url":"{url}"}}' for url in urls)
        return f'<script type="application/ld+json">[{body}]</script>'

    @staticmethod
    def links(*urls: str) -> str:
        return "".join(f'<a href="{url}">資格証明</a>' for url in urls)

    def test_掲載回数を固定せずURL一致を確認する(self) -> None:
        for count in (1, 2, 4):
            with self.subTest(count=count):
                html = self.metadata(self.AIF, self.CLF) + self.links(self.AIF, self.CLF) * count
                self.assertEqual(self.check(html), [])

    def test_期待するURLは2資格分(self) -> None:
        self.assertEqual(check_portfolio.EXPECTED_CREDLY, {self.AIF, self.CLF})
        self.assertIn("0045d984-825f-4110-bc04-3f929dbd961f", self.CLF)

    def test_異なる資格URLを検出する(self) -> None:
        html = self.metadata(self.AIF, self.CLF) + self.links(self.AIF, self.CLF)
        html += '<a href="https://www.credly.com/badges/wrong/public_url">資格証明</a>'
        errors = self.check(html)
        self.assertTrue(any("検証URLが不一致" in error for error in errors))

    def test_片方の資格URLの欠落を検出する(self) -> None:
        for present, missing in ((self.AIF, self.CLF), (self.CLF, self.AIF)):
            with self.subTest(missing=missing):
                errors = self.check(self.metadata(present) + self.links(present))
                self.assertTrue(any("検証URLが不一致" in error for error in errors))
                self.assertIn(f"Credlyの検証URLへの表示リンクがない: {missing}", errors)
                self.assertIn(f"JSON-LDにCredlyの検証URLがない: {missing}", errors)

    def test_構造化データのみでは表示リンク欠落を検出する(self) -> None:
        errors = self.check(self.metadata(self.AIF, self.CLF))
        for url in (self.AIF, self.CLF):
            self.assertIn(f"Credlyの検証URLへの表示リンクがない: {url}", errors)

    def test_表示リンクのみでは構造化データ欠落を検出する(self) -> None:
        errors = self.check(self.links(self.AIF, self.CLF))
        for url in (self.AIF, self.CLF):
            self.assertIn(f"JSON-LDにCredlyの検証URLがない: {url}", errors)


class 非公開作品の掲載検査テスト(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pattern = next(
            pattern
            for pattern, reason in check_portfolio.FORBIDDEN_PATTERNS
            if reason.startswith("portfolio-assistant の非公開リポジトリ")
        )

    def test_非公開リポジトリと内部識別子を検出する(self) -> None:
        for text in (
            "https://github.com/kojima8924/portfolio-assistant",
            "arn:aws:lambda:ap-northeast-1:000000000000:function:x",
            "portfolio-assistant-dev",
            "https://example.execute-api.ap-northeast-1.amazonaws.com/ask",
        ):
            with self.subTest(text=text):
                self.assertIsNotNone(re.search(self.pattern, text))

    def test_作品カードのidと接続先metaは許容する(self) -> None:
        for text in (
            'id="portfolio-assistant-card"',
            'name="portfolio-assistant-endpoint" content="https://example.execute-api.ap-northeast-1.amazonaws.com"',
            "media/portfolio-assistant-dialog.webp",
        ):
            with self.subTest(text=text):
                self.assertIsNone(re.search(self.pattern, text))


class Trivium解き直し表現検査テスト(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pattern = next(
            pattern
            for pattern, reason in check_portfolio.FORBIDDEN_PATTERNS
            if reason.startswith("Trivium の解き直しを別AI")
        )

    def test_別AIや別モデルによる解き直しを検出する(self) -> None:
        for text in (
            "コード実行や別AIによる解き直しで検証し",
            "選択式は正解を伏せた別のAIが解き直して一致を確認",
            "別モデルで解き直し",
            "別のAIが問題を解き直し",
        ):
            with self.subTest(text=text):
                self.assertIsNotNone(re.search(self.pattern, text))

    def test_同じモデルへの別の呼び出しの表現と無関係な別モデルは許容する(self) -> None:
        for text in (
            "生成問題はコード実行や，正解を伏せた解き直しで検証し",
            "正解を伏せた別の呼び出し（独立したソルバー）で解き直して一致を確認",
            "モデル障害時も別モデルへ自動で切り替えません．回答は解き直しません",
        ):
            with self.subTest(text=text):
                self.assertIsNone(re.search(self.pattern, text))


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


class 文言検査関数テスト(unittest.TestCase):
    def test_約21パーセントまで低減は許容する(self) -> None:
        for text in ("従来法の約21%まで低減", "約21％まで低減した"):
            with self.subTest(text=text):
                self.assertEqual(check_portfolio._percent_wording_errors(text), [])

    def test_21パーセント低減型の表現を検出する(self) -> None:
        for text in ("誤差を21%低減", "誤差を22%削減", "精度が21％改善"):
            with self.subTest(text=text):
                self.assertEqual(len(check_portfolio._percent_wording_errors(text)), 1)

    def test_誤解表現の文面と接頭辞(self) -> None:
        self.assertEqual(
            check_portfolio._percent_wording_errors("位置誤差を21%低減", "[README.md] "),
            ["[README.md] 『22%低減』型の誤解表現: …位置誤差を21%低減…"],
        )
        self.assertEqual(
            check_portfolio._percent_wording_errors("位置誤差を22%削減"),
            ["『22%低減』型の誤解表現: …位置誤差を22%削減…"],
        )

    def test_禁止パターンの文面(self) -> None:
        patterns = [(r"ダメ出し", "口語的表現"), (r"無関係", "一致しない規則")]
        self.assertEqual(
            check_portfolio._pattern_errors(patterns, "ダメ出しとダメ出し", "[表示テキスト] "),
            ["[表示テキスト] 口語的表現: 2件（例: 'ダメ出し'）"],
        )
        self.assertEqual(check_portfolio._pattern_errors(patterns, "本文"), [])

    def test_必須文字列の文面(self) -> None:
        required = [("ScriptVEdit", "公式プロジェクト名"), ("本文", "存在する語")]
        self.assertEqual(
            check_portfolio._missing_errors(required, "本文", "[README.md] "),
            ["[README.md] 必須文字列が見つからない（公式プロジェクト名）: 'ScriptVEdit'"],
        )
        self.assertEqual(
            check_portfolio._missing_errors(required, "本文"),
            ["必須文字列が見つからない（公式プロジェクト名）: 'ScriptVEdit'"],
        )

    def test_関連文書の検査は接頭辞付きで3種を通す(self) -> None:
        errors = check_portfolio.check_doc("README.md", "Scriptvedit で誤差を21%低減")
        self.assertEqual(errors, [
            "[README.md] プロジェクト名の表記揺れ: 1件（例: 'Scriptvedit'）",
            "[README.md] 必須文字列が見つからない（研究の21%表現）: '約21%まで低減'",
            "[README.md] 必須文字列が見つからない（公式プロジェクト名）: 'ScriptVEdit'",
            "[README.md] 『22%低減』型の誤解表現: …dit で誤差を21%低減…",
        ])


class 禁止パターン整理の同値性テスト(unittest.TestCase):
    """冗長な選択肢を削った正規表現が、旧パターンと同じ一致有無を返すこと。"""

    CASES = (
        (
            r"(?<!バッジ)(?<!学習実績バッジ)実績\s*61\s*種",
            "研究・Trivium の誤読されやすい表現",
            ("学習実績バッジ実績61種", "バッジ実績 61 種", "実績61種"),
        ),
        (
            r"クラウドLLM|クラウド\s*LLM|再監査",
            "受託案件の匿名化の説明は",
            ("クラウドLLM", "クラウド LLM", "再監査"),
        ),
    )

    def test_旧パターンと一致有無が同じ(self) -> None:
        for old, reason, texts in self.CASES:
            new = next(
                pattern for pattern, r in check_portfolio.FORBIDDEN_PATTERNS if r.startswith(reason)
            )
            for text in texts:
                with self.subTest(text=text):
                    self.assertEqual(re.search(old, text) is None, re.search(new, text) is None)


CREDENTIALS = (
    ("AWS Certified AI Practitioner", "2026-09"),
    ("AWS Certified Cloud Practitioner", "2026-10"),
    ("基本情報技術者", "2026-08"),
    ("G検定", "2026-09"),
    ("GitHub Foundations", "2026-10"),
)


def display(name: str, date: str) -> str:
    year, month = date.split("-")
    return f"{name} 取得（{int(year)}年{int(month)}月）"


def credential_html(
    credentials=CREDENTIALS, profile=CREDENTIALS, career=CREDENTIALS, atcoder="水色・最高1541／<strong>上位4.24%</strong>"
) -> str:
    data = {
        "@context": "https://schema.org",
        "@type": "ProfilePage",
        "mainEntity": {
            "@type": "Person",
            "hasCredential": [{"name": name, "dateCreated": date} for name, date in credentials],
        },
    }
    profile_dd = "<br>".join(display(*item) for item in profile)
    career_p = "，".join(display(*item) for item in career)
    return (
        f'<script type="application/ld+json">{json.dumps(data, ensure_ascii=False, indent=2)}</script>'
        f'<div class="profile-facts"><dl><dt>資格</dt><dd>{profile_dd}</dd>'
        f"<dt>AtCoder</dt><dd>{atcoder}</dd></dl></div>"
        f'<section id="career"><p><strong>資格：</strong>{career_p}．</p></section>'
    )


class 資格同期検査テスト(unittest.TestCase):
    def check(self, html: str) -> list[str]:
        return check_portfolio.check_credentials(parse(html))

    def test_検査表とフィクスチャの資格が一致する(self) -> None:
        needles = [n for n, reason in check_portfolio.TEXT_REQUIRED_STRINGS if reason == "資格表記"]
        self.assertEqual(sorted(needles), sorted(display(*item) for item in CREDENTIALS))

    def test_3か所が同期していればエラーなし(self) -> None:
        self.assertEqual(self.check(credential_html()), [])

    def test_全角スペースや改行の差は許容する(self) -> None:
        html = credential_html().replace("G検定 取得", "G検定　\n取得", 1)
        self.assertEqual(self.check(html), [])

    def test_JSONLDの年月ずれを検出する(self) -> None:
        shifted = tuple((name, "2026-11" if name == "GitHub Foundations" else date) for name, date in CREDENTIALS)
        errors = self.check(credential_html(credentials=shifted))
        self.assertIn("JSON-LDの資格がプロフィール（.profile-facts）の表示テキストにない: 'GitHub Foundations 取得（2026年11月）'", errors)
        self.assertIn("JSON-LDの資格が#careerの表示テキストにない: 'GitHub Foundations 取得（2026年11月）'", errors)
        self.assertIn("検査表の資格表記がJSON-LDのhasCredentialにない: 'GitHub Foundations 取得（2026年10月）'", errors)

    def test_プロフィールだけの欠落を検出する(self) -> None:
        errors = self.check(credential_html(profile=CREDENTIALS[:-1]))
        self.assertEqual(errors, ["JSON-LDの資格がプロフィール（.profile-facts）の表示テキストにない: 'GitHub Foundations 取得（2026年10月）'"])

    def test_careerだけの欠落を検出する(self) -> None:
        errors = self.check(credential_html(career=CREDENTIALS[1:]))
        self.assertEqual(errors, ["JSON-LDの資格が#careerの表示テキストにない: 'AWS Certified AI Practitioner 取得（2026年9月）'"])

    def test_hasCredentialの1件欠落を検出する(self) -> None:
        errors = self.check(credential_html(credentials=CREDENTIALS[:-1]))
        self.assertIn("JSON-LDのhasCredentialは検査表の資格表記と同じ5件を期待: 4件", errors)
        self.assertIn("検査表の資格表記がJSON-LDのhasCredentialにない: 'GitHub Foundations 取得（2026年10月）'", errors)

    def test_壊れたJSONLDは1件のエラー(self) -> None:
        html = credential_html().replace('"@type": "ProfilePage",', '"@type": "ProfilePage",,', 1)
        errors = self.check(html)
        self.assertEqual(len(errors), 1)
        self.assertTrue(errors[0].startswith("JSON-LDを解析できない"))


class プロフィールAtCoder検査テスト(unittest.TestCase):
    def check(self, html: str) -> list[str]:
        return check_portfolio.check_profile_facts(parse(html))

    def test_検査表の値と一致すればエラーなし(self) -> None:
        self.assertEqual(self.check(credential_html()), [])

    def test_最高レーティングの取り残しを検出する(self) -> None:
        errors = self.check(credential_html(atcoder="水色・最高1540／<strong>上位4.24%</strong>"))
        self.assertEqual(errors, ["プロフィール（.profile-facts）にAtCoderの値がない: '最高1541'"])

    def test_上位パーセントの取り残しを検出する(self) -> None:
        errors = self.check(credential_html(atcoder="水色・最高1541／<strong>上位5.00%</strong>"))
        self.assertEqual(errors, ["プロフィール（.profile-facts）にAtCoderの値がない: '上位4.24%'"])


META = """
<title>小嶋 明 | Portfolio</title>
<meta property="og:title" content="小嶋 明 | Portfolio" />
<meta property="og:description" content="説明文" />
<meta property="og:image" content="https://example.com/ogp.png" />
<meta property="og:image:alt" content="代替テキスト" />
<meta name="twitter:title" content="小嶋 明 | Portfolio" />
<meta name="twitter:description" content="説明文" />
<meta name="twitter:image" content="https://example.com/ogp.png" />
<meta name="twitter:image:alt" content="代替テキスト" />
"""


class メタ情報同期検査テスト(unittest.TestCase):
    def check(self, html: str) -> list[str]:
        return check_portfolio.check_meta_consistency(parse(html))

    def test_一致していればエラーなし(self) -> None:
        self.assertEqual(self.check(META), [])

    def test_twitter_titleだけの変更を検出する(self) -> None:
        html = META.replace('name="twitter:title" content="小嶋 明 | Portfolio"', 'name="twitter:title" content="旧タイトル"')
        self.assertEqual(self.check(html), ["titleとtwitter:titleが不一致: '小嶋 明 | Portfolio' / '旧タイトル'"])

    def test_meta欠落を検出する(self) -> None:
        html = META.replace('<meta name="twitter:image:alt" content="代替テキスト" />', "")
        self.assertEqual(self.check(html), ["metaがない: twitter:image:alt"])


MEDIA = (
    '<a class="media-trigger" data-media-kind="image" href="media/a.webp" aria-label="画像を拡大：比較グラフ">'
    '<img src="media/a.webp" alt="比較グラフ"><span class="media-label" aria-hidden="true">⤢ 画像を拡大</span></a>'
    '<a class="cg-media media-trigger" data-media-kind="image" href="media/shadow.jpg" aria-label="シャドウマッピングの出力画像を拡大">'
    '<img src="media/shadow.jpg" alt="別文言の説明"></a>'
    '<a data-media-kind="video" href="media/v.mp4" aria-label="画像を拡大：動画は対象外"></a>'
)


class 画像拡大ラベル検査テスト(unittest.TestCase):
    def check(self, html: str) -> list[str]:
        return check_portfolio.check_media_labels(parse(html))

    def test_一致と対象外はエラーなし(self) -> None:
        self.assertEqual(self.check(MEDIA), [])

    def test_altを1文字変えると検出する(self) -> None:
        errors = self.check(MEDIA.replace('alt="比較グラフ"', 'alt="比較グラ"'))
        self.assertEqual(errors, ["画像拡大リンクのaria-labelとimgのaltが不一致: media/a.webp（aria-label: '比較グラフ' / alt: '比較グラ'）"])

    def test_子imgがなければ検出する(self) -> None:
        html = '<a data-media-kind="image" href="media/b.webp" aria-label="画像を拡大：説明"></a><img src="x.webp" alt="説明">'
        self.assertEqual(self.check(html), ["画像拡大リンクに子imgがない: media/b.webp"])


if __name__ == "__main__":
    unittest.main()
