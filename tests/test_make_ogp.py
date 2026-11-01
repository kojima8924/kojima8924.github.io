import struct
import tempfile
import unittest
from pathlib import Path

import make_ogp


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _png_header(width: int, height: int, *, signature: bytes = PNG_SIGNATURE, chunk: bytes = b"IHDR") -> bytes:
    """_png_size が読む先頭24バイト（署名・チャンク長・チャンク種別・幅・高さ）を組み立てる．"""
    return signature + struct.pack(">I", 13) + chunk + struct.pack(">II", width, height)


class PNG寸法読取テスト(unittest.TestCase):
    def _size_of(self, header: bytes) -> tuple[int, int]:
        # 一時ディレクトリ内だけに書き，公開OGP画像には触れない．
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "header.png"
            path.write_bytes(header)
            return make_ogp._png_size(path)

    def test_正しいIHDRの幅と高さを返す(self) -> None:
        header = _png_header(1200, 630)
        self.assertEqual(len(header), 24)
        self.assertEqual(self._size_of(header), (1200, 630))

    def test_PNG署名が不正なら失敗する(self) -> None:
        with self.assertRaises(RuntimeError):
            self._size_of(_png_header(1200, 630, signature=b"\x89PNX\r\n\x1a\n"))

    def test_先頭チャンクがIHDRでなければ失敗する(self) -> None:
        with self.assertRaises(RuntimeError):
            self._size_of(_png_header(1200, 630, chunk=b"IDAT"))


if __name__ == "__main__":
    unittest.main()
