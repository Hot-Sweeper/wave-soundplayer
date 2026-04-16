import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { ReactionType } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json() as { submissionId?: string; type?: string };
  const { submissionId, type } = body;

  if (!submissionId || typeof submissionId !== "string") {
    return NextResponse.json({ error: "submissionId required" }, { status: 400 });
  }

  const validTypes: ReactionType[] = ["LIKE", "DISLIKE", "FIRE"];
  if (!type || !validTypes.includes(type as ReactionType)) {
    return NextResponse.json({ error: "Invalid reaction type" }, { status: 400 });
  }

  const reaction = await db.reaction.create({
    data: { submissionId, type: type as ReactionType },
  });

  return NextResponse.json(reaction, { status: 201 });
}
