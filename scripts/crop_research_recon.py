"""元のSI2022ポスターから，比較図・接触点・導電率凡例を切り出す．"""

from __future__ import annotations

import argparse
import io
import subprocess
from pathlib import Path

from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parents[1]
# 元の高解像度JPEGはGit履歴に保持されている．生成AIによる補完は行わない．
SOURCE = "96665026c78aef97219e5cccb7526db98b510ce6:media/SI2022_poster.jpg"
SOURCE_SIZE = (15453, 10928)
CROP_BOX = (4120, 9280, 6900, 10740)
OUTPUT_SIZE = (1112, 584)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path,
        default=PROJECT_ROOT / "media" / "research-recon.webp",
    )
    args = parser.parse_args()
    result = subprocess.run(
        ["git", "show", SOURCE], cwd=PROJECT_ROOT,
        check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    # 元ポスターだけを対象に，大判画像の読込上限を寸法に合わせる．
    Image.MAX_IMAGE_PIXELS = SOURCE_SIZE[0] * SOURCE_SIZE[1]
    with Image.open(io.BytesIO(result.stdout)) as source:
        if source.size != SOURCE_SIZE:
            raise ValueError(f"元ポスターの寸法が想定と異なります: {source.size}")
        image = source.crop(CROP_BOX).resize(OUTPUT_SIZE, Image.Resampling.LANCZOS)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        image.save(args.output, format="WEBP", lossless=True, method=6)
    print(f"比較図を出力: {args.output} ({OUTPUT_SIZE[0]} x {OUTPUT_SIZE[1]})")


if __name__ == "__main__":
    main()
