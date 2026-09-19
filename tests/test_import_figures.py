import contextlib
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import import_figures


class 図版同期検査テスト(unittest.TestCase):
    def _run_check(
        self,
        source_exists: bool,
        source_mtime: int,
        output_mtime: int | None,
        rendered_svg: str = "<svg></svg>",
    ) -> tuple[int, str, mock.Mock]:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.pdf"
            output_dir = root / "fig"
            output_dir.mkdir()

            if source_exists:
                source.write_bytes(b"pdf")
                os.utime(source, (source_mtime, source_mtime))

            if output_mtime is not None:
                output = output_dir / "sample.svg"
                output.write_text("<svg></svg>", encoding="utf-8")
                os.utime(output, (output_mtime, output_mtime))

            stdout = io.StringIO()
            render = mock.Mock(return_value=rendered_svg)
            with (
                mock.patch.object(import_figures, "FIGURES", {"sample": source}),
                mock.patch.object(import_figures, "OUT_DIR", output_dir),
                mock.patch.object(import_figures, "_render_svg", render),
                mock.patch.object(sys, "argv", ["import_figures.py", "--check"]),
                contextlib.redirect_stdout(stdout),
            ):
                result = import_figures.main()
            return result, stdout.getvalue(), render

    def test_参照元pdf欠損は失敗する(self) -> None:
        result, output, render = self._run_check(False, 0, 200)
        self.assertEqual(result, 1)
        self.assertIn("[missing] sample", output)
        self.assertIn("参照元 PDF の欠損: 1", output)
        render.assert_not_called()

    def test_通常変換は一部欠損時に何も変換しない(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            existing = root / "existing.pdf"
            existing.write_bytes(b"pdf")
            missing = root / "missing.pdf"
            convert = mock.Mock()
            stdout = io.StringIO()
            with (
                mock.patch.object(
                    import_figures,
                    "FIGURES",
                    {"existing": existing, "missing": missing},
                ),
                mock.patch.object(import_figures, "convert", convert),
                mock.patch.object(sys, "argv", ["import_figures.py"]),
                contextlib.redirect_stdout(stdout),
            ):
                result = import_figures.main()

        self.assertEqual(result, 1)
        self.assertIn("[missing] missing", stdout.getvalue())
        convert.assert_not_called()

    def test_mtimeに関係なく内容が異なれば更新要とする(self) -> None:
        result, output, render = self._run_check(True, 100, 200, "<svg>changed</svg>")
        self.assertEqual(result, 1)
        self.assertIn("[stale] sample", output)
        self.assertIn("更新が必要な図: 1", output)
        self.assertIn("参照元 PDF の欠損: 0", output)
        render.assert_called_once()

    def test_mtimeに関係なく内容が同じなら正常とする(self) -> None:
        result, output, render = self._run_check(True, 200, 100)
        self.assertEqual(result, 0)
        self.assertNotIn("[missing]", output)
        self.assertNotIn("[stale]", output)
        self.assertIn("更新が必要な図: 0", output)
        self.assertIn("参照元 PDF の欠損: 0", output)
        render.assert_called_once()

    def test_出力svg欠損は更新要とする(self) -> None:
        result, output, render = self._run_check(True, 100, None)
        self.assertEqual(result, 1)
        self.assertIn("[stale] sample: 出力 SVG がありません", output)
        render.assert_not_called()

    def test_変換中の書き込み失敗でも既存svgを保持する(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            output = output_dir / "sample.svg"
            output.write_text("<svg>existing</svg>", encoding="utf-8")
            with (
                mock.patch.object(import_figures, "OUT_DIR", output_dir),
                mock.patch.object(import_figures, "_render_svg", return_value="<svg>new</svg>"),
                mock.patch.object(Path, "write_text", side_effect=OSError("write failed")),
                self.assertRaises(OSError),
            ):
                import_figures.convert("sample", output_dir / "source.pdf")

            self.assertEqual(output.read_text(encoding="utf-8"), "<svg>existing</svg>")
            self.assertEqual(list(output_dir.iterdir()), [output])


if __name__ == "__main__":
    unittest.main()
