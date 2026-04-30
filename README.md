# レガシーVBA解析デモ

Excel VBA / Access VBA のコードを読み取り、Gemini で中間JSONを生成し、そこから簡易仕様書・簡易設計書を画面表示、`Word(.docx)`、`PDF` に展開する商談向けデモです。

## 現在の構成
- 実装は `Next.js` ではなく、`TypeScript + tsx + node:http` の軽量Webサーバー構成です。
- UI は `public/` 配下の静的HTML/CSS/JS です。
- 解析は `src/legacy-analyzer/`、出力は `src/web/` に分離しています。
- PDF は `HTML -> Puppeteer Chromium` で生成します。
- Word は `docx` で、中間JSONから直接生成します。

## このデモの目的
- 古い VBA コードから、仕様理解用のたたき台を短時間で作れることを見せる
- コードの事実、推測、要確認事項を分けて整理できることを見せる
- 生成結果をその場で文書として持ち帰れることを見せる

## 現在できること
- `.bas` `.cls` `.frm` `.txt` ファイルの読込
- 複数ファイルの同時選択、追加読込、同名ファイルの差し替え
- 画面上への VBA コード貼り付け
- Gemini API による関数単位・ファイル単位・プロジェクト単位の段階解析
- 中間JSONからの以下4文書のHTML表示
  - 現状仕様書
  - 問題点分析
  - 詳細リファクタリング案
  - リファクタリング設計書
- 各文書の `PDF` ダウンロード
- 各文書の `Word(.docx)` ダウンロード
- 生成済み要約JSONのキャッシュ再利用
- コード中のSQL文字列からのテーブル / カラム候補抽出
- Mermaid図の表示向け正規化

## できないこと
- 本格的な自動リファクタリング
- 業務仕様の完全断定
- 実行時依存を含む 100% 正確な再現解析
- `output/` フォルダへの成果物保存
- CLI での文書生成
- Access / Excel ファイル本体の直接解析
- VBA 実行結果や外部DBの実データを使った検証

## 解析フロー
1. 入力されたコードをファイル単位で受け取ります。
2. ファイル内の `Sub` / `Function` を分割します。
3. Gemini Light Model で関数単位の要約JSONを作ります。
4. Gemini Main Model でファイル単位の要約JSONを作ります。
5. ファイル要約JSONだけを使って、最終の中間JSONを作ります。
6. 同じ内容のコードであれば `.cache/legacy-analysis/` のJSONを再利用します。
7. 中間JSONから画面HTML、Word、PDFを生成します。

## PDF / Word の方針
- PDF は中間JSON -> HTMLテンプレート -> Chromium PDF の順で生成します。
- PDFでは `assets/fonts/NotoSansCJKjp-Regular.otf` を埋め込み、日本語の文字化けを防ぎます。
- PDF は表、折り返し、改ページ制御を含むレイアウトを持ちます。
- Word は表示崩れを避けるため、表中心ではなく `見出し + ラベル + 箇条書き` の段落ベースで出力します。
- Word の既定フォントは `Meiryo` です。Windows標準フォントを優先し、英数字だけ別書体になる現象を抑えています。
- 必要に応じて `WORD_EXPORT_FONT` で Word 用フォント名を上書きできます。

## Gemini モデル方針
- 通常処理の既定モデルは `Gemini 2.5 Flash`
- 軽量な関数要約用モデルは `Gemini 2.5 Flash-Lite`
- プロジェクト統合解析は既定で `GEMINI_MAIN_MODEL` を使います
- `Gemini 2.5 Pro` を使いたい場合だけ `GEMINI_PROJECT_MODEL` で明示指定します

## 429 / 無料枠対策
- 1回のリクエストでコード全文を毎回投げ直さない構成です。
- 同じコード内容ならキャッシュ済みJSONを再利用します。
- Gemini の利用制限に達した場合は、エラーメッセージを返します。
- 一時的な `503 high demand` に対しては指数バックオフ付きで自動リトライします。
- それでも `503` が続く場合は、同系統の軽いモデルへ順次フォールバックして完走率を上げます。

## 画面の使い方
1. `npm run dev:web` を実行します。
2. ブラウザで `http://localhost:3000` を開きます。
3. `ファイル読込` で VBA ファイルを読み込むか、入力欄へコードを貼り付けます。
4. 必要に応じて案件名 / システム名を入力します。
5. `解析を実行` を押します。
6. 生成された現状仕様書 / 問題点分析 / 詳細リファクタリング案 / リファクタリング設計書を確認します。
7. 必要なら `PDF` または `Word` をダウンロードします。

## 起動仕様
- 既定ポートは `3000` です。
- 同じデモの同じAPIバージョンがすでに `3000` で起動中なら、既存の `http://localhost:3000` を案内します。
- `3000` を別アプリが使っている場合は、エラーを表示します。その場合は該当プロセスを停止するか、`.env` の `WEB_PORT` を変更してください。

## 必要な環境変数
- `GEMINI_API_KEY`
- `GEMINI_MAIN_MODEL`
  - 既定値: `gemini-2.5-flash`
- `GEMINI_LIGHT_MODEL`
  - 既定値: `gemini-2.5-flash-lite`
- `GEMINI_PRO_MODEL`
  - 既定値: 未設定
  - 将来の切替用に保持する任意設定
- `GEMINI_PROJECT_MODEL`
  - 既定値: `GEMINI_MAIN_MODEL` と同じ
  - 例: `gemini-2.5-pro`
- `GEMINI_RETRY_MAX_ATTEMPTS`
  - 既定値: `5`
- `GEMINI_RETRY_BASE_DELAY_MS`
  - 既定値: `2000`
- `GEMINI_RETRY_MAX_DELAY_MS`
  - 既定値: `15000`
- `PDF_EXPORT_ENGINE`
  - 既定値: `puppeteer`
  - `playwright` へ切替可能
- `WORD_EXPORT_FONT`
  - 既定値: `Meiryo`
- `WEB_PORT`
  - 既定値: `3000`

`.env.example` をもとに `.env` を作成してください。

```dotenv
GEMINI_API_KEY=xxxxxxxxxxxxxxxx
GEMINI_MAIN_MODEL=gemini-2.5-flash
GEMINI_LIGHT_MODEL=gemini-2.5-flash-lite
GEMINI_PRO_MODEL=gemini-2.5-pro
# GEMINI_PROJECT_MODEL=gemini-2.5-pro
GEMINI_RETRY_MAX_ATTEMPTS=5
GEMINI_RETRY_BASE_DELAY_MS=2000
GEMINI_RETRY_MAX_DELAY_MS=15000
PDF_EXPORT_ENGINE=puppeteer
WORD_EXPORT_FONT=Meiryo
WEB_PORT=3000
```

旧形式の `.env` 互換:
- `GEMINI_MODEL=gemini-2.5-flash` のような旧設定も、現在は `GEMINI_MAIN_MODEL` の代替として読み取ります。
- ただし今後の運用では、上記の新しい環境変数名へ揃えることを推奨します。

## 実行方法
```bash
npm install
npm run dev:web
```

型チェックだけ行う場合は次を使います。

```bash
npm run typecheck
```

## 出力される成果物
解析結果は画面上に4つの文書として表示されます。

- 現状仕様書
  - 対象機能、現行フロー、テーブル / カラム、主要手続きを整理
- 問題点分析
  - 副作用、責務混在、SQL組立、エラー制御などの改修リスクを整理
- 詳細リファクタリング案
  - 代替案、推奨方針、段階的ロードマップ、ガードレールを整理
- リファクタリング設計書
  - 目標アーキテクチャ、モジュール責務、移行フロー、設計上のリスクを整理

各文書は `PDF` または `Word(.docx)` としてダウンロードできます。

サーバー側で成果物ファイルを恒久保存する構成ではありません。保存対象は再利用用の中間JSONキャッシュです。

## リポジトリ構成
```text
assets/
  fonts/
    NotoSansCJKjp-Regular.otf

public/
  index.html
  app.js
  styles.css

samples/
  legacy_excel_sales_sample.bas
  legacy_excel_receivable_sample.bas

src/
  legacy-analyzer/
    analyzer.ts
    cacheStore.ts
    codeUnits.ts
    designSchemaLocalizer.ts
    diagramRefiner.ts
    mermaidNormalizer.ts
    prompts.ts
    tableReferenceExtractor.ts
    types.ts
  web/
    analysisRenderer.ts
    documentExport.ts
    pdfDocument.css
    pdfTemplate.ts
    server.ts
```

## sample ファイルについて
- `samples/legacy_excel_sales_sample.bas` は売上・請求作成を題材にした Excel VBA サンプルです。
- `samples/legacy_excel_receivable_sample.bas` は売掛・入金突合を題材にした Excel VBA サンプルです。
- どちらもデモ用のレガシーコードであり、仕様書、設計書、要約文はファイル内に含まれていません。
- 画面や出力ファイルに出る要約文は、解析ロジックと Gemini API によって生成されます。

## 確認済みポイント
- `npm run typecheck`
- 中間JSONからの `Word(.docx)` 生成
- 中間JSONからの `PDF` 生成
- `src/web/server.ts` の起動確認
- Word 出力で `ascii / hAnsi / eastAsia / cs` を同一フォントに揃えていることを確認

## 注意点
- 生成文書は、あくまで商談用の簡易たたき台です。
- Gemini API を使う場合でも、断定できない内容は確認が必要です。
- `PDF_EXPORT_ENGINE=playwright` を使う場合は、実行環境側で `playwright` の導入を別途整える前提です。
- `npm run generate:docs` のような CLI 出力機能は削除済みです。

## 商談時の説明例
「古い Excel / Access VBA を読み込ませると、まず中間JSONとして整理し、その同じデータから現状仕様書、問題点分析、詳細リファクタリング案、リファクタリング設計書を画面表示できます。さらに、その場で Word や PDF に落とせるので、現状把握や確認会の出発点として使えます。」
