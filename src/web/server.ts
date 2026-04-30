import "dotenv/config";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeLegacyCode, loadSampleLegacyCode } from "../legacy-analyzer/analyzer.js";
import { AnalyzerError, type AnalysisDocumentType, type AnalyzerMode, type LegacyAnalysisDocument } from "../legacy-analyzer/types.js";
import { renderAnalysisDocuments } from "./analysisRenderer.js";
import { exportDocumentBuffer } from "./documentExport.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const publicDir = path.join(projectRoot, "public");
const vendorDir = path.join(projectRoot, "node_modules", "mermaid", "dist");
const basePort = Number(process.env.WEB_PORT ?? "3000");
const appId = "legacy-vba-analysis-demo";
const apiVersion = "analysis-json-v3";

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function sendText(response: ServerResponse, statusCode: number, text: string, contentType: string): void {
  response.writeHead(statusCode, {
    "Content-Type": `${contentType}; charset=utf-8`
  });
  response.end(text);
}

function sendBinary(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  fileName: string,
  buffer: Buffer
): void {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Content-Length": String(buffer.length)
  });
  response.end(buffer);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStaticFile(response: ServerResponse, absolutePath: string): Promise<void> {
  const extension = path.extname(absolutePath).toLowerCase();
  const mimeType =
    extension === ".css"
      ? "text/css"
      : extension === ".js"
        ? "text/javascript"
        : "text/html";

  const content = await readFile(absolutePath, "utf8");
  sendText(response, 200, content, mimeType);
}

function normalizeMode(value: unknown): AnalyzerMode {
  if (value === "gemini" || value === "local-demo" || value === "auto") {
    return value;
  }

  return "auto";
}

function normalizeDocumentType(value: unknown): AnalysisDocumentType | null {
  if (value === "spec" || value === "issues" || value === "refactor" || value === "design") {
    return value;
  }

  return null;
}

function normalizeFiles(
  value: unknown
): Array<{
  fileName: string;
  code: string;
}> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const files = value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const fileName =
        typeof (item as { fileName?: unknown }).fileName === "string"
          ? (item as { fileName: string }).fileName.trim()
          : "";
      const code =
        typeof (item as { code?: unknown }).code === "string" ? (item as { code: string }).code : "";

      if (!fileName || !code.trim()) {
        return null;
      }

      return { fileName, code };
    })
    .filter((item): item is { fileName: string; code: string } => Boolean(item));

  return files.length > 0 ? files : undefined;
}

function sanitizeBaseName(sourceName: string): string {
  const baseName = path.parse(sourceName).name || "legacy_document";
  return baseName.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getHttpStatus(error: unknown): number {
  if (error instanceof AnalyzerError) {
    return error.statusCode;
  }

  return 500;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected server error";
}

async function handleApiAnalyze(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const body = (await readJsonBody(request)) as {
      code?: unknown;
      files?: unknown;
      mode?: unknown;
      sourceName?: unknown;
      projectName?: unknown;
    };

    const code = typeof body.code === "string" ? body.code : "";
    const files = normalizeFiles(body.files);
    const sourceName =
      typeof body.sourceName === "string" && body.sourceName.trim()
        ? body.sourceName.trim()
        : files?.[0]?.fileName ?? "uploaded.bas";
    const projectName =
      typeof body.projectName === "string" && body.projectName.trim()
        ? body.projectName.trim()
        : undefined;

    const result = await analyzeLegacyCode({
      code,
      files,
      mode: normalizeMode(body.mode),
      sourceName,
      projectName
    });
    const rendered = renderAnalysisDocuments(result.analysis);

    sendJson(response, 200, {
      sourceName: result.sourceName,
      analysis: result.analysis,
      rendered,
      modeUsed: result.modeUsed,
      notice: result.notice,
      cache: result.cache,
      modelUsage: result.modelUsage
    });
  } catch (error) {
    sendJson(response, getHttpStatus(error), { message: getErrorMessage(error) });
  }
}

async function handleExport(
  request: IncomingMessage,
  response: ServerResponse,
  format: "pdf" | "docx"
): Promise<void> {
  try {
    const body = (await readJsonBody(request)) as {
      analysis?: unknown;
      documentType?: unknown;
      sourceName?: unknown;
    };

    const analysis = body.analysis as LegacyAnalysisDocument | undefined;
    const documentType = normalizeDocumentType(body.documentType);
    const sourceName =
      typeof body.sourceName === "string" && body.sourceName.trim()
        ? body.sourceName.trim()
        : "legacy_document.bas";

    if (!analysis || !documentType) {
      sendJson(response, 400, { message: "出力対象のJSONまたは文書種別が不正です。" });
      return;
    }

    const buffer = await exportDocumentBuffer({
      analysis,
      documentType,
      format
    });

    const suffix =
      documentType === "spec"
        ? "spec"
        : documentType === "issues"
          ? "issues"
          : documentType === "refactor"
            ? "refactor"
            : "design";
    const baseName = sanitizeBaseName(sourceName);
    const fileName = `${baseName}_${suffix}.${format}`;
    const contentType =
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    sendBinary(response, 200, contentType, fileName, buffer);
  } catch (error) {
    sendJson(response, getHttpStatus(error), { message: getErrorMessage(error) });
  }
}

async function requestListener(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, {
        app: appId,
        status: "ok",
        apiVersion
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/sample") {
      const code = await loadSampleLegacyCode();
      sendJson(response, 200, {
        sourceName: "legacy_excel_sales_sample.bas",
        code
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/analyze") {
      await handleApiAnalyze(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/export/pdf") {
      await handleExport(request, response, "pdf");
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/export/word") {
      await handleExport(request, response, "docx");
      return;
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      await serveStaticFile(response, path.join(publicDir, "index.html"));
      return;
    }

    if (request.method === "GET" && (url.pathname === "/styles.css" || url.pathname === "/app.js")) {
      await serveStaticFile(response, path.join(publicDir, path.basename(url.pathname)));
      return;
    }

    if (request.method === "GET" && url.pathname === "/vendor/mermaid.min.js") {
      await serveStaticFile(response, path.join(vendorDir, "mermaid.min.js"));
      return;
    }

    sendJson(response, 404, { message: "Not found" });
  } catch (error) {
    sendJson(response, getHttpStatus(error), {
      message: getErrorMessage(error)
    });
  }
}

const server = createServer((request, response) => {
  void requestListener(request, response);
});

async function isDemoAlreadyRunning(port: number): Promise<boolean> {
  try {
    const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);

    if (healthResponse.ok) {
      const payload = (await healthResponse.json()) as {
        app?: string;
        status?: string;
        apiVersion?: string;
      };
      if (payload.app === appId && payload.status === "ok" && payload.apiVersion === apiVersion) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

async function listenOnFixedPort(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onListening = () => {
      server.off("error", onError);
      const address = server.address() as AddressInfo | null;
      const actualPort = address?.port ?? port;
      console.log(`Web demo is running at http://localhost:${actualPort}`);
      resolve();
    };

    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      server.off("error", onError);

      if (error.code === "EADDRINUSE") {
        void isDemoAlreadyRunning(port)
          .then((running) => {
            if (running) {
              console.log(`Web demo is already running at http://localhost:${port}`);
              resolve();
              return;
            }

            reject(
              new Error(
                `Port ${port} is already in use by another process. Stop that process or change WEB_PORT.`
              )
            );
          })
          .catch(reject);
        return;
      }

      reject(error);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port);
  });
}

listenOnFixedPort(basePort).catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
