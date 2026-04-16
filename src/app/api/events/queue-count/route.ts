import { NextRequest } from "next/server";
import { addSSEListener, removeSSEListener } from "@/lib/sse";
import { db } from "@/lib/db";
import fs from "fs";
import { resolveFilePath } from "@/lib/storage";

export const dynamic = "force-dynamic";

async function getPlayableQueueCount() {
  const submissions = await db.submission.findMany({
    where: { playedAt: null },
    select: {
      audioPath: true,
    },
  });

  return submissions.reduce((count, submission) => {
    const filePath = resolveFilePath(submission.audioPath as string);
    return count + (fs.existsSync(filePath) ? 1 : 0);
  }, 0);
}

export async function GET(req: NextRequest) {
  const count = await getPlayableQueueCount();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Send initial count
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ queueCount: count })}\n\n`));

      const listener = (_data: string) => {
        void (async () => {
          try {
            const playableCount = await getPlayableQueueCount();
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ queueCount: playableCount })}\n\n`));
          } catch {
            // Client disconnected or count computation failed
          }
        })();
      };

      addSSEListener(listener);

      req.signal.addEventListener("abort", () => {
        removeSSEListener(listener);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
