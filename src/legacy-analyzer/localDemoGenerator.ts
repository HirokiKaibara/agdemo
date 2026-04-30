import path from "node:path";

import { extractProcedureBlocks } from "./codeUnits.js";
import type {
  LegacyAnalysisDocument,
  LegacyDependencyReference,
  LegacyDiagram,
  LegacyEndpointReference,
  LegacyFileSummary,
  LegacyFlowStep,
  LegacyFunctionSummary,
  LegacyIssue,
  LegacyModuleBlueprint,
  LegacyRefactorOption,
  LegacyRefactorPhase,
  LegacySpecificationFeature,
  LegacyTableReference,
  NormalizedSourceFile,
  ProcedureBlock
} from "./types.js";

const IDENTIFIER_PATTERN = /[A-Za-z0-9_\u3040-\u30ff\u4e00-\u9faf]+/g;
const SHEET_PATTERN = /Worksheets?\("([^"]+)"\)|Sheets?\("([^"]+)"\)/gim;
const STRING_LITERAL_PATTERN = /"([^"]*)"/gim;
const URL_PATTERN = /(https?:\/\/[^\s"'<>]+)/gim;

interface TableArtifact {
  name: string;
  columns: Set<string>;
  operations: Set<string>;
}

interface CodeSignals {
  usesWorksheet: boolean;
  usesFileSystem: boolean;
  usesDatabase: boolean;
  usesPrinting: boolean;
  usesHttp: boolean;
  usesGlobalState: boolean;
  usesSqlConcatenation: boolean;
  usesOnErrorResumeNext: boolean;
  usesGoto: boolean;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function limit(values: string[], max = 8): string[] {
  return unique(values).slice(0, max);
}

function detectObjectType(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();

  if (extension === ".cls") {
    return "クラスモジュール";
  }

  if (extension === ".frm") {
    return "フォーム";
  }

  if (extension === ".bas") {
    return "標準モジュール";
  }

  return "不明";
}

function collectMatches(source: string, regex: RegExp, groupIndex = 1): string[] {
  const values: string[] = [];

  for (const match of source.matchAll(regex)) {
    const value = match[groupIndex]?.trim();

    if (value) {
      values.push(value);
    }
  }

  return unique(values);
}

function splitCsvLike(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeIdentifier(value: string): string {
  const match = value.match(IDENTIFIER_PATTERN);
  return match ? match.join("") : "";
}

function extractStringLiteralCorpus(code: string): string {
  return collectMatches(code, STRING_LITERAL_PATTERN).join(" ");
}

function detectSignals(code: string): CodeSignals {
  return {
    usesWorksheet: /Worksheets?\(|Sheets?\(|Cells?\(|Range\(/im.test(code),
    usesFileSystem: /Workbooks\.Open|Open\s+.+\s+For\s+(Append|Output|Input)|Dir\(|FileSystemObject|\.csv/im.test(code),
    usesDatabase: /CurrentDb|DAO\.|ADODB\.|db\.Execute|Recordset/im.test(code),
    usesPrinting: /PrintPreview|PrintOut|DoCmd\.OpenReport/im.test(code),
    usesHttp: /XMLHTTP|WinHttpRequest|ServerXMLHTTP|https?:\/\//im.test(code),
    usesGlobalState: /^\s*Public\s+/gim.test(code),
    usesSqlConcatenation: /\b(sql|strSql)\b\s*=\s*\1?\s*&/im.test(code) || /SELECT|UPDATE|INSERT INTO|DELETE FROM/im.test(extractStringLiteralCorpus(code)),
    usesOnErrorResumeNext: /On\s+Error\s+Resume\s+Next/im.test(code),
    usesGoto: /\bGoTo\b|\bResume\b/im.test(code)
  };
}

function buildDependencyReferences(code: string): LegacyDependencyReference[] {
  const dependencies: LegacyDependencyReference[] = [];
  const sheetNames = collectMatches(code, SHEET_PATTERN, 1).concat(collectMatches(code, SHEET_PATTERN, 2));

  if (sheetNames.length > 0) {
    dependencies.push({
      name: `ワークシート: ${limit(sheetNames, 4).join(" / ")}`,
      type: "Excelシート",
      purpose: "業務データ入力や帳票整形に使用"
    });
  }

  if (/CurrentDb|DAO\.|ADODB\.|db\.Execute|Recordset/im.test(code)) {
    dependencies.push({
      name: "Access / DAO / ADODB",
      type: "データベース",
      purpose: "テーブル更新や検索に使用"
    });
  }

  if (/Workbooks\.Open|Open\s+.+\s+For\s+(Append|Output|Input)|Dir\(|FileSystemObject|\.csv/im.test(code)) {
    dependencies.push({
      name: "ファイルシステム",
      type: "入出力",
      purpose: "CSVや外部ファイルの読み書きに使用"
    });
  }

  if (/PrintPreview|PrintOut|DoCmd\.OpenReport/im.test(code)) {
    dependencies.push({
      name: "印刷 / 帳票",
      type: "出力",
      purpose: "請求書や帳票の表示・印刷に使用"
    });
  }

  if (/XMLHTTP|WinHttpRequest|ServerXMLHTTP|https?:\/\//im.test(code)) {
    dependencies.push({
      name: "HTTP連携",
      type: "外部連携",
      purpose: "APIや外部システム接続に使用"
    });
  }

  return dependencies;
}

function detectProcedureInputs(code: string): string[] {
  const inputs: string[] = [];

  if (/Workbooks\.Open|\.csv|Dir\(/im.test(code)) {
    inputs.push("CSVまたは外部ファイル");
  }

  if (/Worksheets?\(|Cells?\(|Range\(/im.test(code)) {
    inputs.push("Excelシート上のデータ");
  }

  if (/CurrentDb|DAO\.|ADODB\.|Recordset/im.test(code)) {
    inputs.push("Accessテーブルまたはクエリ結果");
  }

  if (/XMLHTTP|WinHttpRequest|https?:\/\//im.test(code)) {
    inputs.push("外部API応答");
  }

  return inputs.length > 0 ? inputs : ["入力元は要確認"];
}

function detectProcedureOutputs(code: string): string[] {
  const outputs: string[] = [];

  if (/PrintPreview|PrintOut|DoCmd\.OpenReport/im.test(code)) {
    outputs.push("帳票または印刷プレビュー");
  }

  if (/Open\s+.+\s+For\s+(Append|Output)|Print\s+#|\.csv/im.test(code)) {
    outputs.push("CSVまたは外部ファイル");
  }

  if (/CurrentDb|DAO\.|ADODB\.|db\.Execute|Recordset/im.test(code)) {
    outputs.push("Accessテーブル更新");
  }

  if (/Worksheets?\(|Cells?\(|Range\(/im.test(code)) {
    outputs.push("Excelシート更新");
  }

  return outputs.length > 0 ? outputs : ["出力先は要確認"];
}

function detectProcedureProcess(code: string): string[] {
  const steps: string[] = [];

  if (/Workbooks\.Open|\.csv|Dir\(/im.test(code)) {
    steps.push("入力ファイルや元データを読み込む");
  }

  if (/If\s+.+Then|Select\s+Case/im.test(code)) {
    steps.push("入力値や条件を判定して処理分岐する");
  }

  if (/CurrentDb|DAO\.|ADODB\.|Recordset/im.test(code)) {
    steps.push("DBまたはクエリ結果を参照し、必要に応じて更新する");
  }

  if (/tax|税|amount|total|sum|計算/im.test(code)) {
    steps.push("金額や集計値を計算する");
  }

  if (/Worksheets?\(|Cells?\(|Range\(/im.test(code)) {
    steps.push("シートや画面へ結果を書き戻す");
  }

  if (/PrintPreview|PrintOut|Open\s+.+\s+For\s+(Append|Output)|Print\s+#/im.test(code)) {
    steps.push("帳票・ファイル・外部出力を実行する");
  }

  return steps.length > 0 ? steps : ["処理の詳細は要確認"];
}

function buildProcedureNotes(procedure: ProcedureBlock): string[] {
  const notes: string[] = [];
  const code = procedure.code;

  if (/On\s+Error\s+Resume\s+Next/im.test(code)) {
    notes.push("例外を握りつぶす可能性があるため、エラー制御の見直しが必要");
  }

  if (code.split(/\r?\n/u).length > 80) {
    notes.push("手続きが長く、責務分割候補になりやすい");
  }

  if (/CurrentDb|DAO\.|ADODB\.|Recordset/im.test(code) && /Worksheets?\(|Cells?\(|Range\(/im.test(code)) {
    notes.push("画面操作とDBアクセスが同居している");
  }

  if (notes.length === 0) {
    notes.push("ローカル簡易解析のため詳細確認は要レビュー");
  }

  return notes;
}

function summarizeProcedureFromCode(procedure: ProcedureBlock): LegacyFunctionSummary {
  return {
    name: procedure.name,
    description: `${procedure.name} は ${detectProcedureProcess(procedure.code).join("、")}手続きです。`,
    inputs: detectProcedureInputs(procedure.code),
    outputs: detectProcedureOutputs(procedure.code),
    process: detectProcedureProcess(procedure.code),
    notes: buildProcedureNotes(procedure)
  };
}

function buildFileRole(file: NormalizedSourceFile, signals: CodeSignals): string {
  const roles: string[] = [];

  if (signals.usesWorksheet) {
    roles.push("Excel画面・シート操作");
  }

  if (signals.usesDatabase) {
    roles.push("Accessデータ更新");
  }

  if (signals.usesFileSystem) {
    roles.push("ファイル入出力");
  }

  if (signals.usesPrinting) {
    roles.push("帳票出力");
  }

  if (signals.usesHttp) {
    roles.push("外部連携");
  }

  if (roles.length === 0) {
    roles.push("業務処理制御");
  }

  return `${path.parse(file.fileName).name} は ${roles.join(" / ")} を担う。`;
}

function summarizeFile(file: NormalizedSourceFile): LegacyFileSummary {
  const procedures = extractProcedureBlocks(file);
  const signals = detectSignals(file.code);
  const dependencies = buildDependencyReferences(file.code);

  return {
    fileName: file.fileName,
    objectType: detectObjectType(file.fileName),
    role: buildFileRole(file, signals),
    summary: `${detectObjectType(file.fileName)}として、${dependencies.map((item) => item.name).join("、") || "主要依存は要確認"}に関わる処理が集約されています。`,
    dependencies: dependencies.map((item) => item.name),
    mainFunctions: procedures.slice(0, 10).map((procedure) => summarizeProcedureFromCode(procedure))
  };
}

function ensureTableArtifact(tableArtifacts: Map<string, TableArtifact>, tableName: string): TableArtifact {
  const normalized = normalizeIdentifier(tableName);

  const existing = tableArtifacts.get(normalized);

  if (existing) {
    return existing;
  }

  const artifact: TableArtifact = {
    name: normalized,
    columns: new Set<string>(),
    operations: new Set<string>()
  };
  tableArtifacts.set(normalized, artifact);
  return artifact;
}

function addColumns(artifact: TableArtifact, columns: string[]): void {
  for (const column of columns) {
    const normalized = normalizeIdentifier(column);

    if (normalized && normalized !== "*") {
      artifact.columns.add(normalized);
    }
  }
}

function extractTableReferences(files: NormalizedSourceFile[]): LegacyTableReference[] {
  const tableArtifacts = new Map<string, TableArtifact>();

  for (const file of files) {
    const corpus = extractStringLiteralCorpus(file.code);

    for (const match of corpus.matchAll(/UPDATE\s+([A-Za-z0-9_\u3040-\u30ff\u4e00-\u9faf]+)\s+SET\s+([\s\S]*?)(?:WHERE|GROUP BY|ORDER BY|$)/giu)) {
      const artifact = ensureTableArtifact(tableArtifacts, match[1] ?? "");
      artifact.operations.add("UPDATE");
      addColumns(
        artifact,
        splitCsvLike(match[2] ?? "")
          .map((part) => part.split("=")[0] ?? "")
      );
    }

    for (const match of corpus.matchAll(/INSERT\s+INTO\s+([A-Za-z0-9_\u3040-\u30ff\u4e00-\u9faf]+)\s*\(([^)]+)\)/giu)) {
      const artifact = ensureTableArtifact(tableArtifacts, match[1] ?? "");
      artifact.operations.add("INSERT");
      addColumns(artifact, splitCsvLike(match[2] ?? ""));
    }

    for (const match of corpus.matchAll(/SELECT\s+([\s\S]*?)\s+FROM\s+([A-Za-z0-9_\u3040-\u30ff\u4e00-\u9faf]+)(?:\s|$)/giu)) {
      const artifact = ensureTableArtifact(tableArtifacts, match[2] ?? "");
      artifact.operations.add("SELECT");
      addColumns(artifact, splitCsvLike(match[1] ?? ""));
    }

    for (const match of corpus.matchAll(/DELETE\s+FROM\s+([A-Za-z0-9_\u3040-\u30ff\u4e00-\u9faf]+)(?:\s|$)/giu)) {
      const artifact = ensureTableArtifact(tableArtifacts, match[1] ?? "");
      artifact.operations.add("DELETE");
    }

    for (const match of corpus.matchAll(/\bFROM\s+([A-Za-z0-9_\u3040-\u30ff\u4e00-\u9faf]+)(?:\s|$)/giu)) {
      const artifact = ensureTableArtifact(tableArtifacts, match[1] ?? "");
      artifact.operations.add("FROM");
    }
  }

  return [...tableArtifacts.values()].map((artifact) => ({
    name: artifact.name,
    columns: [...artifact.columns].slice(0, 12),
    usage: artifact.operations.size > 0 ? `${[...artifact.operations].join(" / ")} に使用` : "利用方法は要確認",
    notes: "SQL文字列またはコード断片から抽出した候補",
    confidence: artifact.columns.size > 0 ? "high" : "medium"
  }));
}

function extractEndpointReferences(files: NormalizedSourceFile[]): LegacyEndpointReference[] {
  const endpoints: LegacyEndpointReference[] = [];

  for (const file of files) {
    const urls = collectMatches(file.code, URL_PATTERN);

    for (const url of urls) {
      const methodMatch = file.code.match(new RegExp(`Open\\s+"([A-Z]+)".*${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "im"));
      endpoints.push({
        name: `外部連携: ${url}`,
        method: methodMatch?.[1] ?? "HTTP",
        path: url,
        purpose: "コード中に現れる外部接続先",
        confidence: "high"
      });
    }
  }

  if (endpoints.length === 0 && files.some((file) => /XMLHTTP|WinHttpRequest|ServerXMLHTTP/im.test(file.code))) {
    endpoints.push({
      name: "HTTP連携あり",
      method: "要確認",
      path: "要確認",
      purpose: "HTTPクライアント利用の痕跡はあるが接続先はコード断片から確定できない",
      confidence: "low"
    });
  }

  return endpoints;
}

function buildSpecificationFeatures(files: NormalizedSourceFile[], tables: LegacyTableReference[]): LegacySpecificationFeature[] {
  const combined = files.map((file) => file.code).join("\n");
  const features: LegacySpecificationFeature[] = [];

  if (/Workbooks\.Open|\.csv|Dir\(/im.test(combined)) {
    features.push({
      name: "入力データ取込",
      description: "CSVや外部ファイル、またはシート上の元データを読み込み、業務処理の起点にしています。",
      inputs: ["CSV", "Excelシート"],
      outputs: ["処理対象ワークシート", "内部変数"],
      businessRules: ["対象ファイルや対象月の存在チェックが前提", "入力欠損時の代替動作有無を確認する"],
      relatedFiles: files.filter((file) => /Workbooks\.Open|\.csv|Dir\(/im.test(file.code)).map((file) => file.fileName)
    });
  }

  if (/CurrentDb|DAO\.|ADODB\.|db\.Execute|Recordset/im.test(combined)) {
    features.push({
      name: "Accessデータ更新",
      description: "Accessテーブルやクエリを参照・更新して、業務状態を反映します。",
      inputs: tables.map((table) => table.name).slice(0, 6),
      outputs: ["Accessテーブル更新"],
      businessRules: ["更新条件とトランザクション境界を要確認", "SQL組立方法により保守性と安全性が左右される"],
      relatedFiles: files.filter((file) => /CurrentDb|DAO\.|ADODB\.|db\.Execute|Recordset/im.test(file.code)).map((file) => file.fileName)
    });
  }

  if (/tax|税|amount|total|sum|計算/im.test(combined)) {
    features.push({
      name: "金額・集計計算",
      description: "売上、税、合計、集計値などを計算し、帳票や更新データへ反映します。",
      inputs: ["売上明細", "単価・税率・条件値"],
      outputs: ["請求金額", "税額", "集計結果"],
      businessRules: ["税計算の端数処理を要確認", "条件別の割引や例外ルールを洗い出す"],
      relatedFiles: files.filter((file) => /tax|税|amount|total|sum|計算/im.test(file.code)).map((file) => file.fileName)
    });
  }

  if (/PrintPreview|PrintOut|DoCmd\.OpenReport|Open\s+.+\s+For\s+(Append|Output)|Print\s+#/im.test(combined)) {
    features.push({
      name: "帳票・ファイル出力",
      description: "請求書や集計結果をシート・帳票・CSVなどへ出力します。",
      inputs: ["加工済み業務データ"],
      outputs: ["帳票", "CSV", "シート更新"],
      businessRules: ["出力先の命名規則や再実行時の上書き挙動を確認する", "帳票表示とバッチ処理の分離可否を確認する"],
      relatedFiles: files.filter((file) => /PrintPreview|PrintOut|DoCmd\.OpenReport|Open\s+.+\s+For\s+(Append|Output)|Print\s+#/im.test(file.code)).map((file) => file.fileName)
    });
  }

  return features.length > 0
    ? features
    : [
        {
          name: "主要業務処理",
          description: "ローカル簡易解析では詳細仕様を確定できないため、主要処理の追加レビューが必要です。",
          inputs: ["要確認"],
          outputs: ["要確認"],
          businessRules: ["手動レビューで補完する"],
          relatedFiles: files.map((file) => file.fileName)
        }
      ];
}

function buildCurrentFlows(files: NormalizedSourceFile[], tables: LegacyTableReference[]): LegacyFlowStep[] {
  const combined = files.map((file) => file.code).join("\n");
  const flow: LegacyFlowStep[] = [];

  if (/Workbooks\.Open|\.csv|Dir\(/im.test(combined)) {
    flow.push({
      step: "01",
      detail: "入力ファイルまたはワークシートから対象データを読み込む",
      actors: ["ユーザー", "Excel/Access"]
    });
  }

  flow.push({
    step: "02",
    detail: "条件判定やマスタ参照を行い、処理に必要な項目を補完する",
    actors: ["VBA手続き"]
  });

  if (/tax|税|amount|total|sum|計算/im.test(combined)) {
    flow.push({
      step: "03",
      detail: "金額、税額、集計値などの業務計算を実施する",
      actors: ["VBA手続き", "業務ルール"]
    });
  }

  if (tables.length > 0) {
    flow.push({
      step: "04",
      detail: `${tables.map((table) => table.name).slice(0, 3).join(" / ")} などのテーブルへ更新または参照を行う`,
      actors: ["Access DB"]
    });
  }

  flow.push({
    step: "05",
    detail: "画面・シート・帳票・CSVへ結果を出力する",
    actors: ["Excel/Access", "ユーザー"]
  });

  return flow;
}

function buildSpecificationDiagrams(files: NormalizedSourceFile[], tables: LegacyTableReference[]): LegacyDiagram[] {
  const inputNode = files.some((file) => /Workbooks\.Open|\.csv|Dir\(/im.test(file.code)) ? "入力ファイル" : "業務データ";
  const dbNode = tables.length > 0 ? tables.map((table) => table.name).slice(0, 2).join(" / ") : "DB更新";

  return [
    {
      title: "現行業務フロー",
      description: "入力から計算、更新、出力までの大きな流れです。",
      mermaid: [
        "flowchart LR",
        `  A[${inputNode}] --> B[入力チェック / 条件判定]`,
        "  B --> C[マスタ参照 / 補完]",
        "  C --> D[業務計算]",
        `  D --> E[${dbNode}]`,
        "  D --> F[シート / 帳票 / CSV出力]"
      ].join("\n")
    },
    {
      title: "現行依存関係",
      description: "VBAから見える主な外部依存を整理します。",
      mermaid: [
        "flowchart TB",
        "  VBA[Legacy VBA Module]",
        "  VBA --> Sheet[Excel Sheet / Access UI]",
        "  VBA --> File[File System / CSV]",
        "  VBA --> DB[Access Tables / Queries]",
        "  VBA --> Output[Report / Print / Export]"
      ].join("\n")
    }
  ];
}

function buildIssueFindings(files: NormalizedSourceFile[]): LegacyIssue[] {
  const findings: LegacyIssue[] = [];
  const combined = files.map((file) => file.code).join("\n");
  const longProcedures = files.flatMap((file) =>
    extractProcedureBlocks(file)
      .filter((procedure) => procedure.code.split(/\r?\n/u).length > 80)
      .map((procedure) => `${file.fileName}:${procedure.name}`)
  );
  const publicVariables = unique(
    files.flatMap((file) => collectMatches(file.code, /^\s*Public\s+([A-Za-z0-9_\u3040-\u30ff\u4e00-\u9faf]+)/gim))
  );
  const mixedFiles = files
    .filter((file) => /CurrentDb|DAO\.|ADODB\.|Recordset/im.test(file.code) && /Worksheets?\(|Cells?\(|Range\(/im.test(file.code))
    .map((file) => file.fileName);
  const sqlFiles = files
    .filter((file) => /\b(sql|strSql)\b\s*=\s*\1?\s*&/im.test(file.code) || /UPDATE|INSERT INTO|DELETE FROM|SELECT/im.test(extractStringLiteralCorpus(file.code)))
    .map((file) => file.fileName);

  if (/On\s+Error\s+Resume\s+Next/im.test(combined)) {
    findings.push({
      id: "ISS-01",
      title: "例外が握りつぶされる可能性",
      severity: "critical",
      category: "エラーハンドリング",
      symptoms: ["On Error Resume Next により異常系の流れが見えにくい", "障害発生時に処理継続して不整合を残しやすい"],
      evidence: files
        .filter((file) => /On\s+Error\s+Resume\s+Next/im.test(file.code))
        .map((file) => `${file.fileName} に On Error Resume Next が存在`),
      impact: "データ更新漏れや部分更新が発生しても検知しづらく、保守時の原因調査が難しくなります。",
      recommendation: "共通エラー方針を定義し、復旧不能な例外は即時停止・記録・再実行可能な単位へ整理します。",
      affectedFiles: files.filter((file) => /On\s+Error\s+Resume\s+Next/im.test(file.code)).map((file) => file.fileName),
      priority: "now"
    });
  }

  if (publicVariables.length > 0) {
    findings.push({
      id: "ISS-02",
      title: "グローバル状態への依存",
      severity: "high",
      category: "状態管理",
      symptoms: ["処理間で共有変数が更新される", "実行順や再入時に結果が変わりやすい"],
      evidence: [`Public 変数候補: ${publicVariables.slice(0, 8).join(", ")}`],
      impact: "副作用が追いにくく、テスト・再利用・並行開発の障害になります。",
      recommendation: "実行コンテキストやDTOに集約し、入力値・出力値を明示的に受け渡す構造へ変更します。",
      affectedFiles: files.filter((file) => /^\s*Public\s+/gim.test(file.code)).map((file) => file.fileName),
      priority: "now"
    });
  }

  if (mixedFiles.length > 0) {
    findings.push({
      id: "ISS-03",
      title: "UI操作・業務計算・DB更新の密結合",
      severity: "high",
      category: "責務分離",
      symptoms: ["1つの手続きで画面操作とDB更新が混在", "変更影響範囲が広くなりやすい"],
      evidence: mixedFiles.map((fileName) => `${fileName} でシート操作とDBアクセスが同居`),
      impact: "仕様変更時に回帰範囲が広がり、小修正でも障害化しやすくなります。",
      recommendation: "画面層、アプリケーションサービス、リポジトリ/入出力アダプタを分離します。",
      affectedFiles: mixedFiles,
      priority: "now"
    });
  }

  if (sqlFiles.length > 0) {
    findings.push({
      id: "ISS-04",
      title: "SQL組立の分散と可読性低下",
      severity: "high",
      category: "データアクセス",
      symptoms: ["文字列連結でSQLを構築している", "更新条件や列定義がコードに埋め込まれる"],
      evidence: sqlFiles.map((fileName) => `${fileName} でSQL文字列の組立を検出`),
      impact: "SQL変更時の差分が追いにくく、誤更新や保守漏れの温床になります。",
      recommendation: "SQL生成を専用関数やRepositoryへ隔離し、入力値の検証・パラメータ化・共通化を進めます。",
      affectedFiles: sqlFiles,
      priority: "next"
    });
  }

  if (longProcedures.length > 0) {
    findings.push({
      id: "ISS-05",
      title: "長大手続きによる変更難易度の上昇",
      severity: "medium",
      category: "可読性",
      symptoms: ["手続きが長く、処理境界が分かりにくい", "単体での再利用やテストが難しい"],
      evidence: longProcedures.slice(0, 6).map((item) => `${item} が80行超の候補`),
      impact: "要件追加のたびに同一手続きへ追記され、技術的負債が蓄積します。",
      recommendation: "入出力、計算、永続化、例外制御単位でサブルーチンを抽出します。",
      affectedFiles: unique(longProcedures.map((item) => item.split(":")[0] ?? "")),
      priority: "next"
    });
  }

  if (/\bGoTo\b|\bResume\b/im.test(combined)) {
    findings.push({
      id: "ISS-06",
      title: "ジャンプ構文による制御フローの追跡困難",
      severity: "medium",
      category: "制御構造",
      symptoms: ["途中終了やラベルジャンプが多い", "正常系と異常系の境界が曖昧になりやすい"],
      evidence: files
        .filter((file) => /\bGoTo\b|\bResume\b/im.test(file.code))
        .map((file) => `${file.fileName} に GoTo/Resume を検出`),
      impact: "改修時に分岐漏れを起こしやすく、レビューコストも増えます。",
      recommendation: "ガード節、早期return、結果オブジェクト化で直線的なフローに置き換えます。",
      affectedFiles: files.filter((file) => /\bGoTo\b|\bResume\b/im.test(file.code)).map((file) => file.fileName),
      priority: "later"
    });
  }

  if (findings.length === 0) {
    findings.push({
      id: "ISS-00",
      title: "詳細レビュー前提の未確定課題",
      severity: "low",
      category: "初期調査",
      symptoms: ["ローカル簡易解析だけでは課題を断定できない"],
      evidence: ["サンプルベースのヒューリスティック解析結果"],
      impact: "実コードレビュー前に誤った優先順位を付ける恐れがあります。",
      recommendation: "Gemini解析または手動レビューで詳細仕様と依存関係を補完してください。",
      affectedFiles: files.map((file) => file.fileName),
      priority: "later"
    });
  }

  const severityOrder = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3
  } as const;

  return findings.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]);
}

function buildIssueOverview(findings: LegacyIssue[]): string {
  const counts = findings.reduce<Record<string, number>>((result, finding) => {
    result[finding.severity] = (result[finding.severity] ?? 0) + 1;
    return result;
  }, {});

  return `重大度は critical:${counts.critical ?? 0} / high:${counts.high ?? 0} / medium:${counts.medium ?? 0} / low:${counts.low ?? 0} です。特に副作用、エラー制御、責務分離が優先論点です。`;
}

function buildRefactorAlternatives(): LegacyRefactorOption[] {
  return [
    {
      name: "現行VBA延命リファクタリング",
      summary: "Access/Excel VBAを維持しつつ、責務分離と安全網を追加して保守性を上げる案です。",
      targetVersions: ["Microsoft 365 Apps / Office永続版 (要確認)", "Access Runtime 利用有無を要確認"],
      pros: ["短期で着手しやすい", "業務フローを大きく変えずに改善できる", "既存運用へなじみやすい"],
      cons: ["将来的な拡張性には限界がある", "VBA特有の制約は残る"],
      fitScore: "高",
      whenToChoose: "短期で障害率を下げたい、かつ既存Access/Excel運用を当面継続する場合"
    },
    {
      name: "Access/Excelフロント + API分離",
      summary: "画面は現行に近い形を残しつつ、業務ロジックとデータ更新をAPI/サービスへ切り出す案です。",
      targetVersions: [".NET 8 LTS 候補 (要確認)", "SQL Server / Azure SQL 候補 (要確認)", "OpenAPI 3.1 候補 (要確認)"],
      pros: ["段階移行しやすい", "ロジック再利用性と監査性を高めやすい", "VBA依存を縮小できる"],
      cons: ["インフラと認証設計が新たに必要", "二重運用期間の設計が必要"],
      fitScore: "高",
      whenToChoose: "レガシー画面の継続が必要だが、業務ロジックは外出ししたい場合"
    },
    {
      name: "Web/業務基盤への全面移行",
      summary: "VBAを段階廃止し、Webまたはサービスベースへ全面移行する案です。",
      targetVersions: [".NET 8 LTS 候補 (要確認)", "SPA/SSR フロント技術は組織標準を要確認", "RDBMS は現行資産との互換性を要確認"],
      pros: ["長期保守性が高い", "テスト自動化やCI/CDと親和性が高い", "組織横断の再利用を狙いやすい"],
      cons: ["初期投資が最も大きい", "要件棚卸しと移行計画が重い"],
      fitScore: "中",
      whenToChoose: "業務を中長期で再編し、Access/Excel依存を計画的に解消したい場合"
    }
  ];
}

function buildRefactorRoadmap(files: NormalizedSourceFile[], findings: LegacyIssue[]): LegacyRefactorPhase[] {
  const affectedFiles = limit(files.map((file) => file.fileName), 6);
  const hotIssues = findings.slice(0, 3).map((finding) => finding.title);

  return [
    {
      phase: "Phase 0: 現状固定化",
      objective: "現行挙動を止めずに観測可能な状態へする",
      tasks: [
        "対象ファイル・帳票・テーブル・出力ファイルを一覧化する",
        "代表入力と代表出力をゴールデンデータとして保存する",
        "主要手続きごとに入出力・副作用を棚卸しする"
      ],
      outputs: ["現状仕様書", "回帰確認観点", `重点対象ファイル: ${affectedFiles.join(" / ")}`],
      validations: ["既存月次処理の再現確認", "主要帳票とCSV差分の突合", "DB更新件数の比較"],
      risks: ["現行仕様が暗黙知のままだと、後続フェーズで認識差が残る"]
    },
    {
      phase: "Phase 1: 安全網構築",
      objective: "障害化しやすい論点を先に抑える",
      tasks: [
        "共通エラーハンドリング方針を定義する",
        "グローバル変数を実行コンテキストへ集約する",
        "ハードコードされた定数・パス・シート名を設定化する"
      ],
      outputs: ["エラーポリシー", "設定一覧", `優先課題: ${hotIssues.join(" / ")}`],
      validations: ["例外発生時のロールバック/中断条件確認", "設定変更時の再実行確認"],
      risks: ["設定化だけ先行し過ぎるとロジック分離が遅れる"]
    },
    {
      phase: "Phase 2: 責務分離",
      objective: "UI・業務ロジック・データアクセスを切り分ける",
      tasks: [
        "画面/シート操作を薄いアダプタへ隔離する",
        "計算ロジックを業務サービスへ抽出する",
        "SQLやCurrentDb操作をRepositoryへ集約する"
      ],
      outputs: ["サービス層設計", "Repository一覧", "抽出済み共通関数"],
      validations: ["抽出前後で計算結果が一致すること", "主要手続きの回帰確認"],
      risks: ["分離粒度が粗いと結合度が下がらず効果が薄い"]
    },
    {
      phase: "Phase 3: リファクタリング実装",
      objective: "段階的に呼び出し元を新構造へ寄せる",
      tasks: [
        "新しいサービス/Repositoryを既存手続きから呼び出す",
        "長大手続きからサブルーチンや小さなユースケースへ分割する",
        "ログ、監査、再実行ポイントを整備する"
      ],
      outputs: ["段階移行済み手続き", "監査ログ方針", "リファクタリング差分一覧"],
      validations: ["旧処理との差分比較", "例外系・再実行系の確認"],
      risks: ["旧実装と新実装の二重管理期間が長いと複雑性が増す"]
    },
    {
      phase: "Phase 4: 目標アーキテクチャ移行",
      objective: "選定した代替案に合わせて将来構成へ着地させる",
      tasks: [
        "採用する代替案を決定し、残課題をバックログ化する",
        "必要ならAPI化や外部DB化のインターフェースを追加する",
        "運用手順・設計書・回帰テストを更新する"
      ],
      outputs: ["将来設計書", "移行バックログ", "運用手順書"],
      validations: ["移行後運用の受け入れ確認", "性能・権限制御・監査の確認"],
      risks: ["大きな切替を一度に実施すると運用負荷が跳ね上がる"]
    }
  ];
}

function buildRefactorDiagrams(): LegacyDiagram[] {
  return [
    {
      title: "推奨リファクタリング導線",
      description: "どこから着手し、どの順番で分離していくかを示します。",
      mermaid: [
        "flowchart LR",
        "  A[現状固定化] --> B[安全網構築]",
        "  B --> C[責務分離]",
        "  C --> D[段階移行実装]",
        "  D --> E[目標構成へ着地]"
      ].join("\n")
    },
    {
      title: "責務分離イメージ",
      description: "現行の密結合を、アプリケーション層とアダプタ層にほぐす考え方です。",
      mermaid: [
        "flowchart TB",
        "  UI[Excel / Access UI] --> APP[Application Service]",
        "  APP --> DOMAIN[Business Rule / Calculation]",
        "  APP --> REPO[Repository / Query Service]",
        "  APP --> OUTPUT[Report / CSV Writer]",
        "  REPO --> DB[(Access Tables)]"
      ].join("\n")
    }
  ];
}

function buildDesignModules(files: NormalizedSourceFile[]): LegacyModuleBlueprint[] {
  const modules: LegacyModuleBlueprint[] = [
    {
      name: "ApplicationService",
      responsibility: "ユースケース単位の処理順序制御とトランザクション境界の管理",
      relatedFiles: files.map((file) => file.fileName),
      interfaces: ["IUseCaseRunner", "IExecutionContext"],
      notes: ["既存の長大手続きを最初に薄く移植する受け皿"]
    },
    {
      name: "DomainCalculationService",
      responsibility: "税計算、集計、条件分岐など業務ルールの集約",
      relatedFiles: files.filter((file) => /tax|税|amount|total|sum|計算/im.test(file.code)).map((file) => file.fileName),
      interfaces: ["ICalculationService", "IValidationRule"],
      notes: ["画面やDBアクセスから切り離して単体検証しやすくする"]
    },
    {
      name: "Repository / QueryService",
      responsibility: "CurrentDb、DAO、ADODB、SQL実行の一本化",
      relatedFiles: files.filter((file) => /CurrentDb|DAO\.|ADODB\.|db\.Execute|Recordset/im.test(file.code)).map((file) => file.fileName),
      interfaces: ["IRepository", "IQueryService"],
      notes: ["SQLを集約し、更新条件や列定義の変更点を追いやすくする"]
    },
    {
      name: "InputOutputAdapter",
      responsibility: "シート、CSV、帳票、印刷、ファイルI/Oの境界化",
      relatedFiles: files.filter((file) => /Workbooks\.Open|Worksheets?\(|Cells?\(|Range\(|PrintPreview|PrintOut|Open\s+.+\s+For\s+(Append|Output)|Print\s+#/im.test(file.code)).map((file) => file.fileName),
      interfaces: ["IInputReader", "IReportWriter", "IFileWriter"],
      notes: ["UI依存や副作用を局所化する"]
    }
  ];

  return modules.map((module) => ({
    ...module,
    relatedFiles: unique(module.relatedFiles)
  }));
}

function buildDesignDiagrams(tables: LegacyTableReference[], endpoints: LegacyEndpointReference[]): LegacyDiagram[] {
  const endpointNode = endpoints.length > 0 ? "External API" : "External Integration";
  const tableNode = tables.length > 0 ? tables.map((table) => table.name).slice(0, 2).join(" / ") : "Access Tables";

  return [
    {
      title: "目標アーキテクチャ",
      description: "将来の責務分離後の構成イメージです。",
      mermaid: [
        "flowchart TB",
        "  UI[Excel / Access UI] --> APP[Application Service]",
        "  APP --> DOMAIN[Domain / Rule Service]",
        "  APP --> REPO[Repository]",
        "  APP --> ADAPTER[CSV / Report Adapter]",
        `  REPO --> DB[( ${tableNode} )]`,
        `  APP --> EXT[${endpointNode}]`
      ].join("\n")
    },
    {
      title: "移行フロー",
      description: "現行資産を止めずに段階移行する流れです。",
      mermaid: [
        "flowchart LR",
        "  Legacy[Legacy VBA] --> Wrap[ラッパー化]",
        "  Wrap --> Split[サービス / Repository分離]",
        "  Split --> Target[目標構成へ移行]"
      ].join("\n")
    }
  ];
}

function buildDesignTables(tables: LegacyTableReference[]): LegacyTableReference[] {
  return tables.map((table) => ({
    ...table,
    notes: `${table.notes}。将来構成では Repository 経由でアクセスする前提。`
  }));
}

function buildDesignEndpoints(endpoints: LegacyEndpointReference[]): LegacyEndpointReference[] {
  return endpoints.map((endpoint) => ({
    ...endpoint,
    purpose: `${endpoint.purpose}。将来構成では Gateway / Adapter 経由に整理する想定。`
  }));
}

export function generateLocalDemoAnalysis(
  files: NormalizedSourceFile[],
  projectName: string
): LegacyAnalysisDocument {
  const targetFiles = files.map((file) => summarizeFile(file));
  const tables = extractTableReferences(files);
  const endpoints = extractEndpointReferences(files);
  const dependencies = unique(
    targetFiles.flatMap((file) => file.dependencies)
  ).map<LegacyDependencyReference>((dependency) => ({
    name: dependency,
    type: dependency.includes("ワークシート")
      ? "UI / シート"
      : dependency.includes("HTTP")
        ? "外部連携"
        : dependency.includes("ファイル")
          ? "ファイルI/O"
          : dependency.includes("Access")
            ? "データベース"
            : "依存関係",
    purpose: "主要処理の外部依存"
  }));
  const findings = buildIssueFindings(files);
  const roadmap = buildRefactorRoadmap(files, findings);

  return {
    projectName,
    summary:
      "入力、業務計算、Access更新、帳票/ファイル出力がVBAに密結合している前提で、現状把握から段階的な責務分離までを見通せるよう整理した解析結果です。",
    targetFiles,
    specification: {
      overview:
        "現状仕様では、業務担当者がファイルまたはシートを起点に処理を開始し、条件判定・マスタ参照・計算・更新・出力を1連のVBAで実行している構成が想定されます。",
      userJourney: [
        "まず現状仕様書で、何の業務をどの入力から処理しているかを把握する",
        "次に問題点分析で、障害化しやすい箇所と優先度を確認する",
        "その後リファクタリング案で、どの順番で分離・改善するかを決める",
        "最後に設計書で、目標アーキテクチャと移行後の責務分担を確認する"
      ],
      features: buildSpecificationFeatures(files, tables),
      currentFlows: buildCurrentFlows(files, tables),
      diagrams: buildSpecificationDiagrams(files, tables),
      tables,
      endpoints,
      dependencies
    },
    issues: {
      overview: buildIssueOverview(findings),
      findings
    },
    refactoring: {
      strategy:
        "現行運用を止めずに、まず可視化と安全網を作り、その後に責務分離・データアクセス整理・目標構成への移行を段階実施する戦略が適しています。",
      recommendedApproach:
        "短期はVBA継続リファクタリングまたはAPI分離案を軸にし、画面/業務ロジック/データアクセス/入出力の境界を明確化することを推奨します。",
      goals: [
        "仕様変更時の影響範囲を局所化する",
        "障害時に原因追跡しやすい構造へ変える",
        "SQL・ファイルI/O・帳票出力の散在を止める",
        "将来のAPI化や全面移行に備えたインターフェースを先に作る"
      ],
      alternatives: buildRefactorAlternatives(),
      roadmap,
      diagrams: buildRefactorDiagrams(),
      guardrails: [
        "現行出力との差分比較を毎フェーズで実施する",
        "大きな置換を避け、1ユースケースずつ切り出す",
        "設定値、パス、テーブル名、帳票名の棚卸しを先に行う",
        "Access/Excel利用者の運用フローを変える変更は受け入れ確認後に行う"
      ],
      deliverables: [
        "現状仕様書",
        "問題点分析レポート",
        "詳細リファクタリング案",
        "段階移行用の設計書",
        "回帰確認観点・テスト観点一覧"
      ]
    },
    design: {
      architecture:
        "目標構成では、UIイベントやシート操作から業務ロジックとデータアクセスを分離し、アプリケーションサービスを中心に入出力アダプタとRepositoryを接続する構造を想定します。",
      modules: buildDesignModules(files),
      migrationFlow: roadmap.map((phase) => `${phase.phase}: ${phase.objective}`),
      risks: [
        "現行仕様が暗黙知の場合、抽出した業務ルールに漏れが出やすい",
        "帳票レイアウトやCSV仕様の差分が後半で発覚すると戻りが大きい",
        "Access/Excel運用を残す期間の境界設計が曖昧だと二重保守になる"
      ],
      diagrams: buildDesignDiagrams(tables, endpoints),
      tables: buildDesignTables(tables),
      endpoints: buildDesignEndpoints(endpoints)
    }
  };
}
