"""活動・発表欄の実HTMLに対する回帰テスト．外部通信は行わない．"""
import unittest
from pathlib import Path

from scripts.check_portfolio import _Parser


PUBLICATIONS = [
    ("2018", "３人以上のキムワイプ卓球の得点計算に関する考察", "Proceedings-1.pdf"),
    ("2019", "キムワイプ卓球の台の割り当てアルゴリズムの比較", "Proceedings_3.pdf"),
    ("2020", "過去のキムワイプ卓球研究の分類と紹介", "Proceedings_4.pdf"),
    ("2020", "ソートアルゴリズムによるキムワイプ卓球大会の順位決定", "Proceedings_4.pdf"),
    ("2022", "YOLOv5 を用いたカメラ画像からのキムワイプ検出と入力インターフェースへの応用", "Proceedings-6-1.pdf"),
]


class サークル活動掲載テスト(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parser = _Parser()
        cls.parser.feed((Path(__file__).resolve().parents[1] / "index.html").read_text(encoding="utf-8"))
        cls.section = next(element for element in cls.parser.elements if element.attrs.get("id") == "activities")
        cls.content = "".join(cls.section.text_parts)
        cls.links = [element for element in cls.parser.elements
                     if element.tag == "a" and cls.section in element.ancestors]
        cls.pdf_links = [link for link in cls.links if (link.attrs.get("href") or "").endswith(".pdf")]

    def test_経歴と補足作品の間に常時表示する(self):
        ids = self.parser.ids
        self.assertLess(ids.index("career"), ids.index("activities"))
        self.assertLess(ids.index("activities"), ids.index("archive"))
        self.assertTrue(self.section.has_class("pdf-full-only"))
        self.assertFalse(any(e.tag == "details" or "hidden" in e.attrs for e in self.section.ancestors))

    def test_5題の題名と年と公式予稿の対応を保つ(self):
        self.assertEqual(len(self.pdf_links), len(PUBLICATIONS))
        for year, title, filename in PUBLICATIONS:
            with self.subTest(title=title):
                matches = [link for link in self.pdf_links if title in (link.attrs.get("aria-label") or "")]
                self.assertEqual(len(matches), 1)
                link = matches[0]
                self.assertEqual(link.attrs["href"], f"https://ut.tokyo.jp.iktta.org/wp-content/uploads/{filename}")
                item = next(element for element in reversed(link.ancestors) if element.tag in {"li", "article"})
                text = "".join(item.text_parts)
                self.assertIn(year, text)
                self.assertIn(title, text)
                self.assertFalse(any(e.tag == "details" for e in link.ancestors))

    def test_別タブリンクに安全属性と識別可能な名前がある(self):
        names = []
        for link in self.links:
            self.assertEqual(link.attrs.get("target"), "_blank")
            self.assertTrue({"noopener", "noreferrer"}.issubset((link.attrs.get("rel") or "").split()))
            if link in self.pdf_links:
                names.append(link.attrs.get("aria-label"))
                self.assertIn("PDF", "".join(link.text_parts))
        self.assertEqual(len(set(names)), 5)

    def test_会長経験と研究会の区分と試作の限界を明記する(self):
        for text in ("2019", "2020", "会長", "駒場祭", "シフト", "スポンサー", "取材", "サークル研究会", "転移学習", "Unity", "自作", "未完成"):
            self.assertIn(text, self.content)
        self.assertNotIn("AI不使用", self.content)


if __name__ == "__main__":
    unittest.main()
