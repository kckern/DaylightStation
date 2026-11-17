# Local native supervision guard — commissioning required

Source preparation only. This APK is not installed or commissioned. It does not enable a household condition. The Android service requires device-owner authority and a private credential; an ordinary installed app or browser cannot enforce package restrictions.

The service starts with no lease, hides the configured native package, and polls the authenticated `/api/v1/supervision/native-lease` endpoint over HTTPS. A separate local loop uses `elapsedRealtime` and the request-start deadline, capped at five seconds. A stalled request cannot extend that deadline. Ordering survives process restart, but grants do not. A denial, expired lease or restart returns to a hidden package; unhiding never launches it. Package files and application data are retained by [Android's package-hiding API](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setApplicationHidden(android.content.ComponentName,%20java.lang.String,%20boolean)). Unsaved native progress can be lost.

Provisioning is a separate security-sensitive operation. Review the complete branch, APK signature and device-owner eligibility before touching a device. No factory reset, uninstall, device-owner assignment or install is authorized by this document. Never remove an existing device owner or erase application data to make provisioning succeed.

After explicit commissioning approval, supply `native-supervision.json` in the app's device-protected private files directory (`/data/user_de/0/net.kckern.supervisionguard/files/`) using an authorized management channel. Shape:

```json
{"endpoint":"https://YOUR_APP/api/v1/supervision/native-lease","credential":"INDEPENDENT_RANDOM_SECRET_AT_LEAST_32_CHARACTERS","packageName":"com.retroarch.aarch64"}
```

The matching protected household auth entry is `native_devices.<registered-device>.credential` and `.packages`. Never put a real credential in source, command-line logs, browser storage or a URL. The exported start service requires Android's DUMP permission; it accepts no configuration extras. Only the system/admin receiver and an authorized shell can start it. No child endpoint can configure the guard.

Acceptance must verify actual device-owner capability; the target package is installed, hidden and absent as a process when blocked; startup before unlock; process restart; reboot with network unavailable; network loss during foreground play; TLS failure; a delayed response; grant expiry; Stop and late release. Confirm that normal unhide does not launch anything. The server must also read a live native process's open load log and resolve its last content path exactly to the catalog. Inaccessible `/proc`/log evidence or a title switch that cannot be observed is incomplete native coverage, not proof of an allowed title. A grace lease for a new consumed native launch ends at consumption plus five seconds and cannot be renewed from an idle process forever.

Build with the existing Android toolchain: `gradle -p _extensions/supervision-guard :app:testDebugUnitTest :app:assembleDebug`. Four deadline tests passed and the debug APK built during source preparation. These tests do not establish hardware acceptance or five-second wall-clock termination on the actual Shield.
