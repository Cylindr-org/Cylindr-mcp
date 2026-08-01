import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createLpgServer } from "./server.js";
import { InMemoryStore } from "./store/InMemoryStore.js";

const PORT = Number(process.env.PORT) || 3000;

// Single shared store so all requests see the same (in-memory) data.
// Swap this line for `new MongoStore(...)` later — nothing else changes.
const store = new InMemoryStore();

const app = express();
app.use(express.json());

// Health check (handy for Render/Railway/Vercel).
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "cylindr" });
});

// MCP endpoint. Stateless: a fresh server + transport per request, which is
// the simplest model for serverless/cloud hosting and works with Claude's
// remote custom connectors.
app.post("/mcp", async (req: Request, res: Response) => {
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

app.listen(PORT, () => {
  console.log(`Cylindr MCP server listening on http://localhost:${PORT}/mcp`);
});
