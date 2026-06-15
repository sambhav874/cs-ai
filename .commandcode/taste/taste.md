# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# workflow
- Do not change model configuration defaults (model_name, max_tokens, etc.) in config.py without explicit user approval. Confidence: 0.70
- Run Python scripts via poetry (e.g., `poetry run python script.py`) rather than invoking python directly. Confidence: 0.65
- When refining an existing plan, update the existing plan file rather than creating a new separate plan file. Confidence: 0.65
- Use a root-level Makefile for monorepo orchestration instead of npm scripts in a root package.json. Confidence: 0.70

# docker
- Frontend Containerfile expects build context at ./apps/frontend (uses relative COPY paths like `COPY package.json`). Backend Containerfile expects build context at repo root (uses `COPY apps/backend/...` paths). Confidence: 0.60
- When fixing containerization issues (e.g., Next.js Dockerfile), research established best practices before making ad-hoc fixes. Confidence: 0.65

# naming
- The project is called "ContractSense," not "ContractLens." Confidence: 0.70

# ui-layout
- Use split-panel layout for the playbook page: rules/editor on the left, contracts and PDF viewer on the right. Confidence: 0.70
- Use pop-out or slide-out panels for rule editing triggered by user action, rather than always-visible inline editor cards. Confidence: 0.70
- Show key identifying information (e.g., contract names) directly in list/finding cards rather than hiding them behind click interactions. Confidence: 0.65
