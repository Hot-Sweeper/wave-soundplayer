import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteFile } from "@/lib/storage";
import { broadcastQueueUpdate } from "@/lib/sse";
import { auth } from "@/auth";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const submission = await db.submission.findUnique({ where: { id } });
  if (!submission) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.submission.delete({ where: { id } });

  // Clean up files (non-blocking)
  void deleteFile(submission.audioPath);
  if (submission.avatarPath) void deleteFile(submission.avatarPath);

  const queueCount = await db.submission.count({ where: { playedAt: null } });
  broadcastQueueUpdate(queueCount);

  return NextResponse.json({ ok: true });
}
