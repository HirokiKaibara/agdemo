import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GoogleGenAI } from "@google/genai";

import { buildHash, readCachedArtifact, writeCachedArtifact } from "./cacheStore.js";
import { extractProcedureBlocks, inferProjectName, normalizeSourceFiles } from "./codeUnits.js";
import { localizeDesignSchemaToJapanese } from "./designSchemaLocalizer.js";
import { applyReadableDiagramOverrides } from "./diagramRefiner.js";
import { normalizeAnalysisMermaid } from "./mermaidNormalizer.js";
import { applyCodeTableReferences, extractCodeTableReferences } from "./tableReferenceExtractor.js";
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
const DEFAULT_RETRY_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_DELAY_MS = 2000;
const DEFAULT_RETRY_MAX_DELAY_MS = 15000;

interface ModelConfig {
  mainModel: string;
  lightModel: string;
  proModel?: string;
  projectModel: string;
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

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const rawValue = process.env[name]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number(rawValue);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function getModelConfig(): ModelConfig {
  const mainModel = process.env.GEMINI_MAIN_MODEL ?? process.env.GEMINI_MODEL ?? DEFAULT_MAIN_MODEL;
  const lightModel = process.env.GEMINI_LIGHT_MODEL ?? DEFAULT_LIGHT_MODEL;
  const proModel = readOptionalEnv("GEMINI_PRO_MODEL");
  const projectModel = readOptionalEnv("GEMINI_PROJECT_MODEL") ?? mainModel;

  return {
    mainModel,
    lightModel,
    proModel,
    projectModel
  };
}

function calculateRetryDelay(attempt: number): number {
  const baseDelay = parsePositiveIntegerEnv("GEMINI_RETRY_BASE_DELAY_MS", DEFAULT_RETRY_BASE_DELAY_MS);
  const maxDelay = parsePositiveIntegerEnv("GEMINI_RETRY_MAX_DELAY_MS", DEFAULT_RETRY_MAX_DELAY_MS);
  const exponentialDelay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
  const jitter = Math.floor(Math.random() * 500);
  return exponentialDelay + jitter;
}

function uniqueModels(models: Array<string | undefined>): string[] {
  return [...new Set(models.map((model) => model?.trim()).filter(Boolean) as string[])];
}

async function generateJsonWithRetry<T>(
  ai: GoogleGenAI,
  model: string,
  prompt: string,
  schema: object
): Promise<T> {
  const maxAttempts = parsePositiveIntegerEnv("GEMINI_RETRY_MAX_ATTEMPTS", DEFAULT_RETRY_ATTEMPTS);

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

      await sleep(calculateRetryDelay(attempt));
    }
  }

  throw new AnalyzerError("Gemini API の解析に失敗しました。", 502);
}

async function generateJsonWithModelFallback<T>(
  ai: GoogleGenAI,
  models: string[],
  prompt: string,
  schema: object
): Promise<{ data: T; usedModel: string }> {
  let lastError: unknown;

  for (const model of uniqueModels(models)) {
    try {
      const data = await generateJsonWithRetry<T>(ai, model, prompt, schema);
      return {
        data,
        usedModel: model
      };
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new AnalyzerError("Gemini API の解析に失敗しました。", 502);
}

async function summarizeProcedure(
  ai: GoogleGenAI,
  models: string[],
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
  const { data, usedModel } = await generateJsonWithModelFallback<LegacyFunctionSummary>(
    ai,
    models,
    prompt,
    FUNCTION_SUMMARY_SCHEMA
  );

  const artifact: CachedArtifact<LegacyFunctionSummary> = {
    hash,
    createdAt: new Date().toISOString(),
    model: usedModel,
    data
  };
  await writeCachedArtifact("function-summaries", artifact);

  return data;
}

async function summarizeFile(
  ai: GoogleGenAI,
  models: string[],
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
  const { data, usedModel } = await generateJsonWithModelFallback<LegacyFileSummary>(
    ai,
    models,
    prompt,
    FILE_SUMMARY_SCHEMA
  );

  const artifact: CachedArtifact<LegacyFileSummary> = {
    hash: fileHash,
    createdAt: new Date().toISOString(),
    model: usedModel,
    data
  };
  await writeCachedArtifact("file-summaries", artifact);

  return data;
}

async function buildProjectAnalysis(
  ai: GoogleGenAI,
  models: string[],
  projectName: string,
  fileSummaries: LegacyFileSummary[]
): Promise<{ analysis: LegacyAnalysisDocument; hash: string; reused: boolean; usedModel: string }> {
  const projectHash = buildHash(projectName, JSON.stringify(fileSummaries));
  const cached = await readCachedArtifact<LegacyAnalysisDocument>("project-analyses", projectHash);

  if (cached) {
    return {
      analysis: cached.data,
      hash: projectHash,
      reused: true,
      usedModel: cached.model
    };
  }

  const prompt = buildProjectAnalysisPrompt(projectName, fileSummaries);
  const { data: analysis, usedModel } = await generateJsonWithModelFallback<LegacyAnalysisDocument>(
    ai,
    models,
    prompt,
    PROJECT_ANALYSIS_SCHEMA
  );

  const artifact: CachedArtifact<LegacyAnalysisDocument> = {
    hash: projectHash,
    createdAt: new Date().toISOString(),
    model: usedModel,
    data: analysis
  };
  await writeCachedArtifact("project-analyses", artifact);

  return {
    analysis,
    hash: projectHash,
    reused: false,
    usedModel
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
  const functionModelCandidates = uniqueModels([modelConfig.lightModel, modelConfig.mainModel]);
  const fileModelCandidates = uniqueModels([modelConfig.mainModel, modelConfig.lightModel]);
  const projectModelCandidates = uniqueModels([
    modelConfig.projectModel,
    modelConfig.mainModel,
    modelConfig.lightModel
  ]);

  const fileSummaries: LegacyFileSummary[] = [];

  for (const file of files) {
    const procedures = extractProcedureBlocks(file);
    const functionSummaries: LegacyFunctionSummary[] = [];

    for (const procedure of procedures) {
      const summary = await summarizeProcedure(
        ai,
        functionModelCandidates,
        file.fileName,
        procedure.name,
        procedure.code,
        procedure.hash
      );
      functionSummaries.push(summary);
    }

    const fileSummary = await summarizeFile(
      ai,
      fileModelCandidates,
      file.fileName,
      file.code,
      file.hash,
      functionSummaries
    );
    fileSummaries.push(fileSummary);
  }

  const project = await buildProjectAnalysis(ai, projectModelCandidates, projectName, fileSummaries);
  const primarySource = files[0]?.fileName ?? request.sourceName ?? "uploaded.bas";
  const readableAnalysis = applyReadableDiagramOverrides(project.analysis);
  const normalizedAnalysis = normalizeAnalysisMermaid(readableAnalysis);
  const localizedDesignAnalysis = localizeDesignSchemaToJapanese(normalizedAnalysis);
  const codeTableReferences = extractCodeTableReferences(files);
  const analysisWithCodeTables = applyCodeTableReferences(localizedDesignAnalysis, codeTableReferences);

  return {
    analysis: analysisWithCodeTables,
    modeUsed: "gemini",
    sourceName: primarySource,
    cache: {
      projectHash: project.hash,
      reused: project.reused
    },
    modelUsage: {
      ...modelConfig,
      projectModel: project.usedModel
    }
  };
}

export async function analyzeLegacyCode(request: AnalyzeRequest): Promise<AnalyzeResult> {
  return generateWithGemini(request);
}

export async function loadSampleLegacyCode(): Promise<string> {
  return readFile(samplePath, "utf8");
}
