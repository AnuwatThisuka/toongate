import { createMiddleware } from "hono/factory";

export const rateLimit = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const limiter = c.env.RATE_LIMITER;
  if (!limiter) {
    return next();
  }

  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const { success } = await limiter.limit({ key: ip });

  if (!success) {
    return c.json({ error: "rate limit exceeded" }, 429);
  }

  return next();
});
