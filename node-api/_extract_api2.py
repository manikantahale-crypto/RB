import json
import os

path = r"C:\Users\Digi\.cursor\projects\c-Users-Digi-Desktop-update-syntra-matching\agent-transcripts\572e8fb2-e1ca-4c94-8f0c-f140293aef1e\572e8fb2-e1ca-4c94-8f0c-f140293aef1e.jsonl"
out = r"c:\Users\Digi\Desktop\update\syntra-matching\node-api\_restore"

targets = {476, 561, 562, 435, 417, 415, 211, 160, 363}
with open(path, "r", encoding="utf-8") as f:
    for i, line in enumerate(f, 1):
        if i not in targets:
            continue
        obj = json.loads(line)
        for part in obj.get("message", {}).get("content", []):
            if part.get("type") != "tool_use" or part.get("name") != "Write":
                continue
            inp = part.get("input", {})
            p = (inp.get("path") or "").replace("\\", "/")
            c = inp.get("contents")
            if not c:
                continue
            name = os.path.basename(p)
            dest = os.path.join(out, name)
            open(dest, "w", encoding="utf-8").write(c)
            print(i, name, len(c))
