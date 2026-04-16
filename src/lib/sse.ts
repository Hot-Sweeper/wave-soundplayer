// Server-Sent Events broadcast for queue count updates

type Listener = (data: string) => void;

const listeners = new Set<Listener>();

export function addSSEListener(fn: Listener) {
  listeners.add(fn);
}

export function removeSSEListener(fn: Listener) {
  listeners.delete(fn);
}

export function broadcastQueueUpdate(count: number) {
  const payload = `data: ${JSON.stringify({ queueCount: count })}\n\n`;
  listeners.forEach((fn) => fn(payload));
}
