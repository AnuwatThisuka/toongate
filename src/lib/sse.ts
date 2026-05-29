import { decodeFromToon } from "./decoder";

/**
 * Walks a parsed JSON value and decodes any TOON-encoded strings found inside.
 * Safe to call on any value — non-strings and non-objects are returned as-is.
 */
function decodeToonDeep(value: unknown): unknown {
  if (typeof value === "string") return decodeFromToon(value);
  if (Array.isArray(value)) return value.map(decodeToonDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        decodeToonDeep(v),
      ]),
    );
  }
  return value;
}

/** Processes a single SSE event string (without the trailing \n\n). */
function processEvent(event: string): string {
  return event
    .split("\n")
    .map((line) => {
      if (!line.startsWith("data: ") || line === "data: [DONE]") return line;
      const jsonStr = line.slice(6);
      try {
        const decoded = decodeToonDeep(JSON.parse(jsonStr));
        return "data: " + JSON.stringify(decoded);
      } catch {
        return line;
      }
    })
    .join("\n");
}

/**
 * Returns a TransformStream that reads a raw SSE byte stream, decodes any
 * TOON-encoded content inside each `data:` chunk, and re-emits the events.
 *
 * Handles partial chunks correctly by buffering across boundaries.
 */
export function createSseDecodeStream(): TransformStream<Uint8Array, Uint8Array> {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();
  let buffer = "";

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += textDecoder.decode(chunk, { stream: true });

      // SSE events are separated by double newlines.
      const events = buffer.split("\n\n");
      // Last element may be an incomplete event — keep it in the buffer.
      buffer = events.pop() ?? "";

      for (const event of events) {
        if (event.trim() === "") continue;
        controller.enqueue(textEncoder.encode(processEvent(event) + "\n\n"));
      }
    },
    flush(controller) {
      // Flush any remaining buffered data.
      if (buffer.trim()) {
        controller.enqueue(textEncoder.encode(processEvent(buffer) + "\n\n"));
      }
    },
  });
}
