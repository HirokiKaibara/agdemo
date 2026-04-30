import type { LegacyAnalysisDocument, LegacyDiagram } from "./types.js";

const NODE_ID_PATTERN = "[A-Za-z][A-Za-z0-9_]*";

function sanitizeMultilineText(value: string, joiner: string): string {
  const normalizedLines = value
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return normalizedLines.join(joiner).replaceAll('"', "'");
}

function sanitizeNodeLabel(value: string): string {
  return sanitizeMultilineText(value, "<br/>");
}

function sanitizeInlineLabel(value: string): string {
  return sanitizeMultilineText(value, " ");
}

function normalizeNodeSyntax(source: string): string {
  const replacements: Array<{
    pattern: RegExp;
    render: (id: string, label: string) => string;
  }> = [
    {
      pattern: new RegExp(`\\b(${NODE_ID_PATTERN})\\[\\((.*?)\\)\\]`, "gs"),
      render: (id, label) => `${id}["${sanitizeNodeLabel(label)}"]`
    },
    {
      pattern: new RegExp(`\\b(${NODE_ID_PATTERN})\\[\\[(.*?)\\]\\]`, "gs"),
      render: (id, label) => `${id}["${sanitizeNodeLabel(label)}"]`
    },
    {
      pattern: new RegExp(`\\b(${NODE_ID_PATTERN})\\(\\((.*?)\\)\\)`, "gs"),
      render: (id, label) => `${id}["${sanitizeNodeLabel(label)}"]`
    },
    {
      pattern: new RegExp(`\\b(${NODE_ID_PATTERN})\\{(.*?)\\}`, "gs"),
      render: (id, label) => `${id}{"${sanitizeNodeLabel(label)}"}`
    },
    {
      pattern: new RegExp(`\\b(${NODE_ID_PATTERN})\\[(.*?)\\]`, "gs"),
      render: (id, label) => `${id}["${sanitizeNodeLabel(label)}"]`
    },
    {
      pattern: new RegExp(`\\b(${NODE_ID_PATTERN})\\((.*?)\\)`, "gs"),
      render: (id, label) => `${id}["${sanitizeNodeLabel(label)}"]`
    }
  ];

  return replacements.reduce(
    (current, replacement) =>
      current.replace(replacement.pattern, (_match, id: string, label: string) => replacement.render(id, label)),
    source
  );
}

function normalizeSubgraphLine(line: string): string {
  const match = line.match(/^(\s*subgraph)\s+(.+)$/u);

  if (!match) {
    return line;
  }

  const [, keyword, rawTitle] = match;
  const title = rawTitle.trim();

  if (!title || title.startsWith('"') || title.includes("[") || title.includes("]")) {
    return line;
  }

  return `${keyword} "${sanitizeInlineLabel(title)}"`;
}

function normalizeEdgeLabels(line: string): string {
  return line.replace(/--\s+(.+?)\s+-->/gu, (_match, label: string) => {
    const trimmed = label.trim();

    if (!trimmed || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      return `-- ${trimmed} -->`;
    }

    return `-- "${sanitizeInlineLabel(trimmed)}" -->`;
  });
}

export function normalizeMermaidSource(source: string): string {
  const normalized = normalizeNodeSyntax(source.replace(/\r\n?/gu, "\n"));

  return normalized
    .split("\n")
    .map((line) => line.replace(/;+\s*$/u, ""))
    .map(normalizeSubgraphLine)
    .map(normalizeEdgeLabels)
    .join("\n")
    .trim();
}

function normalizeDiagram(diagram: LegacyDiagram): LegacyDiagram {
  return {
    ...diagram,
    mermaid: normalizeMermaidSource(diagram.mermaid)
  };
}

export function normalizeAnalysisMermaid(analysis: LegacyAnalysisDocument): LegacyAnalysisDocument {
  return {
    ...analysis,
    specification: {
      ...analysis.specification,
      diagrams: analysis.specification.diagrams.map(normalizeDiagram)
    },
    refactoring: {
      ...analysis.refactoring,
      diagrams: analysis.refactoring.diagrams.map(normalizeDiagram)
    },
    design: {
      ...analysis.design,
      diagrams: analysis.design.diagrams.map(normalizeDiagram)
    }
  };
}
