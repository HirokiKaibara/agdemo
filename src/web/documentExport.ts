import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  UnderlineType
} from "docx";

import type { AnalysisDocumentType, LegacyAnalysisDocument } from "../legacy-analyzer/types.js";
import { normalizeAnalysisMermaid } from "../legacy-analyzer/mermaidNormalizer.js";
import { renderDesignHtml, renderIssuesHtml, renderRefactorHtml, renderSpecificationHtml } from "./analysisRenderer.js";
import { buildPdfHtmlDocument } from "./pdfTemplate.js";

export type DownloadFormat = "pdf" | "docx";

interface ExportRequest {
  analysis: LegacyAnalysisDocument;
  documentType: AnalysisDocumentType;
  format: DownloadFormat;
}

const defaultFont = process.env.WORD_EXPORT_FONT ?? "Meiryo";
const defaultColor = "23313F";
const pdfEngine = (process.env.PDF_EXPORT_ENGINE ?? "puppeteer").toLowerCase();
const pageWidthTwip = 11906;
const pageMarginTwip = 1134;
const defaultFontConfig = {
  ascii: defaultFont,
  hAnsi: defaultFont,
  eastAsia: defaultFont,
  cs: defaultFont
} as const;

function stripLeadingOrderMarker(value: string): string {
  return value.replace(/^\s*\d+(?:\.\d+)*[\.\)]\s*/u, "").trim();
}

function textRun(text: string, bold = false): TextRun {
  return new TextRun({
    text,
    bold,
    font: defaultFontConfig,
    color: defaultColor,
    size: 22
  });
}

function paragraph(text: string): Paragraph {
  return new Paragraph({
    spacing: {
      after: 120
    },
    children: [textRun(text)]
  });
}

function bulletParagraph(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: {
      after: 100
    },
    children: [textRun(text)]
  });
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({
    heading: level,
    spacing: {
      before: 180,
      after: 120
    },
    children: [textRun(text, true)]
  });
}

function labelParagraph(label: string, value: string): Paragraph {
  return new Paragraph({
    spacing: {
      after: 120
    },
    children: [
      new TextRun({
        text: `${label}: `,
        bold: true,
        underline: {
          type: UnderlineType.SINGLE,
          color: defaultColor
        },
        font: defaultFontConfig,
        color: defaultColor,
        size: 22
      }),
      textRun(value || "該当なし")
    ]
  });
}

function listParagraphs(title: string, items: string[]): Paragraph[] {
  const children = [
    new Paragraph({
      spacing: { before: 100, after: 60 },
      children: [textRun(title, true)]
    })
  ];

  if (items.length === 0) {
    children.push(paragraph("該当なし"));
    return children;
  }

  for (const item of items) {
    children.push(bulletParagraph(item));
  }

  return children;
}

function diagramParagraphs(title: string, diagrams: Array<{ title: string; description: string; mermaid: string }>): Paragraph[] {
  const children = [heading(title, HeadingLevel.HEADING_2)];

  if (diagrams.length === 0) {
    children.push(paragraph("図はありません。"));
    return children;
  }

  for (const diagram of diagrams) {
    children.push(heading(diagram.title, HeadingLevel.HEADING_3));
    children.push(paragraph(diagram.description));
    children.push(paragraph(diagram.mermaid));
  }

  return children;
}

function isRoadmapDiagram(diagram: { title: string }): boolean {
  return /ロードマップ|roadmap/iu.test(diagram.title);
}

function getRefactorDisplayDiagrams(analysis: LegacyAnalysisDocument) {
  return analysis.refactoring.diagrams.filter((diagram) => !isRoadmapDiagram(diagram));
}

function buildSpecDocxSections(analysis: LegacyAnalysisDocument): Paragraph[] {
  const sections: Paragraph[] = [
    heading("1. 現状仕様書", HeadingLevel.HEADING_1),
    labelParagraph("プロジェクト", analysis.projectName),
    labelParagraph("全体概要", analysis.summary),
    heading("現状概要", HeadingLevel.HEADING_2),
    paragraph(analysis.specification.overview),
    heading("読む順番", HeadingLevel.HEADING_2),
    ...analysis.specification.userJourney.map((item) => bulletParagraph(stripLeadingOrderMarker(item))),
    heading("現行フロー", HeadingLevel.HEADING_2)
  ];

  for (const flow of analysis.specification.currentFlows) {
    sections.push(labelParagraph(flow.step, `${flow.detail} / ${flow.actors.join(" / ")}`));
  }

  sections.push(heading("現行機能一覧", HeadingLevel.HEADING_2));

  for (const feature of analysis.specification.features) {
    sections.push(heading(feature.name, HeadingLevel.HEADING_3));
    sections.push(paragraph(feature.description));
    sections.push(...listParagraphs("入力", feature.inputs));
    sections.push(...listParagraphs("出力", feature.outputs));
    sections.push(...listParagraphs("業務ルール", feature.businessRules));
    sections.push(...listParagraphs("関連ファイル", feature.relatedFiles));
  }

  sections.push(...diagramParagraphs("Mermaid図", analysis.specification.diagrams));
  sections.push(heading("テーブル / カラム", HeadingLevel.HEADING_2));

  for (const table of analysis.specification.tables) {
    sections.push(heading(table.name, HeadingLevel.HEADING_3));
    sections.push(labelParagraph("用途", table.usage));
    sections.push(labelParagraph("備考", table.notes));
    sections.push(...listParagraphs("検出カラム", table.columns));
  }

  sections.push(heading("エンドポイント", HeadingLevel.HEADING_2));

  if (analysis.specification.endpoints.length === 0) {
    sections.push(
      paragraph(
        "HTTP/HTTPS の外部API連携はコードから検出されませんでした。Access、CSV、Excelシートの入出力はエンドポイントには含みません。"
      )
    );
  }

  for (const endpoint of analysis.specification.endpoints) {
    sections.push(heading(endpoint.name, HeadingLevel.HEADING_3));
    sections.push(labelParagraph("メソッド", endpoint.method));
    sections.push(labelParagraph("パス / URL", endpoint.path));
    sections.push(labelParagraph("用途", endpoint.purpose));
    sections.push(labelParagraph("信頼度", endpoint.confidence));
  }

  sections.push(heading("対象ファイルと主要手続き", HeadingLevel.HEADING_2));

  for (const file of analysis.targetFiles) {
    sections.push(heading(file.fileName, HeadingLevel.HEADING_3));
    sections.push(labelParagraph("種別", file.objectType));
    sections.push(labelParagraph("役割", file.role));
    sections.push(labelParagraph("概要", file.summary));
    sections.push(...listParagraphs("依存関係", file.dependencies));

    for (const fn of file.mainFunctions) {
      sections.push(heading(fn.name, HeadingLevel.HEADING_4));
      sections.push(paragraph(fn.description));
      sections.push(...listParagraphs("入力", fn.inputs));
      sections.push(...listParagraphs("出力", fn.outputs));
      sections.push(...listParagraphs("処理手順", fn.process));
      sections.push(...listParagraphs("留意点", fn.notes));
    }
  }

  return sections;
}

function buildIssuesDocxSections(analysis: LegacyAnalysisDocument): Paragraph[] {
  const sections: Paragraph[] = [
    heading("2. 問題点分析", HeadingLevel.HEADING_1),
    labelParagraph("プロジェクト", analysis.projectName),
    labelParagraph("分析要約", analysis.issues.overview)
  ];

  for (const issue of analysis.issues.findings) {
    sections.push(heading(`${issue.id} ${issue.title}`, HeadingLevel.HEADING_2));
    sections.push(labelParagraph("重大度", issue.severity));
    sections.push(labelParagraph("優先度", issue.priority));
    sections.push(labelParagraph("分類", issue.category));
    sections.push(labelParagraph("影響", issue.impact));
    sections.push(...listParagraphs("症状", issue.symptoms));
    sections.push(...listParagraphs("根拠", issue.evidence));
    sections.push(...listParagraphs("影響ファイル", issue.affectedFiles));
    sections.push(labelParagraph("推奨アクション", issue.recommendation));
  }

  return sections;
}

function buildRefactorDocxSections(analysis: LegacyAnalysisDocument): Paragraph[] {
  const refactorDiagrams = getRefactorDisplayDiagrams(analysis);
  const sections: Paragraph[] = [
    heading("3. 詳細リファクタリング案", HeadingLevel.HEADING_1),
    labelParagraph("戦略", analysis.refactoring.strategy),
    labelParagraph("推奨方針", analysis.refactoring.recommendedApproach),
    heading("到達目標", HeadingLevel.HEADING_2),
    ...analysis.refactoring.goals.map((goal) => bulletParagraph(goal)),
    heading("代替案", HeadingLevel.HEADING_2)
  ];

  for (const option of analysis.refactoring.alternatives) {
    sections.push(heading(option.name, HeadingLevel.HEADING_3));
    sections.push(paragraph(option.summary));
    sections.push(labelParagraph("適合度", option.fitScore));
    sections.push(labelParagraph("採用条件", option.whenToChoose));
    sections.push(...listParagraphs("候補バージョン", option.targetVersions));
    sections.push(...listParagraphs("長所", option.pros));
    sections.push(...listParagraphs("短所", option.cons));
  }

  if (refactorDiagrams.length > 0) {
    sections.push(...diagramParagraphs("Mermaid図", refactorDiagrams));
  }

  sections.push(heading("段階的ロードマップ", HeadingLevel.HEADING_2));

  for (const [index, phase] of analysis.refactoring.roadmap.entries()) {
    sections.push(heading(`STEP ${index + 1} ${phase.phase}`, HeadingLevel.HEADING_3));
    sections.push(labelParagraph("目的", phase.objective || "該当なし"));
    sections.push(...listParagraphs("実施タスク", phase.tasks));
    sections.push(...listParagraphs("成果物", phase.outputs));
    sections.push(...listParagraphs("検証観点", phase.validations));
    sections.push(...listParagraphs("リスク", phase.risks));
  }

  sections.push(heading("ガードレール", HeadingLevel.HEADING_2));
  sections.push(...analysis.refactoring.guardrails.map((item) => bulletParagraph(item)));
  sections.push(heading("成果物", HeadingLevel.HEADING_2));
  sections.push(...analysis.refactoring.deliverables.map((item) => bulletParagraph(item)));

  return sections;
}

function buildDesignDocxSections(analysis: LegacyAnalysisDocument): Paragraph[] {
  const sections: Paragraph[] = [
    heading("4. リファクタリング設計書", HeadingLevel.HEADING_1),
    labelParagraph("プロジェクト", analysis.projectName),
    labelParagraph("目標アーキテクチャ", analysis.design.architecture),
    ...diagramParagraphs("Mermaid図", analysis.design.diagrams),
    heading("目標モジュール設計", HeadingLevel.HEADING_2)
  ];

  for (const module of analysis.design.modules) {
    sections.push(heading(module.name, HeadingLevel.HEADING_3));
    sections.push(labelParagraph("責務", module.responsibility));
    sections.push(...listParagraphs("関連ファイル", module.relatedFiles));
    sections.push(...listParagraphs("インターフェース", module.interfaces));
    sections.push(...listParagraphs("補足", module.notes));
  }

  sections.push(heading("移行フロー", HeadingLevel.HEADING_2));
  sections.push(...analysis.design.migrationFlow.map((item) => bulletParagraph(item)));
  sections.push(heading("目標テーブル / カラム設計メモ", HeadingLevel.HEADING_2));

  for (const table of analysis.design.tables) {
    sections.push(heading(table.name, HeadingLevel.HEADING_3));
    sections.push(labelParagraph("用途", table.usage));
    sections.push(labelParagraph("備考", table.notes));
    sections.push(...listParagraphs("検出カラム", table.columns));
  }

  sections.push(heading("目標エンドポイント / 外部連携", HeadingLevel.HEADING_2));

  if (analysis.design.endpoints.length === 0) {
    sections.push(
      paragraph(
        "HTTP/HTTPS の外部API連携はコードから検出されませんでした。Access、CSV、Excelシートの入出力はエンドポイントには含みません。"
      )
    );
  }

  for (const endpoint of analysis.design.endpoints) {
    sections.push(heading(endpoint.name, HeadingLevel.HEADING_3));
    sections.push(labelParagraph("メソッド", endpoint.method));
    sections.push(labelParagraph("パス / URL", endpoint.path));
    sections.push(labelParagraph("用途", endpoint.purpose));
    sections.push(labelParagraph("信頼度", endpoint.confidence));
  }

  sections.push(heading("設計上のリスク", HeadingLevel.HEADING_2));
  sections.push(...analysis.design.risks.map((item) => bulletParagraph(item)));

  return sections;
}

async function buildDocxBuffer(analysis: LegacyAnalysisDocument, documentType: AnalysisDocumentType): Promise<Buffer> {
  const normalizedAnalysis = normalizeAnalysisMermaid(analysis);
  const children =
    documentType === "spec"
      ? buildSpecDocxSections(normalizedAnalysis)
      : documentType === "issues"
        ? buildIssuesDocxSections(normalizedAnalysis)
        : documentType === "refactor"
          ? buildRefactorDocxSections(normalizedAnalysis)
          : buildDesignDocxSections(normalizedAnalysis);

  const document = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: defaultFontConfig,
            color: defaultColor,
            size: 22
          }
        },
        heading1: {
          run: { font: defaultFontConfig, color: defaultColor }
        },
        heading2: {
          run: { font: defaultFontConfig, color: defaultColor }
        },
        heading3: {
          run: { font: defaultFontConfig, color: defaultColor }
        },
        heading4: {
          run: { font: defaultFontConfig, color: defaultColor }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: pageWidthTwip
            },
            margin: {
              top: pageMarginTwip,
              right: pageMarginTwip,
              bottom: pageMarginTwip,
              left: pageMarginTwip
            }
          }
        },
        children
      }
    ]
  });

  return Packer.toBuffer(document);
}

function getDocumentTitle(documentType: AnalysisDocumentType): string {
  if (documentType === "spec") {
    return "現状仕様書";
  }

  if (documentType === "issues") {
    return "問題点分析";
  }

  if (documentType === "refactor") {
    return "詳細リファクタリング案";
  }

  return "リファクタリング設計書";
}

function renderDocumentHtml(analysis: LegacyAnalysisDocument, documentType: AnalysisDocumentType): string {
  if (documentType === "spec") {
    return renderSpecificationHtml(analysis);
  }

  if (documentType === "issues") {
    return renderIssuesHtml(analysis);
  }

  if (documentType === "refactor") {
    return renderRefactorHtml(analysis);
  }

  return renderDesignHtml(analysis);
}

async function importOptionalModule(moduleName: string): Promise<any> {
  const importer = new Function("moduleName", "return import(moduleName);") as (
    target: string
  ) => Promise<any>;
  return importer(moduleName);
}

async function waitForMermaid(page: {
  waitForFunction: (fn: () => boolean, options?: { timeout?: number }) => Promise<unknown>;
}): Promise<void> {
  try {
    await page.waitForFunction(() => (globalThis as { __MERMAID_DONE__?: boolean }).__MERMAID_DONE__ === true, {
      timeout: 10000
    });
  } catch {
    return;
  }
}

async function buildPdfBuffer(analysis: LegacyAnalysisDocument, documentType: AnalysisDocumentType): Promise<Buffer> {
  const normalizedAnalysis = normalizeAnalysisMermaid(analysis);
  const title = getDocumentTitle(documentType);
  const html = await buildPdfHtmlDocument(title, renderDocumentHtml(normalizedAnalysis, documentType));

  if (pdfEngine === "playwright") {
    const playwright = await importOptionalModule("playwright");
    const browser = await playwright.chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 60000 });
      await waitForMermaid(page);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const pdfBytes = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true
      });
      return Buffer.from(pdfBytes);
    } finally {
      await browser.close();
    }
  }

  const puppeteerModule = await importOptionalModule("puppeteer");
  const browser = await puppeteerModule.default.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForMermaid(page);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    const pdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true
    });
    return Buffer.from(pdfBytes);
  } finally {
    await browser.close();
  }
}

export async function exportDocumentBuffer(request: ExportRequest): Promise<Buffer> {
  if (request.format === "pdf") {
    return buildPdfBuffer(request.analysis, request.documentType);
  }

  return buildDocxBuffer(request.analysis, request.documentType);
}
