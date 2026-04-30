import type { LegacyAnalysisDocument, LegacyTableReference, NormalizedSourceFile } from "./types.js";

const STRING_LITERAL_PATTERN = /"([^"]*)"/gim;
const SQL_IDENTIFIER = "[A-Za-z0-9_\\u3040-\\u30ff\\u4e00-\\u9faf]+";
const WHERE_COLUMN_PATTERN = new RegExp(
  `(?:WHERE|AND|OR)\\s+(${SQL_IDENTIFIER})\\s*(?:=|<>|>=|<=|>|<|LIKE|IN|IS)`,
  "giu"
);

interface TableArtifact {
  name: string;
  columns: Set<string>;
  operations: Set<string>;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function splitCsvLike(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeIdentifier(value: string): string {
  const match = value.match(new RegExp(SQL_IDENTIFIER, "u"));
  return match ? match[0] : "";
}

function collectMatches(source: string, regex: RegExp, groupIndex = 1): string[] {
  const values: string[] = [];

  for (const match of source.matchAll(regex)) {
    const value = match[groupIndex]?.trim();

    if (value) {
      values.push(value);
    }
  }

  return unique(values);
}

function extractStringLiteralCorpus(code: string): string {
  return collectMatches(code, STRING_LITERAL_PATTERN).join(" ");
}

function ensureTableArtifact(tableArtifacts: Map<string, TableArtifact>, tableName: string): TableArtifact {
  const normalizedName = normalizeIdentifier(tableName);
  const existingArtifact = tableArtifacts.get(normalizedName);

  if (existingArtifact) {
    return existingArtifact;
  }

  const artifact: TableArtifact = {
    name: normalizedName,
    columns: new Set<string>(),
    operations: new Set<string>()
  };
  tableArtifacts.set(normalizedName, artifact);
  return artifact;
}

function addColumns(artifact: TableArtifact, columns: string[]): void {
  for (const column of columns) {
    const normalizedColumn = normalizeIdentifier(column.split("=")[0] ?? "");

    if (normalizedColumn && normalizedColumn !== "*") {
      artifact.columns.add(normalizedColumn);
    }
  }
}

function addWhereColumns(artifact: TableArtifact, sqlFragment: string): void {
  const whereColumns = collectMatches(sqlFragment, WHERE_COLUMN_PATTERN);
  addColumns(artifact, whereColumns);
}

export function extractCodeTableReferences(files: NormalizedSourceFile[]): LegacyTableReference[] {
  const tableArtifacts = new Map<string, TableArtifact>();

  for (const file of files) {
    const corpus = extractStringLiteralCorpus(file.code);

    for (const match of corpus.matchAll(
      new RegExp(
        `UPDATE\\s+(${SQL_IDENTIFIER})\\s+SET\\s+([\\s\\S]*?)(?=UPDATE\\s+${SQL_IDENTIFIER}\\s+SET|INSERT\\s+INTO|DELETE\\s+FROM|SELECT\\s+|$)`,
        "giu"
      )
    )) {
      const artifact = ensureTableArtifact(tableArtifacts, match[1] ?? "");
      const statement = match[0] ?? "";
      const setClause = statement.match(/\bSET\b([\s\S]*?)(?:\bWHERE\b|$)/iu)?.[1] ?? match[2] ?? "";

      artifact.operations.add("UPDATE");
      addColumns(artifact, splitCsvLike(setClause));
      addWhereColumns(artifact, statement);
    }

    for (const match of corpus.matchAll(
      new RegExp(`INSERT\\s+INTO\\s+(${SQL_IDENTIFIER})\\s*\\(([^)]+)\\)`, "giu")
    )) {
      const artifact = ensureTableArtifact(tableArtifacts, match[1] ?? "");
      artifact.operations.add("INSERT");
      addColumns(artifact, splitCsvLike(match[2] ?? ""));
    }

    for (const match of corpus.matchAll(
      new RegExp(`SELECT\\s+([\\s\\S]*?)\\s+FROM\\s+(${SQL_IDENTIFIER})(?:\\s|$)`, "giu")
    )) {
      const artifact = ensureTableArtifact(tableArtifacts, match[2] ?? "");
      artifact.operations.add("SELECT");
      addColumns(artifact, splitCsvLike(match[1] ?? ""));
      addWhereColumns(artifact, match[0] ?? "");
    }

    for (const match of corpus.matchAll(
      new RegExp(`DELETE\\s+FROM\\s+(${SQL_IDENTIFIER})([\\s\\S]*?)(?=DELETE\\s+FROM|INSERT\\s+INTO|UPDATE\\s+|SELECT\\s+|$)`, "giu")
    )) {
      const artifact = ensureTableArtifact(tableArtifacts, match[1] ?? "");
      artifact.operations.add("DELETE");
      addWhereColumns(artifact, match[0] ?? "");
    }
  }

  return [...tableArtifacts.values()].map((artifact) => ({
    name: artifact.name,
    columns: [...artifact.columns],
    usage: artifact.operations.size > 0 ? `${[...artifact.operations].join(" / ")} に使用` : "SQL操作は要確認",
    notes: "コード中のSQL文字列から抽出",
    confidence: artifact.columns.size > 0 ? "high" : "medium"
  }));
}

export function applyCodeTableReferences(
  analysis: LegacyAnalysisDocument,
  tableReferences: LegacyTableReference[]
): LegacyAnalysisDocument {
  return {
    ...analysis,
    specification: {
      ...analysis.specification,
      tables: tableReferences
    }
  };
}
