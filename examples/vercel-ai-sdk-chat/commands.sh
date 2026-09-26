#!/usr/bin/env bash
# The install and run commands a tutorial page shows. The drift check keeps the install line equal
# to the pinned manifest and the run line equal to the command CI runs.
set -euo pipefail

# region: install
npm install @ai-sdk/anthropic@4.0.63 @ai-sdk/openai@4.0.75 ai@7.0.114
# endregion

# region: run
node main.ts
# endregion
