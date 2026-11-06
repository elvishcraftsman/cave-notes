#!/usr/bin/env bash
set -euo pipefail

# Define target directory
DEST_DIR="/tmp/claude-files"

# List of target files
FILES=(
  "README.md"
  "apps/desktop/src/renderer/components/App.tsx"
  "apps/desktop/src/renderer/components/HeaderBar.tsx"
  "apps/desktop/src/renderer/components/TabBar.tsx"
  "apps/desktop/src/renderer/components/TreeView.tsx"
  "apps/desktop/src/renderer/components/Overlays.tsx"
  "apps/desktop/src/renderer/components/RightSidebar.tsx"
  "apps/desktop/src/renderer/styles/adwaita.css"
  "apps/desktop/src/main/settings.ts"
  "packages/editor/src/editor.ts"
  "packages/editor/src/livePreview.ts"
  "packages/editor/src/markdown.ts"
  "packages/editor/src/outline.ts"
)

# Prepare destination directory
rm -rf "$DEST_DIR"
mkdir -p "$DEST_DIR"

# Copy files maintaining directory structure
for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    mkdir -p "$DEST_DIR/$(dirname "$file")"
    cp "$file" "$DEST_DIR/$file"
    echo "Copied: $file"
  else
    echo "Warning: $file not found, skipping..."
  fi
done

echo -e "\nDone! All files copied to: $DEST_DIR"