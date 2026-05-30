import { createMiddleware } from "hono/factory";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export const adminAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const adminKey = c.env.ADMIN_KEY;

  if (!adminKey) return c.notFound();

  const provided = c.req.header("X-Toongate-Admin-Key") ?? "";
  if (!safeCompare(adminKey, provided)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  await next();
});
