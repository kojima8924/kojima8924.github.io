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
- `scripts/import_figures.py`: 帯図（`media/fig/*.svg`）を slide リポジトリの PDF から変換して取り込む
  （図の正本は `C:\code\slide\cases\2026-09-18_CV・ポートフォリオ図版\` と `…\2026-09-18_履歴書用_受託案件構成図\`。
  文言はそこにある `facts.md`（各リポジトリから根拠つきで集めた事実シート）の範囲だけ。図を直すときは slide 側を直して
  `slide.py check` で PDF を作り直し、このスクリプトを再実行する。SVG は文字をパス化してあるので閲覧環境のフォントに依存しない）
- `docs/`: 検証ログ（`verification/`）と、外部ページで対応する項目のメモ
- `requirements-pdf.txt`: PDF生成用のPython依存
- `proposal/`: 次の更新を試すローカル作業版。誤公開防止のためGit管理対象外

## 現在の公開状態

セクション順は Hero → 代表作品 → 研究 → 受託案件 → 経歴・資格・主要技術 → 過去作品 → 連絡先。
DOM順と視覚順は一致させています（CSS orderによる並べ替えはしない）。

- Heroは制作物名（Clage Cook / Trivium / ChromiumforA / ScriptVEdit）と確認手段（リポジトリ・CI・実機画面・稼働中のサイト・論文・動画）を明示し、学歴は短いメタ情報として表示
- 代表作品はケーススタディ形式（設計判断・担当・技術的な難所・計測条件）。AI利用の範囲は作品ごとに明示する（例: ScriptVEditはDSL仕様と各機構のアイデアをAIと相談しながら主に本人が決め、実装・テストケース生成・スクリーンショットによる出力確認はAIエージェントへ委任。エフェクト品質と生成動画の最終評価は本人）
- 長文を読まずに分かるよう、Clage Cook / Trivium / ScriptVEdit / 研究 / 受託案件（構成＋改善実績）/ 経歴に帯図（`.fig-band`）を置く。
  帯図は幅 1280px 基準で作ってあり、狭い画面では横スクロール、タップでライトボックス拡大。採用向けPDF（2ページ）にも帯図を載せ、
  代わりに帯図と重複する実機画面（Clage Cook / ScriptVEdit のヒーロー画像、Trivium の実機2枚、研究の図2枚）と重複段落（`summary-hide`）を省く
- 受託案件（美容クリニック向けLINE応答AI）は開発中・匿名のため公開作品の後に配置。施設を特定しない範囲で掲載許可を得ており、
  顧客名・画面・利用者データは非公開、技術的な改善数値（応対14,051件の匿名化、7設問・確認項目26点の回答網羅率 50%→81%、
  7設問の平均応答時間 12.4→6.5秒、pytest 395件 など。限定語は facts.md のとおり落とさない）は掲載する
- 過去作品10件は折りたたみの簡潔な一覧（サムネイル・技術・1文説明）
- 技術バッジはshields.io画像を使わず、CSS製の自前バッジで表示（外部通信なし・PDF生成が安定・代表作品と研究に適用。過去作品一覧はテキスト表記）
- 資格は AWS Certified AI Practitioner のデジタルバッジ（`media/badge-aws-ai-practitioner.png`、Credly 発行の画像を縮小しただけで加工しない）を
  経歴セクションに置き、Credly の検証ページ（https://www.credly.com/badges/fb68c752-94ef-46e9-a339-fa398107e3a7/public_url ）へリンク。
  Hero の確認手段と JSON-LD（`hasCredential`）にも同じURLを載せる。紙面ではバッジ画像そのものがリンク（テキストの「Credlyで検証」は画面だけ）
- 文言の事実関係は slide の `facts.md`（各リポジトリを根拠つきで調べた事実シート）に合わせる。2026-09-19 の外部レビューと再調査で、
  受託の網羅率改善の原因（検索設定の変更）・開発段階（試作環境・本番導入前）、ScriptVEdit の O(N²) の特定経緯（AI併用の監査）、
  Trivium の開発期間（初回コミットから約21時間）、Clage Cook の途中回答の扱い、AtCoder の 6.27% が現在レーティングでの順位であることを直した
- 研究数値の表記は「従来法の約21%まで低減」「最悪領域のHWHMを19.2%低減（16電極のシミュレーション）」で統一
  （2026-09-17 に生データから再計算して 22%→21% に改めた。経緯と根拠は CV リポジトリの README）
- SNS共有画像は生成AIを使わず、HTML/CSSから決定的に描画
- シャドウマッピングの閲覧用画像 `media/shadowmap.jpg` は1200×1200px．5000×5000pxの原画像からPillowのLanczos法で単純縮小し，JPEG品質92・色差サブサンプリングなしで保存（生成AI・構図変更なし）．履歴書からの直リンクURLは維持する．原画像は `C:\code\CV\assets\cg\shadowmap.jpg` とGit履歴に保管し，印刷用PDF・CV内の画像は変更しない．

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
# media/Akira_Kojima_Portfolio_Summary.pdf  採用向け（A4・2ページ・約0.9 MiB。帯図入り・受託案件の構成図入り・実機画面は一部省略）
# media/Akira_Kojima_Portfolio.pdf          完全版（A4・9ページ・約1.9 MiB。帯図＋実機画面。受託案件は新ページから）
```

スクリプトはローカルHTTPサーバーを一時的に起動し、アコーディオンを全展開して印刷対象画像の読込を確認してからA4 PDFを生成します。
採用向けは `body.pdf-summary` を付与し、`.pdf-full-only` の要素（受託案件・過去作品・補足ギャラリー等）を除外した同一DOMからの出力です。
さらに `summary-hide` クラスの補足要素（数値概要・機能リスト・AI委任注記など）も採用向けでは省き、A4 2ページに収めています。
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
python scripts/import_figures.py --check      # 図版の参照元PDF欠損・SVGの更新要否を確認
python -m unittest discover -s tests -v       # 検査スクリプトの回帰テスト
```

重複ID、内部anchor切れ、ローカル参照切れ、alt欠落、`rel`不足、shields.io残存、
プロジェクト名の表記揺れ、研究数値の誤解表現などを検査します。
AtCoder / paizaの表記は表示テキストにのみ適用し、`atcoder.jp` / `paiza.jp` のURLを誤検出しません。
`import_figures.py --check` は参照元PDFからSVGをメモリ内で生成し、改行を正規化して既存SVGと内容を比較します。
参照元PDFや出力SVGが1件でも欠損している場合、または内容が異なる場合に終了コード1を返します。
内容比較には `requirements-pdf.txt` に含まれるPyMuPDFが必要です。ファイルの更新時刻だけでは判定しないため、
別作業でPDFを同一内容のまま再生成しても更新要とはなりません。
通常の取り込みでも、指定した参照元PDFを最初にすべて検証します。1件でも欠損していれば何も変換せず終了コード1を返すため、
一部のSVGだけが更新されることはありません。
各SVGは同じディレクトリの一時ファイルへ書き終えてから置換するため、書き込み途中の失敗で既存SVGが壊れることもありません。
実行結果は `docs/verification/`（check_portfolio・W3C Nu・axe-core）に保存しています。

## 更新時の確認

1. HTMLとPDF（2種類）の内容を同じ更新で揃える。帯図を変えたときは slide 側で PDF を作り直してから `python scripts/import_figures.py`
   （`--check` で slide 側の PDF から生成した結果と内容が異なる SVG を列挙できる）
2. `python scripts/check_portfolio.py`、`python scripts/import_figures.py --check`、`python -m unittest discover -s tests -v` を通す
3. PC／スマホ、dark／light、印刷時の改ページを確認する
4. 作品画像、GitHub、論文、動画のリンク切れがないか確認する
5. OGPのtitle、description、画像をページ内容と同期する
6. 受託案件の表現に顧客情報や未確認の実績が含まれないことを確認する
7. `proposal/` や未公開素材がGit差分へ入っていないことを確認してからpushする
