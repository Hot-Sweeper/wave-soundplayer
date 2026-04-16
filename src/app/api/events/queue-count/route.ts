import { NextRequest } from "next/server";
import { addSSEListener, removeSSEListener } from "@/lib/sse";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const count = await db.submission.count({ where: { playedAt: null } });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Send initial count
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ queueCount: count })}\n\n`));

      const listener = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // Client disconnected
        }
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
