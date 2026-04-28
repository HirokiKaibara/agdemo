import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GoogleGenAI } from "@google/genai";

import { buildHash, readCachedArtifact, writeCachedArtifact } from "./cacheStore.js";
import { extractProcedureBlocks, inferProjectName, normalizeSourceFiles } from "./codeUnits.js";
import { generateLocalDemoAnalysis } from "./localDemoGenerator.js";
import {
  COMMON_RULES,
  FILE_SUMMARY_SCHEMA,
  FUNCTION_SUMMARY_SCHEMA,
  PROJECT_ANALYSIS_SCHEMA,
  buildFileSummaryPrompt,
  buildFunctionSummaryPrompt,
  buildProjectAnalysisPrompt
} from "./prompts.js";
import type {
  AnalyzeRequest,
  AnalyzeResult,
  CachedArtifact,
  LegacyAnalysisDocument,
  LegacyFileSummary,
  LegacyFunctionSummary
} from "./types.js";
import { AnalyzerError } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const samplePath = path.join(projectRoot, "samples", "legacy_excel_sales_sample.bas");
const RETRYABLE_ERROR_PATTERNS = ['"code":503', '"status":"UNAVAILABLE"', "high demand"];
const DEFAULT_MAIN_MODEL = "gemini-2.5-flash";
const DEFAULT_LIGHT_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_PRO_MODEL = "gemini-2.5-pro";

interface ModelConfig {
  mainModel: string;
  lightModel: string;
  proModel: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('"code":429') || message.includes("RESOURCE_EXHAUSTED");
}

function normalizeJsonText(text: string): string {
  const trimmed = text.trim();

  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }

  return trimmed;
}

function parseJsonResponse<T>(text: string): T {
  return JSON.parse(normalizeJsonText(text)) as T;
}

function getModelConfig(): ModelConfig {
  return {
    mainModel: process.env.GEMINI_MAIN_MODEL ?? process.env.GEMINI_MODEL ?? DEFAULT_MAIN_MODEL,
    lightModel: process.env.GEMINI_LIGHT_MODEL ?? DEFAULT_LIGHT_MODEL,
    proModel: process.env.GEMINI_PRO_MODEL ?? DEFAULT_PRO_MODEL
  };
}

async function generateJsonWithRetry<T>(
  ai: GoogleGenAI,
  model: string,
  prompt: string,
  schema: object
): Promise<T> {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: COMMON_RULES,
          temperature: 0.1,
          responseMimeType: "application/json",
          responseJsonSchema: schema
        }
      });

      const rawText = String(response.text ?? "").trim();

      if (!rawText) {
        throw new Error("Model response was empty.");
      }

      return parseJsonResponse<T>(rawText);
    } catch (error) {
      if (isQuotaError(error)) {
        throw new AnalyzerError("Gemini API の利用制限に達しました。時間をおいて再実行してください。", 429);
      }

      const retryable = isRetryableError(error);

      if (!retryable || attempt === maxAttempts) {
        const message = error instanceof Error ? error.message : String(error);
        throw new AnalyzerError(`Gemini API の解析に失敗しました。${message}`, 502);
      }

      await sleep(attempt * 1500);
    }
  }

  throw new AnalyzerError("Gemini API の解析に失敗しました。", 502);
}

async function summarizeProcedure(
  ai: GoogleGenAI,
  model: string,
  fileName: string,
  procedureName: string,
  procedureCode: string,
  hash: string
): Promise<LegacyFunctionSummary> {
  const cached = await readCachedArtifact<LegacyFunctionSummary>("function-summaries", hash);

  if (cached) {
    return cached.data;
  }

  const prompt = buildFunctionSummaryPrompt(fileName, procedureName, procedureCode);
  const data = await generateJsonWithRetry<LegacyFunctionSummary>(ai, model, prompt, FUNCTION_SUMMARY_SCHEMA);

  const artifact: CachedArtifact<LegacyFunctionSummary> = {
    hash,
    createdAt: new Date().toISOString(),
    model,
    data
  };
  await writeCachedArtifact("function-summaries", artifact);

  return data;
}

async function summarizeFile(
  ai: GoogleGenAI,
  model: string,
  fileName: string,
  fileCode: string,
  fileHash: string,
  functionSummaries: LegacyFunctionSummary[]
): Promise<LegacyFileSummary> {
  const cached = await readCachedArtifact<LegacyFileSummary>("file-summaries", fileHash);

  if (cached) {
    return cached.data;
  }

  const prompt = buildFileSummaryPrompt(fileName, fileCode, functionSummaries);
  const data = await generateJsonWithRetry<LegacyFileSummary>(ai, model, prompt, FILE_SUMMARY_SCHEMA);

  const artifact: CachedArtifact<LegacyFileSummary> = {
    hash: fileHash,
    createdAt: new Date().toISOString(),
    model,
    data
  };
  await writeCachedArtifact("file-summaries", artifact);

  return data;
}

async function buildProjectAnalysis(
  ai: GoogleGenAI,
  model: string,
  projectName: string,
  fileSummaries: LegacyFileSummary[]
): Promise<{ analysis: LegacyAnalysisDocument; hash: string; reused: boolean }> {
  const projectHash = buildHash(projectName, JSON.stringify(fileSummaries));
  const cached = await readCachedArtifact<LegacyAnalysisDocument>("project-analyses", projectHash);

  if (cached) {
    return {
      analysis: cached.data,
      hash: projectHash,
      reused: true
    };
  }

  const prompt = buildProjectAnalysisPrompt(projectName, fileSummaries);
  const analysis = await generateJsonWithRetry<LegacyAnalysisDocument>(
    ai,
    model,
    prompt,
    PROJECT_ANALYSIS_SCHEMA
  );

  const artifact: CachedArtifact<LegacyAnalysisDocument> = {
    hash: projectHash,
    createdAt: new Date().toISOString(),
    model,
    data: analysis
  };
  await writeCachedArtifact("project-analyses", artifact);

  return {
    analysis,
    hash: projectHash,
    reused: false
  };
}

async function generateWithGemini(request: AnalyzeRequest): Promise<AnalyzeResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new AnalyzerError("Missing required environment variable: GEMINI_API_KEY", 500);
  }

  const files = normalizeSourceFiles(request);
  const projectName = inferProjectName(files, request.projectName);
  const modelConfig = getModelConfig();
  const ai = new GoogleGenAI({ apiKey });

  const fileSummaries: LegacyFileSummary[] = [];

  for (const file of files) {
    const procedures = extractProcedureBlocks(file);
    const functionSummaries: LegacyFunctionSummary[] = [];

    for (const procedure of procedures) {
      const summary = await summarizeProcedure(
        ai,
        modelConfig.lightModel,
        file.fileName,
        procedure.name,
        procedure.code,
        procedure.hash
      );
      functionSummaries.push(summary);
    }

    const fileSummary = await summarizeFile(
      ai,
      modelConfig.mainModel,
      file.fileName,
      file.code,
      file.hash,
      functionSummaries
    );
    fileSummaries.push(fileSummary);
  }

  const project = await buildProjectAnalysis(ai, modelConfig.mainModel, projectName, fileSummaries);
  const primarySource = files[0]?.fileName ?? request.sourceName ?? "uploaded.bas";

  return {
    analysis: project.analysis,
    modeUsed: "gemini",
    sourceName: primarySource,
    cache: {
      projectHash: project.hash,
      reused: project.reused
    },
    modelUsage: modelConfig
  };
}

function generateLocalResult(request: AnalyzeRequest, notice?: string): AnalyzeResult {
  const files = normalizeSourceFiles(request);
  const projectName = inferProjectName(files, request.projectName);
  const analysis = generateLocalDemoAnalysis(files, projectName);
  const primarySource = files[0]?.fileName ?? request.sourceName ?? "uploaded.bas";

  return {
    analysis,
    modeUsed: "local-demo",
    sourceName: primarySource,
    notice,
    cache: {
      projectHash: buildHash(projectName, JSON.stringify(files.map((file) => file.hash))),
      reused: false
    },
    modelUsage: getModelConfig()
  };
}

export async function analyzeLegacyCode(request: AnalyzeRequest): Promise<AnalyzeResult> {
  const mode = request.mode ?? "auto";

  if (mode === "local-demo") {
    return generateLocalResult(request, "Gemini API を使わず、ローカル簡易解析で生成しました。");
  }

  if (mode === "gemini") {
    return generateWithGemini(request);
  }

  try {
    return await generateWithGemini(request);
  } catch (error) {
    const notice =
      error instanceof Error
        ? `Gemini API が利用できなかったため、ローカル簡易解析へ切り替えました。${error.message}`
        : "Gemini API が利用できなかったため、ローカル簡易解析へ切り替えました。";

    return generateLocalResult(request, notice);
  }
}

export async function loadSampleLegacyCode(): Promise<string> {
  return readFile(samplePath, "utf8");
}
