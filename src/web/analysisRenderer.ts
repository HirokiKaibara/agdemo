import type { LegacyAnalysisDocument, LegacyFileSummary, LegacyFunctionSummary, RenderedDocumentBundle } from "../legacy-analyzer/types.js";

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

function renderList(items: string[], ordered = false): string {
  if (items.length === 0) {
    return `<p class="empty-value">該当なし</p>`;
  }

  const tag = ordered ? "ol" : "ul";
  const listItems = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  return `<${tag}>${listItems}</${tag}>`;
}

function renderKeyValueTable(rows: Array<[string, string]>): string {
  const body = rows
    .map(
      ([label, value]) =>
        `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
    )
    .join("");

  return `<table><tbody>${body}</tbody></table>`;
}

function renderFunctionCards(file: LegacyFileSummary): string {
  if (file.mainFunctions.length === 0) {
    return `<p class="empty-value">主要関数は検出されませんでした。</p>`;
  }

  return file.mainFunctions
    .map((fn) => renderFunctionCard(fn))
    .join("");
}

function renderFunctionCard(fn: LegacyFunctionSummary): string {
  return `
    <article class="function-card section-listing">
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
        <h5>処理概要</h5>
        ${renderList(fn.process, true)}
      </section>
      <section>
        <h5>注意点</h5>
        ${renderList(fn.notes)}
      </section>
    </article>
  `.trim();
}

function renderTargetFilesTable(analysis: LegacyAnalysisDocument): string {
  if (analysis.targetFiles.length === 0) {
    return `<p class="empty-value">対象ファイルはありません。</p>`;
  }

  const rows = analysis.targetFiles
    .map(
      (file) => `
        <tr>
          <td>${escapeHtml(file.fileName)}</td>
          <td>${escapeHtml(file.role)}</td>
          <td>${escapeHtml(file.summary)}</td>
        </tr>
      `
    )
    .join("");

  return `
    <table>
      <thead>
        <tr>
          <th>ファイル</th>
          <th>役割</th>
          <th>要約</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `.trim();
}

function renderFeatureTable(analysis: LegacyAnalysisDocument): string {
  if (analysis.specification.features.length === 0) {
    return `<p class="empty-value">機能要約はありません。</p>`;
  }

  const rows = analysis.specification.features
    .map(
      (feature) => `
        <tr>
          <td>${escapeHtml(feature.name)}</td>
          <td>${escapeHtml(feature.description)}</td>
          <td>${escapeHtml(feature.inputs.join(" / ") || "該当なし")}</td>
          <td>${escapeHtml(feature.outputs.join(" / ") || "該当なし")}</td>
          <td>${escapeHtml(feature.businessRules.join(" / ") || "該当なし")}</td>
        </tr>
      `
    )
    .join("");

  return `
    <table>
      <thead>
        <tr>
          <th>機能</th>
          <th>説明</th>
          <th>入力</th>
          <th>出力</th>
          <th>業務ルール候補</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `.trim();
}

function renderModuleTable(analysis: LegacyAnalysisDocument): string {
  if (analysis.design.modules.length === 0) {
    return `<p class="empty-value">モジュール要約はありません。</p>`;
  }

  const rows = analysis.design.modules
    .map(
      (module) => `
        <tr>
          <td>${escapeHtml(module.name)}</td>
          <td>${escapeHtml(module.responsibility)}</td>
          <td>${escapeHtml(module.relatedFiles.join(" / ") || "該当なし")}</td>
        </tr>
      `
    )
    .join("");

  return `
    <table>
      <thead>
        <tr>
          <th>モジュール</th>
          <th>責務</th>
          <th>関連ファイル</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `.trim();
}

export function renderSpecificationHtml(analysis: LegacyAnalysisDocument): string {
  const fileSections = analysis.targetFiles
    .map(
      (file) => `
        <section class="document-section section-listing">
          <h3>${escapeHtml(file.fileName)}</h3>
          ${renderKeyValueTable([
            ["役割", file.role],
            ["要約", file.summary]
          ])}
          <div class="function-card-list">
            ${renderFunctionCards(file)}
          </div>
        </section>
      `
    )
    .join("");

  return `
    <div class="document-view">
      <section class="document-section">
        <h1>簡易仕様書</h1>
        ${renderKeyValueTable([
          ["プロジェクト", analysis.projectName],
          ["要約", analysis.summary]
        ])}
      </section>
      <section class="document-section">
        <h2>概要</h2>
        ${renderParagraph(analysis.specification.overview)}
      </section>
      <section class="document-section">
        <h2>対象ファイル</h2>
        ${renderTargetFilesTable(analysis)}
      </section>
      <section class="document-section section-listing">
        <h2>主な機能</h2>
        ${renderFeatureTable(analysis)}
      </section>
      <section class="document-section section-listing">
        <h2>ファイル別の主要関数</h2>
        ${fileSections || `<p class="empty-value">対象ファイルはありません。</p>`}
      </section>
    </div>
  `.trim();
}

export function renderDesignHtml(analysis: LegacyAnalysisDocument): string {
  return `
    <div class="document-view">
      <section class="document-section">
        <h1>簡易設計書</h1>
        ${renderKeyValueTable([
          ["プロジェクト", analysis.projectName],
          ["全体要約", analysis.summary]
        ])}
      </section>
      <section class="document-section">
        <h2>アーキテクチャ</h2>
        ${renderParagraph(analysis.design.architecture)}
      </section>
      <section class="document-section section-listing">
        <h2>モジュール一覧</h2>
        ${renderModuleTable(analysis)}
      </section>
      <section class="document-section">
        <h2>データフロー</h2>
        ${renderList(analysis.design.dataFlow, true)}
      </section>
      <section class="document-section">
        <h2>リスク・注意点</h2>
        ${renderList(analysis.design.risks)}
      </section>
      <section class="document-section section-listing">
        <h2>対象ファイルとの対応</h2>
        ${renderTargetFilesTable(analysis)}
      </section>
    </div>
  `.trim();
}

export function renderAnalysisDocuments(analysis: LegacyAnalysisDocument): RenderedDocumentBundle {
  return {
    specHtml: renderSpecificationHtml(analysis),
    designHtml: renderDesignHtml(analysis)
  };
}
