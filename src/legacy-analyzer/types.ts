export type AnalyzerMode = "auto" | "gemini" | "local-demo";

export type AnalysisDocumentType = "spec" | "issues" | "refactor" | "design";

export type EvidenceConfidence = "high" | "medium" | "low";

export type IssueSeverity = "critical" | "high" | "medium" | "low";

export type RefactorPriority = "now" | "next" | "later";

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
  objectType: string;
  role: string;
  summary: string;
  dependencies: string[];
  mainFunctions: LegacyFunctionSummary[];
}

export interface LegacySpecificationFeature {
  name: string;
  description: string;
  inputs: string[];
  outputs: string[];
  businessRules: string[];
  relatedFiles: string[];
}

export interface LegacyFlowStep {
  step: string;
  detail: string;
  actors: string[];
}

export interface LegacyDiagram {
  title: string;
  description: string;
  mermaid: string;
}

export interface LegacyTableReference {
  name: string;
  columns: string[];
  usage: string;
  notes: string;
  confidence: EvidenceConfidence;
}

export interface LegacyEndpointReference {
  name: string;
  method: string;
  path: string;
  purpose: string;
  confidence: EvidenceConfidence;
}

export interface LegacyDependencyReference {
  name: string;
  type: string;
  purpose: string;
}

export interface LegacyIssue {
  id: string;
  title: string;
  severity: IssueSeverity;
  category: string;
  symptoms: string[];
  evidence: string[];
  impact: string;
  recommendation: string;
  affectedFiles: string[];
  priority: RefactorPriority;
}

export interface LegacyRefactorOption {
  name: string;
  summary: string;
  targetVersions: string[];
  pros: string[];
  cons: string[];
  fitScore: string;
  whenToChoose: string;
}

export interface LegacyRefactorPhase {
  phase: string;
  objective: string;
  tasks: string[];
  outputs: string[];
  validations: string[];
  risks: string[];
}

export interface LegacyModuleBlueprint {
  name: string;
  responsibility: string;
  relatedFiles: string[];
  interfaces: string[];
  notes: string[];
}

export interface LegacyAnalysisDocument {
  projectName: string;
  summary: string;
  targetFiles: LegacyFileSummary[];
  specification: {
    overview: string;
    userJourney: string[];
    features: LegacySpecificationFeature[];
    currentFlows: LegacyFlowStep[];
    diagrams: LegacyDiagram[];
    tables: LegacyTableReference[];
    endpoints: LegacyEndpointReference[];
    dependencies: LegacyDependencyReference[];
  };
  issues: {
    overview: string;
    findings: LegacyIssue[];
  };
  refactoring: {
    strategy: string;
    recommendedApproach: string;
    goals: string[];
    alternatives: LegacyRefactorOption[];
    roadmap: LegacyRefactorPhase[];
    diagrams: LegacyDiagram[];
    guardrails: string[];
    deliverables: string[];
  };
  design: {
    architecture: string;
    modules: LegacyModuleBlueprint[];
    migrationFlow: string[];
    risks: string[];
    diagrams: LegacyDiagram[];
    tables: LegacyTableReference[];
    endpoints: LegacyEndpointReference[];
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

export interface RenderedDocument {
  key: AnalysisDocumentType;
  title: string;
  html: string;
}

export interface RenderedDocumentBundle {
  specHtml: string;
  issuesHtml: string;
  refactorHtml: string;
  designHtml: string;
  documents: RenderedDocument[];
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
    projectModel?: string;
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
