import { createMiddleware } from "hono/factory";

export const proxyAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const proxyKey = c.env.PROXY_AUTH_KEY;

  if (!proxyKey) {
    await next();
    return;
  }

  const authHeader = c.req.header("Authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (provided !== proxyKey) {
    return c.json({ error: "unauthorized" }, 401);
  }

  await next();
});
