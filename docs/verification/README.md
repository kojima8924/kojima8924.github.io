# 検証ログ（2026-08-12・コミット時点の実行結果）

第2回レビューの指摘「検証ログが成果物に含まれず独立に再確認できない」への対応。
ページを更新したら以下を再実行してこのフォルダを更新する。

| ファイル | 内容 | 結果 |
|---|---|---|
| `check_portfolio.log` | `python scripts/check_portfolio.py --external` の出力 | エラー0・警告0（外部リンク15件全到達） |
| `w3c-nu.json` | W3C Nu HTML validator（https://validator.w3.org/nu/?out=json）の生JSON | error 0件（infoのみ） |
| `axe-core.json` | axe-core 4.10 実行結果（dark/light両テーマ・details全展開） | violations 0件（両テーマ） |

PDFの紙面受入検査（画像とキャプションの同居・孤立見出しなし・最終ページ空白50%未満）は
ページ画像の目視検査で実施:
- 採用向け2ページ: 合格
- 完全版5ページ: 合格
