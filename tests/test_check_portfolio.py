import re
import unittest

from scripts import check_portfolio


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


if __name__ == "__main__":
    unittest.main()
