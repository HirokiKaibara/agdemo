const analyzeButton = document.getElementById("analyze-button");
const codeInput = document.getElementById("code-input");
const modeSelect = document.getElementById("mode-select");
const fileInput = document.getElementById("file-input");
const statusText = document.getElementById("status-text");
const specOutput = document.getElementById("spec-output");
const designOutput = document.getElementById("design-output");
const specPdfButton = document.getElementById("spec-pdf-button");
const specDocxButton = document.getElementById("spec-docx-button");
const designPdfButton = document.getElementById("design-pdf-button");
const designDocxButton = document.getElementById("design-docx-button");

let sourceName = "input.bas";
let currentAnalysis = null;

codeInput.value = "";

function setBusy(isBusy) {
  analyzeButton.disabled = isBusy;
  fileInput.disabled = isBusy;
}

function updateDownloadButtons() {
  const hasAnalysis = Boolean(currentAnalysis);

  specPdfButton.disabled = !hasAnalysis;
  specDocxButton.disabled = !hasAnalysis;
  designPdfButton.disabled = !hasAnalysis;
  designDocxButton.disabled = !hasAnalysis;
}

function resetOutputs() {
  currentAnalysis = null;
  specOutput.textContent = "ここに簡易仕様書が表示されます。";
  designOutput.textContent = "ここに簡易設計書が表示されます。";
  updateDownloadButtons();
}

function renderLegacyTextFallback(specText, designText) {
  currentAnalysis = null;
  specOutput.textContent = specText || "簡易仕様書を表示できませんでした。";
  designOutput.textContent = designText || "簡易設計書を表示できませんでした。";
  updateDownloadButtons();
}

async function analyze() {
  const code = codeInput.value.trim();

  if (!code) {
    statusText.textContent = "VBAコードを入力してください。";
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
      body: JSON.stringify({
        code,
        mode: modeSelect.value,
        sourceName
      })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "解析に失敗しました。");
    }

    if (data.rendered?.specHtml && data.rendered?.designHtml && data.analysis) {
      currentAnalysis = data.analysis;
      specOutput.innerHTML = data.rendered.specHtml;
      designOutput.innerHTML = data.rendered.designHtml;
      updateDownloadButtons();
    } else if (data.documents?.generated_spec || data.documents?.generated_design) {
      renderLegacyTextFallback(data.documents.generated_spec, data.documents.generated_design);
      statusText.textContent =
        "古いバックエンド応答を受信しました。サーバーを再起動すると新しいWord/PDF出力が使えます。";
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

    if (data.modeUsed === "gemini" && data.modelUsage?.mainModel) {
      notices.push(`主処理モデル: ${data.modelUsage.mainModel}`);
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

  statusText.textContent = "ダウンロード用の文書を生成しています...";

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
    const fileName = getFileNameFromResponse(response)
      || `${sourceName.replace(/\.[^.]+$/, "")}_${documentType}.${format}`;
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);

    statusText.textContent = "ダウンロードを開始しました。";
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

async function readLocalFile(file) {
  const text = await file.text();
  sourceName = file.name;
  codeInput.value = text;
  resetOutputs();
  statusText.textContent = `ファイルを読み込みました: ${file.name}`;
}

analyzeButton.addEventListener("click", () => {
  void analyze();
});

fileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  void readLocalFile(file);
});

specPdfButton.addEventListener("click", () => {
  void exportDocument("spec", "pdf");
});

specDocxButton.addEventListener("click", () => {
  void exportDocument("spec", "docx");
});

designPdfButton.addEventListener("click", () => {
  void exportDocument("design", "pdf");
});

designDocxButton.addEventListener("click", () => {
  void exportDocument("design", "docx");
});

updateDownloadButtons();
