import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import fs from "fs";
import { resolveFilePath } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const submissions = await db.submission.findMany({
    where: { playedAt: null },
    orderBy: { queuePos: "asc" },
    select: {
      id: true,
      artistName: true,
      artistNote: true,
      avatarPath: true,
      audioPath: true,
      audioExt: true,
      queuePos: true,
      createdAt: true,
    },
  });

  // Local dev can point at a remote DB where some audio files do not exist on disk.
  // Filter those out so the player does not repeatedly request missing /api/audio/:id files.
  const playable = submissions.filter((submission) => {
    const filePath = resolveFilePath(submission.audioPath as string);
    return fs.existsSync(filePath);
  }).map(({ audioPath, ...rest }) => rest);

  return NextResponse.json(playable);
}
