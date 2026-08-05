import { App } from "@modelcontextprotocol/ext-apps";
import { renderMarketCardBody } from "../card.js";
import type { MarketCardPayload } from "../payload.js";

const root = document.getElementById("root")!;

function show(html: string) {
  root.innerHTML = html;
}

function parsePayload(result: {
  structuredContent?: unknown;
  content?: Array<{ type: string; text?: string }>;
}): MarketCardPayload | null {
  // Preferred: the typed structuredContent channel.
  const sc = result.structuredContent as MarketCardPayload | undefined;
  if (sc && typeof sc === "object" && "status" in sc) return sc;

  // Fallback: older responses put the JSON payload in the text content.
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) return null;
  try {
    return JSON.parse(text) as MarketCardPayload;
  } catch {
    return null;
  }
}

const app = new App({ name: "cylindr-market", version: "1.0.0" });

// Register before connect() so we don't miss the initial tool-result notification.
app.ontoolresult = (result) => {
  const payload = parsePayload(result);
  if (!payload || !payload.status) {
    show(
      `<div style="padding:16px;font-family:sans-serif;color:#6B7280">No market data in this result.</div>`
    );
    return;
  }
  show(renderMarketCardBody(payload));
};

app.ontoolcancelled = () => {
  show(
    `<div style="padding:16px;font-family:sans-serif;color:#6B7280">Cancelled.</div>`
  );
};

show(
  `<div style="padding:16px;font-family:sans-serif;color:#6B7280">Loading market intelligence…</div>`
);

void app.connect();
