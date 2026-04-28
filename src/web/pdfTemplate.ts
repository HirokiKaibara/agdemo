import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const fontPath = path.join(projectRoot, "assets", "fonts", "NotoSansCJKjp-Regular.otf");
const pdfCssPath = path.join(__dirname, "pdfDocument.css");

let cachedFontDataUrl = "";
let cachedPdfCss = "";

async function loadFontDataUrl(): Promise<string> {
  if (!cachedFontDataUrl) {
    const fontBytes = await readFile(fontPath);
    cachedFontDataUrl = `data:font/otf;base64,${fontBytes.toString("base64")}`;
  }

  return cachedFontDataUrl;
}

async function loadPdfCss(): Promise<string> {
  if (!cachedPdfCss) {
    cachedPdfCss = await readFile(pdfCssPath, "utf8");
  }

  return cachedPdfCss;
}

export async function buildPdfHtmlDocument(title: string, bodyHtml: string): Promise<string> {
  const fontDataUrl = await loadFontDataUrl();
  const pdfCss = await loadPdfCss();
  const fontFace = `
    @font-face {
      font-family: "DemoNotoSansJP";
      src: url("${fontDataUrl}") format("opentype");
      font-weight: 400;
      font-style: normal;
      font-display: block;
    }
  `.trim();

  return `
    <!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${title}</title>
        <style>${fontFace}\n${pdfCss}</style>
      </head>
      <body>
        <main>
          ${bodyHtml}
        </main>
      </body>
    </html>
  `.trim();
}
