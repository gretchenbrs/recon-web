import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    vercelEnv: process.env.VERCEL_ENV ?? "local",
    vercelUrl: process.env.VERCEL_URL ?? "",
  });
}
