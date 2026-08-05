import { App } from "@modelcontextprotocol/ext-apps";

const root = document.getElementById("root")!;

function show(html: string) {
  root.innerHTML = html;
}

// Parse the leave_review tool result to know what we're rating (station or dev).
function parseTarget(result: {
  structuredContent?: unknown;
  content?: Array<{ type: string; text?: string }>;
}): { station: string | null; kind: string } {
  const sc = result.structuredContent as
    | { station?: string | null; kind?: string }
    | undefined;
  if (sc && typeof sc === "object") {
    return {
      station: sc.station ?? null,
      kind: sc.kind ?? "developer",
    };
  }
  return { station: null, kind: "developer" };
}

const app = new App({ name: "cylindr-review", version: "1.0.0" });

let target: { station: string | null; kind: string } = {
  station: null,
  kind: "developer",
};
let selectedRating = 0;

// Register before connect() so we don't miss the initial tool-result notification.
app.ontoolresult = (result) => {
  target = parseTarget(result);
  renderWidget();
};

app.ontoolcancelled = () => {
  show(
    `<div style="padding:16px;font-family:sans-serif;color:#6B7280">Cancelled.</div>`
  );
};

function renderWidget() {
  const label =
    target.kind === "station" && target.station
      ? `Rate ${target.station}`
      : "Rate Cylindr";

  const stars = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<button data-star="${n}" class="star-btn" aria-label="${n} star${n > 1 ? "s" : ""}">${
          n <= selectedRating ? "★" : "☆"
        }</button>`
    )
    .join("");

  show(`
    <div style="max-width:400px;margin:0 auto;padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;background:#F9FAFB">
      <div style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,0.04)">
        <div style="font-size:14px;font-weight:600;color:#374151;margin-bottom:12px">${label}</div>
        <div id="stars" style="display:flex;gap:4px;font-size:28px;margin-bottom:14px;cursor:pointer">${stars}</div>
        <textarea id="comment" placeholder="Share your experience (optional)" style="width:100%;border:1px solid #E5E7EB;border-radius:8px;padding:8px 10px;font-size:13px;color:#111827;outline:none;resize:vertical;min-height:60px;font-family:inherit;box-sizing:border-box"></textarea>
        <input id="name" type="text" placeholder="Your name (optional)" style="width:100%;border:1px solid #E5E7EB;border-radius:8px;padding:8px 10px;font-size:13px;color:#111827;outline:none;margin-top:8px;font-family:inherit;box-sizing:border-box" />
        <button id="submit" style="width:100%;margin-top:12px;background:#111827;color:#FFFFFF;border:0;border-radius:8px;padding:10px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Submit</button>
        <div id="status" style="margin-top:12px;font-size:13px;text-align:center"></div>
      </div>
    </div>
  `);

  attachListeners();
}

function attachListeners() {
  const starsContainer = document.getElementById("stars");
  const submitBtn = document.getElementById("submit") as HTMLButtonElement;

  starsContainer?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[data-star]") as HTMLElement;
    if (!btn) return;
    selectedRating = Number(btn.dataset.star);
    renderWidget();
  });

  submitBtn?.addEventListener("click", handleSubmit);
}

async function handleSubmit() {
  const status = document.getElementById("status")!;
  const submitBtn = document.getElementById("submit") as HTMLButtonElement;
  const comment = (document.getElementById("comment") as HTMLTextAreaElement)
    .value.trim();
  const reviewerName = (document.getElementById("name") as HTMLInputElement)
    .value.trim();

  if (selectedRating === 0) {
    status.innerHTML = `<span style="color:#DC2626">Please select a star rating.</span>`;
    return;
  }

  const caps = app.getHostCapabilities();
  if (!caps?.serverTools) {
    status.innerHTML = `<span style="color:#DC2626">Host does not support server tools.</span>`;
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting…";
  status.innerHTML = `<span style="color:#6B7280">Sending your review...</span>`;

  try {
    const result = await app.callServerTool({
      name: "submit_review",
      arguments: {
        station: target.station,
        rating: selectedRating,
        comment: comment || undefined,
        reviewerName: reviewerName || undefined,
      },
    });

    if (result.isError) {
      const textItem = result.content?.find(
        (c): c is { type: "text"; text: string } => c.type === "text"
      );
      const errText = textItem?.text ?? "Failed to submit review.";
      status.innerHTML = `<span style="color:#DC2626">${errText}</span>`;
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit";
      return;
    }

    status.innerHTML = `<span style="color:#059669;font-weight:600">Thanks — your ${selectedRating}★ rating was recorded!</span>`;
    submitBtn.style.display = "none";
  } catch {
    status.innerHTML = `<span style="color:#DC2626">Network error. Please try again.</span>`;
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit";
  }
}

show(
  `<div style="padding:16px;font-family:sans-serif;color:#6B7280">Loading review widget…</div>`
);

void app.connect();
