import { Hono } from "hono";
import openaiRoutes from "./routes/openai";
import anthropicRoutes from "./routes/anthropic";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true, version: "0.1.0" }));

app.route("/", openaiRoutes);
app.route("/", anthropicRoutes);

export default app;
