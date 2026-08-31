import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const forbidden = [/from\s+["']firebase\/firestore["']/, /require\(["']firebase\/firestore["']\)/, /from\s+["']firebase-admin(?:\/[^"']*)?["']/, /require\(["']firebase-admin(?:\/[^"']*)?["']\)/];
const scopes = ["src/core/accounting", "src/application", "src/components/sales"];
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
let failures = [];

function walk(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) walk(child);
    else if (extensions.has(path.extname(entry.name))) {
      const content = fs.readFileSync(path.join(root, child), "utf8");
      for (const pattern of forbidden) {
        if (pattern.test(content)) {
          failures.push(`${child}: forbidden Firebase persistence dependency (${pattern})`);
          break;
        }
      }
    }
  }
}

for (const scope of scopes) walk(scope);

if (failures.length) {
  console.error("Accounting boundary check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Accounting boundary check: passed");
