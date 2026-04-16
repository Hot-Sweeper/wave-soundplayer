import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { broadcastQueueUpdate } from "@/lib/sse";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  await db.submission.update({
    where: { id },
    data: { playedAt: new Date() },
  });

  const queueCount = await db.submission.count({ where: { playedAt: null } });
  broadcastQueueUpdate(queueCount);

  return NextResponse.json({ ok: true });
}
