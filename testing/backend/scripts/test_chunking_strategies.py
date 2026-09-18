"""Compare per-page vs paragraph-based chunking on the consulting term query."""
import os, sys, re, json
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[3] / "apps" / "intelligence"))
from pathlib import Path
_env_path = Path(__file__).resolve().parents[3] / "apps" / "intelligence" / ".env"
if _env_path.exists():
    with open(_env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line: continue
            key, _, val = line.partition("=")
            val = val.strip().strip('"').strip("'"); key = key.strip()
            os.environ.setdefault(key, val)
os.environ.setdefault('APP_ENV', 'development')

from bson import ObjectId
from core.database import collection as contracts_collection

contract = contracts_collection.find_one({'_id': ObjectId('6a2dafc7767185f40434335a')})
content = (contract.get('index') or {}).get('content', '')

# --- STRATEGY A: Per-page chunks ---
pages_raw = re.split(r'--- Page (\d+) ---', content)
page_chunks = []
page_nums = []
i = 0
while i < len(pages_raw):
    if i == 0:
        page_chunks.append(pages_raw[i].strip())
        page_nums.append(0)
        i += 1
    elif i + 1 < len(pages_raw):
        page_nums.append(int(pages_raw[i]))
        page_chunks.append(pages_raw[i+1].strip())
        i += 2
    else:
        break

def score_chunk(text, query_terms):
    t = text.lower()
    score = 0
    for term in query_terms:
        if term.lower() in t:
            score += 1
            score += t.count(term.lower()) * 0.1
    return score

query = "Consulting Term independent contractor Snyder status benefits"
query_terms = query.split()

# Rank pages
page_scores = [(score_chunk(pc, query_terms), pn, pc) for pn, pc in zip(page_nums, page_chunks)]
page_scores.sort(key=lambda x: -x[0])

print("=" * 70)
print("STRATEGY A: Per-Page Chunking (top 3 + neighbors)")
print(f"Total pages: {len(page_chunks)}, query: \"{query}\"")
print()

top_pages = set()
for score, pn, pc in page_scores[:3]:
    top_pages.add(pn)
    # Add neighbors
    if pn > 0: top_pages.add(pn - 1)
    if pn + 1 in page_nums: top_pages.add(pn + 1)

for score, pn, pc in page_scores[:5]:
    neighbor = " [NEIGHBOR]" if pn not in {s for s, _, _ in page_scores[:3]} else ""
    has_header = '(b) Consulting Term' in pc
    ic_pos = pc.find('independent contractor')
    context = pc[max(0, ic_pos - 50):ic_pos + 200] if ic_pos >= 0 else pc[:200]
    print(f"  Rank {page_scores.index((score,pn,pc))}: Page {pn} "
          f"({len(pc)} chars) score={score:.1f}{neighbor} has_header={has_header}")
    if has_header:
        ct_pos = pc.find('(b) Consulting Term')
        print(f"    Clause: {pc[ct_pos:ct_pos+300].replace(chr(10), ' ')[:250]}...")
    else:
        print(f"    Context: {context.replace(chr(10), ' ')[:200]}...")

context_chars_a = sum(len(page_chunks[pn]) for pn in sorted(top_pages))
print(f"\n  Total context: {context_chars_a} chars across {len(top_pages)} pages")
print(f"  Pages included: {sorted(top_pages)}")

# --- STRATEGY B: Paragraph-based chunks (current) ---
from services.contract_agent.graph.tools.executor import _chunk_text
para_chunks = _chunk_text(content, max_chars=3000, overlap=400)
para_scores = [(score_chunk(c[2], query_terms), c[0], c[1], c[2]) for c in para_chunks]
para_scores.sort(key=lambda x: -x[0])

print()
print("=" * 70)
print("STRATEGY B: Paragraph-Based (current, 3000 chars, top 5)")
print(f"Total chunks: {len(para_chunks)}, query: \"{query}\"")
print()

for i, (score, start, end, text) in enumerate(para_scores[:7]):
    has_header = '(b) Consulting Term' in text
    ic_in = 'independent contractor' in text.lower()
    services_in = 'make himself available' in text.lower()
    markers = []
    if has_header: markers.append('RIGHT_CLAUSE')
    if ic_in: markers.append('ic')
    if services_in: markers.append('SERVICES_CLAUSE')
    print(f"  Rank {i}: chars={end-start} score={score:.1f} [{','.join(markers)}]")
    ct_pos = text.find('Consulting Term')
    if ct_pos >= 0:
        print(f"    {text[ct_pos:ct_pos+250].replace(chr(10), ' ')[:200]}...")
    else:
        print(f"    {text[:200].replace(chr(10), ' ')[:150]}...")

context_chars_b = sum(e - s for _, s, e, _ in para_scores[:5])
print(f"\n  Total context: {context_chars_b} chars across top 5 chunks")
print(f"  Right clause in top 5: {'YES' if any('RIGHT_CLAUSE' in ''.join(para_scores[i][3][:100]) for i in range(5)) else 'NO'}")

print()
print("=" * 70)
print(f"SUMMARY:")
print(f"  Per-page:     {len(page_chunks)} embeddings, {context_chars_a} context chars, covers {len(top_pages)} pages")
print(f"  Paragraph:    {len(para_chunks)} embeddings, {context_chars_b} context chars, 5 chunks")
print(f"  Storage diff: {len(para_chunks) - len(page_chunks)} fewer with per-page ({(1 - len(page_chunks)/len(para_chunks))*100:.0f}% reduction)")
print(f"  Context diff: {'more focused' if context_chars_a < context_chars_b else 'more verbose'} with per-page")
