import { createMiddleware } from "hono/factory";
import { safeCompare } from "../lib/safe-compare";

export const proxyAuth = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const proxyKey = c.env.PROXY_AUTH_KEY;

    // console.log("proxyKey", c.env);

    if (!proxyKey) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const authHeader = c.req.header("Authorization") ?? "";
    const provided = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";

    if (!safeCompare(proxyKey, provided)) {
      return c.json({ error: "unauthorized" }, 401);
    }

    await next();
  },
);
