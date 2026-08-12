# ポートフォリオ改善 実施報告（ChatGPT指示書への回答）

対象: `kojima8924/kojima8924.github.io`
実施日: 2026-08-11 〜 2026-08-12
指示書: 「採用向けポートフォリオの『AI生成感』除去と全面改善」§0〜§20

---

## 1. 最も採用上悪影響だった問題

**1位: AIによる自己推薦がページ先頭を占拠していた**
Hero直下に4AI（ChatGPT/Claude/Gemini/Grok）の要約タブがあり、PDFでは冒頭2ページを占めていた。
自作ページをAIに要約させたものは独立した第三者評価ではなく、「AIに自分を褒めさせている」構図になっていた。
さらに4モデルが同じ実績を反復するため、代表作品への到達が遅れていた。

**2位: テンプレートの機械的反復と抽象語**
全作品カードが「成果:／本人の設計:／発展・証拠・状態:」の同一構成で、
「課題設定から実機検証まで」「使い続けられる形まで」など、どのAIポートフォリオにも書ける包括表現が並んでいた。
自分のページで自分を「本人」と呼ぶ第三者視点も不自然だった。

**3位: DOM順と視覚順の乖離**
`order-*` により、DOM先頭は受託案件（開発中・匿名・KPI非公開＝最も検証しにくい実績）だった。
スクリーンリーダー・キーボード操作・印刷では、この最も弱い実績が最初に読まれていた。

---

## 2. 実施した改善

### 削除したもの
| 対象 | 規模 |
|---|---|
| AI要約セクション（HTML・ナビ・専用CSS・印刷CSS） | 約120行 |
| shields.io バッジ画像 | 21箇所 |
| hidden死蔵コンテンツ（アーキ図SVGカード、`#research-detail`） | 約150行 |
| `order-*` クラス | 全廃 |
| 印刷時の生URL展開ルール（`content:" (" attr(href) ")"`） | 4ルール |
| Printボタン（ナビ・連絡先の重複導線） | 2箇所 |
| heroのピンク系radial-gradient | 単色の弱い下地へ置換 |

### 情報設計
```
変更前: Hero → 経歴 → AI要約 → 主要作品 → 研究 → その他 → 連絡先
変更後: Hero → 代表作品 → 研究 → 受託案件 → 経歴・資格・主要技術 → 過去作品 → 連絡先
```
- 学歴はHero内の1行メタ情報に集約（詳細年表は代表作品の後）
- 受託案件は開発中・匿名・KPI非公開のため、検証可能な公開OSSの後に配置
- HTMLの記述順を表示順そのものに並べ替え、視覚順・読み上げ順・フォーカス順・印刷順を一致
- Calcpy（プロトタイプ）は代表作品から過去作品アーカイブへ移動
- 過去作品10件は「サムネイル＋技術＋1文」の折りたたみ一覧に再構成

### PDFの2種類化（§12）
同一DOMから出し分ける方式を採用し、内容の二重管理を回避した。

- `make_pdf.py --mode summary|full|both`（既定 both）
- サマリーは実行時に `document.body.classList.add('pdf-summary')` を付与
- 印刷CSSの `body.pdf-summary .pdf-full-only{ display:none }` で採用向けから除外
- 生成後にPyMuPDFで実ページ数を出力し、README記載と突き合わせ可能に

| 出力 | 内容 | 実測 |
|---|---|---|
| `Akira_Kojima_Portfolio_Summary.pdf` | Hero＋代表作品3件＋研究＋経歴要点＋連絡先 | **2ページ / 0.44 MB / リンク注釈13件** |
| `Akira_Kojima_Portfolio.pdf` | ＋受託案件・開発背景・過去作品10件 | **5ページ / 0.74 MB / リンク注釈22件** |

Heroの主導線は採用向けPDF、完全版は副導線（小さいボタン）に変更した。

### 自動検査の追加（§15）
`scripts/check_portfolio.py`（標準ライブラリのみ、追加依存なし）

検査項目: 重複ID / 内部anchor切れ / ローカル参照切れ / alt欠落 / 空href /
`target=_blank` の `rel` 不足 / shields.io残存 / AI要約文字列残存 / `order-*` 残存 /
プロジェクト名の表記揺れ / 「22%低減」型の誤解表現 / 旧テンプレラベル残存 / 抽象表現の残存 /
必須文字列（メール・GitHub・論文リンク・正確な研究数値）の存在 / 外部リンク到達（`--external`、10秒timeoutで警告止まり）

---

## 3. 主要な文言の before / after

### Hero
> **before**
> AIを既存プロダクトへ組み込み、課題設定から実機検証まで担う AIアプリケーションエンジニアです。
> 複数LLMの統合、Android／Flutterアプリ、AIエージェント向けDSLを中心に、使い続けられる形まで設計・実装しています。
> 実案件 1件（開発中・匿名） ｜ 主要OSS 2件 ｜ 査読論文 筆頭著者

> **after**
> AIアプリケーションエンジニア
> 複数のLLMを一つの画面で扱うFlutterアプリ「Clage Cook」、Android ChromiumへのAI機能統合「ChromiumforA」、
> PythonとFFmpegによる動画編集DSL「ScriptVEdit」を開発しています。
> 実装にはAIエージェントを使い、仕様・アーキテクチャ・受入テスト・実機検証と最終判断を自分で行っています。
> 東京大学 工学部 精密工学科卒・同大学院 修士課程修了。博士課程でEIT触覚センサを研究し（2026年3月退学）、筆頭著者として査読論文を発表。基本情報技術者。
> — 公開OSS: Clage Cook・ScriptVEdit（リポジトリ・CI・実機画面）
> — Android実機開発: ChromiumforA（比較画像・操作動画、非公開）
> — 査読論文: Frontiers in Robotics and AI（筆頭著者）
> — 受託開発: 美容クリニック向けLINE応答AI（開発中・匿名掲載）

### Clage Cook
> **before**
> 成果: 4社AIの回答比較・相互批評・統合を行うBYOKアプリをOSS公開しました。
> 本人の設計: Flutterで6プラットフォームを対象に共通UIを設計し、Direct BYOKと開発用サーバーを切り替える構成。
> 発展・証拠・状態: 非公開版の日常運用で得た会議フローを公式APIベースで再実装。（後略）

> **after**
> 設計判断: プロバイダごとに異なるAPI契約（認証ヘッダ・エンドポイント・応答形式）を共通のインターフェースに吸収し、
> 一部のAIが失敗しても完了済みの回答を保持して統合まで進める流れにしました。進行状況はSSEでUIへ統一配信します。
> APIキーはOSのsecure storageへ保存し、会話履歴を端末内だけに置くDirect接続と、開発用のreference serverを分離しています。
> 実装・検証: Flutter/DartのUI実装はAIエージェントへ任せ、生成されたアプリへのダメ出しと修正指示、
> WindowsとAndroid実機での動作確認を担当。公開リポジトリとCIで確認できます。
> 公開状況: 公開ベータ。本番運用向けサポート・後方互換性は未保証です。

### ScriptVEdit
> **before**
> 本人の設計: DSL記法、素材キャッシュ、要素配置のアンカー解決。**FFmpegへの変換実装はAIへ任せ**、出力と性能を検証しました。

> **after**
> 考案したもの: DSLの記法、素材キャッシュ、要素配置のアンカー解決、区間ごとの並列レンダリング。
> AI利用の範囲: 上記の仕組みを含む実装全般と、テストケースの生成、スクリーンショットによる出力確認はAIエージェントへ任せました。
> DSLの仕様と各仕組みのアイデアはAIと相談しながらほぼ自分で決め、
> エフェクトの品質と、テーマだけ与えてAIに作らせた動画の出来は自分の目で評価しています。
> 計測条件: 2分56秒・87オブジェクトの実プロジェクトを20コアPCで計測 — 逐次1012秒、並列8で106秒。

### ラベル・用語
| before | after |
|---|---|
| 本人の設計 / 本人の責任範囲 | 設計判断 / 担当 |
| 発展・証拠・状態 | 確認できるもの / 公開状況 |
| Repo / Video / Private / Print | GitHub / デモ動画 / 非公開 /（削除） |
| production support は未保証 | 本番運用向けサポートは未保証 |
| scriptvedit | ScriptVEdit（リポジトリ名も改名） |

---

## 4. 指示書から意図的に外した2点

### (1) 「コミットとpushは行わないこと」→ push実施
指示どおり作業完了時点では未コミット状態で報告し、その後ユーザーから
「本番にpushしていい」との明示承認を得てpushした。以後も「変更のたびにpush」の運用方針を受領している
（スマホ実機での確認を優先するため）。

### (2) ScriptVEditのAI利用範囲 — 指示書の想定と実態が逆だった
指示書の推奨文面は
「FFmpeg変換部分の実装にAIエージェントを利用した。**DSL仕様、受入条件、テストケース、出力検証、性能評価は本人が定義・実施**した」
だったが、本人へ確認したところ実態は次のとおりで、**テストと出力評価の担当が逆**だった。

| 項目 | 実際の担当 |
|---|---|
| DSL仕様・各仕組みのアイデア（記法・キャッシュ・アンカー解決・並列化） | AIと相談しつつ**ほぼ本人** |
| 実装全般（上記の仕組みを含む） | **AIエージェント** |
| テストケース生成 | **AIエージェント** |
| スクリーンショットからの出力評価 | **AIエージェント** |
| エフェクトの品質評価 | **本人** |
| テーマだけ与えてAIに作らせた動画の人力評価 | **本人** |

指示書§17「実装をすべて手書きしたという表現を追加しない」「捏造しない」を優先し、実態側を採用した。

### 関連: 指示書になかった追加修正（本人確認により実施）
- **Flutter/Dart** — Clage CookのUI実装はAI委任で、本人は完成品へのダメ出しと指示のみ。
  よって主要技術の列挙から外し、「実装をAIエージェントへ委任し、設計・修正指示・実機検証を担当」の注記に移した。
- **FastAPI** — 同様に自力で理解して書いたものではないため列挙から除外し、同じ注記に含めた。
- 連絡先の「主な領域」とJSON-LDの `knowsAbout` からも Flutter / FastAPI を削除。
- 主要技術のPython行は、自力実装の実体がある対象（EIT研究・過去作品の画像処理/CG・ScriptVEditの仕様設計）に限定。

この結果、**主要技術として掲げるのは Python / Android・Chromium改造 / FFmpeg / Dify・RAG / CNN(Keras) / C++・GLSL** となり、
AI委任分は別枠で明示される構成になった。技術欄の水増しが消え、実力の申告として正確になっている。

---

## 5. レンダリング確認結果

Playwrightで以下を検証（すべて `pageerror 0 / console error 0 / requestfailed 0`）。

| 条件 | 横スクロール | 備考 |
|---|---|---|
| 1440×900 light | なし | |
| 1440×900 dark | なし | |
| 390×844 light | なし | 実機Xperia相当（CSS幅393px） |
| 390×844 dark | なし | |
| print emulation | — | 改ページ位置を画像化して目視 |

追加の対話検証:
- モバイルナビ: 開閉動作・全項目表示（`max-height: calc(100dvh - 60px)`）
- Lightbox: 画像クリックで開く / Escapeで閉じる / **フォーカスがトリガー要素へ復帰**することを確認
- テーマトグル: `data-theme` と navbar の `data-bs-theme` が同期し、ライトで白背景に白文字が出ないことを確認
- スマホのスクショ2枚組: `flex:1 1 0` により**常に横並び**（top座標一致・各160px幅）を数値で確認

---

## 6. PDFのページ数とファイルサイズ

| ファイル | ページ | サイズ | リンク注釈 |
|---|---|---|---|
| `media/Akira_Kojima_Portfolio_Summary.pdf` | 2 | 0.44 MB | 13件（クリック可能） |
| `media/Akira_Kojima_Portfolio.pdf` | 5 | 0.74 MB | 22件（クリック可能） |

改善前は AI要約込みで 7ページ / 1.12 MB だった。README記載と実測が一致することを生成時に確認している。

---

## 7. 実行した検査と結果

```
$ python scripts/check_portfolio.py --external
検査OK: エラー0件 / 警告0件 (ID 13個, 画像 25枚, 外部リンク 15件)

$ git diff --check
（出力なし＝OK）

$ python make_pdf.py
PDF生成完了（full）:    ... (0.7 MiB / 5ページ)
PDF生成完了（summary）: ... (0.4 MiB / 2ページ)
```

外部リンク15件（GitHub 5・Frontiers論文・ニコニコ動画9）はすべて到達確認済み。

---

## 8. 未実施の項目

いずれも指示書上「可能なら」「効果と保守コストを比較して判断」とされた任意項目。

| 項目 | 判断 |
|---|---|
| §13 CSS/JSの外部ファイル分離（`assets/portfolio.css` / `.js`） | 見送り。単一HTMLのままでもPDF生成・検査は安定しており、内容の正確性を優先した |
| §13 Bootstrapのローカル化 | 見送り。SRI付きCDNで不具合が出ておらず、保守コスト増に見合わないと判断 |
| §16 HTML validator / Lighthouse | 未実行。Playwrightでのエラー検査・自作検査スクリプト・目視で代替。正式なaxe/Lighthouseスコアは未取得 |

---

## 9. ユーザーの判断が必要な項目

1. **受託案件の表現**: 効果の断定（自動化した・削減した等）は全て除去済み。
   残した事実「Dify応答フロー・LINE Webhook・RAG・状態管理を実装済み、回答品質と安全性を検証中」が正確かの最終確認。
2. **Hero学歴の粒度**: 「東京大学 工学部 精密工学科卒・同大学院 修士課程修了。博士課程でEIT触覚センサを研究し（2026年3月退学）」で問題ないか。
3. **Heroのmailto**: 指示書§4「メール導線を最下部だけに限定しない」に従いHeroへ配置した。スパム収集を懸念する場合は要検討。
4. **旧アンカーの扱い**: `#ai`・`#other` を `#works`・`#archive` へ変更した。外部から旧フラグメントで流入した場合はページ先頭が表示される（実害は小さい）。

---

## 10. 変更ファイルと差分

```
 README.md                                |   57 +-
 index.html                               | 1805 +++++++++++-------------------
 make_pdf.py                              |   53 +-
 media/Akira_Kojima_Portfolio.pdf         |  Bin 1119680 -> 744776 bytes
 media/Akira_Kojima_Portfolio_Summary.pdf |  新規 (444440 bytes)
 docs/portfolio-audit.md                  |  新規 (監査レポート)
 docs/external-checklist.md               |  新規 (リポジトリ外の対応候補)
 scripts/check_portfolio.py               |  新規 (自動検査)
```

主要コミット:
- `1cefda4` 採用向けに全面改善: AI要約削除・ケーススタディ化・2ページPDF追加
- `22cdfee` Clage Cookの設計記述をコード検証に基づき修正
- `ce7d140` ScriptVEditのAI利用範囲を本人確認の実態に合わせて修正
- `b8df634` スマホでスクショ2枚を横並び維持、Flutter/Dartをスキル表記から分離
- `104fcb1` FastAPIを人間スキル表記から除外し、ScriptVEditの実装委任範囲を実態に修正
- `295908e` ScriptVEditリポジトリ改名に伴いリンクを更新

---

## 11. 事実確認のためにコードを読んだ箇所（§17対応）

推測で書かず、実装を確認してから記述した。

**Clage Cook**（`C:\code\ClageCookOSS`）
| ページの記述 | 確認したコード |
|---|---|
| API契約差異の吸収 | `app/lib/services/direct_provider_client.dart` — 4社のエンドポイント（api.anthropic.com / api.openai.com / generativelanguage.googleapis.com / api.x.ai）、認証ヘッダ（`anthropic-version` / `x-goog-api-key` / `Authorization`）、応答パーサ（Claudeのcontent blocks、Geminiのcandidates、OpenAI/Grokのresponses）を共通型へ集約 |
| 部分失敗時も完了済み回答を保持 | `app/lib/services/direct_byok_client.dart` — `Future.wait` による並列実行、失敗ターンへの`error`付与、完了済み回答があれば統合を継続（全滅時のみ「完了した回答がないため統合できません」） |
| secure storage | `app/pubspec.yaml` の `flutter_secure_storage ^10.3.1`、`direct_settings_store.dart` で実使用 |
| 6プラットフォーム / CI | `app/` 配下に android・ios・linux・macos・web・windows、`.github/workflows/ci.yml` |

**この検証で1件の誤りを発見・修正した**: 当初「異なるAPI契約と**ストリーミング形式**を吸収」と書いていたが、
プロバイダへの通信は非ストリーミングPOSTで、SSEはアプリ／reference serverが進行状況をUIへ配信する側の仕組みだった。
→「API契約の吸収＋進行状況はSSEでUIへ統一配信」に訂正済み。

**ScriptVEdit**（GitHub README）: 公式表記が `ScriptVEdit`（パッケージ名のみ小文字 `src/scriptvedit/`）であることを確認し、表示名を統一。
その後リポジトリ名自体も `scriptvedit` → `ScriptVEdit` へ改名した（旧URLはGitHubのリダイレクトで到達可能）。

---

## 12. 関連リポジトリの整備（指示書§18への対応）

§18は「リポジトリ外なので変更せず `docs/external-checklist.md` に記録する」とされていたが、
ユーザーの追加指示により、ポートフォリオから参照される公開リポジトリのREADMEも実際に整備した。

- `kojima8924/ScriptVEdit` — `git clone <repo>` プレースホルダーの修正ほか
- `kojima8924/ClageCook` — 冒頭を「AI支援能力を示すポートフォリオ」から製品目的中心へ
- `kojima8924/ChatGPT-Windows` — 見出しがリポジトリ名と不一致（`ChatGPT Desktop`）だった点ほか
- `kojima8924/ChatGPT-Web` — 空のスクリーンショット節ほか

いずれもポートフォリオ本体の記述と整合させ、AI利用の範囲を同じ切り分けで記述している。
