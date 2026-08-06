import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createLpgServer } from "./server.js";
import { MongoStore } from "./store/MongoStore.js";
import { connectDB } from "./db.js";
import { config } from "./config.js";

const PORT = config.port;

// Reads live LPG data from MongoDB (same collections the backend writes to).
const store = new MongoStore();

const app = express();
// Behind Render/Railway's proxy: trust it so req.ip is the real client IP
// (needed for the rate limiter to key on the caller, not the proxy).
app.set("trust proxy", 1);
// Don't advertise the framework (reduces trivial fingerprinting).
app.disable("x-powered-by");
// Cap request bodies — an MCP JSON-RPC call is tiny; anything large is abuse.
app.use(express.json({ limit: "64kb" }));

// Lightweight in-memory fixed-window rate limiter for the public /mcp endpoint.
// Stops a script from flooding submit_review (or any tool) without a new
// dependency. The window is generous so Claude's normal traffic is unaffected;
// state is per-process, which is fine on a single free-tier instance.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120; // requests per IP per window
const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimit(req: Request, res: Response, next: () => void) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
  } else if (rec.count >= RATE_MAX) {
    res.status(429).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Too many requests. Please slow down." },
      id: null,
    });
    return;
  } else {
    rec.count++;
  }
  // Opportunistic cleanup so the map can't grow unbounded.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
  }
  next();
}

// Health check (handy for Render/Railway/Vercel).
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "cylindr" });
});

// MCP endpoint. Stateless: a fresh server + transport per request, which is
// the simplest model for serverless/cloud hosting and works with Claude's
// remote custom connectors.
app.post("/mcp", rateLimit, async (req: Request, res: Response) => {
  const server = createLpgServer(store);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless server: GET/DELETE aren't used for SSE streams here.
const methodNotAllowed = (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
};
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

// Connect to MongoDB first, then start accepting MCP requests.
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Cylindr MCP server listening on http://localhost:${PORT}/mcp`);
    });
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err);
    process.exit(1);
  });
