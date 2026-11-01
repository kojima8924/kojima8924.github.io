import tempfile
import unittest
from pathlib import Path
from urllib.parse import quote

import make_pdf

try:
    import pymupdf
except ImportError:
    pymupdf = None


class 配信位置テスト(unittest.TestCase):
    def test_プロジェクト内のHTMLはプロジェクトルートから配信する(self) -> None:
        self.assertEqual(
            make_pdf._server_location(make_pdf.PROJECT_ROOT / "index.html"),
            (make_pdf.PROJECT_ROOT, "index.html"),
        )

    def test_プロジェクト外のHTMLは親ディレクトリから引用符付きの名前で配信する(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "日本語 空白.html"
            source.write_text("<!doctype html>", encoding="utf-8")
            server_root, url_path = make_pdf._server_location(source)
        self.assertEqual(server_root, source.parent)
        self.assertEqual(url_path, quote("日本語 空白.html"))
        self.assertNotIn(" ", url_path)


class 出力名規則テスト(unittest.TestCase):
    def test_既定の出力先から採用向けの既定出力先を導く(self) -> None:
        self.assertEqual(
            make_pdf.summary_output_for(make_pdf.DEFAULT_OUTPUT),
            make_pdf.PROJECT_ROOT / "media" / "Akira_Kojima_Portfolio_Summary.pdf",
        )

    def test_任意の出力先では同じディレクトリに_Summaryを付ける(self) -> None:
        self.assertEqual(
            make_pdf.summary_output_for(Path("out") / "sub" / "X.pdf"),
            Path("out") / "sub" / "X_Summary.pdf",
        )


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


@unittest.skipIf(pymupdf is None, "PyMuPDFが必要")
class PDF後処理テスト(unittest.TestCase):
    origin = "http://127.0.0.1:54321"

    def _source_pdf(self) -> bytes:
        """再圧縮される大きなJPEG・小さなPNG・ローカル/外部リンクを持つ1ページPDFをメモリ内で作る．"""
        large = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 1500, 1000), False)
        large.clear_with(200)
        large.set_rect(pymupdf.IRect(100, 100, 900, 700), (30, 90, 160))
        small = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 200), False)
        small.clear_with(255)
        small.set_rect(pymupdf.IRect(40, 40, 160, 160), (220, 40, 40))
        with pymupdf.open() as source:
            page = source.new_page()
            page.insert_image(pymupdf.Rect(30, 30, 230, 163), stream=large.tobytes("jpg"))
            # 20pt 四方に置くと 720dpi 相当になり，復元しなければ再圧縮で縮められる．
            page.insert_image(pymupdf.Rect(30, 200, 50, 220), stream=small.tobytes("png"))
            for index, uri in enumerate((f"{self.origin}/media/x.pdf", "https://github.com/kojima8924")):
                page.insert_link({
                    "kind": pymupdf.LINK_URI,
                    "from": pymupdf.Rect(30, 250 + index * 30, 220, 270 + index * 30),
                    "uri": uri,
                })
            return source.tobytes()

    def _small_image_bytes(self, document) -> bytes:
        small = [
            info for info in document[0].get_image_info(xrefs=True)
            if max(info["width"], info["height"]) <= make_pdf.SMALL_IMAGE_MAX_PX
        ]
        self.assertEqual(len(small), 1)
        return document.extract_image(small[0]["xref"])["image"]

    def test_メタデータ設定と小画像の保持とローカルリンクの書換を行う(self) -> None:
        original = self._source_pdf()
        with pymupdf.open(stream=original, filetype="pdf") as document:
            small_before = self._small_image_bytes(document)
            make_pdf._postprocess_document(document, "summary", self.origin)
            processed = document.tobytes()

        with pymupdf.open(stream=processed, filetype="pdf") as document:
            expected = make_pdf.PDF_METADATA["summary"]
            self.assertEqual(
                {key: document.metadata[key] for key in ("title", "author", "subject")},
                expected,
            )
            self.assertEqual(self._small_image_bytes(document), small_before)
            self.assertEqual(
                [link["uri"] for link in document[0].get_links()],
                ["https://kojima8924.github.io/media/x.pdf", "https://github.com/kojima8924"],
            )



@unittest.skipIf(pymupdf is None, "PyMuPDFが必要")
class 資格画像保護テスト(unittest.TestCase):
    def test_同じ寸法の2つのAWSバッジをそれぞれ正しい元画像に対応付ける(self) -> None:
        badges = [path for path in make_pdf.UNALTERED_IMAGES if path.name.startswith("badge-aws-")]
        self.assertEqual(
            sorted(path.name for path in badges),
            ["badge-aws-ai-practitioner.png", "badge-aws-cloud-practitioner.png"],
        )
        # 掲載順と逆順に埋め込んでも、寸法ではなく画素で対応付けることを確認する．
        with pymupdf.open() as document:
            page = document.new_page()
            xrefs = {}
            for index, path in enumerate(reversed(badges)):
                xrefs[path] = page.insert_image(pymupdf.Rect(30 + index * 90, 30, 110 + index * 90, 110), filename=str(path))
            found = make_pdf._find_unaltered_images(document)
        self.assertEqual(sorted((xref, path.name) for _, xref, path in found),
                         sorted((xref, path.name) for path, xref in xrefs.items()))


if __name__ == "__main__":
    unittest.main()
