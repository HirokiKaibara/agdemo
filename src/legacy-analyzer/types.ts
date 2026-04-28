export type AnalyzerMode = "auto" | "gemini" | "local-demo";

export type AnalysisDocumentType = "spec" | "design";

export interface LegacyFunctionSummary {
  name: string;
  description: string;
  inputs: string[];
  outputs: string[];
  process: string[];
  notes: string[];
}

export interface LegacyFileSummary {
  fileName: string;
  role: string;
  summary: string;
  mainFunctions: LegacyFunctionSummary[];
}

export interface LegacySpecificationFeature {
  name: string;
  description: string;
  inputs: string[];
  outputs: string[];
  businessRules: string[];
}

export interface LegacyDesignModule {
  name: string;
  responsibility: string;
  relatedFiles: string[];
}

export interface LegacyAnalysisDocument {
  projectName: string;
  summary: string;
  targetFiles: LegacyFileSummary[];
  specification: {
    overview: string;
    features: LegacySpecificationFeature[];
  };
  design: {
    architecture: string;
    modules: LegacyDesignModule[];
    dataFlow: string[];
    risks: string[];
  };
}

export interface SourceFileInput {
  fileName: string;
  code: string;
}

export interface NormalizedSourceFile extends SourceFileInput {
  hash: string;
}

export interface ProcedureBlock {
  fileName: string;
  name: string;
  code: string;
  signature: string;
  hash: string;
}

export interface RenderedDocumentBundle {
  specHtml: string;
  designHtml: string;
}

export interface AnalyzeRequest {
  code?: string;
  files?: SourceFileInput[];
  mode?: AnalyzerMode;
  sourceName?: string;
  projectName?: string;
}

export interface AnalyzeResult {
  analysis: LegacyAnalysisDocument;
  rendered?: RenderedDocumentBundle;
  modeUsed: "gemini" | "local-demo";
  sourceName: string;
  notice?: string;
  cache?: {
    projectHash: string;
    reused: boolean;
  };
  modelUsage?: {
    mainModel: string;
    lightModel: string;
    proModel?: string;
  };
}

export interface CachedArtifact<T> {
  hash: string;
  createdAt: string;
  model: string;
  data: T;
}

export class AnalyzerError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "AnalyzerError";
    this.statusCode = statusCode;
  }
}
