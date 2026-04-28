import type { LegacyFileSummary, LegacyFunctionSummary } from "./types.js";

const COMMON_RULES = `
You analyze legacy Excel VBA and Access VBA to draft specification and design documents.
Important:
- Separate facts, inferences, and unknown points where possible.
- Do not refactor the code.
- Use cautious wording for assumptions.
- Output language must be Japanese.
- Focus on business behavior and system behavior rather than the implementation language unless it matters.
- Return JSON only.
`.trim();

const FUNCTION_SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "description", "inputs", "outputs", "process", "notes"],
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    inputs: { type: "array", items: { type: "string" } },
    outputs: { type: "array", items: { type: "string" } },
    process: { type: "array", items: { type: "string" } },
    notes: { type: "array", items: { type: "string" } }
  }
} as const;

const FILE_SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fileName", "role", "summary", "mainFunctions"],
  properties: {
    fileName: { type: "string" },
    role: { type: "string" },
    summary: { type: "string" },
    mainFunctions: {
      type: "array",
      items: FUNCTION_SUMMARY_SCHEMA
    }
  }
} as const;

const PROJECT_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["projectName", "summary", "targetFiles", "specification", "design"],
  properties: {
    projectName: { type: "string" },
    summary: { type: "string" },
    targetFiles: {
      type: "array",
      items: FILE_SUMMARY_SCHEMA
    },
    specification: {
      type: "object",
      additionalProperties: false,
      required: ["overview", "features"],
      properties: {
        overview: { type: "string" },
        features: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "description", "inputs", "outputs", "businessRules"],
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              inputs: { type: "array", items: { type: "string" } },
              outputs: { type: "array", items: { type: "string" } },
              businessRules: { type: "array", items: { type: "string" } }
            }
          }
        }
      }
    },
    design: {
      type: "object",
      additionalProperties: false,
      required: ["architecture", "modules", "dataFlow", "risks"],
      properties: {
        architecture: { type: "string" },
        modules: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "responsibility", "relatedFiles"],
            properties: {
              name: { type: "string" },
              responsibility: { type: "string" },
              relatedFiles: { type: "array", items: { type: "string" } }
            }
          }
        },
        dataFlow: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } }
      }
    }
  }
} as const;

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function buildFunctionSummaryPrompt(fileName: string, procedureName: string, procedureCode: string): string {
  return `
${COMMON_RULES}

# Task
Summarize one VBA procedure for later document generation.

# Output contract
- Return JSON that matches the provided schema.
- Keep each process item concise.
- If unknown, write "要確認" in notes instead of inventing details.

# Context
- File name: ${fileName}
- Procedure name: ${procedureName}

# VBA procedure
\`\`\`vb
${procedureCode}
\`\`\`
`.trim();
}

export function buildFileSummaryPrompt(
  fileName: string,
  fileCode: string,
  functionSummaries: LegacyFunctionSummary[]
): string {
  return `
${COMMON_RULES}

# Task
Create a file-level summary for one legacy VBA file.

# Output contract
- Return JSON that matches the provided schema.
- Preserve the provided function summaries and align wording if needed.
- role should describe the business role of this file.
- summary should stay concise and avoid over-claiming.

# File name
${fileName}

# Existing function summaries
\`\`\`json
${formatJson(functionSummaries)}
\`\`\`

# Source code
\`\`\`vb
${fileCode}
\`\`\`
`.trim();
}

export function buildProjectAnalysisPrompt(projectName: string, fileSummaries: LegacyFileSummary[]): string {
  return `
${COMMON_RULES}

# Task
Create a project-level intermediate JSON for specification and design documents.

# Output contract
- Return JSON that matches the provided schema.
- Use only the file summaries as the main basis.
- Avoid treating uncertain details as confirmed facts.
- specification and design should be easy to show in a demo.

# Project name
${projectName}

# File summaries
\`\`\`json
${formatJson(fileSummaries)}
\`\`\`
`.trim();
}

export {
  COMMON_RULES,
  FILE_SUMMARY_SCHEMA,
  FUNCTION_SUMMARY_SCHEMA,
  PROJECT_ANALYSIS_SCHEMA
};
