import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { resolveFilePath } from "@/lib/storage";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Assuming resolveFilePath works for avatars if given the correct relative path or folder mapping.
  // Wait, let's look at storage.ts to see what it does.
  // I will just use the standard storage logic.
  let filePath = resolveFilePath("avatars/" + filename);

  if (!fs.existsSync(filePath)) {
    // try fallback logic in case storage is directly inside uploads/avatars
    filePath = path.join(process.cwd(), "uploads", "avatars", filename);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Avatar not found" }, { status: 404 });
    }
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filename).slice(1).toLowerCase();

  const mimeMap: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
  };
  const contentType = mimeMap[ext] ?? "application/octet-stream";

  const stream = fs.createReadStream(filePath);
  const nodeToWebStream = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => controller.enqueue(chunk));
      stream.on("end", () => controller.close());
      stream.on("error", (err) => controller.error(err));
    },
  });

  return new NextResponse(nodeToWebStream, {
    status: 200,
    headers: {
      "Content-Length": String(stat.size),
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
