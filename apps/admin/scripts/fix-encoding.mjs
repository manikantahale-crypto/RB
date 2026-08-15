import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target = path.join(root, "src/pages/PolicyEditor.tsx");
let s = fs.readFileSync(target, "utf8");

const replacements = [
  ["Weâ€™ve", "We've"],
  ["Weâ€™", "We'"],
  ["â€™", "'"],
  ["â€˜", "'"],
  ["â€"", "—"],
  ["â€“", "–"],
  ["â€¦", "…"],
  ["Â·", "·"],
  ["â€œ", '"'],
  ["â€", '"'],
];

for (const [from, to] of replacements) {
  s = s.split(from).join(to);
}

fs.writeFileSync(target, s);
console.log("PolicyEditor encoding normalized");
