# Akira Kojima Portfolio

小嶋明のポートフォリオサイトです。`main` ブランチのルートをGitHub Pagesで公開しています。

- 公開URL: https://kojima8924.github.io/
- 実装: 単一の `index.html`、Bootstrap 5、Vanilla JavaScript
- 主な内容: AIを活用・統合したアプリ開発、機械学習×触覚計測の研究

## 構成

- `index.html`: 公開ページ本体。CSSとJavaScriptも含む
- `media/`: 作品画像、OGP画像、配布用PDF
- `make_pdf.py`: 公開HTMLからA4 PDFを生成するスクリプト（採用向け/完全版の2モード）
- `make_ogp.py`: HTML/CSSだけで1200×630のOGP画像を生成するスクリプト
- `scripts/check_portfolio.py`: リンク・alt・表記揺れ等の自動検査
- `docs/`: 検証ログ（`verification/`）と、外部ページで対応する項目のメモ
- `requirements-pdf.txt`: PDF生成用のPython依存
- `proposal/`: 次の更新を試すローカル作業版。誤公開防止のためGit管理対象外

## 現在の公開状態

セクション順は Hero → 代表作品 → 研究 → 受託案件 → 経歴・資格・主要技術 → 過去作品 → 連絡先。
DOM順と視覚順は一致させています（CSS orderによる並べ替えはしない）。

- Heroは制作物名（Clage Cook / Trivium / ChromiumforA / ScriptVEdit）と確認手段（リポジトリ・CI・実機画面・稼働中のサイト・論文・動画）を明示し、学歴は短いメタ情報として表示
- 代表作品はケーススタディ形式（設計判断・担当・技術的な難所・計測条件）。AI利用の範囲は作品ごとに明示する（例: ScriptVEditはDSL仕様と各機構のアイデアをAIと相談しながら主に本人が決め、実装・テストケース生成・スクリーンショットによる出力確認はAIエージェントへ委任。エフェクト品質と生成動画の最終評価は本人）
- 受託案件（美容クリニック向けLINE応答AI）は開発中・匿名・KPI非公開のため公開作品の後に配置
- 過去作品10件は折りたたみの簡潔な一覧（サムネイル・技術・1文説明）
- 技術バッジはshields.io画像を使わず、CSS製の自前バッジで表示（外部通信なし・PDF生成が安定・代表作品と研究に適用。過去作品一覧はテキスト表記）
- 研究数値の表記は「従来法の約22%まで低減」「HWHMを最大19.2%低減」で統一
- SNS共有画像は生成AIを使わず、HTML/CSSから決定的に描画

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

HTMLを確定した後、次のコマンドで2種類のPDFを更新します。

```powershell
python make_pdf.py            # 両方生成（--mode summary|full で個別生成）
# media/Akira_Kojima_Portfolio_Summary.pdf  採用向け（A4・3ページ・約0.4 MiB）
# media/Akira_Kojima_Portfolio.pdf          完全版（A4・7ページ・約1.0 MiB）
```

スクリプトはローカルHTTPサーバーを一時的に起動し、アコーディオンを全展開して印刷対象画像の読込を確認してからA4 PDFを生成します。
採用向けは `body.pdf-summary` を付与し、`.pdf-full-only` の要素（受託案件・過去作品・補足ギャラリー等）を除外した同一DOMからの出力です。
生成後、埋め込み画像を150dpi・JPEG品質80へ再圧縮し、実ページ数を表示します。
`--source`、`--output`、`--timeout` で入出力と待ち時間を変更できます。

SNS共有画像は同じPlaywright環境でHTML/CSSから描画します。

```powershell
python make_ogp.py
# media/ogp-portfolio.png
```

## 自動検査

```powershell
python scripts/check_portfolio.py             # HTML内部の検査
python scripts/check_portfolio.py --external  # 外部リンクの到達確認も行う
```

重複ID、内部anchor切れ、ローカル参照切れ、alt欠落、`rel`不足、shields.io残存、
プロジェクト名の表記揺れ、研究数値の誤解表現などを検査します。
AtCoder / paizaの表記は表示テキストにのみ適用し、`atcoder.jp` / `paiza.jp` のURLを誤検出しません。
実行結果は `docs/verification/`（check_portfolio・W3C Nu・axe-core）に保存しています。

## 更新時の確認

1. HTMLとPDF（2種類）の内容を同じ更新で揃える
2. `python scripts/check_portfolio.py` を通す
3. PC／スマホ、dark／light、印刷時の改ページを確認する
4. 作品画像、GitHub、論文、動画のリンク切れがないか確認する
5. OGPのtitle、description、画像をページ内容と同期する
6. 受託案件の表現に顧客情報や未確認の実績が含まれないことを確認する
7. `proposal/` や未公開素材がGit差分へ入っていないことを確認してからpushする
