import { NextResponse } from "next/server";
import { db } from "@/lib/db";

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
      audioExt: true,
      queuePos: true,
      createdAt: true,
    },
  });

  return NextResponse.json(submissions);
}
