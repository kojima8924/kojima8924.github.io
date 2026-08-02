# Akira Kojima Portfolio

小嶋明のポートフォリオサイトです。`main` ブランチのルートをGitHub Pagesで公開しています。

- 公開URL: https://kojima8924.github.io/
- 実装: 単一の `index.html`、Bootstrap 5、Vanilla JavaScript
- 主な内容: AI×個人開発、制御／シミュレーション、CG／画像処理、機械学習×計測の研究

## 構成

- `index.html`: 公開ページ本体。CSSとJavaScriptも含む
- `media/`: 作品画像、OGP画像、配布用PDF
- `make_pdf.py`: 公開HTMLからA4 PDFを生成するスクリプト
- `make_ogp.py`: HTML/CSSだけで1200×630のOGP画像を生成するスクリプト
- `requirements-pdf.txt`: PDF生成用のPython依存
- `proposal/`: 次の更新を試すローカル作業版。誤公開防止のためGit管理対象外

## 現在の公開状態

AI×個人開発を含む刷新版を段階公開しています。ChromiumforAは説明を先に公開し、
通常／AI評価後の実スクリーンショットとAndroid実機動画は安全な素材が揃い次第追加します。
作品画面とOGP画像に生成AI画像は使いません。OGPはHTML/CSSで描画した概念図です。

## ローカル確認

```powershell
python -m http.server 8790 --bind 127.0.0.1
# http://127.0.0.1:8790/
```

## PDFの再生成

初回だけPlaywrightとChromiumを用意します。

```powershell
python -m pip install -r requirements-pdf.txt
python -m playwright install chromium
```

HTMLを確定した後、次のコマンドで `media/Akira_Kojima_Portfolio.pdf` を更新します。

```powershell
python make_pdf.py
```

スクリプトはローカルHTTPサーバーを一時的に起動し、印刷対象画像の読込を確認してからA4 PDFを生成します。
`--source`、`--output`、`--timeout` で入出力と待ち時間を変更できます。

SNS共有画像は生成AIを使わず、同じPlaywright環境でHTML/CSSから決定的に描画します。

```powershell
python make_ogp.py
# media/ogp-portfolio.png
```

## 更新時の確認

1. HTMLとPDFの内容を同じ更新で揃える
2. PC／スマホ、dark／light、印刷時の改ページを確認する
3. 作品画像、GitHub、論文、動画のリンク切れがないか確認する
4. OGPのtitle、description、画像をページ内容と同期する
5. `proposal/` や未公開素材がGit差分へ入っていないことを確認してからpushする
