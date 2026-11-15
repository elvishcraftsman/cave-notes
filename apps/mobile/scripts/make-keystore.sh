#!/usr/bin/env bash
# Makes the signing key once. Keep the result (and the password) somewhere safe that is not git: a password manager is ideal.
#   bash scripts/make-keystore.sh
# It writes android/cave-notes.jks and android/keystore.properties (both ignored by git) and prints the keystore as base64,
# which you can store as a secret and give back to the build on another machine as CAVE_KEYSTORE_B64.
set -euo pipefail
cd "$(dirname "$0")/../android"
[[ -e cave-notes.jks ]] && { echo "cave-notes.jks already exists: not replacing it (a new key could not update installed apps)." >&2; exit 1; }
read -rsp "Choose a password for the key: " PASS; echo
keytool -genkeypair -v -keystore cave-notes.jks -alias cavenotes -keyalg RSA -keysize 4096 -validity 36500 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=Cave Notes"
cat > keystore.properties <<PROPS
storeFile=cave-notes.jks
storePassword=$PASS
keyAlias=cavenotes
keyPassword=$PASS
PROPS
echo
echo "Made android/cave-notes.jks and android/keystore.properties (not in git)."
echo "Store in your password manager: the password, the alias (cavenotes), and this base64 text:"
echo
base64 -w0 cave-notes.jks; echo
