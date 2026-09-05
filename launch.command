#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f dist/index.html ]; then
  printf '%s\n' 'The static release is missing. Run npm ci and npm run build first.'
  exit 1
fi
printf '%s\n' 'Open http://127.0.0.1:4173/?scoutTheme=dark in your browser.' 'Press Ctrl+C to stop the local server.'
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
