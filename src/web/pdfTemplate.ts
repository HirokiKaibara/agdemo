import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const fontPath = path.join(projectRoot, "assets", "fonts", "NotoSansCJKjp-Regular.otf");
const pdfCssPath = path.join(__dirname, "pdfDocument.css");
const mermaidRuntimePath = path.join(projectRoot, "node_modules", "mermaid", "dist", "mermaid.min.js");

let cachedFontDataUrl = "";
let cachedPdfCss = "";
let cachedMermaidRuntime = "";

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

async function loadMermaidRuntime(): Promise<string> {
  if (!cachedMermaidRuntime) {
    try {
      cachedMermaidRuntime = await readFile(mermaidRuntimePath, "utf8");
    } catch {
      cachedMermaidRuntime = "";
    }
  }

  return cachedMermaidRuntime;
}

export async function buildPdfHtmlDocument(title: string, bodyHtml: string): Promise<string> {
  const fontDataUrl = await loadFontDataUrl();
  const pdfCss = await loadPdfCss();
  const mermaidRuntime = await loadMermaidRuntime();
  const fontFace = `
    @font-face {
      font-family: "DemoNotoSansJP";
      src: url("${fontDataUrl}") format("opentype");
      font-weight: 400;
      font-style: normal;
      font-display: block;
    }
  `.trim();
  const mermaidBootstrap = mermaidRuntime
    ? `
        <script>${mermaidRuntime}</script>
        <script>
          globalThis.__MERMAID_DONE__ = false;
          window.addEventListener("DOMContentLoaded", async () => {
            const nodes = document.querySelectorAll(".mermaid");

            if (!nodes.length || !globalThis.mermaid) {
              globalThis.__MERMAID_DONE__ = true;
              return;
            }

            try {
              globalThis.mermaid.initialize({
                startOnLoad: false,
                securityLevel: "loose",
                theme: "neutral",
                flowchart: { useMaxWidth: true, htmlLabels: true },
                gantt: {
                  leftPadding: 180,
                  rightPadding: 32,
                  gridLineStartPadding: 160,
                  topPadding: 48,
                  barHeight: 26,
                  barGap: 8,
                  fontSize: 13,
                  sectionFontSize: 13
                }
              });
              await globalThis.mermaid.run({ nodes });
            } catch (error) {
              console.error(error);
            } finally {
              globalThis.__MERMAID_DONE__ = true;
            }
          });
        </script>
      `.trim()
    : `<script>globalThis.__MERMAID_DONE__ = true;</script>`;

  return `
    <!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${title}</title>
        <style>${fontFace}\n${pdfCss}</style>
        ${mermaidBootstrap}
      </head>
      <body>
        <main>
          ${bodyHtml}
        </main>
      </body>
    </html>
  `.trim();
}
