import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { broadcastQueueUpdate } from "@/lib/sse";
import { auth } from "@/auth";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  await db.submission.update({
    where: { id },
    data: { playedAt: new Date() },
  });

  const queueCount = await db.submission.count({ where: { playedAt: null } });
  broadcastQueueUpdate(queueCount);

  return NextResponse.json({ ok: true });
}
