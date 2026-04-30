import type {
  LegacyAnalysisDocument,
  LegacyDiagram,
  LegacyEndpointReference,
  LegacyFileSummary,
  LegacyFunctionSummary,
  LegacyIssue,
  LegacyRefactorPhase,
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

function renderConfidenceBadge(confidence: LegacyTableReference["confidence"]): string {
  const label = confidence === "high" ? "高" : confidence === "medium" ? "中" : "低";
  return renderBadge(`信頼度 ${label}`, confidence);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function extractUsageOperations(usage: string): string[] {
  const operations: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /(?:\bINSERT\b|レコード追加|(?<!レコード)追加)/iu, label: "レコード追加" },
    { pattern: /(?:\bUPDATE\b|レコード更新|(?<!レコード)更新)/iu, label: "レコード更新" },
    { pattern: /(?:\bDELETE\b|レコード削除|(?<!レコード)削除)/iu, label: "レコード削除" },
    { pattern: /(?:\bSELECT\b|データ参照|(?<!データ)参照)/iu, label: "データ参照" }
  ];

  return operations.filter((operation) => operation.pattern.test(usage)).map((operation) => operation.label);
}

function localizeUsageText(usage: string): string {
  return usage
    .replace(/\bINSERT\b/giu, "レコード追加")
    .replace(/\bUPDATE\b/giu, "レコード更新")
    .replace(/\bDELETE\b/giu, "レコード削除")
    .replace(/\bSELECT\b/giu, "データ参照")
    .replace(/(^|[\s/])追加(?=([\s/]|に|で|を|$))/gu, "$1レコード追加")
    .replace(/(^|[\s/])更新(?=([\s/]|に|で|を|$))/gu, "$1レコード更新")
    .replace(/(^|[\s/])削除(?=([\s/]|に|で|を|$))/gu, "$1レコード削除")
    .replace(/(^|[\s/])参照(?=([\s/]|に|で|を|$))/gu, "$1データ参照");
}

function renderUsageCell(usage: string): string {
  const localizedUsage = localizeUsageText(usage || "要確認");

  return `
    <div class="table-usage-cell">
      <span class="table-usage-text">${escapeHtml(localizedUsage)}</span>
    </div>
  `.trim();
}

function renderTableReferenceExcelView(
  tables: LegacyTableReference[],
  sectionKey: "specification" | "design"
): string {
  if (tables.length === 0) {
    return `<p class="empty-value">該当なし</p>`;
  }

  const totalColumns = tables.reduce((sum, table) => sum + Math.max(table.columns.length, 1), 0);
  const rows = tables.flatMap((table, tableIndex) => {
    const columns = table.columns.length > 0 ? table.columns : ["要確認"];
    const groupTone = tableIndex % 2 === 0 ? "group-even" : "group-odd";

    return columns.map((columnName, columnIndex) => ({
      tableName: table.name,
      usage: table.usage || "要確認",
      usageDisplay: localizeUsageText(table.usage || "要確認"),
      columnOrder: columnIndex + 1,
      columnName,
      notes: table.notes || "要確認",
      rowSpan: columns.length,
      isFirstRow: columnIndex === 0,
      groupTone
    }));
  });

  return `
    <div
      class="table-reference-excel"
      data-table-reference-root
      data-section-key="${escapeAttribute(sectionKey)}"
    >
      <div class="table-reference-header-bar">
        <div class="table-reference-summary-grid">
          <article class="table-summary-card">
            <span class="table-summary-label">抽出テーブル数</span>
            <strong data-summary-tables>${tables.length}</strong>
          </article>
          <article class="table-summary-card">
            <span class="table-summary-label">抽出カラム数</span>
            <strong data-summary-columns>${totalColumns}</strong>
          </article>
        </div>
      </div>
      <div class="table-reference-scroll" data-table-scroll>
        <table class="table-reference-excel-table">
          <thead>
            <tr>
              <th>テーブル名</th>
              <th>用途</th>
              <th>列順</th>
              <th>カラム名</th>
              <th>備考</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) => `
                  <tr
                    class="table-reference-row ${row.groupTone}"
                    data-table-reference-row
                    data-table-name="${escapeAttribute(row.tableName)}"
                    data-usage="${escapeAttribute(row.usageDisplay)}"
                    data-column-order="${escapeAttribute(String(row.columnOrder))}"
                    data-column-name="${escapeAttribute(row.columnName)}"
                    data-notes="${escapeAttribute(row.notes)}"
                  >
                    ${
                      row.isFirstRow
                        ? `
                          <td rowspan="${row.rowSpan}" class="table-merged-cell table-name-cell">${escapeHtml(row.tableName)}</td>
                          <td rowspan="${row.rowSpan}" class="table-merged-cell table-usage-column">${renderUsageCell(row.usage)}</td>
                        `.trim()
                        : ""
                    }
                    <td class="table-column-order-cell">${escapeHtml(String(row.columnOrder))}</td>
                    <td class="table-column-name-cell">${escapeHtml(row.columnName)}</td>
                    ${
                      row.isFirstRow
                        ? `<td rowspan="${row.rowSpan}" class="table-merged-cell table-notes-cell">${escapeHtml(row.notes)}</td>`
                        : ""
                    }
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `.trim();
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

function renderDiagramSection(
  diagrams: LegacyDiagram[],
  scope: "default" | "specification" | "refactor" | "design" = "default"
): string {
  if (diagrams.length === 0) {
    return `<p class="empty-value">図はありません。</p>`;
  }

  const scopeClass = scope === "default" ? "" : ` diagram-grid-${scope}`;
  return `<div class="diagram-grid${scopeClass}" data-diagram-scope="${escapeAttribute(scope)}">${diagrams
    .map((diagram) => renderDiagram(diagram))
    .join("")}</div>`;
}

function isRoadmapDiagram(diagram: LegacyDiagram): boolean {
  return /ロードマップ|roadmap/iu.test(diagram.title);
}

function getRefactorDisplayDiagrams(analysis: LegacyAnalysisDocument): LegacyDiagram[] {
  return analysis.refactoring.diagrams.filter((diagram) => !isRoadmapDiagram(diagram));
}

type RoadmapSchedule = {
  phase: LegacyRefactorPhase;
  phaseIndex: number;
  startSlot: number;
  endSlot: number;
  span: number;
  groupTone: "group-even" | "group-odd";
};

function buildRoadmapSchedules(phases: LegacyRefactorPhase[]): RoadmapSchedule[] {
  let cursor = 1;

  return phases.map((phase, phaseIndex) => {
    const phaseLoad = Math.max(
      1,
      phase.tasks.length + phase.outputs.length + phase.validations.length + Math.ceil(phase.risks.length / 2)
    );
    const span = Math.max(1, Math.min(3, Math.ceil(phaseLoad / 4)));
    const startSlot = cursor;
    const endSlot = startSlot + span - 1;
    cursor = endSlot + 1;

    return {
      phase,
      phaseIndex,
      startSlot,
      endSlot,
      span,
      groupTone: phaseIndex % 2 === 0 ? "group-even" : "group-odd"
    };
  });
}

function renderRoadmapTimeline(phases: LegacyRefactorPhase[]): string {
  const schedules = buildRoadmapSchedules(phases);
  const totalSlots = schedules.at(-1)?.endSlot ?? 0;
  const months = Array.from({ length: totalSlots }, (_, index) => `${index + 1}か月目`);

  return `
    <div class="roadmap-gantt">
      <p class="roadmap-intro">開始時点を1か月目として表示した目安です。フェーズ順と作業量をもとに期間バーを自動整形しています。</p>
      <div class="roadmap-gantt-scroll">
        <table class="roadmap-gantt-table">
          <thead>
            <tr>
              <th class="roadmap-gantt-phase-sticky">フェーズ</th>
              ${months.map((month) => `<th class="roadmap-gantt-month">${escapeHtml(month)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${schedules
              .map((schedule) =>
                `
                  <tr class="roadmap-gantt-row ${schedule.groupTone}">
                    <td class="roadmap-gantt-phase-cell">
                      <span class="roadmap-order-badge">STEP ${schedule.phaseIndex + 1}</span>
                      <strong>${escapeHtml(schedule.phase.phase)}</strong>
                      <span class="roadmap-order-caption">${escapeHtml(schedule.phase.objective || "該当なし")}</span>
                    </td>
                    ${months
                      .map((_, monthIndex) => {
                        const slot = monthIndex + 1;
                        const isActive = slot >= schedule.startSlot && slot <= schedule.endSlot;

                        if (!isActive) {
                          return `<td class="roadmap-gantt-slot"></td>`;
                        }

                        const barClasses = [
                          "roadmap-gantt-slot",
                          "is-active",
                          slot === schedule.startSlot ? "is-start" : "",
                          slot === schedule.endSlot ? "is-end" : ""
                        ]
                          .filter(Boolean)
                          .join(" ");

                        return `<td class="${barClasses}"><span class="roadmap-gantt-bar" aria-hidden="true"></span></td>`;
                      })
                      .join("")}
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `.trim();
}

function renderRoadmapDetails(phases: LegacyRefactorPhase[]): string {
  return `
    <div class="roadmap-detail-list">
      ${phases
        .map(
          (phase, index) => `
            <article class="roadmap-detail-card">
              <div class="roadmap-detail-header">
                <span class="roadmap-order-badge">STEP ${index + 1}</span>
                <h3>${escapeHtml(phase.phase)}</h3>
              </div>
              ${renderParagraph(phase.objective || "該当なし")}
              <section>
                <h4>実施タスク</h4>
                ${renderList(phase.tasks)}
              </section>
              <section>
                <h4>成果物</h4>
                ${renderList(phase.outputs)}
              </section>
              <section>
                <h4>確認ポイント</h4>
                ${renderList(phase.validations)}
              </section>
              <section>
                <h4>主なリスク</h4>
                ${renderList(phase.risks)}
              </section>
            </article>
          `
        )
        .join("")}
    </div>
  `.trim();
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
    ["テーブル", "検出カラム", "用途", "信頼度", "備考"],
    tables.map((table) => [
      table.name,
      table.columns.join(" / ") || "要確認",
      table.usage,
      table.confidence,
      table.notes
    ])
  );
}

function renderColumnMatrixTable(columns: string[]): string {
  const normalizedColumns = columns.length > 0 ? columns : ["要確認"];

  return `
    <table class="table-column-table">
      <thead>
        <tr><th>列順</th><th>列名</th></tr>
      </thead>
      <tbody>
        ${normalizedColumns
          .map(
            (column, index) => `<tr><td>${escapeHtml(String(index + 1))}</td><td>${escapeHtml(column)}</td></tr>`
          )
          .join("")}
      </tbody>
    </table>
  `.trim();
}

function renderTableReferenceCards(tables: LegacyTableReference[]): string {
  if (tables.length === 0) {
    return `<p class="empty-value">隧ｲ蠖薙↑縺・/p>`;
  }

  return `
    <p class="table-reference-note">
      SQL 文字列などコード上の記述から検出した列一覧です。型、主キー、NULL 制約などはコードだけでは確定できない場合があります。
    </p>
    <div class="table-reference-grid">
      ${tables
        .map(
          (table) => `
            <article class="table-reference-card">
              <div class="table-reference-header">
                <h3>${escapeHtml(table.name)}</h3>
                ${renderConfidenceBadge(table.confidence)}
              </div>
              <div class="table-reference-copy">
                <section>
                  <h4>用途</h4>
                  ${renderParagraph(table.usage || "要確認")}
                </section>
                <section>
                  <h4>備考</h4>
                  ${renderParagraph(table.notes || "要確認")}
                </section>
              </div>
              <section>
                <h4>列一覧</h4>
                ${renderColumnMatrixTable(table.columns)}
              </section>
            </article>
          `
        )
        .join("")}
    </div>
  `.trim();
}

function renderEndpointReferences(endpoints: LegacyEndpointReference[]): string {
  if (endpoints.length === 0) {
    return `
      <p class="empty-value">
        HTTP/HTTPS の外部API連携はコードから検出されませんでした。Access、CSV、Excelシートの入出力はエンドポイントには含みません。
      </p>
    `.trim();
  }

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
  const phases = analysis.refactoring.roadmap;

  if (phases.length === 0) {
    return `<p class="empty-value">ロードマップはありません。</p>`;
  }

  return `
    <div class="roadmap-plan">
      ${renderRoadmapTimeline(phases)}
      <div class="roadmap-detail-section">
        <h3>フェーズ詳細</h3>
        ${renderRoadmapDetails(phases)}
      </div>
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
        ${renderDiagramSection(analysis.specification.diagrams, "specification")}
      </section>
      <section class="document-section">
        <h2>テーブル / カラム</h2>
        ${renderTableReferenceExcelView(analysis.specification.tables, "specification")}
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
  const refactorDiagrams = getRefactorDisplayDiagrams(analysis);

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
      ${
        refactorDiagrams.length > 0
          ? `
            <section class="document-section">
              <h2>Mermaid図</h2>
              ${renderDiagramSection(refactorDiagrams, "refactor")}
            </section>
          `
          : ""
      }
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
        ${renderDiagramSection(analysis.design.diagrams, "design")}
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
        ${renderTableReferenceExcelView(analysis.design.tables, "design")}
      </section>
      <section class="document-section">
        <h2>目標エンドポイント / 外部連携</h2>
        ${renderEndpointReferences(analysis.design.endpoints)}
      </section>
      <section class="document-section">
        <h2>設計上のリスク</h2>
        ${renderList(analysis.design.risks)}
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
