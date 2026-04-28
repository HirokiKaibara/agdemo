import path from "node:path";

import { extractProcedureBlocks } from "./codeUnits.js";
import type {
  LegacyAnalysisDocument,
  LegacyFileSummary,
  LegacyFunctionSummary,
  NormalizedSourceFile,
  ProcedureBlock
} from "./types.js";

function collectMatches(source: string, regex: RegExp): string[] {
  const values = new Set<string>();

  for (const match of source.matchAll(regex)) {
    const value = match[1]?.trim();

    if (value) {
      values.add(value);
    }
  }

  return [...values];
}

function detectFeatures(code: string): string[] {
  const features: string[] = [];

  if (/Workbooks\.Open/i.test(code) || /売上一覧/.test(code)) {
    features.push("売上一覧の読込");
  }
  if (/顧客/.test(code)) {
    features.push("顧客情報の参照");
  }
  if (/商品/.test(code)) {
    features.push("商品情報の参照");
  }
  if (/tax|消費税|TaxRate/i.test(code)) {
    features.push("金額計算と消費税計算");
  }
  if (/請求書/.test(code)) {
    features.push("請求書作成");
  }
  if (/月次集計/.test(code)) {
    features.push("月次売上集計");
  }
  if (/\.csv/i.test(code) || /Open .* For Append/i.test(code)) {
    features.push("CSV出力");
  }
  if (/PrintPreview|PrintOut/i.test(code)) {
    features.push("印刷プレビュー");
  }
  if (/CurrentDb|\.Execute/i.test(code)) {
    features.push("売上実績・請求履歴・月次集計の更新");
  }

  return features;
}

function detectInputCandidates(code: string): string[] {
  const values: string[] = [];

  if (/売上一覧/.test(code)) {
    values.push("売上一覧シートまたは売上一覧CSV");
  }
  if (/顧客/.test(code)) {
    values.push("顧客マスタ");
  }
  if (/商品/.test(code)) {
    values.push("商品マスタ");
  }
  if (values.length === 0) {
    values.push("入力データは要確認");
  }

  return values;
}

function detectOutputCandidates(code: string): string[] {
  const values: string[] = [];

  if (/請求書/.test(code)) {
    values.push("請求書シート");
  }
  if (/月次集計/.test(code)) {
    values.push("月次集計シート");
  }
  if (/\.csv/i.test(code) || /Open .* For Append/i.test(code)) {
    values.push("売上出力CSV");
  }
  if (/CurrentDb|\.Execute/i.test(code)) {
    values.push("売上実績・請求履歴・月次集計テーブル");
  }
  if (values.length === 0) {
    values.push("出力先は要確認");
  }

  return values;
}

function summarizeProcedureFromCode(procedure: ProcedureBlock, file: NormalizedSourceFile): LegacyFunctionSummary {
  if (procedure.name === "売上請求作成") {
    return {
      name: procedure.name,
      description: "売上データを取り込み、顧客・商品情報を参照し、請求書作成、CSV出力、月次集計、更新処理まで実行する主処理です。",
      inputs: ["売上一覧シートまたは売上一覧CSV", "顧客マスタ", "商品マスタ"],
      outputs: ["請求書シート", "月次集計シート", "売上出力CSV", "売上実績・請求履歴・月次集計テーブル"],
      process: [
        "売上一覧CSVの有無を確認し、存在すれば一覧シートへ取り込みます。",
        "売上一覧を1件ずつ処理し、顧客情報と商品情報を参照します。",
        "数量・単価から金額、消費税、税込金額を算出します。",
        "請求書シートへの転記、CSV出力、月次集計更新、DB更新を行います。"
      ],
      notes: [
        "特価時の値引き、印刷条件、高額売上時の確認メッセージがあります。",
        "画面操作、計算、出力、更新処理が同一手続きに集中しています。"
      ]
    };
  }

  if (procedure.name === "顧客ランク取得") {
    return {
      name: procedure.name,
      description: "顧客コードをもとに顧客マスタを検索し、顧客ランクを返す処理です。",
      inputs: ["顧客コード", "顧客マスタ"],
      outputs: ["顧客ランク"],
      process: [
        "顧客シートを走査して対象顧客を検索します。",
        "一致した行のランク列を返します。",
        "見つからない場合は通常ランクを返します。"
      ],
      notes: ["顧客マスタの列定義は要確認です。"]
    };
  }

  if (procedure.name === "売上チェック") {
    return {
      name: procedure.name,
      description: "売上明細の数量と単価から計算した金額と、一覧上の金額を比較して不一致をチェックする処理です。",
      inputs: ["売上一覧シート"],
      outputs: ["チェック結果列への不一致表示"],
      process: [
        "売上一覧の最終行まで走査します。",
        "数量と単価から金額を計算します。",
        "一覧上の金額と一致しない場合は金額不一致を記録します。"
      ],
      notes: ["チェック対象列の正式定義は要確認です。"]
    };
  }

  return {
    name: procedure.name,
    description: `${path.parse(file.fileName).name} 内の処理です。内容の詳細は追加確認が必要です。`,
    inputs: detectInputCandidates(procedure.code),
    outputs: detectOutputCandidates(procedure.code),
    process: [
      "入力データを参照します。",
      "条件判定または計算処理を行います。",
      "結果を画面、シート、または外部出力へ反映します。"
    ],
    notes: ["詳細仕様はコード全体と運用ルールを合わせて確認する必要があります。"]
  };
}

function summarizeFile(file: NormalizedSourceFile): LegacyFileSummary {
  const procedures = extractProcedureBlocks(file);
  const features = detectFeatures(file.code);

  return {
    fileName: file.fileName,
    role: "売上請求作成と月次集計を担当する販売管理処理",
    summary:
      features.length > 0
        ? `売上データの読込から、顧客・商品参照、請求書作成、集計、出力、更新までをまとめて処理する構成です。主な機能は ${features.join("、")} です。`
        : "売上関連の処理をまとめて実行するモジュールです。",
    mainFunctions: procedures.slice(0, 8).map((procedure) => summarizeProcedureFromCode(procedure, file))
  };
}

export function generateLocalDemoAnalysis(
  files: NormalizedSourceFile[],
  projectName: string
): LegacyAnalysisDocument {
  const targetFiles = files.map((file) => summarizeFile(file));
  const allFeatures = [...new Set(files.flatMap((file) => detectFeatures(file.code)))];
  const firstCode = files[0]?.code ?? "";
  const tables = collectMatches(
    firstCode,
    /\b(?:UPDATE|INTO|FROM|DELETE\s+FROM)\s+([A-Za-z0-9_\u3040-\u30ff\u4e00-\u9faf]+)/gi
  );

  return {
    projectName,
    summary:
      "売上一覧を起点に、顧客・商品情報の参照、請求書作成、CSV出力、月次集計、更新処理までを一括で行う販売管理処理です。",
    targetFiles,
    specification: {
      overview:
        "売上データを読み込み、請求書作成と月次集計を行い、あわせて出力ファイルや更新処理へ反映する販売管理業務の仕様書要約です。",
      features:
        allFeatures.length > 0
          ? allFeatures.map((feature) => ({
              name: feature,
              description: `${feature} を行う処理が含まれています。`,
              inputs: detectInputCandidates(firstCode),
              outputs: detectOutputCandidates(firstCode),
              businessRules: [
                "顧客マスタや商品マスタの内容に応じて処理結果が変わる可能性があります。",
                "正式な条件や列定義は業務確認が必要です。"
              ]
            }))
          : [
              {
                name: "主要機能",
                description: "販売管理に関する一連の処理が含まれている可能性があります。",
                inputs: ["要確認"],
                outputs: ["要確認"],
                businessRules: ["要確認"]
              }
            ]
    },
    design: {
      architecture:
        "売上取込、マスタ参照、金額計算、請求書作成、CSV出力、月次集計、更新処理が1つの処理群に集約された構成です。",
      modules: targetFiles.map((file) => ({
        name: path.parse(file.fileName).name,
        responsibility: file.role,
        relatedFiles: [file.fileName]
      })),
      dataFlow: [
        "売上一覧を読み込みます。",
        "顧客マスタと商品マスタを参照して必要情報を補完します。",
        "金額、税額、税込金額を算出します。",
        "請求書、CSV、月次集計、更新テーブルへ結果を反映します。"
      ],
      risks: [
        "画面操作、業務ロジック、出力、更新処理が密結合しています。",
        "エラー処理が簡略化されており、異常時の追跡が難しい可能性があります。",
        tables.length > 0
          ? `更新対象として ${tables.join("、")} が使われている可能性があります。`
          : "更新対象テーブルの正式名称は要確認です。"
      ]
    }
  };
}
