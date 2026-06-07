const RETRYABLE = new Set([429, 503]);

async function attempt(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function retryDelay(res: Response): number {
  const header = res.headers.get("retry-after");
  if (header) {
    const secs = parseInt(header, 10);
    if (!isNaN(secs)) return Math.min(secs * 1000, 10_000);
  }
  return 1_000;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const res = await attempt(url, init, timeoutMs);
  if (!RETRYABLE.has(res.status)) return res;

  await new Promise<void>((r) => setTimeout(r, retryDelay(res)));
  return attempt(url, init, timeoutMs);
}
