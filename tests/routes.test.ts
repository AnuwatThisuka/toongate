import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { adminAuth } from "../src/middleware/admin-auth";
import { proxyAuth } from "../src/middleware/proxy-auth";

// Helper to build a minimal Env object
function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    UPSTREAM_URL: "",
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    TOON_THRESHOLD: "0.6",
    TOON_THRESHOLD_MESSAGES: "",
    TOON_THRESHOLD_CHAT: "",
    TOON_THRESHOLD_EMBEDDINGS: "",
    TOON_LOG_SAVINGS: "",
    TOON_DRY_RUN: "",
    UPSTREAM_TIMEOUT_MS: "",
    DB: null as unknown as D1Database,
    CF_AIG_TOKEN: "",
    ADMIN_KEY: "",
    PROXY_AUTH_KEY: "",
    ...overrides,
  };
}

function buildSavingsApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", adminAuth);
  app.get("/savings/summary", (c) => c.json({ ok: true }));
  app.get("/savings/by-model", (c) => c.json({ rows: [] }));
  return app;
}

function buildProxyApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/v1/*", proxyAuth);
  app.get("/v1/test", (c) => c.json({ ok: true }));
  app.get("/health", (c) => c.json({ ok: true, version: "0.1.0" }));
  return app;
}

async function req(
  app: Hono<{ Bindings: Env }>,
  path: string,
  env: Env,
  headers: Record<string, string> = {},
) {
  const request = new Request(`http://localhost${path}`, { headers });
  return app.fetch(request, env);
}

describe("admin auth middleware (/savings/*)", () => {
  it("returns 404 when ADMIN_KEY not set", async () => {
    const env = makeEnv({ ADMIN_KEY: "" });
    const app = buildSavingsApp(env);
    const res = await req(app, "/savings/summary", env);
    expect(res.status).toBe(404);
  });

  it("returns 401 with wrong key", async () => {
    const env = makeEnv({ ADMIN_KEY: "secret" });
    const app = buildSavingsApp(env);
    const res = await req(app, "/savings/summary", env, {
      "X-Toongate-Admin-Key": "wrong",
    });
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, string>;
    expect(body).toEqual({ error: "unauthorized" });
  });

  it("returns 200 with correct key", async () => {
    const env = makeEnv({ ADMIN_KEY: "secret" });
    const app = buildSavingsApp(env);
    const res = await req(app, "/savings/summary", env, {
      "X-Toongate-Admin-Key": "secret",
    });
    expect(res.status).toBe(200);
  });
});

describe("proxy auth middleware (/v1/*)", () => {
  it("returns 401 when PROXY_AUTH_KEY not set (fail-closed)", async () => {
    const env = makeEnv({ PROXY_AUTH_KEY: "" });
    const app = buildProxyApp(env);
    const res = await req(app, "/v1/test", env);
    expect(res.status).toBe(401);
  });

  it("returns 401 when PROXY_AUTH_KEY set but missing from request", async () => {
    const env = makeEnv({ PROXY_AUTH_KEY: "mykey" });
    const app = buildProxyApp(env);
    const res = await req(app, "/v1/test", env);
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, string>;
    expect(body).toEqual({ error: "unauthorized" });
  });

  it("passes through with correct bearer token", async () => {
    const env = makeEnv({ PROXY_AUTH_KEY: "mykey" });
    const app = buildProxyApp(env);
    const res = await req(app, "/v1/test", env, {
      Authorization: "Bearer mykey",
    });
    expect(res.status).toBe(200);
  });
});

describe("GET /savings/by-model", () => {
  it("returns 404 when ADMIN_KEY not set", async () => {
    const env = makeEnv({ ADMIN_KEY: "" });
    const app = buildSavingsApp(env);
    const res = await req(app, "/savings/by-model", env);
    expect(res.status).toBe(404);
  });

  it("returns 401 with wrong key", async () => {
    const env = makeEnv({ ADMIN_KEY: "secret" });
    const app = buildSavingsApp(env);
    const res = await req(app, "/savings/by-model", env, {
      "X-Toongate-Admin-Key": "wrong",
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 with correct key", async () => {
    const env = makeEnv({ ADMIN_KEY: "secret" });
    const app = buildSavingsApp(env);
    const res = await req(app, "/savings/by-model", env, {
      "X-Toongate-Admin-Key": "secret",
    });
    expect(res.status).toBe(200);
  });
});

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const env = makeEnv();
    const app = buildProxyApp(env);
    const res = await req(app, "/health", env);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });
});
