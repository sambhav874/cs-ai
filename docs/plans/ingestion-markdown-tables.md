# Ingestion, Segmentation & Embedding Quality

## Handoff brief — read first

You are implementing this in the repo `extractor` (monorepo; Python backend at `apps/backend`, Next.js frontend at `apps/frontend`). All paths below are repo-relative. Nothing in this plan has been implemented — the working tree is untouched.

**Environment (verified, do not re-derive):**
- Python 3.11, Poetry. Run backend commands as `cd apps/backend && poetry run ...`.
- Vector store is **MongoDB Atlas Vector Search** (`langchain_mongodb.MongoDBAtlasVectorSearch`). Pinecone and FAISS exist as fallbacks. No pgvector/Qdrant/Chroma.
- Tests: no `pytest.ini`, no `[tool.pytest]`. Run as `cd apps/backend && TESTING=true poetry run pytest ../../testing/backend/tests`. `conftest.py` at `testing/backend/tests/conftest.py` only does `sys.path` setup.
- Current branch has substantial unrelated uncommitted work. **Branch off before editing** and keep these changes isolated.

**Claims already verified empirically — trust them, they cost real time to establish:**
- Installed `liteparse` is **2.0.8**. `LiteParse.__init__` accepts only `ocr_enabled, ocr_server_url, ocr_language, tessdata_path, max_pages, target_pages, dpi, output_format, preserve_very_small_text, password, quiet, num_workers`. Its docstring reads `output_format: Output format: "json" or "text" (default: "json")`. `LiteParse(output_format="markdown").get_config().output_format` returns **`'json'`** — accepted and silently downgraded. **Markdown is impossible on the pinned version.**
- PyPI latest is **2.13.0**, with `cp310/cp311/cp312` wheels for manylinux, musllinux, macOS (incl. arm64), and Windows. **No cp313 wheel** — do not move the runtime to 3.13.
- 2.13.0's documented API adds `output_format="markdown"`, `image_mode` (`placeholder`/`off`/`embed`), `extract_links`, `keep_headers_footers`, `continue_on_page_error`, and `result.total_pages`.
- 2.x `ParsedPage` is `(page_num, width, height, text, text_items)` — **there is no `.markdown` attribute and no `.textItems`** (camelCase). The current code reads both. `ParseResult` is `(pages, text)`.
- Per-page parsing is **cheaper** than whole-doc, measured on the 9-page `demo_data/baltia-jfk-gha1.pdf`: whole-doc 0.038s vs nine `target_pages="N"` parses totalling 0.024s. Do not "optimize" away the per-page loop.
- `sanitize_llm_input` (`apps/backend/core/sanitizers.py:7`) strips control chars, redacts four injection phrases, and truncates any `\S{500,}` run. Pipes, hashes and dashes survive, so markdown and HTML-comment sentinels pass through intact — but base64 data URIs would be shredded, which is why `image_mode` must be `placeholder`, never `embed`.

**Line numbers** are from the pre-change tree and will drift as you edit. Treat them as pointers to functions, not as literal addresses; find the function by name.

**Decisions already made by the repo owner — do not revisit:**
1. Upgrade liteparse to 2.13. Docling was considered and rejected (pulls torch/transformers and ~1-2GB of model weights for a problem a version bump solves).
2. Ship as 3 PRs in the stated order.
3. **No backfill.** Existing v2 contracts keep their v2 chunks. The version-aware early-exit in PR 1 is what makes that safe and is not optional.

**Non-negotiable invariant, stated by the repo owner:** coverage must never regress. Every marker in this plan **annotates**; none may **filter**. An unlabeled, malformed, or unrecognized table/exhibit must flow through as ordinary text exactly as it does today. Worst acceptable case is degraded metadata. Silently dropping content is a failure of the change, not a tradeoff.

---

## Context

Contracts are parsed to text, chunked, and embedded for agent retrieval. Three verified defects compound through that pipeline:

1. **We never get markdown.** `pyproject.toml:57` pins `liteparse = "^2.0.8"`. That version's `LiteParse.__init__` has no `image_mode` / `extract_links` / `keep_headers_footers`, its docstring says `output_format: "json" or "text"`, and `LiteParse(output_format="markdown").get_config().output_format` returns **`json`** — silently downgraded. Verified against the installed wheel. Markdown never existed on this version, so `_liteparse_page_text` (`tasks.py:712`) falls through to raw text on every single document.

2. **A regex then fabricates tables from that text.** `_looks_tabular` / `_tabular_to_pipe` / `_normalize_aligned_tables` (`tasks.py:755-804`) guess columns from runs of 2+ spaces. On `demo_data/baltia-jfk-gha1.pdf` p4 the real header wraps two lines (`Position | Number of / Staff | Man hours`); the continuation line fails the `\S\s{3,}\S` test, so the table starts one row late and **`| Supervisor | 1 | 8 |` becomes the header row**. The true header is destroyed.

3. **Chunks are silently dropped.** `_make_legal_segment` (`segmentation.py:367`) returns `None` under 60 chars (30 for micro); callers do `if segment:` — that span produces zero chunks, no log. `segments_to_index_documents` (`vector_store.py:314`) then applies a *second, different* floor of 40, so micros of 30-39 chars are built, counted in `segment_count`, and never embedded. Micros are single value matches (`$1,850.00`, `99.9%`) — the highest-precision content in the corpus.

Downstream: real markdown makes `_detect_section_heading`'s `^#{1,6}` branch (`segmentation.py:206`) fire for the first time, so the section tree stops relying on an ALL-CAPS-ratio guess — `section_path` and page citations get accurate for free.

**Outcome:** markdown in, tables as atomic chunks with their headers intact, and a guarantee that no character of a contract silently vanishes.

**Decisions taken:** upgrade liteparse (not docling — the 2.13 upgrade gets native markdown without torch/transformers and ~1-2GB of weights). Ship in 3 PRs. **No backfill** — v2 contracts keep their v2 chunks.

---

## PR 1 — Stop the bleeding

Low risk, no new dependency, no migration. Ship standalone.

**Delete the corrupting heuristics** — `tasks.py`: `_looks_tabular:755`, `_tabular_to_pipe:760`, `_normalize_aligned_tables:784`. They are active corruption today and become dead weight after PR 2. Keep `_normalize_markdown_tables:738` (harmless cell-spacing normalizer; PR 2's row splitter wants its output deterministic).

**One length floor, one place** — delete the `len(segment_text.strip()) < 40` check at `vector_store.py:314-316`. The segmenter is the sole authority on minimum length. Keep the `type == "sentence"` skip (`segment_text:79` is dead code, but the guard is free).

**Never drop on merge failure** — `_merge_tiny_meso_segments` (`segmentation.py:733`) does `merged.append(combined or previous)`, discarding `segment` whenever `_combine_meso_segments` returns `None` (null `char_start`/`char_end`, or `end <= start`). Append both instead.

**Guard the re-ingestion corruption path** (mandatory even with no backfill). `embed_contract_text` (`vector_store.py:754-772`) early-exits whenever a namespace already has vectors. But `retry_queued_ingestions` (`tasks.py:296`) and both re-dispatch endpoints (`contracts.py:417`, `:667`) re-parse and overwrite `index.content` (`tasks.py:531`) *after* that skip. Post-PR-2 that writes v3 markdown under v2 chunks whose `char_start`/`char_end` point into text that no longer exists. Fix: make the early-exit **version-aware** — return cached only when the stored `chunk_schema_version` equals `settings.chunk_schema_version`, otherwise clear the namespace and re-embed. Self-heals on natural re-ingestion; no bulk script, no bulk API spend.

---

## PR 2 — Real markdown + atomic tables

### A. Parser

**A0 — bump the pin first.** `pyproject.toml:57` → `liteparse = "^2.13"`, re-lock. Every other change here is inert without it. 2.13.0 has cp310/311/312 wheels, manylinux + macOS arm64; repo is py3.11. Risk: 13 minor releases of a beta native wheel — write the adapter defensively (`getattr(result, "total_pages", None) or len(result.pages)`).

**A1 — `_build_liteparse_parser:659`.** Keep the `inspect.signature` filter (it is why 2.0.8 didn't crash, and it keeps one code path serving both versions). Add to `parser_options`: `output_format="markdown"`, `image_mode="placeholder"`, `extract_links=True`, `keep_headers_footers=False`, `continue_on_page_error=True`.

Then **assert it took**: read back `parser.get_config().output_format` and `logger.error` + raise if it is not `"markdown"`. This is the guard whose absence hid the bug for the entire life of the 2.0.8 pin.

> `image_mode="embed"` is unsafe — `sanitize_llm_input` (`core/sanitizers.py:7`) truncates `\S{500,}`, which shreds base64 data URIs. `placeholder` only.

**A2 — delete `_run_liteparse_parse:678`.** Every kwarg it builds is filtered out (2.x `parse()` takes only the file), there is no `parse_async`, and `asyncio.run` (`:886`) spins an event loop per attempt inside a Celery worker for nothing. Its `asyncio.wait_for` timeout never applied — `wait_for` cannot interrupt a blocking Rust extension, so this removes a false guarantee, not a real one. Call `parser.parse(str(path))` directly; put a real timeout at the Celery task level if wanted.

**A3 — keep per-page markers.** The `--- Page N ---` contract (`page_marker_regex`, `segmentation.py:73`) drives `page_start`/`page_end`, which drive every citation. Whole-doc `result.text` would destroy page attribution product-wide. Per-page is also *cheaper* — measured on the 9-page baltia PDF: whole-doc 0.038s vs nine `target_pages="N"` parses totalling 0.024s.

```python
def _liteparse_markdown_pages(path: Path, *, ocr_enabled: bool) -> tuple[list[tuple[int, str]], str]:
    """Return [(page_num, page_markdown)] plus whole-doc markdown as coverage ground truth."""
```

1. One whole-doc parse → `whole_md`, `total_pages` (doubles as fallback).
2. Loop `n in 1..total_pages` with `target_pages=str(n)`.
3. **Coverage guard:** if `sum(len(p) for _, p in pages) < 0.9 * len(whole_md)`, warn and return `whole_md` as a single unmarked chunk. `_split_by_page_markers:143` handles a marker-less document as one chunk — coverage safe, page attribution degraded. Never lose text to keep markers.
4. Emit a marker for **every** page including empty ones (`--- Page N ---\n\n[no extractable text on this page]`) so numbering never shifts.

**A4 — `_liteparse_page_text:712`** becomes a thin accessor over per-page `result.text`. Drop the `page.markdown` / `page.textItems` branches — neither attribute exists in either version (2.x `ParsedPage` is `page_num, width, height, text, text_items`). `_liteparse_page_number:806` stays.

**A5 — real `parse_quality_score` + quality-gated OCR retry.** `parse_quality_score` is hardcoded `0.0` (`tasks.py:919`), written to Mongo (`:539`), and has **zero readers**. Add:

```python
def _score_parse_quality(markdown: str, page_count: int) -> tuple[float, dict]:
```

Cheap signals, no model: chars-per-page vs a ~150 floor; alphanumeric ratio; mean token length sanity (CID/ligature soup gives 1-char or 40-char tokens); pure-punctuation line fraction; `�` rate. Return `[0,1]` + signals dict for logging.

Then fix the retry in `_process_with_liteparse:883`. Today it breaks on `markdown.strip() or ocr_enabled` (`:898`) — retry only on **total emptiness**, so a scanned PDF with a junk text layer (the common real failure) never retries. New rule: retry with OCR when `score < settings.parse_quality_min` (new config, suggest `0.55`); keep the higher-scoring attempt; persist score + signals.

> `keep_headers_footers=False` strips the `CONFIDENTIAL Page 1 of 1` noise interleaved mid-page — a real win, but it **shifts every `char_start`/`char_end`**. This is why PR 2 bumps `chunk_schema_version` to 3 (`config.py:59`), and why PR 1's version-aware early-exit must land first.

### B. Table markers

**Emit at the parse layer, not the segmenter.** Only the parser knows the renderer produced a *real* table (2.13 reconstructs tables from spatial layout). The segmenter sees text and would be back to guessing. Parse-time emission also puts markers into `index.content`.

**Format** — must not collide with `page_marker_regex`, so no leading `---`. HTML comments: invisible in any renderer, trivially regexable, pass `sanitize_llm_input` untouched.

```
<!--TABLE:START id=t3 rows=7 cols=3-->
| Position | Number of Staff | Man hours |
| --- | --- | --- |
<!--TABLE:END id=t3-->
```

`r"<!--TABLE:START(?P<attrs>[^>]*)-->\n(?P<body>.*?)\n<!--TABLE:END[^>]*-->"` with `re.DOTALL`.

**Detection** — new `_annotate_markdown_tables(md: str) -> str` in `tasks.py`, run per page after A3. A table is ≥2 consecutive `^\s*\|.*\|\s*$` lines where line 2 is a delimiter `^\s*\|[\s:|-]+\|\s*$`.

> **Answering the coverage question directly:** this is a *wrapping* pass, not a filter. It returns the full string with sentinels inserted around detected runs. There is no reject path — an unlabeled or malformed table simply isn't wrapped and flows through as ordinary markdown exactly as today. Same for exhibits and any other marker in this plan: markers **annotate**, never gate. Worst case is degraded metadata, never lost content.

### C. Segmenter

- Add `table_marker_regex` beside `page_marker_regex` (`segmentation.py:73`).
- `_legal_segments_from_page_chunks:171` strips page markers before segmentation. Do the same for table sentinels, but **record `table_spans: List[Tuple[int,int]]`** alongside the existing `page_spans` and thread it through `_build_legal_segments:740` → `_meso_segments_for_section:523`. Span-list over leaving sentinels in the text: keeps them out of stored chunks entirely and mirrors plumbing that already exists.
- New `_table_segments_for_section(...)`, running **before** `_paragraph_blocks:464`. Emit a `type="table"` segment per table span intersecting the section, then hand `_paragraph_blocks` only the **complement intervals** — prose unaffected, no character visited twice.
- `_make_legal_segment:351` takes `preserve_whitespace: bool` — skip the `re.sub(r"[ \t\f\v]+", " ", ...)` at `:365` for tables.
- Tables never reach `_sentence_windows:480` — structurally guaranteed by extracting before `_paragraph_blocks`. This is the current table killer: any block over `legal_meso_max_chars` (3000) gets split on `[^.!?\n]+`, shredding rows mid-cell.

#### Table size is unknown — size-adaptive, token-based

We cannot assume table shape. The corpus will contain 3-row rate cards, 500-row fee schedules, and wide grids where a **single row** exceeds any sane chunk budget. A fixed `max_chars` handles none of these, so tier on **measured tokens** via the existing `_estimated_tokens` (`segmentation.py:192`, tiktoken `cl100k_base`) rather than characters — the embedding API's limit is in tokens, and character count mispredicts it badly for numeric grids.

```python
def _split_table(body: str, *, max_tokens: int) -> List[str]:
    """Row-boundary split. Header + delimiter prepended to every part. Never drops a row."""
```

Four tiers, measured on the table body:

| Tier | Condition | Handling |
|---|---|---|
| Tiny | under the min-length floor | Keep whole. **Lower the floor for tables** — a 3-row rate card can be under 60 chars and is exactly the content we most need. Never drop. |
| Normal | fits `max_tokens` | One atomic `type="table"` chunk. The common case. |
| Large | exceeds `max_tokens`, every row fits | Split on row boundaries, **header + delimiter prepended to every part**. Without it, part 2+ is meaningless numbers. `(part i of n)` goes in `section_path`, never in the text. |
| Pathological | a single row exceeds `max_tokens` | Do not attempt a grid split. Emit that row as its own chunk via the D2 linearized form (`"Position: Supervisor; Staff: 1; ..."`), which is far more compact than wide pipe syntax. If it still overflows, fall back to a plain character split with a WARNING. **Degrade, never fail** — an unparseable monster table must not abort the ingestion. |

Budget: `settings.table_max_tokens`, default ~1500 (well inside any embedding model's window, and roughly aligned with `legal_meso_max_chars` 3000 at ~2 chars/token). Independent of `legal_meso_max_chars` — table rows tokenize very differently from prose.

**Add a parent summary chunk when a table splits.** A table broken into 8 parts is 8 chunks that each look like a fragment; nothing in the index represents the table *as a whole*, so "what does the fee schedule cover" retrieves one arbitrary part. Emit a `type="table"` parent holding the caption, header row, shape (`7 rows x 3 cols`), and the first few rows — with the parts as `child_chunk_ids`. This mirrors the existing macro/meso relationship rather than inventing a new one.

**Cap the blast radius.** A 2000-row table would otherwise produce ~200 chunks and, with D3, up to 2000 micros. Cap parts per table (~40) and micros per table (~50); past the cap, emit the parent summary plus capped parts and log a WARNING naming the contract. Nothing is silently discarded — the audit in D catches any span this leaves uncovered.

**Feed the shape forward.** `_annotate_markdown_tables` already computes `rows=` / `cols=` for the sentinel. Carry them into segment metadata so tiering, capping, and later debugging read a measured value instead of re-deriving it.

### D. Coverage audit (ships with C, not after)

`_audit_span_coverage(full_text, segments) -> List[Tuple[int,int]]` at the end of `_build_legal_segments:740`. Union `meso` + `table` spans (macros are summaries and overlap by design; micros are sub-spans), merge, diff against `[0, len(full_text))`. For each gap over ~40 chars: log WARNING with offsets and a 120-char excerpt, then **repair** — emit a `meso` segment for the gap with `section_path` inherited from the nearest preceding section.

Repair over warn: the stated requirement is that coverage never regresses, and a warning in a Celery log is not a guarantee. This is also the safety net for B's complement-interval bookkeeping, which is where bugs will hide.

---

## PR 3 — Embedding quality

**D1 — stop leaking the embedding prefix into the agent's context.** `embedding_text_for_segment` (`vector_store.py:290-300`) builds `Document: X | Section: Y | Chunk level: meso | Tags: ...` and it is stored as `page_content` (`:319`) → Mongo `text` → read straight back as agent-facing evidence (`evidence_service.py:716`, `:901`). No strip step exists.

Strip-on-read is a parser for a format with no escaping — a contract line containing ` | Section: ` would be mangled, and it rots the moment the prefix format changes. Instead:

- Add `display_text: Optional[str] = None` to `TextSegment` (`schemas.py:25`). `text` stays canonical display text; the embedding string is derived only at index time.
- In `segments_to_index_documents:303`, keep `page_content=embedding_text_for_segment(...)` and **add `"display_text": segment_text`** to metadata.
- Add `"display_text"` to the **allow-list projection** at `evidence_service.py:634-653` — a field missing there is silently never read back. Have `:716`/`:901` prefer `display_text`, falling back to `text`. The fallback is what keeps un-migrated v2 chunks working.

**D2 — linearize tables for embedding.** `_linearize_table_for_embedding(markdown_table: str) -> str` → `"Position: Supervisor; Number of Staff: 1; Man hours: 8. Position: ..."`. Route through `embedding_text_for_segment` when `type == "table"`; display stays markdown via D1. Embedding models have no purchase on `| Supervisor | 1 | 8 |` — a query like *"how many supervisors are staffed"* matches nothing lexically or semantically. This is the payoff that makes D1 worth doing.

**D3 — mine values from table cells.** `_micro_segments_for_meso:650` runs `VALUE_PATTERNS:60` over prose only. Rate cards are where the money literally is. Run the same patterns per table row; emit one micro per matching row with `value_types` set and `parent_chunk_id` → the table segment. Cap at ~50 micros per table and require a non-numeric label cell, or a big pricing grid explodes the index.

**D4 — tag tables.** `_assign_section_tags:266` reads `f"{title} {content[:1000]}".lower()`. For tables pass the *linearized* form so keyword matching fires, and add a literal `"table"` tag.

**D5 — do not touch the Atlas filter list.** It is fixed at index creation (`vector_store.py:661-674`), Atlas does not update an existing index's filters, and the create call is wrapped in a bare `except` logging at debug (`:676-677`) — a change fails **invisibly**. No query path filters on anything but `namespace`/`contract_id` anyway. `section_tags` is already in the list, and adding a *value* to an existing field is fine; adding a *field* is not. Route table awareness through `section_tags` + the Python-side boosts in `retrieval.py:219-223`, `:344-353`.

**D6 — batch the writes.** `add_documents(texts)` (`:657`) sends every chunk in one call with no batching or token guard. PR 2 materially increases chunk count on exhibit-heavy contracts. Add `_batched(iterable, n=256)` with per-batch error logging so one bad batch can't fail a whole ingestion.

**D7 — drop the duplicate segmentation.** `facade.py:197` re-segments the same text a second time immediately after `embed_contract_text` already segmented it (`vector_store.py:775`). Reuse the returned segments. Post-PR-2 segmentation is more expensive, so this doubles a growing cost.

---

## Verification

**Local parse script** — `testing/backend/scripts/parse_pdf_local.py`. `_process_with_liteparse(Path, str, str)` is already standalone-importable (no Celery, no Mongo); nothing calls it that way today. Flags: `--show-markers`, `--quality`.

```bash
cd apps/backend && poetry run python ../../testing/backend/scripts/parse_pdf_local.py ../../demo_data/baltia-jfk-gha1.pdf --show-markers --quality
```

**Acceptance test: baltia p4.** The `Position / Number of Staff / Man hours` table must come out with its true header intact. That is the exact case current code corrupts (header destroyed, `| Supervisor | 1 | 8 |` promoted to header), so it is a real before/after. Also run `sample_projects/project1_iata_gha/03_AnnexB_Charges.pdf`, `project3_full_lifecycle/04_PricingExhibitB.pdf`, `05_SLAExhibitC.pdf`.

**Tests** — extend `testing/backend/tests/test_legal_chunking.py` (105 lines, unittest, inline `GOLDEN_CONTRACT` fixture at `:22-35` with page markers and an Exhibit A rate card):

- `_annotate_markdown_tables` — well-formed table wrapped; **malformed table passes through unwrapped and byte-identical**; sentinels do not match `page_marker_regex`.
- `_split_table` — header repeated in every part; **row count conserved across parts** (the property that proves no row was dropped); tiny table survives the floor; a single oversized row degrades instead of raising; part/micro caps emit a parent summary rather than discarding.
- `_score_parse_quality` — clean markdown high, `�` soup low.
- **Coverage property test** (the single most valuable one): for each `final_evaluation/datasets/kpi_contracts/*.md` (already markdown, no PDF dependency), assert union of meso+table spans covers ≥99% of `full_text` with no gap over 40 chars. Encodes the coverage requirement as a gate.

```bash
cd apps/backend && TESTING=true poetry run pytest ../../testing/backend/tests/test_legal_chunking.py -v
```

**Wire into CI** — `test_legal_chunking.py` is currently run by nothing: not in `AGENT_GATE_TESTS` (`Makefile:36-51`), and `.github/workflows/agent-eval.yml:19-33` path filter excludes both `worker/tasks.py` and `rag/segmentation.py`, so ingestion changes trigger no CI at all. Add the test to the gate list and both paths to the filter.

> Before doing so, handle `apps/backend/test_fetch.py` and `apps/backend/test_test.py` — pytest-collectible names, module-level side effects, live Mongo required. They execute at import. Rename or exclude via `testpaths`.

**RAG baseline** — run `testing/backend/scripts/evaluate_contract_rag.py` (requires Mongo) **before** any change, commit as `testing/backend/baselines/rag_baseline_v2.json`. Watch `context_precision_at_6` and `term_recall_at_6`. `avg_chunk_tokens` will rise — tables are atomic now — which is intended, not a regression; record that interpretation with the baseline. Add table-targeted entries to `GOLDEN_QUERIES:30-56` with `preferred_levels: ["table"]`.

> Note: `evals/contractsense_agent/` will **not** catch a chunking regression — its README states retrieval quality is out of scope by design, and the `agent` runner injects its own executor over fixture sections.

---

## Files

| File | PR | Change |
|---|---|---|
| `apps/backend/pyproject.toml` | 2 | pin `^2.13`, re-lock |
| `apps/backend/worker/tasks.py` | 1,2 | delete heuristics; rewrite parser init/parse/page-text; add `_annotate_markdown_tables`, `_score_parse_quality` |
| `.../rag/segmentation.py` | 1,2 | merge-drop fix; `table_marker_regex`, `table_spans`, `_table_segments_for_section`, `_split_table_on_rows`, `_audit_span_coverage`, `preserve_whitespace` |
| `.../rag/vector_store.py` | 1,3 | drop 40-char floor; version-aware early-exit; `display_text` metadata; table linearization; batching |
| `.../rag/schemas.py` | 3 | `display_text` field |
| `.../rag/evidence_service.py` | 3 | projection allow-list + `display_text` preference |
| `.../rag/facade.py` | 3 | drop duplicate segmentation |
| `apps/backend/core/config.py` | 2 | `chunk_schema_version` → 3, `parse_quality_min`, `table_max_tokens` |
| `testing/backend/tests/test_legal_chunking.py` | 2 | new tests |
| `testing/backend/scripts/parse_pdf_local.py` | 2 | new |
| `Makefile`, `.github/workflows/agent-eval.yml` | 2 | CI wiring |

## Risks

- **liteparse 2.13 upgrade** — 13 minor releases of a beta native wheel. Defensive attribute access; verify via the local parse script before merging. No Dockerfile found in-repo (only compose files) — confirm the deploy image's Python is 3.10-3.12, since 2.13.0 ships no cp313 wheel.
- **Complement-interval bookkeeping in PR 2C** — most likely source of a coverage bug. The PR 2D audit is the net; land them together.
- **Unknown table shapes** — we have no survey of what the corpus actually contains, so the tier thresholds are estimates. Before tuning them, run the local parse script across every committed sample PDF and print a histogram of table row/col/token counts. Set `table_max_tokens` from that measurement rather than from the guess above. `03_AnnexB_Charges.pdf` and `04_PricingExhibitB.pdf` are the known table-heavy cases; they are unlikely to be the largest tables real customers upload.
- **Chunk-count growth** — atomic tables plus split parts plus table micros increase chunks per contract. D6 batching absorbs the write; watch embedding spend on the first exhibit-heavy contract after PR 3.
- **`chunk_schema_version` 3 with no backfill** — v2 and v3 chunks coexist. Safe *because each contract's chunks match its own stored `index.content`*. The one path that breaks that invariant is re-parse-without-re-embed, which PR 1's version-aware early-exit closes. That guard is not optional.
