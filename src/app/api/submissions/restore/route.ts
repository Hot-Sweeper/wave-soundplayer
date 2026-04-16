import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { broadcastQueueUpdate } from "@/lib/sse";

export async function POST() {
  const restoredCount = await db.submission.restorePlayed();
  const queueCount = await db.submission.count({ where: { playedAt: null } });

  broadcastQueueUpdate(queueCount);

  return NextResponse.json({ ok: true, restoredCount, queueCount });
}