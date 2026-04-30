const DOCUMENT_LABELS = {
  spec: "現状仕様書",
  issues: "問題点分析",
  refactor: "詳細リファクタリング案",
  design: "リファクタリング設計書"
};

const analyzeButton = document.getElementById("analyze-button");
const clearFilesButton = document.getElementById("clear-files-button");
const codeInput = document.getElementById("code-input");
const fileInput = document.getElementById("file-input");
const projectNameInput = document.getElementById("project-name-input");
const statusText = document.getElementById("status-text");
const sourceText = document.getElementById("source-text");
const fileList = document.getElementById("file-list");
const analysisSummary = document.getElementById("analysis-summary");
const exportButtons = [...document.querySelectorAll(".export-button")];

const outputs = {
  spec: document.getElementById("spec-output"),
  issues: document.getElementById("issues-output"),
  refactor: document.getElementById("refactor-output"),
  design: document.getElementById("design-output")
};

let sourceName = "input.bas";
let currentAnalysis = null;
let selectedFiles = [];
let activeFileName = null;
let mermaidInitialized = false;

codeInput.value = "";

function setBusy(isBusy) {
  analyzeButton.disabled = isBusy;
  fileInput.disabled = isBusy;
  clearFilesButton.disabled = isBusy;
}

function updateDownloadButtons() {
  const hasAnalysis = Boolean(currentAnalysis);

  exportButtons.forEach((button) => {
    button.disabled = !hasAnalysis;
  });
}

function getActiveFile() {
  if (selectedFiles.length === 0) {
    activeFileName = null;
    return null;
  }

  const activeFile = selectedFiles.find((file) => file.fileName === activeFileName) ?? selectedFiles[0];
  activeFileName = activeFile.fileName;
  return activeFile;
}

function refreshCodeEditor() {
  const activeFile = getActiveFile();

  if (!activeFile) {
    codeInput.readOnly = false;
    return;
  }

  codeInput.value = activeFile.code;
  codeInput.readOnly = false;
}

function renderFileList() {
  if (selectedFiles.length === 0) {
    fileList.innerHTML = '<span class="empty-file">ファイル未選択</span>';
    sourceText.textContent = "入力: コード貼り付けモード";
    return;
  }

  const activeFile = getActiveFile();
  fileList.innerHTML = selectedFiles
    .map(
      (file) => `
        <button
          class="file-pill${file.fileName === activeFile?.fileName ? " is-active" : ""}"
          type="button"
          data-file-name="${escapeHtml(file.fileName)}"
          aria-pressed="${file.fileName === activeFile?.fileName ? "true" : "false"}"
        >
          ${escapeHtml(file.fileName)}
        </button>
      `.trim()
    )
    .join("");

  sourceText.textContent =
    selectedFiles.length === 1
      ? `入力: ${selectedFiles[0].fileName}`
      : `入力: ${selectedFiles.length}ファイルを選択中 | 表示中: ${activeFile?.fileName ?? selectedFiles[0].fileName}`;
}

function setDefaultOutputs() {
  outputs.spec.textContent = "ここに現状仕様書が表示されます。";
  outputs.issues.textContent = "ここに問題点分析が表示されます。";
  outputs.refactor.textContent = "ここに詳細リファクタリング案が表示されます。";
  outputs.design.textContent = "ここにリファクタリング設計書が表示されます。";
}

function setFallbackOutputs(specText, designText) {
  outputs.spec.textContent = specText || "現状仕様書を表示できませんでした。";
  outputs.issues.textContent = "旧レスポンスのため問題点分析は表示できません。";
  outputs.refactor.textContent = "旧レスポンスのため詳細リファクタリング案は表示できません。";
  outputs.design.textContent = designText || "リファクタリング設計書を表示できませんでした。";
}

function updateSummaryCards(fileCount, issueCount, tableCount, roadmapCount) {
  analysisSummary.innerHTML = `
    <article class="summary-card">
      <strong>${fileCount}</strong>
      <span>対象ファイル</span>
    </article>
    <article class="summary-card">
      <strong>${issueCount}</strong>
      <span>主要問題点</span>
    </article>
    <article class="summary-card">
      <strong>${tableCount}</strong>
      <span>候補テーブル</span>
    </article>
    <article class="summary-card">
      <strong>${roadmapCount}</strong>
      <span>リファクタリング段階</span>
    </article>
  `;
}

function resetOutputs() {
  currentAnalysis = null;
  setDefaultOutputs();
  updateSummaryCards(0, 0, 0, 0);
  updateDownloadButtons();
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildPreview(files) {
  return files
    .map((file) => `\' ===== File: ${file.fileName} =====\n${file.code}`)
    .join("\n\n");
}

function mergeSelectedFiles(existingFiles, incomingFiles) {
  const mergedFiles = [...existingFiles];
  let addedCount = 0;
  let replacedCount = 0;

  incomingFiles.forEach((incomingFile) => {
    const existingIndex = mergedFiles.findIndex((file) => file.fileName === incomingFile.fileName);

    if (existingIndex >= 0) {
      mergedFiles[existingIndex] = incomingFile;
      replacedCount += 1;
      return;
    }

    mergedFiles.push(incomingFile);
    addedCount += 1;
  });

  return {
    mergedFiles,
    addedCount,
    replacedCount
  };
}

function buildFileReadStatus(incomingCount, totalCount, addedCount, replacedCount) {
  if (totalCount === 0) {
    return "読み込めるVBAファイルが見つかりませんでした。";
  }

  const actions = [];

  if (addedCount > 0) {
    actions.push(`${addedCount}ファイルを追加`);
  }

  if (replacedCount > 0) {
    actions.push(`${replacedCount}ファイルを更新`);
  }

  const actionText = actions.length > 0 ? actions.join("、") : `${incomingCount}ファイルを確認`;

  if (totalCount > 1) {
    return `${actionText}しました。現在 ${totalCount} ファイルを選択中です。ファイル名をクリックするとコード表示を切り替えられます。`;
  }

  return `ファイルを読み込みました: ${selectedFiles[0]?.fileName || "input.bas"}`;
}

function clearSelectedFiles() {
  selectedFiles = [];
  activeFileName = null;
  fileInput.value = "";
  codeInput.readOnly = false;
  sourceName = "input.bas";
  renderFileList();
}

async function readLocalFiles(fileListValue) {
  const files = await Promise.all(
    [...fileListValue].map(async (file) => ({
      fileName: file.name,
      code: await file.text()
    }))
  );

  const normalizedIncomingFiles = files.filter((file) => file.code.trim());
  const { mergedFiles, addedCount, replacedCount } = mergeSelectedFiles(selectedFiles, normalizedIncomingFiles);

  selectedFiles = mergedFiles;
  activeFileName = normalizedIncomingFiles[0]?.fileName ?? selectedFiles[0]?.fileName ?? null;
  sourceName = selectedFiles[0]?.fileName || "input.bas";
  fileInput.value = "";
  resetOutputs();
  refreshCodeEditor();
  renderFileList();
  statusText.textContent = buildFileReadStatus(
    normalizedIncomingFiles.length,
    selectedFiles.length,
    addedCount,
    replacedCount
  );
}

function syncActiveFileEdit() {
  const activeFile = getActiveFile();

  if (activeFile) {
    activeFile.code = codeInput.value;
  }
}

function setActiveFile(fileName) {
  if (!selectedFiles.some((file) => file.fileName === fileName)) {
    return;
  }

  activeFileName = fileName;
  refreshCodeEditor();
  renderFileList();
}

function buildAnalyzePayload() {
  const projectName = projectNameInput.value.trim();

  if (selectedFiles.length > 0) {
    return {
      files: selectedFiles,
      mode: "gemini",
      sourceName,
      projectName: projectName || undefined
    };
  }

  return {
    code: codeInput.value.trim(),
    mode: "gemini",
    sourceName,
    projectName: projectName || undefined
  };
}

function validateBeforeAnalyze(payload) {
  if (payload.files?.length) {
    return true;
  }

  if (!payload.code) {
    statusText.textContent = "VBAコードを入力してください。";
    return false;
  }

  return true;
}

function ensureMermaid() {
  if (mermaidInitialized || !window.mermaid) {
    return;
  }

  window.mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: "neutral",
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true
    },
    gantt: {
      leftPadding: 180,
      rightPadding: 32,
      gridLineStartPadding: 160,
      topPadding: 48,
      barHeight: 26,
      barGap: 8,
      fontSize: 13,
      sectionFontSize: 13
    }
  });
  mermaidInitialized = true;
}

async function renderMermaid(root) {
  if (!root || !window.mermaid) {
    return;
  }

  const nodes = [...root.querySelectorAll(".mermaid")];

  if (nodes.length === 0) {
    return;
  }

  ensureMermaid();

  try {
    await window.mermaid.run({
      nodes,
      suppressErrors: true
    });
  } catch (error) {
    console.error(error);
  }
}

async function renderAllMermaid() {
  for (const root of Object.values(outputs)) {
    await renderMermaid(root);
  }
}

function updateSummaryFromAnalysis(analysis) {
  updateSummaryCards(
    analysis.targetFiles?.length || 0,
    analysis.issues?.findings?.length || 0,
    analysis.specification?.tables?.length || 0,
    analysis.refactoring?.roadmap?.length || 0
  );
}

async function analyze() {
  const payload = buildAnalyzePayload();

  if (!validateBeforeAnalyze(payload)) {
    return;
  }

  setBusy(true);
  statusText.textContent = "解析を実行しています...";

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "解析に失敗しました。");
    }

    if (
      data.rendered?.specHtml &&
      data.rendered?.issuesHtml &&
      data.rendered?.refactorHtml &&
      data.rendered?.designHtml &&
      data.analysis
    ) {
      currentAnalysis = data.analysis;
      outputs.spec.innerHTML = data.rendered.specHtml;
      outputs.issues.innerHTML = data.rendered.issuesHtml;
      outputs.refactor.innerHTML = data.rendered.refactorHtml;
      outputs.design.innerHTML = data.rendered.designHtml;
      updateSummaryFromAnalysis(data.analysis);
      updateDownloadButtons();
      await renderAllMermaid();
    } else if (data.documents?.generated_spec || data.documents?.generated_design) {
      currentAnalysis = null;
      setFallbackOutputs(data.documents.generated_spec, data.documents.generated_design);
      updateSummaryCards(0, 0, 0, 0);
      updateDownloadButtons();
      statusText.textContent =
        "古いバックエンド応答を受信しました。サーバーを再起動すると新しい4成果物の出力が使えます。";
      return;
    } else {
      throw new Error("解析結果の形式が不正です。サーバーを再起動してください。");
    }

    const notices = [];

    if (data.notice) {
      notices.push(data.notice);
    } else {
      notices.push("解析が完了しました。");
    }

    if (data.cache?.reused) {
      notices.push("保存済みの要約JSONを再利用しました。");
    }

    if (data.modeUsed === "gemini" && data.modelUsage?.projectModel) {
      notices.push(`統合モデル: ${data.modelUsage.projectModel}`);
    }

    statusText.textContent = notices.join(" ");
  } catch (error) {
    resetOutputs();
    statusText.textContent = error instanceof Error ? error.message : "解析に失敗しました。";
  } finally {
    setBusy(false);
  }
}

async function exportDocument(documentType, format) {
  if (!currentAnalysis) {
    statusText.textContent = "先に解析を実行してください。";
    return;
  }

  statusText.textContent = `${DOCUMENT_LABELS[documentType]} を出力しています...`;

  const endpoint = format === "pdf" ? "/api/export/pdf" : "/api/export/word";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        analysis: currentAnalysis,
        documentType,
        sourceName
      })
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.message || "ダウンロードの生成に失敗しました。");
    }

    const blob = await response.blob();
    const fileName =
      getFileNameFromResponse(response) ||
      `${sourceName.replace(/\.[^.]+$/, "")}_${documentType}.${format}`;
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);

    statusText.textContent = `${DOCUMENT_LABELS[documentType]} のダウンロードを開始しました。`;
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : "ダウンロードに失敗しました。";
  }
}

function getFileNameFromResponse(response) {
  const disposition = response.headers.get("Content-Disposition");

  if (!disposition) {
    return "";
  }

  const match = disposition.match(/filename="([^"]+)"/i);
  return match ? match[1] : "";
}

analyzeButton.addEventListener("click", () => {
  void analyze();
});

clearFilesButton.addEventListener("click", () => {
  clearSelectedFiles();
  statusText.textContent = "ファイル選択を解除しました。";
});

fileInput.addEventListener("change", (event) => {
  const files = event.target.files;

  if (!files?.length) {
    return;
  }

  void readLocalFiles(files);
});

codeInput.addEventListener("input", () => {
  syncActiveFileEdit();
});

fileList.addEventListener("click", (event) => {
  const target = event.target.closest("[data-file-name]");

  if (!target) {
    return;
  }

  setActiveFile(target.dataset.fileName || "");
});

exportButtons.forEach((button) => {
  button.addEventListener("click", () => {
    void exportDocument(button.dataset.documentType, button.dataset.format);
  });
});

renderFileList();
resetOutputs();
