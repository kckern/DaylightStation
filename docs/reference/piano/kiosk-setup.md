# Piano Kiosk Display Setup

Reference for the KCKERN.NET kiosk configuration — the primary display for DaylightStation's piano games and office UI.

---

## Hardware

| Component | Details |
|-----------|---------|
| Host | KCKERN.NET (Ubuntu 24.04, AMD Cezanne Radeon Vega iGPU) |
| Primary display | VIE LED Monitor on HDMI-A-1 (1920x1080@75Hz) |
| Mirror display | VIZIO V605-G3 60" TV on DP-3 (native 4K, driven at 1080p) |
| CPU | 16 cores, shared with ~109 Docker containers |

## Software Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Window manager | **sway** | Replaced GNOME Shell — eliminated ~270ms compositor stalls at 60fps (see [Jank Resolution](#jank-resolution)) |
| Browser | **Brave** (native .deb) | Replaced Snap Firefox — native package, V8 GC is incremental |
| Display mirroring | **wl-mirror** | Mirrors HDMI-A-1 content to DP-3 fullscreen |
| Login manager | GDM3 | Auto-login into sway session |

### Why Not GNOME

GNOME Shell + Mutter caused consistent ~270ms jank spikes every ~10 seconds during 60fps game rendering. Investigation ruled out CPU contention, Firefox GC, and frontend code — the compositor itself was the bottleneck. GNOME's overhead on this host:

| Process | Resource |
|---------|----------|
| gnome-shell | 7.6% CPU, 984 MB RAM |
| ding@rastersoft.com (desktop icons) | 2.1% CPU, **3.6 GB RAM** |
| gjs (notifications, screensaver) | Multiple processes |

Sway replaced all of this with a single 135 MB process and zero jank.

### Why Not Firefox

Firefox was running as a **Snap package** (Ubuntu default). Snap adds AppArmor confinement and squashfs overhead. While switching browsers alone didn't fix the jank (GNOME was the real cause), Brave as a native .deb avoids Snap overhead entirely.

---

## Configuration Files

### Sway Config

**Path:** `/home/kckern/.config/sway/config`

```
# Primary display — 1080p at 1.5x scale
output HDMI-A-1 resolution 1920x1080 position 0 0 scale 1.5

# Mirror display
output DP-3 resolution 1920x1080 position 1920 0

# No title bars, no borders
default_border none
default_floating_border none

# Black background
output * bg #000000 solid_color

# Launch Brave kiosk on startup
exec brave-browser --kiosk \
  --no-first-run --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --noerrdialogs --password-store=basic \
  --disable-features=Translate \
  --disable-component-update --disable-sync \
  --disable-background-networking \
  --no-default-browser-check \
  --disable-client-side-phishing-detection \
  --enable-features=VaapiVideoDecoder,VaapiVideoDecodeLinuxGL \
  --enable-gpu-rasterization --ignore-gpu-blocklist \
  --ozone-platform=wayland \
  https://daylightlocal.kckern.net/office

# Mirror HDMI-A-1 to DP-3 via wl-mirror
exec wl-mirror HDMI-A-1
for_window [app_id="at.yrlf.wl_mirror"] move to output DP-3, fullscreen enable

# Exit sway
set $mod Mod4
bindsym $mod+Shift+e exec swaynag -t warning -m "Exit sway?" -B "Yes" "swaymsg exit"
```

### GDM Auto-Login

**Path:** `/etc/gdm3/custom.conf`

```ini
[daemon]
DefaultSession=sway.desktop
AutomaticLoginEnable=True
AutomaticLogin=kckern
```

**Path:** `/var/lib/AccountsService/users/kckern`

```ini
[User]
Session=sway
```

### Old Scripts (disabled)

| File | Status |
|------|--------|
| `/home/kckern/.config/autostart/firefox-kiosk.desktop` | `X-GNOME-Autostart-enabled=false` |
| `/home/kckern/firefox-kiosk.sh` | Unused (launched Snap Firefox in kiosk mode) |
| `/usr/local/bin/start-browser-kiosk.sh` | Unused (Chromium-based, never connected to autostart) |
| `/home/kckern/browser-kiosk.sh` | Unused (Brave variant, superseded by sway config) |

---

## Jank Resolution

The piano side-scroller and other 60fps games exhibited ~270ms single-frame jank spikes every ~10 seconds. Full investigation documented in `docs/_wip/bugs/2026-02-28-piano-jank-cpu-contention.md`.

### Investigation Summary

| Hypothesis | Result |
|------------|--------|
| Frontend GC pressure (Array.shift, setInterval, Math.min spread) | **Wrong** — code fixes had zero impact on jank |
| Codebase timer matching ~10s cadence | **Wrong** — no matching timer in piano component tree |
| CPU contention (cadvisor 58%, Plex 46%, Dropbox) | **Partially right** — reduced load but jank persisted |
| Snap Firefox overhead | **Wrong** — jank identical on Brave |
| GNOME Shell / Mutter compositor | **Root cause** — switching to sway eliminated all jank |

### Before vs After

```
=== GNOME + Firefox (Snap) ===
Jank windows: 26/55 (47%)
Spike range: 55ms - 433ms
FPS: 56-60 (unstable)

=== GNOME + Brave (native) ===
Jank windows: 4/9 (44%)
Spike range: 267ms - 300ms
FPS: 56-60 (unstable)

=== Sway + Brave (native) ===
Jank windows: 0/9 (0%)
Max frame time: 13.5ms
FPS: 75.0 (locked to monitor refresh)
```

### Infrastructure Changes Made During Investigation

| Change | Location | Impact |
|--------|----------|--------|
| cadvisor scrape interval 1s → 10s, CPU capped at 0.5 | Docker compose (System) | CPU usage 58% → ~2% |
| tubearchivist removed (3 containers) | Docker compose (Media) | Freed ~100% CPU |
| Brave installed | apt (native .deb) | No Snap overhead |
| sway installed | apt | Lightweight Wayland compositor |
| wl-mirror installed | apt | Display mirroring for sway |

---

## Garage Kiosk (Reference)

The garage has a similar kiosk setup for the fitness display.

**Script:** `/usr/local/bin/start-browser-kiosk.sh`

| Setting | Value |
|---------|-------|
| Browser | Firefox (native, not Snap) |
| URL | `https://daylightlocal.kckern.net/fitness` |
| Display | HDMI-1 at 1920x1080 |
| GPU accel | VAAPI via iHD driver |
