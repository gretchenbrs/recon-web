"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type TableData = {
  name: string;
  columns: string[];
  rows: Record<string, string>[];
};

type ReconSpec = {
  keyA: string;
  keyB: string;
  amountA: string;
  amountB: string;
  tolerance: number;
  ignoreCase: boolean;
  flagDuplicates: boolean;
  detectOrphans: boolean;
  source: "fast_suggest" | "manual" | "llm";
};

type ExceptionRow = {
  id: string;
  amountA: string;
  amountB: string;
  difference: string;
  issueType: string;
  severity: "critical" | "high" | "medium" | "low";
};

type ReconResult = {
  matched: number;
  missingInB: number;
  missingInA: number;
  amountMismatches: number;
  nullKeyCount: number;
  duplicateKeyCount: number;
  totalA: number;
  totalB: number;
  totalErrorValue: number;
  avgMismatchError: number;
  maxMismatchError: number;
  matchRate: number;
  issueRate: number;
  orphanRate: number;
  joinCoverage: number;
  nullKeyRatio: number;
  duplicateKeyRatio: number;
  issueTotal: number;
  exceptions: ExceptionRow[];
};

type ChatMessage = {
  role: "assistant" | "user";
  content: string;
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCsv(text: string, name: string): TableData {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error(`${name}: CSV needs a header row and at least one data row.`);
  }

  const columns = lines[0].split(",").map((item) => item.trim());
  const rows = lines.slice(1).map((line) => {
    const values = line.split(",").map((item) => item.trim());
    const row: Record<string, string> = {};
    columns.forEach((column, index) => {
      row[column] = values[index] ?? "";
    });
    return row;
  });

  return { name, columns, rows };
}

function scorePair(columnA: string, columnB: string, requirement: string): number {
  const a = normalize(columnA);
  const b = normalize(columnB);
  const req = normalize(requirement);
  let score = 0;
  if (a === b) score += 10;
  if (a.includes(b) || b.includes(a)) score += 4;
  if (a.includes("id") && b.includes("id")) score += 5;
  if (a.includes("amount") && b.includes("amount")) score += 6;
  if (req.includes(a) || req.includes(b)) score += 2;
  return score;
}

function bestMatch(columnA: string, columnsB: string[], requirement: string): string {
  let best = columnsB[0] ?? "";
  let bestScore = -1;
  columnsB.forEach((candidate) => {
    const score = scorePair(columnA, candidate, requirement);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  });
  return best;
}

function parseTolerance(requirement: string): number {
  const found = requirement.match(
    /(?:tolerance|above|over|within|threshold|mismatch)\D{0,20}(\d+(?:\.\d+)?)/i
  );
  if (!found) return 0.01;
  const value = Number(found[1]);
  return Number.isFinite(value) ? value : 0.01;
}

function buildFastSuggestSpec(
  datasetA: TableData | null,
  datasetB: TableData | null,
  requirement: string
): ReconSpec | null {
  if (!datasetA || !datasetB || !datasetA.columns.length || !datasetB.columns.length) return null;

  const keyA =
    datasetA.columns.find((column) => normalize(column).includes("id")) ?? datasetA.columns[0];
  const amountA =
    datasetA.columns.find((column) => normalize(column).includes("amount")) ?? datasetA.columns[0];

  return {
    keyA,
    keyB: bestMatch(keyA, datasetB.columns, requirement),
    amountA,
    amountB: bestMatch(amountA, datasetB.columns, requirement),
    tolerance: parseTolerance(requirement),
    ignoreCase: true,
    flagDuplicates: true,
    detectOrphans: true,
    source: "fast_suggest",
  };
}

function parseNumber(raw: string): number | null {
  const value = Number(raw.replace(/[$,\s]/g, ""));
  return Number.isFinite(value) ? value : null;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function severityForDifference(diff: number): "critical" | "high" | "medium" | "low" {
  if (diff >= 5000) return "critical";
  if (diff >= 1000) return "high";
  if (diff >= 100) return "medium";
  return "low";
}

export default function Home() {
  const [datasetA, setDatasetA] = useState<TableData | null>(null);
  const [datasetB, setDatasetB] = useState<TableData | null>(null);
  const [requirement, setRequirement] = useState(
    "Match order_id to payment order_ref and flag amount mismatches above 0.01."
  );
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Upload both datasets, then describe your requirement. Fast Suggest runs automatically and fills Recon Spec.",
    },
  ]);
  const [spec, setSpec] = useState<ReconSpec | null>(null);
  const [manualEdited, setManualEdited] = useState(false);
  const [result, setResult] = useState<ReconResult | null>(null);
  const [error, setError] = useState("");
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState("");
  const [engineMode, setEngineMode] = useState<"fast" | "llm">("fast");
  const [requirementDocName, setRequirementDocName] = useState("");
  const [requirementDocHint, setRequirementDocHint] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportMarkdown, setReportMarkdown] = useState("");
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    if (manualEdited) return;
    const suggestion = buildFastSuggestSpec(datasetA, datasetB, requirement);
    if (suggestion) setSpec(suggestion);
  }, [datasetA, datasetB, requirement, manualEdited]);

  const datasetSummary = useMemo(() => {
    if (!datasetA || !datasetB) return "";
    return `A: ${datasetA.rows.length} rows / ${datasetA.columns.length} cols | B: ${datasetB.rows.length} rows / ${datasetB.columns.length} cols`;
  }, [datasetA, datasetB]);

  async function handleFileUpload(
    event: React.ChangeEvent<HTMLInputElement>,
    side: "A" | "B"
  ): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseCsv(text, file.name);
      setError("");
      setResult(null);

      if (side === "A") setDatasetA(parsed);
      if (side === "B") setDatasetB(parsed);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to parse CSV.");
    }
  }

  async function handleRequirementDocUpload(
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;

    setRequirementDocName(file.name);
    const lower = file.name.toLowerCase();
    const isTextLike =
      file.type.startsWith("text/") ||
      lower.endsWith(".txt") ||
      lower.endsWith(".md") ||
      lower.endsWith(".csv");

    if (isTextLike) {
      const text = (await file.text()).slice(0, 12000);
      setRequirement(text);
      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          content: `Loaded requirement document: ${file.name}`,
        },
      ]);
      setRequirementDocHint("Requirement loaded from document.");

      if (datasetA && datasetB) {
        setEngineMode("llm");
        await enhanceSpecWithLlm(text);
      } else {
        setRequirementDocHint(
          "Requirement loaded from document. Upload both datasets, then switch to LLM."
        );
      }
      return;
    }

    if (lower.endsWith(".pdf") || lower.endsWith(".docx") || lower.endsWith(".doc")) {
      setRequirementDocHint(
        "PDF/DOC parsing will be enabled next. For now, use txt/md or paste key requirements in chat."
      );
      return;
    }

    setRequirementDocHint("Unsupported file type. Use txt/md for now.");
  }

  function sendRequirement(): void {
    const content = chatInput.trim();
    if (!content) return;
    setMessages((prev) => [...prev, { role: "user", content }]);
    setRequirement(content);
    setChatInput("");
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content:
          "Requirement captured. Fast Suggest refreshed the spec. You can edit fields before running.",
      },
    ]);
  }

  async function enhanceSpecWithLlm(requirementOverride?: string): Promise<void> {
    if (!datasetA || !datasetB) {
      setLlmError("Upload both datasets before LLM enhancement.");
      return;
    }
    const effectiveRequirement = (requirementOverride ?? requirement).trim();
    if (!effectiveRequirement) {
      setLlmError("Add a requirement (text or document) before LLM enhancement.");
      return;
    }

    setLlmLoading(true);
    setLlmError("");

    try {
      const response = await fetch("/api/recon-spec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirement: effectiveRequirement,
          datasetAName: datasetA.name,
          datasetBName: datasetB.name,
          datasetAColumns: datasetA.columns,
          datasetBColumns: datasetB.columns,
          datasetASampleRows: datasetA.rows.slice(0, 5),
          datasetBSampleRows: datasetB.rows.slice(0, 5),
          currentSpec: spec,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "LLM request failed.");
      }

      const payload = await response.json();
      const nextSpec: ReconSpec = {
        keyA: payload.spec.keyA,
        keyB: payload.spec.keyB,
        amountA: payload.spec.amountA,
        amountB: payload.spec.amountB,
        tolerance: Number(payload.spec.tolerance ?? 0.01),
        ignoreCase: Boolean(payload.spec.ignoreCase),
        flagDuplicates: Boolean(payload.spec.flagDuplicates),
        detectOrphans: Boolean(payload.spec.detectOrphans),
        source: "llm",
      };

      setSpec(nextSpec);
      setManualEdited(true);
      setEngineMode("llm");
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "LLM enhancement complete. Recon Spec has been updated for your review.",
        },
      ]);
    } catch (enhanceError) {
      setLlmError(enhanceError instanceof Error ? enhanceError.message : "LLM enhancement failed.");
    } finally {
      setLlmLoading(false);
    }
  }

  function updateSpecField(field: keyof ReconSpec, value: string | number | boolean): void {
    setSpec((prev) => {
      if (!prev) return prev;
      return { ...prev, [field]: value, source: "manual" };
    });
    setManualEdited(true);
  }

  function resetToFastSuggest(): void {
    const suggestion = buildFastSuggestSpec(datasetA, datasetB, requirement);
    if (!suggestion) {
      setError("Upload both datasets first.");
      return;
    }
    setSpec(suggestion);
    setManualEdited(false);
    setEngineMode("fast");
    setError("");
    setLlmError("");
  }

  async function switchEngine(mode: "fast" | "llm"): Promise<void> {
    setEngineMode(mode);
    if (mode === "fast") {
      resetToFastSuggest();
      return;
    }
    await enhanceSpecWithLlm();
  }

  function runRecon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!datasetA || !datasetB) {
      setError("Please upload dataset A and dataset B.");
      return;
    }

    const activeSpec = spec ?? buildFastSuggestSpec(datasetA, datasetB, requirement);
    if (!activeSpec?.keyA || !activeSpec?.keyB || !activeSpec?.amountA || !activeSpec?.amountB) {
      setError("Please complete the mapping in Recon Spec.");
      return;
    }

    const mapB = new Map<string, Record<string, string>>();
    datasetB.rows.forEach((row) => mapB.set((row[activeSpec.keyB] ?? "").trim(), row));

    const keyFreq = new Map<string, number>();
    datasetA.rows.forEach((row) => {
      const key = (row[activeSpec.keyA] ?? "").trim();
      if (!key) return;
      keyFreq.set(key, (keyFreq.get(key) ?? 0) + 1);
    });

    const duplicateKeyCount = Array.from(keyFreq.values()).reduce((sum, count) => {
      return count > 1 ? sum + (count - 1) : sum;
    }, 0);

    let matched = 0;
    let missingInB = 0;
    let amountMismatches = 0;
    let totalErrorValue = 0;
    let maxMismatchError = 0;
    let nullKeyCount = 0;
    const exceptions: ExceptionRow[] = [];

    datasetA.rows.forEach((rowA, index) => {
      const key = (rowA[activeSpec.keyA] ?? "").trim();
      if (!key) {
        nullKeyCount += 1;
        if (exceptions.length < 50) {
          exceptions.push({
            id: `A-${index + 1}`,
            amountA: rowA[activeSpec.amountA] ?? "-",
            amountB: "-",
            difference: "-",
            issueType: "Null Key",
            severity: "medium",
          });
        }
        return;
      }

      const rowB = mapB.get(key);
      if (!rowB) {
        missingInB += 1;
        if (exceptions.length < 50) {
          const amountA = parseNumber(rowA[activeSpec.amountA]);
          exceptions.push({
            id: key,
            amountA: amountA === null ? "-" : formatCurrency(amountA),
            amountB: "-",
            difference: amountA === null ? "-" : formatCurrency(amountA),
            issueType: "Missing in B",
            severity: "high",
          });
        }
        return;
      }

      matched += 1;
      const amountA = parseNumber(rowA[activeSpec.amountA]);
      const amountB = parseNumber(rowB[activeSpec.amountB]);
      if (
        amountA !== null &&
        amountB !== null &&
        Math.abs(amountA - amountB) > activeSpec.tolerance
      ) {
        amountMismatches += 1;
        const diff = Math.abs(amountA - amountB);
        totalErrorValue += diff;
        if (diff > maxMismatchError) maxMismatchError = diff;

        if (exceptions.length < 50) {
          exceptions.push({
            id: key,
            amountA: formatCurrency(amountA),
            amountB: formatCurrency(amountB),
            difference: `${amountA - amountB >= 0 ? "+" : "-"}${formatCurrency(diff)}`,
            issueType: "Amount Mismatch",
            severity: severityForDifference(diff),
          });
        }
      }
    });

    const keysA = new Set(
      datasetA.rows
        .map((row) => (row[activeSpec.keyA] ?? "").trim())
        .filter((key) => key.length > 0)
    );
    let missingInA = 0;
    datasetB.rows.forEach((rowB, index) => {
      const key = (rowB[activeSpec.keyB] ?? "").trim();
      if (key && !keysA.has(key)) {
        missingInA += 1;
        if (exceptions.length < 50) {
          const amountB = parseNumber(rowB[activeSpec.amountB]);
          exceptions.push({
            id: key || `B-${index + 1}`,
            amountA: "-",
            amountB: amountB === null ? "-" : formatCurrency(amountB),
            difference: amountB === null ? "-" : `-${formatCurrency(amountB)}`,
            issueType: "Missing in A",
            severity: "high",
          });
        }
      }
    });

    const totalA = datasetA.rows.length;
    const totalB = datasetB.rows.length;
    const issueTotal = missingInB + missingInA + amountMismatches + nullKeyCount + duplicateKeyCount;
    const avgMismatchError = amountMismatches > 0 ? totalErrorValue / amountMismatches : 0;
    const matchRate = totalA > 0 ? matched / totalA : 0;
    const issueRate = totalA > 0 ? issueTotal / totalA : 0;
    const orphanRate = totalB > 0 ? missingInA / totalB : 0;
    const joinCoverage = totalA > 0 ? matched / totalA : 0;
    const nullKeyRatio = totalA > 0 ? nullKeyCount / totalA : 0;
    const duplicateKeyRatio = totalA > 0 ? duplicateKeyCount / totalA : 0;

    setResult({
      matched,
      missingInB,
      missingInA,
      amountMismatches,
      nullKeyCount,
      duplicateKeyCount,
      totalA,
      totalB,
      totalErrorValue,
      avgMismatchError,
      maxMismatchError,
      matchRate,
      issueRate,
      orphanRate,
      joinCoverage,
      nullKeyRatio,
      duplicateKeyRatio,
      issueTotal,
      exceptions,
    });
    setError("");
  }

  async function generateReport(): Promise<void> {
    if (!result || !spec) {
      setReportError("Run reconciliation first before generating report.");
      setReportOpen(true);
      return;
    }

    setReportLoading(true);
    setReportError("");
    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirement,
          spec,
          result,
          datasetSummary: {
            datasetA: datasetA?.name ?? "Dataset A",
            datasetB: datasetB?.name ?? "Dataset B",
            totalA: result.totalA,
            totalB: result.totalB,
          },
          exceptions: result.exceptions.slice(0, 20),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Failed to generate report.");
      }

      const payload = await response.json();
      setReportMarkdown(payload.reportMarkdown ?? "");
      setReportOpen(true);
    } catch (generateError) {
      setReportError(generateError instanceof Error ? generateError.message : "Report generation failed.");
      setReportOpen(true);
    } finally {
      setReportLoading(false);
    }
  }

  function downloadReport(): void {
    if (!reportMarkdown) return;
    const blob = new Blob([reportMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `reconciliation-report-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const summaryStatus = result ? (result.issueRate > 0.1 ? "Warning" : "Healthy") : "-";
  const chartItems = result
    ? [
        { label: "Missing in A", value: result.missingInA, color: "var(--c-red)" },
        { label: "Missing in B", value: result.missingInB, color: "var(--c-orange)" },
        { label: "Amount Mismatch", value: result.amountMismatches, color: "var(--c-yellow)" },
        { label: "Duplicates", value: result.duplicateKeyCount, color: "var(--c-blue)" },
        { label: "Orphan Records", value: result.nullKeyCount, color: "var(--c-purple)" },
      ]
    : [];
  const maxChart = chartItems.length ? Math.max(...chartItems.map((item) => item.value), 1) : 1;

  return (
    <main className="make-page">
      <header className="make-header">
        <div className="brand-row">
          <div className="brand-icon">R</div>
          <span>Recon Web</span>
        </div>
        <h1>Elegant reconciliation for messy operational data</h1>
        <p>
          Upload datasets, describe your requirement in chat, review AI-assisted Recon Spec, then
          run reconciliation and inspect the dashboard.
        </p>
      </header>

      <form onSubmit={runRecon} className="make-content">
        <section className="glass-card">
          <h2>1. Upload Data Sources</h2>
          <div className="upload-grid">
            <label className="upload-tile">
              <span>Dataset A</span>
              <input type="file" accept=".csv" onChange={(event) => void handleFileUpload(event, "A")} />
              <small>{datasetA ? datasetA.name : "CSV file"}</small>
            </label>
            <label className="upload-tile">
              <span>Dataset B</span>
              <input type="file" accept=".csv" onChange={(event) => void handleFileUpload(event, "B")} />
              <small>{datasetB ? datasetB.name : "CSV file"}</small>
            </label>
          </div>
          <p className="meta-line">{datasetSummary || "Upload both datasets to continue."}</p>
        </section>

        <section className="glass-card">
          <h2>2. Requirement Chat</h2>
          <div className="chat-panel">
            <div className="chat-messages">
              {messages.map((msg, idx) => (
                <div key={`${msg.role}-${idx}`} className={msg.role === "user" ? "msg user" : "msg ai"}>
                  {msg.content}
                </div>
              ))}
            </div>
            <div className="chat-input">
              <input
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="Describe matching rules, tolerance, or edge cases..."
              />
              <button type="button" onClick={sendRequirement}>
                Send
              </button>
            </div>
          </div>
          <div className="doc-upload-row">
            <label className="doc-upload">
              <span>Attach requirement doc</span>
              <input
                type="file"
                accept=".txt,.md,.pdf,.doc,.docx"
                onChange={(event) => void handleRequirementDocUpload(event)}
              />
            </label>
            <p className="meta-line">
              {requirementDocName ? `File: ${requirementDocName}` : "Optional: upload requirement document"}
            </p>
            {requirementDocHint ? <p className="meta-line">{requirementDocHint}</p> : null}
          </div>
        </section>

        <section className="glass-card recon-spec-wrap">
          <div className="title-row">
            <h2 className="step-title">
              <span className="step-dot">3</span>
              Recon Spec
            </h2>
            <div className="spec-actions">
              <div className="mode-switch">
                <button
                  type="button"
                  className={engineMode === "fast" ? "mode-btn active" : "mode-btn"}
                  onClick={() => void switchEngine("fast")}
                >
                  Fast Match
                </button>
                <button
                  type="button"
                  className={engineMode === "llm" ? "mode-btn active" : "mode-btn"}
                  onClick={() => void switchEngine("llm")}
                  disabled={llmLoading}
                >
                  {llmLoading ? "LLM..." : "LLM"}
                </button>
              </div>
            </div>
          </div>
          {llmError ? <p className="error-text">{llmError}</p> : null}
          {spec ? (
            <div className="recon-sections">
              <div className="section-box">
                <p className="section-title">MAPPING</p>
                <label>
                  Key Mapping
                  <div className="spec-grid">
                    <select value={spec.keyA} onChange={(event) => updateSpecField("keyA", event.target.value)}>
                      {datasetA?.columns.map((column) => (
                        <option key={column} value={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                    <select value={spec.keyB} onChange={(event) => updateSpecField("keyB", event.target.value)}>
                      {datasetB?.columns.map((column) => (
                        <option key={column} value={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                  </div>
                  <small>Fields used to match records across datasets</small>
                </label>
                <label>
                  Amount Mapping
                  <div className="spec-grid">
                    <select value={spec.amountA} onChange={(event) => updateSpecField("amountA", event.target.value)}>
                      {datasetA?.columns.map((column) => (
                        <option key={column} value={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                    <select value={spec.amountB} onChange={(event) => updateSpecField("amountB", event.target.value)}>
                      {datasetB?.columns.map((column) => (
                        <option key={column} value={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                  </div>
                  <small>Numeric fields to compare</small>
                </label>
              </div>

              <div className="section-box">
                <label className="tol-row">
                  Tolerance
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={spec.tolerance}
                    onChange={(event) => updateSpecField("tolerance", Number(event.target.value))}
                  />
                  <small>Maximum acceptable amount variance</small>
                </label>
              </div>

              <div className="section-box">
                <p>Additional Options</p>
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={spec.ignoreCase}
                    onChange={(event) => updateSpecField("ignoreCase", event.target.checked)}
                  />
                  Ignore case in key matching
                </label>
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={spec.flagDuplicates}
                    onChange={(event) => updateSpecField("flagDuplicates", event.target.checked)}
                  />
                  Flag duplicate records
                </label>
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={spec.detectOrphans}
                    onChange={(event) => updateSpecField("detectOrphans", event.target.checked)}
                  />
                  Detect orphan records
                </label>
              </div>
            </div>
          ) : (
            <p className="meta-line">Spec appears after both datasets are uploaded.</p>
          )}
        </section>

        <section className="dashboard-shell">
          <div className="title-row dashboard-top">
            <p className="ready-line">Spec ready - review and run when ready</p>
            <div className="run-actions">
              <button type="button" className="table-btn" onClick={() => void generateReport()} disabled={reportLoading}>
                {reportLoading ? "Generating..." : "Generate Report"}
              </button>
              <button type="submit" className="primary-btn">
                Run Reconciliation
              </button>
            </div>
          </div>
          {error ? <p className="error-text">{error}</p> : null}

          {result ? (
            <>
              <section className="dash-block summary">
                <h3>Summary</h3>
                <div className="summary-grid">
                  <article className="summary-main">
                    <p>Match Rate</p>
                    <div className="main-row">
                      <div className="main-number">{formatPercent(result.matchRate)}</div>
                      <div className="delta">+2.3%</div>
                    </div>
                    <div className="summary-bar">
                      <span style={{ width: `${result.matchRate * 100}%` }} />
                    </div>
                    <small>
                      {result.matched} of {result.totalA} records matched
                    </small>
                  </article>
                  <article>
                    <p>Status</p>
                    <strong>{summaryStatus}</strong>
                    <small>{result.issueTotal} issues require review</small>
                  </article>
                  <article>
                    <p>Issue Rate</p>
                    <strong>{formatPercent(result.issueRate)}</strong>
                    <small>{result.issueTotal} records with issues</small>
                  </article>
                </div>
              </section>

              <section className="dash-block">
                <h3>Error Breakdown</h3>
                <div className="error-grid">
                  <div className="breakdown-bars">
                    <p className="chart-title">Issue Distribution</p>
                    <div className="vbars">
                      {chartItems.map((item) => (
                        <div key={item.label} className="vbar-item">
                          <div className="vbar-wrap">
                            <span
                              className="vbar"
                              style={{
                                height: `${Math.max(8, (item.value / maxChart) * 100)}%`,
                                background: item.color,
                              }}
                            />
                          </div>
                          <div className="vbar-label">{item.label}</div>
                        </div>
                      ))}
                    </div>
                    <div className="chart-scale">
                      <span>0</span>
                      <span>{maxChart}</span>
                    </div>
                  </div>
                  <div className="mini-cards">
                    <article>
                      <p>Missing in A</p>
                      <strong>{result.missingInA}</strong>
                    </article>
                    <article>
                      <p>Missing in B</p>
                      <strong>{result.missingInB}</strong>
                    </article>
                    <article>
                      <p>Amount mismatch</p>
                      <strong>{result.amountMismatches}</strong>
                    </article>
                    <article>
                      <p>Duplicate records</p>
                      <strong>{result.duplicateKeyCount}</strong>
                    </article>
                  </div>
                </div>
              </section>

              <section className="dash-block">
                <h3>Financial Impact</h3>
                <div className="financial-grid">
                  <article>
                    <p>Total Mismatch Value</p>
                    <strong>{formatCurrency(result.totalErrorValue)}</strong>
                    <small>Across {result.amountMismatches} records</small>
                  </article>
                  <article>
                    <p>Net Difference</p>
                    <strong className="good">{`+${formatCurrency(result.totalErrorValue)}`}</strong>
                    <small>Dataset A higher</small>
                  </article>
                  <article>
                    <p>Avg Mismatch</p>
                    <strong>{formatCurrency(result.avgMismatchError)}</strong>
                    <small>Per discrepancy</small>
                  </article>
                  <article>
                    <p>Max Mismatch</p>
                    <strong className="bad">{formatCurrency(result.maxMismatchError)}</strong>
                    <small>Highest error in one key</small>
                  </article>
                </div>
              </section>

              <section className="dash-block quality">
                <h3>Data Quality Metrics</h3>
                <div className="quality-grid">
                  <article>
                    <p>Join Coverage</p>
                    <strong>{formatPercent(result.joinCoverage)}</strong>
                    <div className="quality-track">
                      <span style={{ width: `${result.joinCoverage * 100}%` }} />
                    </div>
                    <small>
                      {Math.round(result.joinCoverage * result.totalA)} of {result.totalA} keys joined
                    </small>
                  </article>
                  <article>
                    <p>Null Key Ratio</p>
                    <strong>{formatPercent(result.nullKeyRatio)}</strong>
                    <div className="quality-track">
                      <span style={{ width: `${result.nullKeyRatio * 100}%` }} />
                    </div>
                    <small>{result.nullKeyCount} records with null keys</small>
                  </article>
                  <article>
                    <p>Duplicate Key Ratio</p>
                    <strong>{formatPercent(result.duplicateKeyRatio)}</strong>
                    <div className="quality-track">
                      <span style={{ width: `${result.duplicateKeyRatio * 100}%` }} />
                    </div>
                    <small>{result.duplicateKeyCount} duplicate key instances</small>
                  </article>
                </div>
              </section>

              <section className="dash-block">
                <div className="table-head">
                  <div className="left">
                    <h3>Exception Details</h3>
                    <span className="issue-pill">{result.issueTotal} issues</span>
                  </div>
                  <div className="right">
                    <button type="button" className="table-btn">
                      Filter
                    </button>
                    <button type="button" className="table-btn">
                      Export
                    </button>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Order ID</th>
                        <th>Amount A</th>
                        <th>Amount B</th>
                        <th>Difference</th>
                        <th>Issue Type</th>
                        <th>Severity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.exceptions.slice(0, 12).map((row) => (
                        <tr key={`${row.id}-${row.issueType}-${row.difference}`}>
                          <td className="mono">{row.id}</td>
                          <td>{row.amountA}</td>
                          <td>{row.amountB}</td>
                          <td className={row.difference.startsWith("-") ? "diff bad" : "diff good"}>
                            {row.difference}
                          </td>
                          <td>{row.issueType}</td>
                          <td>
                            <span className={`sev ${row.severity}`}>{row.severity}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="meta-line">
                  Showing {Math.min(12, result.exceptions.length)} of {result.issueTotal} exceptions
                </p>
              </section>
            </>
          ) : (
            <section className="dash-block">
              <p className="meta-line">Run reconciliation to generate dashboard sections.</p>
            </section>
          )}
        </section>
      </form>

      {reportOpen ? (
        <div className="report-modal-backdrop" role="dialog" aria-modal="true">
          <div className="report-modal">
            <div className="report-modal-head">
              <h3>Reconciliation Report (Markdown)</h3>
              <div className="run-actions">
                <button type="button" className="table-btn" onClick={downloadReport} disabled={!reportMarkdown}>
                  Download .md
                </button>
                <button type="button" className="table-btn" onClick={() => navigator.clipboard.writeText(reportMarkdown)} disabled={!reportMarkdown}>
                  Copy
                </button>
                <button type="button" className="light-btn" onClick={() => setReportOpen(false)}>
                  Close
                </button>
              </div>
            </div>
            {reportError ? <p className="error-text">{reportError}</p> : null}
            <textarea
              className="report-markdown"
              value={reportMarkdown}
              onChange={(event) => setReportMarkdown(event.target.value)}
              placeholder="Report markdown will appear here."
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}
