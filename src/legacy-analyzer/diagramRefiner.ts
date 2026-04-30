import type { LegacyAnalysisDocument, LegacyDiagram } from "./types.js";

function isRoadmapDiagram(diagram: LegacyDiagram): boolean {
  return /ロードマップ|roadmap/iu.test(diagram.title);
}

export function applyReadableDiagramOverrides(analysis: LegacyAnalysisDocument): LegacyAnalysisDocument {
  return {
    ...analysis,
    refactoring: {
      ...analysis.refactoring,
      diagrams: analysis.refactoring.diagrams.filter((diagram) => !isRoadmapDiagram(diagram))
    }
  };
}
