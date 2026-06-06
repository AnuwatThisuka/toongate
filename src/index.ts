import { Hono } from "hono";
import openaiRoutes from "./routes/openai";
import anthropicRoutes from "./routes/anthropic";
import azureRoutes from "./routes/azure";
import geminiRoutes from "./routes/gemini";
import deepseekRoutes from "./routes/deepseek";
import savingsRoutes from "./routes/savings";
import { proxyAuth } from "./middleware/proxy-auth";
import { rateLimit } from "./middleware/rate-limit";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true, version: "0.1.0" }));

app.use("/v1/*", proxyAuth, rateLimit);
app.use("/azure/*", proxyAuth, rateLimit);
app.use("/gemini/*", proxyAuth, rateLimit);
app.use("/deepseek/*", proxyAuth, rateLimit);

app.route("/", openaiRoutes);
app.route("/", anthropicRoutes);
app.route("/", azureRoutes);
app.route("/", geminiRoutes);
app.route("/", deepseekRoutes);
app.route("/", savingsRoutes);

export default app;
