import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const filter = req.nextUrl.searchParams.get("filter"); // "LIKE" | "DISLIKE" | "FIRE" | null (all)

  const items = await db.history.findMany(
    filter === "LIKE" || filter === "DISLIKE" || filter === "FIRE" ? filter : undefined,
  );

  return NextResponse.json(items);
}
