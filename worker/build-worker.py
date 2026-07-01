import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TRANSCRIPT = Path(
    r"C:\Users\82107\.cursor\projects\c-Users-82107-Desktop-eoulrimstudio-home-control"
    r"\agent-transcripts\f40b129e-2c1f-477d-8395-3fcd331311dd"
    r"\f40b129e-2c1f-477d-8395-3fcd331311dd.jsonl"
)
BATCH = ROOT / "portfolio-image-batch.js"
OUT = ROOT / "worker.js"

batch = BATCH.read_text(encoding="utf-8")
git_fn = re.search(r"async function gitCommitMultipleFiles[\s\S]*?^}\n", batch, re.M).group(0)
new_upload = re.search(r"async function handlePortfolioImageUpload[\s\S]*?^}\n", batch, re.M).group(0)

source = None
for line in TRANSCRIPT.open(encoding="utf-8"):
    if "Cloudflare Worker" not in line or "handlePortfolioImageUpload" not in line:
        continue
    data = json.loads(line)
    text = data["message"]["content"][0]["text"]
    if not text.startswith("<user_query>"):
        continue
    source = text.replace("<user_query>\n", "").replace("\n</user_query>", "").strip()
    break

if not source:
    raise SystemExit("Worker source not found in transcript")

source = source.replace(
    "포트폴리오 API (GET/PUT /portfolio → portfolio.json, POST/DELETE /portfolio-image → assets/picture/pj_N/)",
    "포트폴리오 API (GET/PUT /portfolio → portfolio.json, POST/DELETE /portfolio-image, 배치 files[])",
)

marker = "function safePortfolioImagePath"
if marker not in source:
    raise SystemExit("safePortfolioImagePath not found")
source = source.replace(marker, git_fn + "\n" + marker, 1)

old_upload = re.search(r"async function handlePortfolioImageUpload[\s\S]*?^}\n", source, re.M)
if not old_upload:
    raise SystemExit("handlePortfolioImageUpload not found")
source = source[: old_upload.start()] + new_upload + source[old_upload.end() :]

header = (
    "/**\n"
    " * eoulrimstudio-upload — Cloudflare Worker 전체 코드\n"
    " * Dashboard → Workers → eoulrimstudio-upload → Edit code → 전체 선택 후 붙여넣기 → Save and deploy\n"
    " * 포트폴리오 이미지 배치 업로드(files[]) 포함\n"
    " */\n\n"
)
OUT.write_text(header + source, encoding="utf-8")
print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")
