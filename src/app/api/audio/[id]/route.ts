import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { resolveFilePath } from "@/lib/storage";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const submission = await db.submission.findUnique({
    where: { id },
    select: { audioPath: true, audioExt: true },
  });
  if (!submission) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const filePath = resolveFilePath(submission.audioPath);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Audio file not found" }, { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.get("range");

  const mimeMap: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",
    opus: "audio/opus",
    m4a: "audio/mp4",
  };
  const contentType = mimeMap[submission.audioExt] ?? "application/octet-stream";

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const stream = fs.createReadStream(filePath, { start, end });
    const { Readable } = require("stream");
    const webStream = Readable.toWeb(stream);

    return new NextResponse(webStream as any, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunkSize),
        "Content-Type": contentType,
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  const { Readable } = require("stream");
  const webStream = Readable.toWeb(stream);

  return new NextResponse(webStream as any, {
    status: 200,
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(fileSize),
      "Content-Type": contentType,
    },
  });
}
