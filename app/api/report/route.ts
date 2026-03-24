import { NextRequest, NextResponse } from "next/server";

type ReportRequest = {
  requirement: string;
  spec: Record<string, unknown>;
  result: Record<string, unknown>;
  datasetSummary: Record<string, unknown>;
  exceptions: Array<Record<string, unknown>>;
};

function fallbackReport(body: ReportRequest): string {
  return `# Data Reconciliation Report

## 1. Requirement
${body.requirement || "No requirement provided."}

## 2. Dataset Scope
- Dataset A: ${String(body.datasetSummary.datasetA ?? "N/A")}
- Dataset B: ${String(body.datasetSummary.datasetB ?? "N/A")}
- Records in A: ${String(body.datasetSummary.totalA ?? "N/A")}
- Records in B: ${String(body.datasetSummary.totalB ?? "N/A")}

## 3. Recon Spec
\`\`\`json
${JSON.stringify(body.spec, null, 2)}
\`\`\`

## 4. Dashboard Metrics
\`\`\`json
${JSON.stringify(body.result, null, 2)}
\`\`\`

## 5. Exception Samples
\`\`\`json
${JSON.stringify(body.exceptions, null, 2)}
\`\`\`

## 6. Analyst Notes
- Match quality appears in the dashboard metrics above.
- Prioritize critical and high severity exceptions first.
- Re-run reconciliation after resolving schema and key-quality issues.
`;
}

export async function POST(request: NextRequest) {
  let body: ReportRequest;
  try {
    body = (await request.json()) as ReportRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ reportMarkdown: fallbackReport(body), source: "fallback" });
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const systemText =
    "You are a reconciliation reporting assistant. Produce a concise professional markdown report with sections: Executive Summary, Requirement, Scope, Recon Spec, Dashboard Analysis, Top Exceptions, Recommendations.";

  const inputPayload = {
    requirement: body.requirement,
    datasetSummary: body.datasetSummary,
    spec: body.spec,
    result: body.result,
    exceptions: body.exceptions,
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      input: [
        { role: "system", content: [{ type: "input_text", text: systemText }] },
        { role: "user", content: [{ type: "input_text", text: JSON.stringify(inputPayload) }] },
      ],
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ reportMarkdown: fallbackReport(body), source: "fallback" });
  }

  const data = (await response.json()) as { output_text?: string };
  const reportMarkdown = data.output_text?.trim();
  if (!reportMarkdown) {
    return NextResponse.json({ reportMarkdown: fallbackReport(body), source: "fallback" });
  }

  return NextResponse.json({ reportMarkdown, source: "llm" });
}
