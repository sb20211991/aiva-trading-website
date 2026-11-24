#!/usr/bin/env bash
# Builds the Aiva Android app (a Trusted Web Activity around app.aivatrading.uk) on a Linux runner that has a JDK 17, so
# no Mac, Android Studio or local toolchain is needed. Produces, in this directory:
#   app-release-bundle.aab   signed, for a Google Play upload
#   app-release-signed.apk   signed, for installing on a phone
#   assetlinks/assetlinks.json   the certificate fingerprint Android needs to open the site full screen
#
# Signing: ANDROID_KEYSTORE_BASE64 and ANDROID_KEYSTORE_PASSWORD keep one stable upload key. Without them a key is
# generated for this run and reported as KEYSTORE_STATUS=generated, so the pipeline works before any account exists.
set -euo pipefail
cd "$(dirname "$0")"

: "${JAVA_HOME:?JAVA_HOME is not set: run actions/setup-java first}"

# Runner images change between releases and their SDK layouts are not guaranteed; Bubblewrap only accepts an SDK it can
# drive itself, so build against a command-line-tools install we control rather than whatever is preinstalled.
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ] || [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  SDK="$HOME/android-sdk"
  [ -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ] || {
    echo "Installing Android command-line tools into $SDK"
    mkdir -p "$SDK/cmdline-tools"
    curl -fsSL --retry 3 -o /tmp/cmdline-tools.zip \
      https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
    unzip -q -o /tmp/cmdline-tools.zip -d /tmp/cmdline-tools
    mv /tmp/cmdline-tools/cmdline-tools "$SDK/cmdline-tools/latest"
  }
fi
export ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"
SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager"
"$SDKMANAGER" --version

# Licences first, so nothing below can stop to ask a question that an unattended run cannot answer.
yes | "$SDKMANAGER" --licenses > /dev/null 2>&1 || true
"$SDKMANAGER" --install "platform-tools" "platforms;android-35" "build-tools;35.0.0" > /dev/null

# Bubblewrap looks for sdkmanager at <sdk>/bin and <sdk>/tools/bin, not inside cmdline-tools, and refuses the SDK without
# it ("The provided androidSdk isn't correct"). Point those at the real binaries.
mkdir -p "$SDK/bin" "$SDK/tools/bin"
for tool in sdkmanager avdmanager; do
  ln -sf "$SDK/cmdline-tools/latest/bin/$tool" "$SDK/bin/$tool"
  ln -sf "$SDK/cmdline-tools/latest/bin/$tool" "$SDK/tools/bin/$tool"
done
"$SDK/bin/sdkmanager" --version > /dev/null

mkdir -p "$HOME/.bubblewrap"
printf '{"jdkPath":"%s","androidSdkPath":"%s"}\n' "$JAVA_HOME" "$SDK" > "$HOME/.bubblewrap/config.json"

# Play rejects a versionCode that was already uploaded, so the run number is the versionCode.
if [ -n "${RUN_NUMBER:-}" ]; then
  python3 - "$RUN_NUMBER" <<'PY'
import json, sys
n = int(sys.argv[1])
with open('twa-manifest.json') as f:
    m = json.load(f)
m['appVersionCode'] = n
m['appVersionName'] = '1.0.%d' % n
with open('twa-manifest.json', 'w') as f:
    json.dump(m, f, indent=2)
    f.write('\n')
print('version %s (versionCode %d)' % (m['appVersionName'], n))
PY
fi

umask 077
if [ -n "${ANDROID_KEYSTORE_BASE64:-}" ] && [ -n "${ANDROID_KEYSTORE_PASSWORD:-}" ]; then
  printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 -d > android.keystore
  PASS="$ANDROID_KEYSTORE_PASSWORD"
  STATUS=existing
  echo "Using the upload key from repository secrets."
else
  PASS="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
  rm -f android.keystore
  keytool -genkeypair -keystore android.keystore -alias android -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass "$PASS" -keypass "$PASS" \
    -dname "CN=Aiva Trading Limited, O=Aiva Trading Limited, L=London, C=GB"
  STATUS=generated
  echo "::add-mask::$PASS"
  echo "No upload key in secrets: generated one for this build. Save it before the first Play upload."
fi
[ -n "${GITHUB_ENV:-}" ] && printf 'KEYSTORE_STATUS=%s\n' "$STATUS" >> "$GITHUB_ENV"

export BUBBLEWRAP_KEYSTORE_PASSWORD="$PASS"
export BUBBLEWRAP_KEY_PASSWORD="$PASS"

# `update` regenerates the Android project from twa-manifest.json and writes the checksum that keeps `build` from
# stopping to ask a question, which an unattended run cannot answer.
bubblewrap update --skipVersionUpgrade --directory .
bubblewrap build --skipPwaValidation --directory . --signingKeyPath=./android.keystore --signingKeyAlias=android

ls -l app-release-bundle.aab app-release-signed.apk

FP="$(keytool -list -v -keystore android.keystore -alias android -storepass "$PASS" \
  | awk -F': ' '/SHA256:/{print $2; exit}' | tr -d ' ')"
[ -n "$FP" ] || { echo "Could not read the certificate fingerprint" >&2; exit 1; }

mkdir -p assetlinks
printf '[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"uk.aivatrading.app","sha256_cert_fingerprints":["%s"]}}]\n' "$FP" \
  > assetlinks/assetlinks.json
cat assetlinks/assetlinks.json

echo "sha256=$FP" >> "${GITHUB_OUTPUT:-/dev/null}"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## Aiva Android build"
    echo ""
    echo "- package: uk.aivatrading.app"
    echo "- SHA-256 certificate fingerprint: `$FP`"
    echo "- signing key: $STATUS"
    echo ""
    echo "Artifacts: app-release-bundle.aab (Play Console), app-release-signed.apk (a phone), assetlinks.json"
    echo "(serve at https://app.aivatrading.uk/.well-known/assetlinks.json so the app opens full screen)."
  } >> "$GITHUB_STEP_SUMMARY"
fi
