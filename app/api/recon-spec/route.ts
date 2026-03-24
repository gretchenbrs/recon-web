import { NextRequest, NextResponse } from "next/server";

type ReconSpecPayload = {
  requirement: string;
  datasetAName: string;
  datasetBName: string;
  datasetAColumns: string[];
  datasetBColumns: string[];
  datasetASampleRows: Record<string, string>[];
  datasetBSampleRows: Record<string, string>[];
  currentSpec?: {
    keyA?: string;
    keyB?: string;
    amountA?: string;
    amountB?: string;
    tolerance?: number;
    ignoreCase?: boolean;
    flagDuplicates?: boolean;
    detectOrphans?: boolean;
  } | null;
};

type LlmSpec = {
  keyA: string;
  keyB: string;
  amountA: string;
  amountB: string;
  tolerance: number;
  ignoreCase: boolean;
  flagDuplicates: boolean;
  detectOrphans: boolean;
  confidence: "low" | "medium" | "high";
  notes: string;
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickValidColumn(candidate: string, columns: string[], fallback?: string): string {
  if (columns.includes(candidate)) {
    return candidate;
  }
  const normalizedCandidate = normalize(candidate);
  const direct = columns.find((column) => normalize(column) === normalizedCandidate);
  if (direct) {
    return direct;
  }
  const partial = columns.find((column) => normalize(column).includes(normalizedCandidate));
  if (partial) {
    return partial;
  }
  return fallback && columns.includes(fallback) ? fallback : columns[0] ?? "";
}

function coerceSpec(spec: Partial<LlmSpec>, payload: ReconSpecPayload): LlmSpec {
  const fallback = payload.currentSpec ?? {};
  return {
    keyA: pickValidColumn(spec.keyA ?? "", payload.datasetAColumns, fallback.keyA),
    keyB: pickValidColumn(spec.keyB ?? "", payload.datasetBColumns, fallback.keyB),
    amountA: pickValidColumn(spec.amountA ?? "", payload.datasetAColumns, fallback.amountA),
    amountB: pickValidColumn(spec.amountB ?? "", payload.datasetBColumns, fallback.amountB),
    tolerance:
      typeof spec.tolerance === "number" && Number.isFinite(spec.tolerance)
        ? Math.max(0, spec.tolerance)
        : Math.max(0, Number(fallback.tolerance ?? 0.01)),
    ignoreCase:
      typeof spec.ignoreCase === "boolean" ? spec.ignoreCase : Boolean(fallback.ignoreCase ?? true),
    flagDuplicates:
      typeof spec.flagDuplicates === "boolean"
        ? spec.flagDuplicates
        : Boolean(fallback.flagDuplicates ?? true),
    detectOrphans:
      typeof spec.detectOrphans === "boolean"
        ? spec.detectOrphans
        : Boolean(fallback.detectOrphans ?? true),
    confidence:
      spec.confidence === "low" || spec.confidence === "medium" || spec.confidence === "high"
        ? spec.confidence
        : "medium",
    notes: typeof spec.notes === "string" ? spec.notes : "Generated from requirement and metadata.",
  };
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY in server environment." },
      { status: 500 }
    );
  }

  let payload: ReconSpecPayload;
  try {
    payload = (await request.json()) as ReconSpecPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  if (!payload.requirement?.trim()) {
    return NextResponse.json({ error: "Requirement is empty." }, { status: 400 });
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const systemInstruction =
    "You are a reconciliation analyst. Build a practical reconciliation spec using provided dataset metadata and requirement.";

  const userInput = {
    requirement: payload.requirement,
    datasetA: {
      name: payload.datasetAName,
      columns: payload.datasetAColumns,
      sampleRows: payload.datasetASampleRows,
    },
    datasetB: {
      name: payload.datasetBName,
      columns: payload.datasetBColumns,
      sampleRows: payload.datasetBSampleRows,
    },
    currentSpec: payload.currentSpec ?? null,
    constraints: [
      "Use column names that exist in each dataset.",
      "Tolerance must be >= 0.",
      "Prefer id-like fields for key mapping and amount-like fields for amount mapping.",
    ],
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: JSON.stringify(userInput) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "recon_spec",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: [
              "keyA",
              "keyB",
              "amountA",
              "amountB",
              "tolerance",
              "ignoreCase",
              "flagDuplicates",
              "detectOrphans",
              "confidence",
              "notes",
            ],
            properties: {
              keyA: { type: "string" },
              keyB: { type: "string" },
              amountA: { type: "string" },
              amountB: { type: "string" },
              tolerance: { type: "number" },
              ignoreCase: { type: "boolean" },
              flagDuplicates: { type: "boolean" },
              detectOrphans: { type: "boolean" },
              confidence: { type: "string", enum: ["low", "medium", "high"] },
              notes: { type: "string" },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json(
      { error: `OpenAI API error: ${response.status} ${errorText}` },
      { status: 502 }
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    return NextResponse.json({ error: "LLM returned empty content." }, { status: 502 });
  }

  let parsed: Partial<LlmSpec>;
  try {
    parsed = JSON.parse(content) as Partial<LlmSpec>;
  } catch {
    return NextResponse.json({ error: "LLM JSON parse failed." }, { status: 502 });
  }

  const spec = coerceSpec(parsed, payload);
  return NextResponse.json({ spec });
}
