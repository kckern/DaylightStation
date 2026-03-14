# Fully Kiosk Browser — JavaScript Interface

FKB exposes a `fully` object to all pages loaded in its WebView. This allows web pages to launch Android apps, bind to device lifecycle events, and control FKB behavior without any server-side involvement.

**No configuration required** — the `fully` object is available on all pages by default.

---

## Launching Android Apps

```javascript
// Launch by package name (opens default launcher activity)
fully.startApplication("org.lds.stream");

// Use as an href
<a href="javascript:fully.startApplication('org.lds.stream')">Gospel Stream</a>
```

### App Package Names

| App | Package |
|-----|---------|
| Gospel Stream (ChurchofJesusChrist) | `org.lds.stream` |
| BYUtv | `org.byutv.android` |
| Zoom | `us.zoom.videomeetings` |
| RetroArch | `com.retroarch.aarch64` |
| Arc Browser | `net.floatingpoint.android.arcturus` |
| X-plore | `com.lonelycatgames.Xplore` |

### Launching a Specific Activity

```javascript
fully.startApplication("us.zoom.videomeetings", "", "com.zipow.videobox.LauncherActivity");
```

---

## Lifecycle Events

Use `fully.bind(eventName, callback)` to respond to device/app events.

```javascript
// FKB returns to foreground after another app was used
fully.bind("onResume", function() {
    window.location.href = "fully://launcher";
});

// Screen turned on
fully.bind("onScreenOn", function() {
    console.log("Screen on");
});

// Screen turned off
fully.bind("onScreenOff", function() {
    console.log("Screen off");
});
```

### Common Events

| Event | Fires when |
|-------|-----------|
| `onResume` | FKB comes back to foreground (e.g. after exiting a launched app) |
| `onPause` | FKB goes to background |
| `onScreenOn` | Device screen turns on |
| `onScreenOff` | Device screen turns off |
| `onBatteryLevelChanged` | Battery level changes |
| `onMotionDetected` | Motion detected (if enabled) |

---

## Navigation

```javascript
// Load FKB's Universal Launcher
window.location.href = "fully://launcher";

// Load the configured start URL
window.location.href = "fully://startpage";

// Reload current page
fully.reload();
```

---

## Other Useful Methods

```javascript
// Check if fully interface is available (always guard in shared code)
if (typeof fully !== "undefined") {
    fully.startApplication("org.lds.stream");
}

// Text-to-speech
fully.textToSpeech("Hello from DaylightStation");

// Get device info
fully.getDeviceId();
fully.getBatteryLevel();
fully.isScreenOn();
```

---

## Boot / Return-to-Launcher Pattern

To load the Daylight web app on boot but return to the launcher after exiting other apps:

**In `injectJsCode` (FKB browser-level inject, runs on all pages):**
```javascript
if (typeof fully !== "undefined") {
    fully.bind("onResume", function() {
        window.location.href = "fully://launcher";
    });
}
```

**FKB settings:**
- `startURL` = `https://daylightlocal.kckern.net/tv`
- `showAppLauncherOnStart` = `false`

Result: Daylight loads on boot. After any launched app exits, FKB fires `onResume` and navigates to the Universal Launcher.

---

## Notes

- The `fully` object is only present when the page is loaded inside FKB. Guard all calls with `typeof fully !== "undefined"` if the same code runs in a desktop browser.
- `fully.startApplication()` is fire-and-forget — there is no callback or return value.
- Launched apps run as separate Android activities. FKB's WebView continues running in the background.
- `fully://launcher` renders FKB's Universal Launcher page (configurable via Remote Admin > Universal Launcher settings).
