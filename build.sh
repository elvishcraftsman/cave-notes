#!/usr/bin/env bash
set -e

# Always work from the repo root, wherever the script is started from
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# 1. Fetch current version from root package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version is: $CURRENT_VERSION"

# 2. Prompt user for new version
read -rp "Enter new version to publish (e.g., 0.6.0): " NEW_VERSION

if [ -z "$NEW_VERSION" ]; then
  echo "Error: Version cannot be empty. Aborting release."
  exit 1
fi

echo ""
echo "=========================================="
echo " Preparing release v${NEW_VERSION}"
echo "=========================================="
echo ""

# 3. Bump version in package.json & package-lock.json, create git commit + tag
npm version "$NEW_VERSION" -m "chore: release v%s"

# 4. Build
echo "Installing clean dependencies..."
npm ci

echo "Building AppImage package..."
(cd "$ROOT/apps/desktop" && npm run package:appimage:uruntime)

echo "Building the Android APK..."
(cd "$ROOT/apps/mobile/scripts" && bash ./build-apk.sh)

APK_BUILT="$ROOT/apps/mobile/dist/cave-notes-debug.apk"
if [ ! -f "$APK_BUILT" ]; then
  echo "Error: Built APK not found at $APK_BUILT"
  exit 1
fi
# the phone app looks for an .apk among the files of the newest release
APK_PATH="$ROOT/apps/mobile/dist/Cave_Notes-${NEW_VERSION}.apk"
cp "$APK_BUILT" "$APK_PATH"

# 5. Check the AppImage
ARTIFACT_PATH="$ROOT/apps/desktop/release/Cave_Notes-${NEW_VERSION}-x86_64-uruntime.AppImage"
if [ ! -f "$ARTIFACT_PATH" ]; then
  echo "Error: Built artifact not found at $ARTIFACT_PATH"
  exit 1
fi

# 6. Push local branch and tags to GitHub
echo "Pushing commits and tags to GitHub..."
git push --follow-tags

# 7. Create GitHub Release and upload AppImage and APK
echo "Creating GitHub Release v${NEW_VERSION}..."
gh release create "v${NEW_VERSION}" "$ARTIFACT_PATH" "$APK_PATH" \
  --title "${NEW_VERSION}" \
  --notes "Release v${NEW_VERSION}"

echo ""
echo "Successfully published v${NEW_VERSION} to GitHub Releases!"