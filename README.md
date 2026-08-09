# Akira Kojima Portfolio

小嶋明のポートフォリオサイトです。`main` ブランチのルートをGitHub Pagesで公開しています。

- 公開URL: https://kojima8924.github.io/
- 実装: 単一の `index.html`、Bootstrap 5、Vanilla JavaScript
- 主な内容: AIを活用・統合したアプリ開発、機械学習×触覚計測の研究

## 構成

- `index.html`: 公開ページ本体。CSSとJavaScriptも含む
- `media/`: 作品画像、OGP画像、配布用PDF
- `make_pdf.py`: 公開HTMLからA4 PDFを生成するスクリプト
- `make_ogp.py`: HTML/CSSだけで1200×630のOGP画像を生成するスクリプト
- `requirements-pdf.txt`: PDF生成用のPython依存
- `proposal/`: 次の更新を試すローカル作業版。誤公開防止のためGit管理対象外

## 現在の公開状態

採用担当者が短時間で判断できるよう、Heroでは職能、本人が担う責任範囲、確認できる証拠、主要導線を先に示しています。AIを使うこと自体ではなく、AIを既存プロダクトへ組み込み、要件・設計・検証まで担うことを主軸にしています。

- Heroから主要作品、完全版PDF、GitHubへ直接移動できる。実績の根拠は「実案件1件（開発中・匿名）／主要OSS 2件／査読論文筆頭著者」として表示
- Clage Cook、ChromiumforA、scriptveditを代表作品として先に掲載。美容クリニック向けLINE応答AIは代表作品の後に掲載し、実装済み・検証中・非公開範囲を明記
- Clage CookはOSS版を中心に掲載し、非公開Original版はOSSに至る背景として折り畳んで表示。Windows画面とAndroid実機2画面で確認できる
- ChromiumforAは「人工知能」の通常表示／AI評価後に加え、日本語検索でのAI再評価、FAB、ページ要約の実機画面と2倍速動画を掲載。動画ダウンロード機能は非掲載
- scriptveditは公開リポジトリ、コードと出力映像、実プロジェクトの並列レンダリング計測条件を掲載
- 過去作品は初期状態で折り畳み、必要な場合だけ画像・動画・技術バッジを展開できる。印刷・PDF生成時は自動で全展開して収録する
- 研究実績は評価設計の根拠として要点と論文・ポスターへの導線に集約。経歴は独立セクションに掲載
- SNS共有画像は生成AIを使わず、HTML/CSSから決定的に描画
- 配布PDFは同じ公開HTMLから生成する完全版（A4・5ページ・約1.0 MiB）。過去作品・開発背景のアコーディオンも展開して収録し、埋め込み画像は150dpiへ再圧縮。採用向け2ページサマリーPDFは未実装

AIによる要約欄（`#ai-summary`）には、ChatGPT・Claude・Gemini・Grokの4タブで、統一プロンプト（ページ内「実行条件」に記載）により取得した要約をモデル名・取得日つきの固定文字列として掲載しています（2026年8月10日取得）。リアルタイム生成ではなく、更新時は本人が再取得して貼り替えます。GeminiのみURL・ファイル一式を読めなかったため、ページのスクリーンショット添付で取得しています。PDFにも収録され、印刷時はタブを廃して4AI分をAI名見出しつきで縦に並べます。

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

スクリプトはローカルHTTPサーバーを一時的に起動し、アコーディオンを全展開して印刷対象画像の読込を確認してからA4 PDFを生成します。
生成後、埋め込み画像を150dpi・JPEG品質80へ再圧縮し、配布しやすいサイズ（約1 MiB）に抑えます。
`--source`、`--output`、`--timeout` で入出力と待ち時間を変更できます。

SNS共有画像は生成AIを使わず、同じPlaywright環境で落ち着いた編集デザインをHTML/CSSから描画します。

```powershell
python make_ogp.py
# media/ogp-portfolio.png
```

## 更新時の確認

1. HTMLとPDFの内容を同じ更新で揃える
2. PC／スマホ、dark／light、印刷時の改ページを確認する
3. 作品画像、GitHub、論文、動画のリンク切れがないか確認する
4. OGPのtitle、description、画像をページ内容と同期する
5. 開発中案件の表現に顧客情報や未確認の実績が含まれないことを確認する
6. `proposal/` や未公開素材がGit差分へ入っていないことを確認してからpushする
