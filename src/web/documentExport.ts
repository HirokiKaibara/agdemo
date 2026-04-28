import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  UnderlineType
} from "docx";

import type { AnalysisDocumentType, LegacyAnalysisDocument } from "../legacy-analyzer/types.js";
import { renderDesignHtml, renderSpecificationHtml } from "./analysisRenderer.js";
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
      textRun(value)
    ]
  });
}

function listParagraphs(title: string, items: string[]): Paragraph[] {
  const paragraphs = [
    new Paragraph({
      spacing: { before: 100, after: 60 },
      children: [textRun(title, true)]
    })
  ];

  if (items.length === 0) {
    paragraphs.push(paragraph("該当なし"));
    return paragraphs;
  }

  for (const item of items) {
    paragraphs.push(bulletParagraph(item));
  }

  return paragraphs;
}

function buildSpecDocxSections(analysis: LegacyAnalysisDocument): Paragraph[] {
  const sections: Paragraph[] = [
    heading("簡易仕様書", HeadingLevel.HEADING_1),
    labelParagraph("プロジェクト", analysis.projectName),
    labelParagraph("要約", analysis.summary),
    heading("概要", HeadingLevel.HEADING_2),
    paragraph(analysis.specification.overview),
    heading("対象ファイル", HeadingLevel.HEADING_2),
    heading("主な機能", HeadingLevel.HEADING_2),
    heading("ファイル別の主要関数", HeadingLevel.HEADING_2)
  ];

  for (const file of analysis.targetFiles) {
    sections.push(heading(file.fileName, HeadingLevel.HEADING_3));
    sections.push(labelParagraph("役割", file.role));
    sections.push(labelParagraph("要約", file.summary));
  }

  for (const feature of analysis.specification.features) {
    sections.push(heading(feature.name, HeadingLevel.HEADING_3));
    sections.push(paragraph(feature.description));
    sections.push(...listParagraphs("入力", feature.inputs));
    sections.push(...listParagraphs("出力", feature.outputs));
    sections.push(...listParagraphs("業務ルール候補", feature.businessRules));
  }

  sections.push(heading("主要関数一覧", HeadingLevel.HEADING_2));

  for (const file of analysis.targetFiles) {
    sections.push(heading(file.fileName, HeadingLevel.HEADING_3));

    for (const fn of file.mainFunctions) {
      sections.push(heading(fn.name, HeadingLevel.HEADING_4));
      sections.push(paragraph(fn.description));
      sections.push(...listParagraphs("入力", fn.inputs));
      sections.push(...listParagraphs("出力", fn.outputs));
      sections.push(...listParagraphs("処理概要", fn.process));
      sections.push(...listParagraphs("注意点", fn.notes));
    }
  }

  return sections;
}

function buildDesignDocxSections(analysis: LegacyAnalysisDocument): Paragraph[] {
  const sections: Paragraph[] = [
    heading("簡易設計書", HeadingLevel.HEADING_1),
    labelParagraph("プロジェクト", analysis.projectName),
    labelParagraph("要約", analysis.summary),
    heading("アーキテクチャ", HeadingLevel.HEADING_2),
    paragraph(analysis.design.architecture),
    heading("モジュール一覧", HeadingLevel.HEADING_2)
  ];

  for (const module of analysis.design.modules) {
    sections.push(heading(module.name, HeadingLevel.HEADING_3));
    sections.push(labelParagraph("責務", module.responsibility));
    sections.push(labelParagraph("関連ファイル", module.relatedFiles.join(" / ") || "該当なし"));
  }

  sections.push(heading("データフロー", HeadingLevel.HEADING_2));

  for (const item of analysis.design.dataFlow) {
    sections.push(bulletParagraph(item));
  }

  sections.push(heading("リスク・注意点", HeadingLevel.HEADING_2));

  for (const item of analysis.design.risks) {
    sections.push(bulletParagraph(item));
  }

  sections.push(heading("対象ファイルとの対応", HeadingLevel.HEADING_2));

  for (const file of analysis.targetFiles) {
    sections.push(heading(file.fileName, HeadingLevel.HEADING_3));
    sections.push(labelParagraph("役割", file.role));
    sections.push(labelParagraph("要約", file.summary));
  }

  return sections;
}

async function buildDocxBuffer(analysis: LegacyAnalysisDocument, documentType: AnalysisDocumentType): Promise<Buffer> {
  const children =
    documentType === "spec" ? buildSpecDocxSections(analysis) : buildDesignDocxSections(analysis);

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
          run: {
            font: defaultFontConfig,
            color: defaultColor
          }
        },
        heading2: {
          run: {
            font: defaultFontConfig,
            color: defaultColor
          }
        },
        heading3: {
          run: {
            font: defaultFontConfig,
            color: defaultColor
          }
        },
        heading4: {
          run: {
            font: defaultFontConfig,
            color: defaultColor
          }
        }
      }
    },
    numbering: {
      config: [
        {
          reference: "legacy-numbered",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.START
            }
          ]
        }
      ]
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
  return documentType === "spec" ? "簡易仕様書" : "簡易設計書";
}

function renderDocumentHtml(analysis: LegacyAnalysisDocument, documentType: AnalysisDocumentType): string {
  return documentType === "spec" ? renderSpecificationHtml(analysis) : renderDesignHtml(analysis);
}

async function importOptionalModule(moduleName: string): Promise<any> {
  const importer = new Function("moduleName", "return import(moduleName);") as (
    target: string
  ) => Promise<any>;
  return importer(moduleName);
}

async function buildPdfBuffer(analysis: LegacyAnalysisDocument, documentType: AnalysisDocumentType): Promise<Buffer> {
  const title = getDocumentTitle(documentType);
  const html = await buildPdfHtmlDocument(title, renderDocumentHtml(analysis, documentType));

  if (pdfEngine === "playwright") {
    const playwright = await importOptionalModule("playwright");
    const browser = await playwright.chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "domcontentloaded" });
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
    await page.setContent(html, { waitUntil: "domcontentloaded" });
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
