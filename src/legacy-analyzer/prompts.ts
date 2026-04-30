import type { LegacyFileSummary, LegacyFunctionSummary } from "./types.js";

const COMMON_RULES = `
You analyze legacy Excel VBA and Access VBA to draft current-state and refactoring documents.
Important:
- Separate facts, inferences, and unknown points where possible.
- Do not refactor the code directly.
- Use cautious wording for assumptions.
- Output language must be Japanese.
- Focus on business behavior and system behavior rather than VBA syntax unless it materially matters.
- When you mention product or framework versions, present them as candidate versions and explicitly say "要確認" if the source code alone cannot confirm them.
- Mermaid diagrams must be valid flowchart or graph syntax and easy for business users to follow.
- Return JSON only.
`.trim();

const STRING_ARRAY_SCHEMA = {
  type: "array",
  items: { type: "string" }
} as const;

const FUNCTION_SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "description", "inputs", "outputs", "process", "notes"],
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    inputs: STRING_ARRAY_SCHEMA,
    outputs: STRING_ARRAY_SCHEMA,
    process: STRING_ARRAY_SCHEMA,
    notes: STRING_ARRAY_SCHEMA
  }
} as const;

const FILE_SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fileName", "objectType", "role", "summary", "dependencies", "mainFunctions"],
  properties: {
    fileName: { type: "string" },
    objectType: { type: "string" },
    role: { type: "string" },
    summary: { type: "string" },
    dependencies: STRING_ARRAY_SCHEMA,
    mainFunctions: {
      type: "array",
      items: FUNCTION_SUMMARY_SCHEMA
    }
  }
} as const;

const DIAGRAM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "mermaid"],
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    mermaid: { type: "string" }
  }
} as const;

const FLOW_STEP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["step", "detail", "actors"],
  properties: {
    step: { type: "string" },
    detail: { type: "string" },
    actors: STRING_ARRAY_SCHEMA
  }
} as const;

const TABLE_REFERENCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "columns", "usage", "notes", "confidence"],
  properties: {
    name: { type: "string" },
    columns: STRING_ARRAY_SCHEMA,
    usage: { type: "string" },
    notes: { type: "string" },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"]
    }
  }
} as const;

const ENDPOINT_REFERENCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "method", "path", "purpose", "confidence"],
  properties: {
    name: { type: "string" },
    method: { type: "string" },
    path: { type: "string" },
    purpose: { type: "string" },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"]
    }
  }
} as const;

const DEPENDENCY_REFERENCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "type", "purpose"],
  properties: {
    name: { type: "string" },
    type: { type: "string" },
    purpose: { type: "string" }
  }
} as const;

const ISSUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "title",
    "severity",
    "category",
    "symptoms",
    "evidence",
    "impact",
    "recommendation",
    "affectedFiles",
    "priority"
  ],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    severity: {
      type: "string",
      enum: ["critical", "high", "medium", "low"]
    },
    category: { type: "string" },
    symptoms: STRING_ARRAY_SCHEMA,
    evidence: STRING_ARRAY_SCHEMA,
    impact: { type: "string" },
    recommendation: { type: "string" },
    affectedFiles: STRING_ARRAY_SCHEMA,
    priority: {
      type: "string",
      enum: ["now", "next", "later"]
    }
  }
} as const;

const REFACTOR_OPTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "summary", "targetVersions", "pros", "cons", "fitScore", "whenToChoose"],
  properties: {
    name: { type: "string" },
    summary: { type: "string" },
    targetVersions: STRING_ARRAY_SCHEMA,
    pros: STRING_ARRAY_SCHEMA,
    cons: STRING_ARRAY_SCHEMA,
    fitScore: { type: "string" },
    whenToChoose: { type: "string" }
  }
} as const;

const REFACTOR_PHASE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["phase", "objective", "tasks", "outputs", "validations", "risks"],
  properties: {
    phase: { type: "string" },
    objective: { type: "string" },
    tasks: STRING_ARRAY_SCHEMA,
    outputs: STRING_ARRAY_SCHEMA,
    validations: STRING_ARRAY_SCHEMA,
    risks: STRING_ARRAY_SCHEMA
  }
} as const;

const MODULE_BLUEPRINT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "responsibility", "relatedFiles", "interfaces", "notes"],
  properties: {
    name: { type: "string" },
    responsibility: { type: "string" },
    relatedFiles: STRING_ARRAY_SCHEMA,
    interfaces: STRING_ARRAY_SCHEMA,
    notes: STRING_ARRAY_SCHEMA
  }
} as const;

const FEATURE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "description", "inputs", "outputs", "businessRules", "relatedFiles"],
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    inputs: STRING_ARRAY_SCHEMA,
    outputs: STRING_ARRAY_SCHEMA,
    businessRules: STRING_ARRAY_SCHEMA,
    relatedFiles: STRING_ARRAY_SCHEMA
  }
} as const;

const PROJECT_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["projectName", "summary", "targetFiles", "specification", "issues", "refactoring", "design"],
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
      required: [
        "overview",
        "userJourney",
        "features",
        "currentFlows",
        "diagrams",
        "tables",
        "endpoints",
        "dependencies"
      ],
      properties: {
        overview: { type: "string" },
        userJourney: STRING_ARRAY_SCHEMA,
        features: {
          type: "array",
          items: FEATURE_SCHEMA
        },
        currentFlows: {
          type: "array",
          items: FLOW_STEP_SCHEMA
        },
        diagrams: {
          type: "array",
          items: DIAGRAM_SCHEMA
        },
        tables: {
          type: "array",
          items: TABLE_REFERENCE_SCHEMA
        },
        endpoints: {
          type: "array",
          items: ENDPOINT_REFERENCE_SCHEMA
        },
        dependencies: {
          type: "array",
          items: DEPENDENCY_REFERENCE_SCHEMA
        }
      }
    },
    issues: {
      type: "object",
      additionalProperties: false,
      required: ["overview", "findings"],
      properties: {
        overview: { type: "string" },
        findings: {
          type: "array",
          items: ISSUE_SCHEMA
        }
      }
    },
    refactoring: {
      type: "object",
      additionalProperties: false,
      required: [
        "strategy",
        "recommendedApproach",
        "goals",
        "alternatives",
        "roadmap",
        "diagrams",
        "guardrails",
        "deliverables"
      ],
      properties: {
        strategy: { type: "string" },
        recommendedApproach: { type: "string" },
        goals: STRING_ARRAY_SCHEMA,
        alternatives: {
          type: "array",
          items: REFACTOR_OPTION_SCHEMA
        },
        roadmap: {
          type: "array",
          items: REFACTOR_PHASE_SCHEMA
        },
        diagrams: {
          type: "array",
          items: DIAGRAM_SCHEMA
        },
        guardrails: STRING_ARRAY_SCHEMA,
        deliverables: STRING_ARRAY_SCHEMA
      }
    },
    design: {
      type: "object",
      additionalProperties: false,
      required: ["architecture", "modules", "migrationFlow", "risks", "diagrams", "tables", "endpoints"],
      properties: {
        architecture: { type: "string" },
        modules: {
          type: "array",
          items: MODULE_BLUEPRINT_SCHEMA
        },
        migrationFlow: STRING_ARRAY_SCHEMA,
        risks: STRING_ARRAY_SCHEMA,
        diagrams: {
          type: "array",
          items: DIAGRAM_SCHEMA
        },
        tables: {
          type: "array",
          items: TABLE_REFERENCE_SCHEMA
        },
        endpoints: {
          type: "array",
          items: ENDPOINT_REFERENCE_SCHEMA
        }
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
- objectType should be a short label such as "標準モジュール", "クラス", "フォーム", "レポート", "不明".
- role should describe the business role of this file.
- dependencies should list key external dependencies used by the file, such as worksheets, CurrentDb, file system, reports, APIs, or COM components.
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
Create one project-level JSON that contains:
1. current-state specification
2. issue analysis
3. detailed refactoring proposal
4. target design document

# Output contract
- Return JSON that matches the provided schema.
- Use only the file summaries as the main basis, and be explicit when something is inferred.
- Make the result useful for a user who wants to understand what to refactor and in what order.
- Include Mermaid diagrams for the current state, the refactoring roadmap, and the target design.
- Represent tables, columns, and endpoints in structured arrays when they can be inferred.
- For version-related recommendations, provide candidate versions and append "要確認" when the source code alone cannot prove the exact version.
- Do not omit alternatives. Provide at least 2 alternatives when feasible.
- Avoid treating uncertain details as confirmed facts.

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
