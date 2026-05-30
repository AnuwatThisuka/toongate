import { createMiddleware } from "hono/factory";
import { safeCompare } from "../lib/safe-compare";

export const adminAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const adminKey = c.env.ADMIN_KEY;

  if (!adminKey) return c.notFound();

  const provided = c.req.header("X-Toongate-Admin-Key") ?? "";
  if (!safeCompare(adminKey, provided)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  await next();
});
