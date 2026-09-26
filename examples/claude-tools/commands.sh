#!/usr/bin/env bash
# The install and run commands a tutorial page shows. The drift check keeps the install line equal
# to the pinned manifest and the run line equal to the command CI runs.
set -euo pipefail

# region: install
npm install @anthropic-ai/sdk@0.128.0 zod@4.6.5
# endregion

# region: run
node main.ts
# endregion
