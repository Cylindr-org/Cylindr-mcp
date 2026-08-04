import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const entry = path.join(root, "src/market/app/main.ts");
const outFile = path.join(root, "src/market/market-app.html");
const distFiles = [
  path.join(root, "dist/market-app.html"),
  path.join(root, "dist/market/market-app.html"),
];

const result = await esbuild.build({
  entryPoints: [entry],
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
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Cylindr Market Intelligence</title>
<style>html,body{margin:0;padding:0;background:#F9FAFB}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html, "utf8");
console.log(`Wrote ${path.relative(root, outFile)} (${(html.length / 1024).toFixed(1)} KB)`);
for (const distFile of distFiles) {
  fs.mkdirSync(path.dirname(distFile), { recursive: true });
  fs.writeFileSync(distFile, html, "utf8");
  console.log(`Wrote ${path.relative(root, distFile)}`);
}
