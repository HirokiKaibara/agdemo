import type {
  LegacyAnalysisDocument,
  LegacyDiagram,
  LegacyEndpointReference,
  LegacyFileSummary,
  LegacyFunctionSummary,
  LegacyIssue,
  LegacyTableReference,
  RenderedDocumentBundle
} from "../legacy-analyzer/types.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderParagraph(text: string): string {
  return `<p>${escapeHtml(text)}</p>`;
}

function stripLeadingOrderMarker(value: string): string {
  return value.replace(/^\s*\d+(?:\.\d+)*[\.\)]\s*/u, "").trim();
}

function renderList(items: string[], ordered = false): string {
  if (items.length === 0) {
    return `<p class="empty-value">該当なし</p>`;
  }

  const tag = ordered ? "ol" : "ul";
  const normalizedItems = ordered ? items.map((item) => stripLeadingOrderMarker(item)) : items;
  return `<${tag}>${normalizedItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${tag}>`;
}

function renderKeyValueTable(rows: Array<[string, string]>): string {
  return `
    <table>
      <tbody>
        ${rows
          .map(
            ([label, value]) =>
              `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value || "該当なし")}</td></tr>`
          )
          .join("")}
      </tbody>
    </table>
  `.trim();
}

function renderTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return `<p class="empty-value">該当なし</p>`;
  }

  return `
    <table>
      <thead>
        <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${escapeHtml(cell || "該当なし")}</td>`).join("")}</tr>`
          )
          .join("")}
      </tbody>
    </table>
  `.trim();
}

function renderBadge(text: string, tone = "default"): string {
  return `<span class="badge badge-${tone}">${escapeHtml(text)}</span>`;
}

function renderSeverityBadge(issue: LegacyIssue): string {
  return renderBadge(issue.severity.toUpperCase(), issue.severity);
}

function renderPriorityBadge(priority: LegacyIssue["priority"]): string {
  const label =
    priority === "now" ? "最優先" : priority === "next" ? "次段階" : "後続";
  return renderBadge(label, priority);
}

function renderDiagram(diagram: LegacyDiagram): string {
  return `
    <article class="diagram-card">
      <div class="diagram-header">
        <h4>${escapeHtml(diagram.title)}</h4>
        ${renderBadge("Mermaid", "info")}
      </div>
      ${renderParagraph(diagram.description)}
      <div class="mermaid">${escapeHtml(diagram.mermaid)}</div>
      <details class="mermaid-source">
        <summary>Mermaidソース</summary>
        <pre><code>${escapeHtml(diagram.mermaid)}</code></pre>
      </details>
    </article>
  `.trim();
}

function renderDiagramSection(diagrams: LegacyDiagram[]): string {
  if (diagrams.length === 0) {
    return `<p class="empty-value">図はありません。</p>`;
  }

  return `<div class="diagram-grid">${diagrams.map((diagram) => renderDiagram(diagram)).join("")}</div>`;
}

function renderFunctionCard(fn: LegacyFunctionSummary): string {
  return `
    <article class="function-card">
      <h4>${escapeHtml(fn.name)}</h4>
      ${renderParagraph(fn.description)}
      <div class="function-grid">
        <section>
          <h5>入力</h5>
          ${renderList(fn.inputs)}
        </section>
        <section>
          <h5>出力</h5>
          ${renderList(fn.outputs)}
        </section>
      </div>
      <section>
        <h5>処理手順</h5>
        ${renderList(fn.process, true)}
      </section>
      <section>
        <h5>留意点</h5>
        ${renderList(fn.notes)}
      </section>
    </article>
  `.trim();
}

function renderFunctionCards(file: LegacyFileSummary): string {
  if (file.mainFunctions.length === 0) {
    return `<p class="empty-value">主要手続きは抽出できませんでした。</p>`;
  }

  return `<div class="function-card-list">${file.mainFunctions.map((fn) => renderFunctionCard(fn)).join("")}</div>`;
}

function renderFileInventoryTable(analysis: LegacyAnalysisDocument): string {
  return renderTable(
    ["ファイル", "種別", "役割", "依存関係"],
    analysis.targetFiles.map((file) => [
      file.fileName,
      file.objectType,
      file.role,
      file.dependencies.join(" / ") || "該当なし"
    ])
  );
}

function renderFeatureTable(analysis: LegacyAnalysisDocument): string {
  return renderTable(
    ["機能", "説明", "入力", "出力", "業務ルール", "関連ファイル"],
    analysis.specification.features.map((feature) => [
      feature.name,
      feature.description,
      feature.inputs.join(" / "),
      feature.outputs.join(" / "),
      feature.businessRules.join(" / "),
      feature.relatedFiles.join(" / ")
    ])
  );
}

function renderFlowTable(analysis: LegacyAnalysisDocument): string {
  return renderTable(
    ["順序", "内容", "主な主体"],
    analysis.specification.currentFlows.map((flow) => [
      flow.step,
      flow.detail,
      flow.actors.join(" / ")
    ])
  );
}

function renderTableReferences(tables: LegacyTableReference[]): string {
  return renderTable(
    ["テーブル", "カラム候補", "用途", "信頼度", "備考"],
    tables.map((table) => [
      table.name,
      table.columns.join(" / ") || "要確認",
      table.usage,
      table.confidence,
      table.notes
    ])
  );
}

function renderEndpointReferences(endpoints: LegacyEndpointReference[]): string {
  return renderTable(
    ["名前", "メソッド", "パス / URL", "用途", "信頼度"],
    endpoints.map((endpoint) => [
      endpoint.name,
      endpoint.method,
      endpoint.path,
      endpoint.purpose,
      endpoint.confidence
    ])
  );
}

function renderIssueSummary(analysis: LegacyAnalysisDocument): string {
  const counts = analysis.issues.findings.reduce<Record<string, number>>((result, issue) => {
    result[issue.severity] = (result[issue.severity] ?? 0) + 1;
    return result;
  }, {});

  return `
    <div class="stat-grid">
      <article class="stat-card"><strong>${counts.critical ?? 0}</strong><span>Critical</span></article>
      <article class="stat-card"><strong>${counts.high ?? 0}</strong><span>High</span></article>
      <article class="stat-card"><strong>${counts.medium ?? 0}</strong><span>Medium</span></article>
      <article class="stat-card"><strong>${counts.low ?? 0}</strong><span>Low</span></article>
    </div>
  `.trim();
}

function renderIssueCards(analysis: LegacyAnalysisDocument): string {
  if (analysis.issues.findings.length === 0) {
    return `<p class="empty-value">問題点は抽出されませんでした。</p>`;
  }

  return `
    <div class="issue-grid">
      ${analysis.issues.findings
        .map(
          (issue) => `
            <article class="issue-card severity-${issue.severity}">
              <div class="issue-header">
                <div>
                  <p class="issue-id">${escapeHtml(issue.id)}</p>
                  <h3>${escapeHtml(issue.title)}</h3>
                </div>
                <div class="badge-row">
                  ${renderSeverityBadge(issue)}
                  ${renderPriorityBadge(issue.priority)}
                </div>
              </div>
              ${renderKeyValueTable([
                ["分類", issue.category],
                ["影響ファイル", issue.affectedFiles.join(" / ") || "該当なし"],
                ["影響", issue.impact]
              ])}
              <section>
                <h4>症状</h4>
                ${renderList(issue.symptoms)}
              </section>
              <section>
                <h4>根拠</h4>
                ${renderList(issue.evidence)}
              </section>
              <section>
                <h4>推奨アクション</h4>
                ${renderParagraph(issue.recommendation)}
              </section>
            </article>
          `
        )
        .join("")}
    </div>
  `.trim();
}

function renderRefactorAlternatives(analysis: LegacyAnalysisDocument): string {
  return renderTable(
    ["代替案", "概要", "候補バージョン", "長所", "短所", "適合度", "採用条件"],
    analysis.refactoring.alternatives.map((option) => [
      option.name,
      option.summary,
      option.targetVersions.join(" / "),
      option.pros.join(" / "),
      option.cons.join(" / "),
      option.fitScore,
      option.whenToChoose
    ])
  );
}

function renderRoadmap(analysis: LegacyAnalysisDocument): string {
  if (analysis.refactoring.roadmap.length === 0) {
    return `<p class="empty-value">ロードマップはありません。</p>`;
  }

  return `
    <div class="roadmap-list">
      ${analysis.refactoring.roadmap
        .map(
          (phase) => `
            <article class="roadmap-card">
              <h3>${escapeHtml(phase.phase)}</h3>
              ${renderParagraph(phase.objective)}
              <div class="roadmap-grid">
                <section>
                  <h4>実施タスク</h4>
                  ${renderList(phase.tasks)}
                </section>
                <section>
                  <h4>成果物</h4>
                  ${renderList(phase.outputs)}
                </section>
                <section>
                  <h4>検証観点</h4>
                  ${renderList(phase.validations)}
                </section>
                <section>
                  <h4>リスク</h4>
                  ${renderList(phase.risks)}
                </section>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `.trim();
}

function renderModuleTable(analysis: LegacyAnalysisDocument): string {
  return renderTable(
    ["モジュール", "責務", "関連ファイル", "主なインターフェース", "補足"],
    analysis.design.modules.map((module) => [
      module.name,
      module.responsibility,
      module.relatedFiles.join(" / ") || "該当なし",
      module.interfaces.join(" / ") || "該当なし",
      module.notes.join(" / ") || "該当なし"
    ])
  );
}

function renderSpecificationHtml(analysis: LegacyAnalysisDocument): string {
  const fileSections = analysis.targetFiles
    .map(
      (file) => `
        <section class="document-section">
          <h3>${escapeHtml(file.fileName)}</h3>
          ${renderKeyValueTable([
            ["種別", file.objectType],
            ["役割", file.role],
            ["概要", file.summary],
            ["依存関係", file.dependencies.join(" / ") || "該当なし"]
          ])}
          ${renderFunctionCards(file)}
        </section>
      `
    )
    .join("");

  return `
    <div class="document-view">
      <section class="document-section">
        <h1>1. 現状仕様書</h1>
        ${renderKeyValueTable([
          ["プロジェクト", analysis.projectName],
          ["全体概要", analysis.summary]
        ])}
      </section>
      <section class="document-section">
        <h2>読む順番</h2>
        ${renderList(analysis.specification.userJourney, true)}
      </section>
      <section class="document-section">
        <h2>現状概要</h2>
        ${renderParagraph(analysis.specification.overview)}
      </section>
      <section class="document-section">
        <h2>現行フロー</h2>
        ${renderFlowTable(analysis)}
      </section>
      <section class="document-section">
        <h2>現行機能一覧</h2>
        ${renderFeatureTable(analysis)}
      </section>
      <section class="document-section">
        <h2>Mermaid図</h2>
        ${renderDiagramSection(analysis.specification.diagrams)}
      </section>
      <section class="document-section">
        <h2>テーブル / カラム</h2>
        ${renderTableReferences(analysis.specification.tables)}
      </section>
      <section class="document-section">
        <h2>エンドポイント</h2>
        ${renderEndpointReferences(analysis.specification.endpoints)}
      </section>
      <section class="document-section">
        <h2>主要依存関係</h2>
        ${renderTable(
          ["依存名", "種別", "用途"],
          analysis.specification.dependencies.map((dependency) => [
            dependency.name,
            dependency.type,
            dependency.purpose
          ])
        )}
      </section>
      <section class="document-section">
        <h2>対象ファイル一覧</h2>
        ${renderFileInventoryTable(analysis)}
      </section>
      <section class="document-section">
        <h2>ファイル別の主要手続き</h2>
        ${fileSections || `<p class="empty-value">対象ファイルはありません。</p>`}
      </section>
    </div>
  `.trim();
}

function renderIssuesHtml(analysis: LegacyAnalysisDocument): string {
  return `
    <div class="document-view">
      <section class="document-section">
        <h1>2. 問題点分析</h1>
        ${renderKeyValueTable([
          ["プロジェクト", analysis.projectName],
          ["分析要約", analysis.issues.overview]
        ])}
      </section>
      <section class="document-section">
        <h2>重大度サマリー</h2>
        ${renderIssueSummary(analysis)}
      </section>
      <section class="document-section">
        <h2>指摘一覧</h2>
        ${renderIssueCards(analysis)}
      </section>
    </div>
  `.trim();
}

function renderRefactorHtml(analysis: LegacyAnalysisDocument): string {
  return `
    <div class="document-view">
      <section class="document-section">
        <h1>3. 詳細リファクタリング案</h1>
        ${renderKeyValueTable([
          ["戦略", analysis.refactoring.strategy],
          ["推奨方針", analysis.refactoring.recommendedApproach]
        ])}
      </section>
      <section class="document-section">
        <h2>到達目標</h2>
        ${renderList(analysis.refactoring.goals)}
      </section>
      <section class="document-section">
        <h2>代替案と候補バージョン</h2>
        ${renderRefactorAlternatives(analysis)}
      </section>
      <section class="document-section">
        <h2>Mermaid図</h2>
        ${renderDiagramSection(analysis.refactoring.diagrams)}
      </section>
      <section class="document-section">
        <h2>段階的ロードマップ</h2>
        ${renderRoadmap(analysis)}
      </section>
      <section class="document-section">
        <h2>進める上でのガードレール</h2>
        ${renderList(analysis.refactoring.guardrails)}
      </section>
      <section class="document-section">
        <h2>成果物</h2>
        ${renderList(analysis.refactoring.deliverables)}
      </section>
    </div>
  `.trim();
}

function renderDesignHtml(analysis: LegacyAnalysisDocument): string {
  return `
    <div class="document-view">
      <section class="document-section">
        <h1>4. リファクタリング設計書</h1>
        ${renderKeyValueTable([
          ["プロジェクト", analysis.projectName],
          ["目標アーキテクチャ", analysis.design.architecture]
        ])}
      </section>
      <section class="document-section">
        <h2>Mermaid図</h2>
        ${renderDiagramSection(analysis.design.diagrams)}
      </section>
      <section class="document-section">
        <h2>目標モジュール設計</h2>
        ${renderModuleTable(analysis)}
      </section>
      <section class="document-section">
        <h2>移行フロー</h2>
        ${renderList(analysis.design.migrationFlow, true)}
      </section>
      <section class="document-section">
        <h2>目標テーブル / カラム設計メモ</h2>
        ${renderTableReferences(analysis.design.tables)}
      </section>
      <section class="document-section">
        <h2>目標エンドポイント / 外部連携</h2>
        ${renderEndpointReferences(analysis.design.endpoints)}
      </section>
      <section class="document-section">
        <h2>設計上のリスク</h2>
        ${renderList(analysis.design.risks)}
      </section>
      <section class="document-section">
        <h2>現行ファイルとの対応</h2>
        ${renderFileInventoryTable(analysis)}
      </section>
    </div>
  `.trim();
}

export {
  renderIssuesHtml,
  renderRefactorHtml,
  renderDesignHtml,
  renderSpecificationHtml
};

export function renderAnalysisDocuments(analysis: LegacyAnalysisDocument): RenderedDocumentBundle {
  const specHtml = renderSpecificationHtml(analysis);
  const issuesHtml = renderIssuesHtml(analysis);
  const refactorHtml = renderRefactorHtml(analysis);
  const designHtml = renderDesignHtml(analysis);

  return {
    specHtml,
    issuesHtml,
    refactorHtml,
    designHtml,
    documents: [
      { key: "spec", title: "現状仕様書", html: specHtml },
      { key: "issues", title: "問題点分析", html: issuesHtml },
      { key: "refactor", title: "詳細リファクタリング案", html: refactorHtml },
      { key: "design", title: "リファクタリング設計書", html: designHtml }
    ]
  };
}
