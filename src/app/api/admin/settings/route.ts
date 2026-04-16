import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await db.setting.findMany();
  const result: Record<string, string> = {};
  for (const s of settings) result[s.key] = s.value;

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as Record<string, string>;

  const allowedKeys = new Set(["retention_days", "banned_words"]);
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      return NextResponse.json({ error: `Unknown setting key: ${key}` }, { status: 400 });
    }
  }

  for (const [key, value] of Object.entries(body)) {
    await db.setting.upsert({
      where: { key },
      update: { value: String(value) },
      create: { key, value: String(value) },
    });
  }

  return NextResponse.json({ ok: true });
}
