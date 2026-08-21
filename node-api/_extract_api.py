import json
import os

path = r"C:\Users\Digi\.cursor\projects\c-Users-Digi-Desktop-update-syntra-matching\agent-transcripts\572e8fb2-e1ca-4c94-8f0c-f140293aef1e\572e8fb2-e1ca-4c94-8f0c-f140293aef1e.jsonl"
out = r"c:\Users\Digi\Desktop\update\syntra-matching\node-api\_restore"

os.makedirs(out, exist_ok=True)

wanted = [
    "job.repository.js",
    "candidate.repository.js",
    "match.repository.js",
    "job.controller.js",
    "candidate.controller.js",
    "matches.controller.js",
    "match.controller.js",
    "job.routes.js",
    "candidate.routes.js",
    "matches.routes.js",
    "stats.controller.js",
    "stats.routes.js",
    "skill.routes.js",
    "skill.repository.js",
    "app.js",
    "client.ts",
]

# Prefer later Writes before keyword era but after API was built — up to line ~500
last = {}
with open(path, "r", encoding="utf-8") as f:
    for i, line in enumerate(f, 1):
        if i > 450:
            break
        try:
            obj = json.loads(line)
        except Exception:
            continue
        content = obj.get("message", {}).get("content", [])
        if not isinstance(content, list):
            continue
        for part in content:
            if part.get("type") != "tool_use" or part.get("name") != "Write":
                continue
            inp = part.get("input", {})
            p = (inp.get("path") or "").replace("\\", "/")
            contents = inp.get("contents")
            if not contents:
                continue
            for suf in wanted:
                if p.endswith(suf):
                    # Prefer node-api for js, frontend for client.ts
                    if suf == "client.ts" and "frontend" not in p:
                        continue
                    if suf.endswith(".js") and "node-api" not in p:
                        continue
                    last[suf] = (i, p, contents)

for suf, (i, p, contents) in sorted(last.items(), key=lambda x: x[1][0]):
    dest = os.path.join(out, suf)
    open(dest, "w", encoding="utf-8").write(contents)
    print(f"L{i}: {suf} ({len(contents)} bytes) from {p}")
