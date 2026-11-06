#!/usr/bin/env bash
# Builds the Cave Notes debug APK on an Ubuntu/Debian machine, with no Android Studio and no GitHub Actions.
#   bash scripts/build-apk.sh            build apps/mobile/dist/cave-notes-debug.apk
#   bash scripts/build-apk.sh --install  also install it on a phone connected over USB (or wireless) debugging
# First run downloads the Android command-line tools and SDK pieces (about 1 GB) into ~/Android/Sdk.
# The build uses JDK 21 whatever your default Java is (Gradle 8.14 cannot run on Java 25).
set -euo pipefail

cd "$(dirname "$0")/.."
MOBILE_DIR="$PWD"
REPO_ROOT="$(cd ../.. && pwd)"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
CMDLINE_TOOLS_ZIP="commandlinetools-linux-11076708_latest.zip"
INSTALL=0
[[ "${1:-}" == "--install" ]] && INSTALL=1

say() { printf '\n== %s\n' "$*"; }

find_jdk21() {
  local d
  for d in /usr/lib/jvm/java-21-openjdk-* /usr/lib/jvm/temurin-21-*; do
    [[ -x "$d/bin/javac" ]] && { echo "$d"; return 0; }
  done
  return 1
}

say "Checking tools"
missing=()
command -v unzip >/dev/null || missing+=(unzip)
command -v curl >/dev/null || missing+=(curl)
find_jdk21 >/dev/null || missing+=(openjdk-21-jdk-headless)
if ((${#missing[@]})); then
  echo "Installing: ${missing[*]}"
  sudo apt-get update && sudo apt-get install -y "${missing[@]}"
fi
JAVA_HOME="$(find_jdk21)" || { echo "JDK 21 not found after install." >&2; exit 1; }
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"
echo "Using $(java -version 2>&1 | head -1) from $JAVA_HOME"
command -v node >/dev/null || { echo "Node 22 or newer is required (the repo already needs it)." >&2; exit 1; }

SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
if [[ ! -x "$SDKMANAGER" ]]; then
  say "Downloading the Android command-line tools"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  tmp="$(mktemp -d)"
  curl -fL -o "$tmp/tools.zip" "https://dl.google.com/android/repository/$CMDLINE_TOOLS_ZIP"
  unzip -q "$tmp/tools.zip" -d "$tmp"
  mv "$tmp/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  rm -rf "$tmp"
fi

say "Installing SDK pieces (skipped when already present)"
yes | "$SDKMANAGER" --licenses >/dev/null || true
"$SDKMANAGER" "platform-tools" "platforms;android-36" "build-tools;36.0.0"

say "Building the web bundle"
(cd "$REPO_ROOT" && npm ci --no-audit --no-fund)
npm run build
npx cap sync android

say "Building the APK"
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
# Gradle must use exactly this JDK: with auto-detection it may pick another Java on the machine (for example a JRE with no compiler)
(cd android && ./gradlew --no-daemon \
  -Dorg.gradle.java.home="$JAVA_HOME" \
  -Porg.gradle.java.installations.auto-detect=false \
  -Porg.gradle.java.installations.paths="$JAVA_HOME" \
  assembleDebug)

mkdir -p dist
cp android/app/build/outputs/apk/debug/app-debug.apk dist/cave-notes-debug.apk
say "Done: $MOBILE_DIR/dist/cave-notes-debug.apk"

if (( INSTALL )); then
  say "Installing on the connected phone"
  "$ANDROID_HOME/platform-tools/adb" install -r dist/cave-notes-debug.apk
fi
