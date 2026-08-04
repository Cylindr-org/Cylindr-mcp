import type { MarketCardPayload } from "./payload.js";
import type { MarketStatus } from "./interpret.js";

// Renders the market reading as an HTML fragment for the MCP App iframe.
// Everything is inlined (styles + SVG), no external requests — sandboxed hosts
// block network by default.

const PALETTE: Record<
  MarketStatus,
  { bg: string; fg: string; chip: string; dot: string }
> = {
  calm: { bg: "#ECFDF5", fg: "#065F46", chip: "#D1FAE5", dot: "#059669" },
  watch: { bg: "#FFFBEB", fg: "#92400E", chip: "#FEF3C7", dot: "#D97706" },
  alert: { bg: "#FEF2F2", fg: "#991B1B", chip: "#FEE2E2", dot: "#DC2626" },
};

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function sparkline(vals: number[]): string {
  if (vals.length < 2) return "";

  const w = 320;
  const h = 56;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const step = w / (vals.length - 1);

  const coords = vals.map((v, i) => {
    const x = i * step;
    const y = h - 6 - ((v - min) / span) * (h - 12);
    return [x, y] as const;
  });

  const line = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const rising = vals[vals.length - 1] >= vals[0];
  const stroke = rising ? "#DC2626" : "#059669";
  const fill = rising ? "rgba(220,38,38,0.08)" : "rgba(5,150,105,0.08)";

  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" role="img" aria-label="Propane price trend">
      <path d="${area}" fill="${fill}" stroke="none"/>
      <path d="${line}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
}

function metricTile(m: MarketCardPayload["metrics"][number]): string {
  const change =
    m.changePct == null
      ? ""
      : `<span style="font-size:12px;font-weight:600;color:${
          m.direction === "up"
            ? "#DC2626"
            : m.direction === "down"
            ? "#059669"
            : "#6B7280"
        }">${m.changePct > 0 ? "+" : ""}${m.changePct.toFixed(1)}%</span>`;
  return `<div style="flex:1 1 140px;min-width:140px;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;padding:12px 14px">
      <div style="font-size:12px;font-weight:600;color:#6B7280;margin-bottom:6px">${esc(
        m.label
      )}</div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
        <span style="font-size:18px;font-weight:700;color:#111827">${esc(
          m.value
        )}</span>
        ${change}
      </div>
    </div>`;
}

/** Inner card markup (no document shell) — used by the MCP App View. */
export function renderMarketCardBody(payload: MarketCardPayload): string {
  const pal = PALETTE[payload.status];
  const tiles = payload.metrics.map(metricTile).join("");
  const spark = sparkline(payload.propaneSeries);

  return `<div style="max-width:520px;margin:0 auto;padding:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;background:#F9FAFB">
    <div style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04)">

      <div style="background:${pal.bg};padding:16px 18px;border-bottom:1px solid #E5E7EB">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="width:10px;height:10px;border-radius:50%;background:${
            pal.dot
          };display:inline-block"></span>
          <span style="font-size:12px;font-weight:700;letter-spacing:0.02em;color:${
            pal.fg
          }">CYLINDR MARKET INTELLIGENCE</span>
        </div>
        <div style="font-size:17px;font-weight:700;color:${pal.fg}">${esc(
          payload.headline
        )}</div>
      </div>

      <div style="padding:16px 18px">
        <p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#374151">${esc(
          payload.summary
        )}</p>

        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px">${tiles}</div>

        ${
          spark
            ? `<div style="margin-bottom:14px">
                 <div style="font-size:12px;font-weight:600;color:#6B7280;margin-bottom:4px">Propane trend (${payload.windowDays} days)</div>
                 ${spark}
               </div>`
            : ""
        }

        <div style="background:${
          pal.chip
        };border-radius:12px;padding:12px 14px">
          <div style="font-size:12px;font-weight:700;color:${
            pal.fg
          };margin-bottom:4px">What to consider</div>
          <div style="font-size:13px;line-height:1.5;color:#374151">${esc(
            payload.advice
          )}</div>
        </div>

        <div style="margin-top:14px;font-size:11px;color:#9CA3AF">Latest data ${esc(
          payload.latestDate
        )}. Readings are observational, not predictions.</div>
      </div>
    </div>
  </div>`;
}
