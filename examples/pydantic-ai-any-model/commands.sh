#!/usr/bin/env bash
# The install and run commands a tutorial page shows. The drift check keeps the install line equal
# to the pinned manifest and the run line equal to the command CI runs.
set -euo pipefail

# region: install
pip install "pydantic-ai-slim[anthropic,openai]==2.50.0"
# endregion

# region: run
python main.py
# endregion
