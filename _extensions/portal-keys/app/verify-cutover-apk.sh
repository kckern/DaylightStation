#!/bin/bash
# Offline release checks for the exact APK supplied by the cutover operator.
set -euo pipefail
export LC_ALL=C

apk=${1:?usage: bash verify-cutover-apk.sh APK ANDROID_BUILD_TOOLS_DIR [INSTALLED_APK]}
tools=${2:?supply the Android SDK build-tools directory}
installed=${3:-}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

require_artifact_pattern() {
    grep -Fq "$1" "$2" || { echo "Missing $1 in $2" >&2; exit 1; }
}

badging=$("$tools/aapt" dump badging "$apk")
package=$(sed -n "s/^package: name='\([^']*\)'.*/\1/p" <<< "$badging")
version=$(sed -n "s/^package: .*versionCode='\([0-9]*\)'.*/\1/p" <<< "$badging")
[[ "$package" == net.kckern.portalkeys ]] || { echo "Unexpected helper package: $package" >&2; exit 1; }
[[ -n "$version" && "$version" -gt 35 ]] || { echo "Expected helper versionCode above 35, found $version" >&2; exit 1; }

"$tools/aapt" dump xmltree "$apk" AndroidManifest.xml > "$work/manifest.txt"
awk '/^      E: / { admin=0 } /"net.kckern.portalkeys.PortalAdminReceiver"/ { admin=1 } admin' \
    "$work/manifest.txt" > "$work/admin.txt"
require_artifact_pattern '"android.permission.BIND_DEVICE_ADMIN"' "$work/admin.txt"
require_artifact_pattern '"android.app.device_admin"' "$work/admin.txt"
resources=$("$tools/aapt" dump resources "$apk")
admin_resource=$(awk '/spec resource .* net.kckern.portalkeys:xml\/device_admin:/ { print $3 }' <<< "$resources")
[[ -n "$admin_resource" ]]
require_artifact_pattern "@$admin_resource" "$work/admin.txt"
"$tools/aapt" dump xmltree "$apk" res/xml/device_admin.xml > "$work/admin-resource.txt"
require_artifact_pattern 'E: support-transfer-ownership' "$work/admin-resource.txt"

unzip -jq "$apk" 'classes*.dex' -d "$work"
strings "$work"/classes*.dex > "$work/shell.strings"
require_artifact_pattern '"lockdownProtocolVersion":2,"lockdownRevision":' "$work/shell.strings"
require_artifact_pattern 'stale or conflicting lockdown revision' "$work/shell.strings"

unzip -p "$apk" assets/payload-baked.jar > "$work/payload.jar"
unzip -p "$work/payload.jar" classes.dex > "$work/payload.dex"
"$tools/dexdump" -d "$work/payload.dex" > "$work/payload-disassembly.txt"
require_artifact_pattern '"p10-ordered-owner-transfer"' "$work/payload-disassembly.txt"
require_artifact_pattern '"/owner/transfer"' "$work/payload-disassembly.txt"
require_artifact_pattern 'HomeWatchdog;.transferOwner:' "$work/payload-disassembly.txt"
require_artifact_pattern 'DevicePolicyManager;.transferOwnership:' "$work/payload-disassembly.txt"
require_artifact_pattern 'ShellServices;.applyLockdown:' "$work/payload-disassembly.txt"

signature=$("$tools/apksigner" verify --print-certs "$apk")
signer=$(sed -n 's/^Signer #[0-9]* certificate SHA-256 digest: //p' <<< "$signature")
[[ -n "$signer" ]]
if [[ -n "$installed" ]]; then
    installed_badging=$("$tools/aapt" dump badging "$installed")
    [[ "$installed_badging" == "package: name='net.kckern.portalkeys'"* ]] ||
        { echo 'Installed signer reference is not a Portal Keys APK' >&2; exit 1; }
    installed_signature=$("$tools/apksigner" verify --print-certs "$installed")
    installed_signer=$(sed -n 's/^Signer #[0-9]* certificate SHA-256 digest: //p' <<< "$installed_signature")
    [[ "$signer" == "$installed_signer" ]] || { echo 'Installed signer mismatch' >&2; exit 1; }
fi

echo "APK SHA-256: $(shasum -a 256 < "$apk" | cut -d ' ' -f 1)"
echo "Baked payload SHA-256: $(shasum -a 256 < "$work/payload.jar" | cut -d ' ' -f 1)"
echo "Signing certificate SHA-256: $signer"
echo "Portal Keys versionCode $version passed the cutover packaging checks."
