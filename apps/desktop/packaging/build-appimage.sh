#!/bin/sh
# Build the Cave Notes AppImage(s) for x86_64.
#
#   sh packaging/build-appimage.sh [fuse2|uruntime|type2|both|all]      (default: both = fuse2 + uruntime)
#
#   fuse2     classic runtime (AppImageKit): needs libfuse.so.2 and fusermount on the machine that runs it
#   uruntime  VHSgunzo/uruntime: no libfuse needed; falls back to user namespaces, then to unpacking into a temp folder
#   type2     the current official runtime (AppImage/type2-runtime): static, but still needs /dev/fuse + fusermount(3)
#
# Output: release/Cave_Notes-<version>-x86_64[-<variant>].AppImage
# Needs: node/npm (with `npm ci` done in the repo root), curl, and mksquashfs (package squashfs-tools, version 4.4+ with xz
# and zstd). The runtimes are downloaded the first time and cached in .appimage-tools/. An AppImage is simply a runtime
# followed by a SquashFS image of the AppDir, so no appimagetool is needed (its bundled mksquashfs only does zstd, which the
# classic runtime cannot read). Pin or override with URUNTIME_VERSION=<tag>, CAVE_TOOLS_DIR=<dir>.
set -eu
cd "$(dirname "$0")/.."

VARIANT="${1:-both}"
ARCH=x86_64
# The version is the one `npm version` keeps in the package.json at the top of the repository (APP_VERSION=… overrides it
# for one build). apps/desktop/package.json is only kept in step with it, for the app's own About box and the packager.
ROOT_DIR="$(cd ../.. && pwd)"
VERSION="${APP_VERSION:-$(node -p "require('$ROOT_DIR/package.json').version")}"
DESKTOP_VERSION="$(node -p "require('./package.json').version")"
echo "Cave Notes version $VERSION (from $ROOT_DIR/package.json)"
if [ -z "${APP_VERSION:-}" ] && [ "$DESKTOP_VERSION" != "$VERSION" ]; then
  node "$ROOT_DIR/scripts/sync-version.mjs" # the packager and the About box read apps/desktop/package.json
fi
TOOLS="${CAVE_TOOLS_DIR:-$PWD/.appimage-tools}"
URUNTIME_VERSION="${URUNTIME_VERSION:-latest}"
mkdir -p "$TOOLS" release

fetch() { # url dest
  [ -s "$2" ] || { echo "• downloading $(basename "$2")"; curl -fL --retry 3 -o "$2.part" "$1" && mv "$2.part" "$2"; }
  chmod +x "$2"
}

URU_URL="https://github.com/VHSgunzo/uruntime/releases/latest/download"
[ "$URUNTIME_VERSION" = latest ] || URU_URL="https://github.com/VHSgunzo/uruntime/releases/download/$URUNTIME_VERSION"

command -v mksquashfs >/dev/null 2>&1 || { echo "mksquashfs not found: install squashfs-tools (dnf/apt install squashfs-tools)" >&2; exit 1; }

case "$VARIANT" in both) VARIANTS="fuse2 uruntime" ;; all) VARIANTS="fuse2 uruntime type2" ;; fuse2|uruntime|type2) VARIANTS="$VARIANT" ;; *) echo "unknown variant: $VARIANT" >&2; exit 2 ;; esac

# ---- 1. the unpacked app (bundles + electron-builder --dir; chrome-sandbox is removed by packaging/after-pack.cjs)
echo "• building the app"
rm -rf release/linux-unpacked
npm run package:dir

# ---- 2. one AppDir per runtime
for v in $VARIANTS; do
  case "$v" in
    fuse2)    RT_URL="https://github.com/AppImage/AppImageKit/releases/download/continuous/runtime-$ARCH"; RT="$TOOLS/runtime-fuse2-$ARCH"; COMP="xz -Xdict-size 100%"; SUFFIX="" ;;
    uruntime) RT_URL="$URU_URL/uruntime-appimage-squashfs-$ARCH"; RT="$TOOLS/uruntime-squashfs-$URUNTIME_VERSION-$ARCH"; COMP="zstd -Xcompression-level 19"; SUFFIX="-uruntime" ;;
    type2)    RT_URL="https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-$ARCH"; RT="$TOOLS/runtime-type2-$ARCH"; COMP="zstd -Xcompression-level 19"; SUFFIX="-type2" ;;
  esac
  fetch "$RT_URL" "$RT"

  AD="release/AppDir-$v"
  echo "• assembling $AD"
  rm -rf "$AD"
  mkdir -p "$AD/app"
  cp -a release/linux-unpacked/. "$AD/app/"
  # which runtime this AppImage has, so that its updater fetches the same kind (a renamed file cannot say)
  printf '%s\n' "$v" > "$AD/app/resources/appimage-variant"
  install -m 755 packaging/AppRun "$AD/AppRun"
  cp packaging/cave-notes.desktop "$AD/cave-notes.desktop"
  cp packaging/icons/512.png "$AD/cave-notes.png"
  ln -s cave-notes.png "$AD/.DirIcon"
  for s in 16 24 32 48 64 128 256 512; do
    mkdir -p "$AD/usr/share/icons/hicolor/${s}x${s}/apps"
    cp "packaging/icons/$s.png" "$AD/usr/share/icons/hicolor/${s}x${s}/apps/cave-notes.png"
  done

  OUT="release/Cave_Notes-$VERSION-$ARCH$SUFFIX.AppImage"
  rm -f "$OUT"
  echo "• packing $OUT ($v runtime, ${COMP%% *})"
  command -v desktop-file-validate >/dev/null 2>&1 && desktop-file-validate "$AD/cave-notes.desktop"
  # shellcheck disable=SC2086  # COMP is "<compressor> <its options>"
  mksquashfs "$AD" "$OUT.sqfs" -root-owned -noappend -no-xattrs -b 1M -comp $COMP -quiet -no-progress
  cat "$RT" "$OUT.sqfs" > "$OUT"
  rm -f "$OUT.sqfs"
  chmod +x "$OUT"
  rm -rf "$AD"
  ls -lh "$OUT"
done
echo "done."
