import unittest

import make_pdf

try:
    import pymupdf
except ImportError:
    pymupdf = None


class PDF公開リンク変換テスト(unittest.TestCase):
    origin = "http://127.0.0.1:54321"

    def test_生成用サーバーの画像リンクを公開先へ変換する(self) -> None:
        self.assertEqual(
            make_pdf._public_pdf_uri(f"{self.origin}/media/shadowmap.jpg", self.origin),
            "https://kojima8924.github.io/media/shadowmap.jpg",
        )

    def test_クエリとフラグメントとエンコードを保持する(self) -> None:
        path = "/media/%E5%9B%B3.pdf?download=1&mode=full#page=2"
        self.assertEqual(
            make_pdf._public_pdf_uri(self.origin + path, self.origin),
            "https://kojima8924.github.io" + path,
        )

    def test_ルートへのリンクも公開先へ変換する(self) -> None:
        self.assertEqual(
            make_pdf._public_pdf_uri(self.origin, self.origin),
            make_pdf.PUBLIC_SITE_URL,
        )

    def test_外部URLとメールと相対参照は変更しない(self) -> None:
        for uri in (
            "https://github.com/kojima8924",
            "https://www.nicovideo.jp/watch/sm45922410",
            "https://kojima8924.github.io/media/shadowmap.jpg",
            "mailto:a.kojima8924@gmail.com",
            "#craft",
            "media/shadowmap.jpg",
        ):
            with self.subTest(uri=uri):
                self.assertEqual(make_pdf._public_pdf_uri(uri, self.origin), uri)

    def test_別ポートや別schemeのローカルサービスを変更しない(self) -> None:
        for uri in (
            "http://127.0.0.1:54322/media/shadowmap.jpg",
            "https://127.0.0.1:54321/media/shadowmap.jpg",
            "http://localhost:54321/media/shadowmap.jpg",
            "http://127.0.0.1/media/shadowmap.jpg",
        ):
            with self.subTest(uri=uri):
                self.assertEqual(make_pdf._public_pdf_uri(uri, self.origin), uri)

    def test_似たホスト名やuserinfoを誤変換しない(self) -> None:
        for uri in (
            "http://127.0.0.1:543210/media/shadowmap.jpg",
            "http://127.0.0.1:54321.example.com/media/shadowmap.jpg",
            "http://user@127.0.0.1:54321/media/shadowmap.jpg",
        ):
            with self.subTest(uri=uri):
                self.assertEqual(make_pdf._public_pdf_uri(uri, self.origin), uri)

    def test_外部サイトを生成元として渡しても変更しない(self) -> None:
        uri = "https://example.com/media/photo.jpg"
        self.assertEqual(make_pdf._public_pdf_uri(uri, "https://example.com"), uri)

    def test_不正なURIの解析失敗で生成を中断しない(self) -> None:
        uri = "http://[invalid"
        self.assertEqual(make_pdf._public_pdf_uri(uri, self.origin), uri)


@unittest.skipIf(pymupdf is None, "PyMuPDFが必要です")
class PDFリンク後処理テスト(unittest.TestCase):
    def test_実PDFのURIだけを直し内部移動と外観を保持する(self) -> None:
        origin = "http://127.0.0.1:54321"
        uris = [
            f"{origin}/media/shadowmap.jpg",
            "https://github.com/kojima8924",
            "mailto:a.kojima8924@gmail.com",
            "http://127.0.0.1:54322/other-service",
        ]
        # テスト用PDFはメモリ内だけで生成し，公開成果物には触れない．
        with pymupdf.open() as source:
            source.new_page()
            source.new_page()
            page = source[0]
            page.insert_text((30, 30), "PDF link regression test")
            for index, uri in enumerate(uris):
                page.insert_link({
                    "kind": pymupdf.LINK_URI,
                    "from": pymupdf.Rect(30, 50 + index * 30, 220, 70 + index * 30),
                    "uri": uri,
                })
            page.insert_link({
                "kind": pymupdf.LINK_GOTO,
                "from": pymupdf.Rect(30, 190, 220, 210),
                "page": 1,
                "to": pymupdf.Point(0, 0),
            })
            original = source.tobytes()

        with pymupdf.open(stream=original, filetype="pdf") as document:
            before_links = document[0].get_links()
            before_pixels = document[0].get_pixmap().samples
            self.assertEqual(make_pdf._rewrite_local_pdf_links(document, origin), 1)
            rewritten = document.tobytes()

        with pymupdf.open(stream=rewritten, filetype="pdf") as document:
            after_links = document[0].get_links()
            self.assertEqual(document.page_count, 2)
            self.assertEqual(document[0].get_pixmap().samples, before_pixels)
            self.assertEqual(len(after_links), len(before_links))
            self.assertEqual(after_links[0]["uri"], "https://kojima8924.github.io/media/shadowmap.jpg")
            for before, after in zip(before_links, after_links):
                self.assertEqual(after["kind"], before["kind"])
                self.assertEqual(after["from"], before["from"])
            self.assertEqual([link["uri"] for link in after_links[1:4]], uris[1:])
            self.assertEqual(after_links[4]["kind"], pymupdf.LINK_GOTO)
            self.assertEqual(after_links[4]["page"], 1)
            self.assertEqual(after_links[4]["to"], before_links[4]["to"])
            self.assertEqual(make_pdf._rewrite_local_pdf_links(document, origin), 0)


if __name__ == "__main__":
    unittest.main()
