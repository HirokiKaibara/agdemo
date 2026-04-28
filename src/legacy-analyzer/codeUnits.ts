import path from "node:path";

import { AnalyzerError, type AnalyzeRequest, type NormalizedSourceFile, type ProcedureBlock } from "./types.js";
import { buildHash } from "./cacheStore.js";

const procedureHeaderPattern = /^\s*(?:Public|Private|Friend)?\s*(Sub|Function)\s+([^\s(]+)(.*)$/gim;

export function normalizeSourceFiles(request: AnalyzeRequest): NormalizedSourceFile[] {
  const filesFromRequest = request.files?.filter((file) => file.code.trim()) ?? [];

  if (filesFromRequest.length > 0) {
    return filesFromRequest.map((file) => ({
      fileName: file.fileName,
      code: file.code,
      hash: buildHash(file.fileName, file.code)
    }));
  }

  const code = request.code?.trim() ?? "";
  const sourceName = request.sourceName?.trim() || "uploaded.bas";

  if (!code) {
    throw new AnalyzerError("解析対象のVBAコードが空です。", 400);
  }

  return [
    {
      fileName: sourceName,
      code,
      hash: buildHash(sourceName, code)
    }
  ];
}

export function inferProjectName(files: NormalizedSourceFile[], explicitName?: string): string {
  if (explicitName?.trim()) {
    return explicitName.trim();
  }

  if (files.length === 1) {
    return path.parse(files[0].fileName).name || "legacy-analysis-project";
  }

  return "legacy-analysis-project";
}

export function extractProcedureBlocks(file: NormalizedSourceFile): ProcedureBlock[] {
  const matches = [...file.code.matchAll(procedureHeaderPattern)];

  if (matches.length === 0) {
    return [
      {
        fileName: file.fileName,
        name: path.parse(file.fileName).name || "module",
        code: file.code,
        signature: file.fileName,
        hash: buildHash(file.fileName, file.code, "module")
      }
    ];
  }

  return matches.map((match, index) => {
    const name = match[2]?.trim() || `procedure_${index + 1}`;
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? file.code.length;
    const code = file.code.slice(start, end).trim();
    const signature = `${match[1] ?? "Sub"} ${name}${match[3] ?? ""}`.trim();

    return {
      fileName: file.fileName,
      name,
      code,
      signature,
      hash: buildHash(file.fileName, name, code)
    };
  });
}
