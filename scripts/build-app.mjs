import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// Each MCP App widget: an entry TS file bundled to a self-contained HTML file
// (written into the source tree so `tsx watch` picks it up, and mirrored into
// dist/ for production `node dist/index.js`).
const bundles = [
  {
    entry: "src/market/app/main.ts",
    out: "src/market/market-app.html",
    title: "Cylindr Market Intelligence",
    distFiles: ["dist/market-app.html", "dist/market/market-app.html"],
  },
  {
    entry: "src/market/app/review.ts",
    out: "src/market/review-app.html",
    title: "Cylindr Review",
    distFiles: ["dist/review-app.html", "dist/market/review-app.html"],
  },
];

function shell(title, js) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>html,body{margin:0;padding:0;background:#F9FAFB}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;
}

for (const b of bundles) {
  const result = await esbuild.build({
    entryPoints: [path.join(root, b.entry)],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    // Keep readable enough for debugging in Claude's iframe inspector.
    minify: true,
    logLevel: "info",
  });

  const js = result.outputFiles[0].text;
  const html = shell(b.title, js);

  const outFile = path.join(root, b.out);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html, "utf8");
  console.log(`Wrote ${path.relative(root, outFile)} (${(html.length / 1024).toFixed(1)} KB)`);

  for (const distFile of b.distFiles) {
    const p = path.join(root, distFile);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, html, "utf8");
    console.log(`Wrote ${path.relative(root, p)}`);
  }
}
