# Image Rendering: Blocky/Pixelated Circular Avatars and Rounded Corners

**Date:** 2026-02-14  
**Status:** Unresolved  
**Severity:** Medium (visual quality issue)  
**Platform:** Garage kiosk (Linux Mint 22.2, Chromium 145, Intel Alder Lake-P iGPU)

## Summary

PNG images with `border-radius` CSS (circular user avatars, season posters with rounded corners) render with blocky/pixelated edges on the garage kiosk display. JPEG episode thumbnails render smoothly. Video playback is smooth (60fps, 0% drops), confirming GPU acceleration is working, but PNG compositing appears to use software rendering for border-radius masks.

## Screenshot Evidence

`/home/kckern/Pictures/Screenshot_2026-02-14_18-15-42.png` on garage PC shows:
- **User avatar (circular PNG):** Severely pixelated/blocky edges on `border-radius: 50%`
- **Season poster (rounded PNG):** Jagged corners on `border-radius: 1rem`
- **Episode thumbnails (JPEG):** Smooth rendering ✓
- **"GOOD KIDS!" text logo (PNG):** Blocky/aliased edges

## Environment

### Hardware
- **CPU:** Intel Core i5-12600H (12th gen, 16 cores)
- **GPU:** Intel Alder Lake-P integrated graphics
- **RAM:** 16GB
- **Display:** 1920x1080 @ 72 DPI

### Software
- **OS:** Linux Mint 22.2 (Ubuntu 24.04 base), kernel 6.17.0-14-generic
- **Browser:** Chromium 145.0.7632.45
- **VAAPI:** Intel iHD driver 24.1.0, VA-API 1.20 (working)
- **EGL:** Mesa/iris, EGL 1.5 (working)

### Chromium Flags (Current)
```bash
/usr/lib/chromium/chromium \
  --ozone-platform=x11 \
  --use-gl=angle \
  --use-angle=gl \
  --ignore-gpu-blocklist \
  --enable-gpu-rasterization \
  --enable-zero-copy \
  --enable-native-gpu-memory-buffers \
  --enable-accelerated-video-decode \
  --disable-gpu-driver-bug-workarounds \
  --enable-features=VaapiVideoDecoder,VaapiVideoEncoder,VaapiVideoDecodeLinuxGL,Vulkan,WebUIDarkMode \
  --disable-features=Translate,TFLiteLanguageDetectionEnabled,GlobalVaapiLock \
  --kiosk \
  --force-device-scale-factor=1.39
```

### GPU Process Verification
```bash
# GPU process shows GL is enabled (not disabled)
ps aux | grep "type=gpu"
# Output: --use-gl=angle --use-angle=gl --enable-gpu-rasterization
```

### FPS Metrics (Confirmed Working)
```json
{
  "videoFps": 60.1,
  "videoDroppedFrames": 2,
  "videoDropRate": 0.0,
  "renderFps": 60
}
```

Video decode and playback use hardware acceleration successfully. The issue is isolated to PNG image compositing with CSS `border-radius`.

## Attempted Fixes

### 1. CSS `image-rendering` Property
**File:** `frontend/index.html`

```css
img {
  image-rendering: -webkit-optimize-contrast; /* Fallback */
  image-rendering: smooth; /* GPU antialiasing */
}
```

**Result:** No improvement. Images still blocky.

**Note:** Initially tried `-webkit-optimize-contrast` alone, which made it WORSE (that property is for performance optimization via pixelation, not quality).

### 2. Force GPU Compositing with `translateZ(0)`
**Files:** 
- `frontend/index.html` (global `img` rule)
- `frontend/src/modules/Fitness/components/CircularUserAvatar.scss` (`.avatar-core`)

```css
img {
  transform: translateZ(0); /* Force GPU layer */
  will-change: transform;
}

.avatar-core {
  transform: translateZ(0);
  will-change: transform;
  
  img {
    transform: translateZ(0);
  }
}
```

**Result:** Deployed and rebooted. User reports no improvement.

### 3. Chromium GPU Blocklist Bypass
**File:** `/usr/local/bin/start-browser-kiosk.sh`

Added flags:
- `--ignore-gpu-blocklist` 
- `--disable-gpu-driver-bug-workarounds`
- `--ozone-platform=x11` (force X11, avoid Wayland conflicts)

**Result:** Fixed video FPS (GPU acceleration now working for video), but PNG border-radius rendering still blocky.

## Analysis

### Working Components
- ✅ Video decode (VAAPI working)
- ✅ Video playback (60fps, 0% drops)
- ✅ GL backend enabled (`--use-gl=angle`)
- ✅ GPU rasterization enabled
- ✅ JPEG image rendering (episode thumbnails smooth)

### Broken Components
- ❌ PNG images with `border-radius` (circular avatars, rounded posters)
- ❌ PNG text logos (blocky edges)
- ❌ CSS `border-radius` antialiasing on PNGs

### Hypothesis

Chromium 145 on Intel Alder Lake-P may be applying a **GPU driver workaround** that forces `border-radius` compositing to CPU for PNGs, even with `--disable-gpu-driver-bug-workarounds` and `--ignore-gpu-blocklist`.

Possible causes:
1. **ANGLE GL backend limitation:** `--use-angle=gl` may not support GPU-accelerated border-radius masks on Linux
2. **Chromium internal blocklist:** Intel Alder Lake-P may be internally blocklisted for specific compositing features (beyond what `--ignore-gpu-blocklist` covers)
3. **PNG vs JPEG format handling:** Chromium may treat PNG alpha channels differently in compositing pipeline
4. **DPI scaling interaction:** `--force-device-scale-factor=1.39` combined with border-radius may trigger software fallback

### Why JPEGs Work but PNGs Don't

JPEGs have no alpha channel, so `border-radius` masking may use a simpler GPU path. PNGs with alpha channels require alpha blending during border-radius clipping, which may be falling back to CPU.

## Diagnostic Commands

```bash
# Check GPU process flags
ssh garage "ps -o args -p \$(pgrep -f 'type=gpu' | head -1)"

# Check FPS in prod logs
ssh homeserver.local 'docker logs --since 5m daylight-station' | grep -i fps

# Take screenshot
ssh garage 'DISPLAY=:0 gnome-screenshot -f /home/kckern/Pictures/Screenshot.png'

# Copy screenshot locally
scp garage:/home/kckern/Pictures/Screenshot_2026-02-14_18-15-42.png /tmp/

# Check image file types
curl -sI https://daylightlocal.kckern.net/api/image-proxy/plex/some-thumb | grep -i content-type
```

## Next Steps for Investigation

### 1. Test ANGLE Vulkan Backend
Try `--use-angle=vulkan` instead of `--use-angle=gl`:

```bash
--use-gl=angle \
--use-angle=vulkan \
```

Intel Alder Lake-P supports Vulkan. This may provide better compositing support.

### 2. Test Native EGL (Pre-Chromium 145)
Chromium 145 requires ANGLE. Downgrade to Chromium 130-144 range to test native `--use-gl=egl`:

```bash
--use-gl=egl \
```

If this works, confirms ANGLE GL backend is the issue.

### 3. Disable Device Scale Factor
Remove `--force-device-scale-factor=1.39` to test if non-integer scaling triggers software rendering:

```bash
# Remove this flag and test
# --force-device-scale-factor=1.39
```

### 4. Test CSS `border-image` Alternative
Replace `border-radius` with SVG mask or `clip-path`:

```css
.circular-user-avatar {
  /* Instead of border-radius: 50% */
  clip-path: circle(50%);
}
```

`clip-path` uses different compositing path than `border-radius`.

### 5. Check Chrome DevTools Remote Debugging
Enable remote debugging to inspect actual render layers:

```bash
chromium --remote-debugging-port=9222
```

Then open `chrome://inspect` from another machine to see if avatars are on GPU layers.

### 6. Try Firefox as Baseline
Install Firefox and test with same content:

```bash
firefox --kiosk https://daylightlocal.kckern.net/fitness
```

Firefox uses native VAAPI without ANGLE. If images render smoothly, confirms Chromium ANGLE GL issue.

## Related Issues

- `2026-02-02-fps-degradation-governance-warning.md` - Video FPS drops (FIXED by GPU blocklist bypass)
- GPU acceleration was previously disabled (`--use-gl=disabled`), now working for video but not PNG compositing

## Files Modified

- `frontend/index.html` - Added global `image-rendering: smooth` and `transform: translateZ(0)`
- `frontend/src/modules/Fitness/components/CircularUserAvatar.scss` - Added GPU compositing hints
- `/usr/local/bin/start-browser-kiosk.sh` (on garage) - Updated Chromium flags for GPU acceleration

## Related Code

- [CircularUserAvatar.scss](frontend/src/modules/Fitness/components/CircularUserAvatar.scss) - Avatar component with `border-radius: 50%`
- [FitnessShow.scss](frontend/src/modules/Fitness/FitnessShow.scss) - Season poster styles
- [GovernanceStateOverlay.scss](frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.scss) - Lock screen avatars

## Priority

**Medium** - Visual polish issue, does not affect functionality. Video playback is smooth and hardware accelerated. Avatars are recognizable despite blocky edges.

Lower priority than functional bugs, but creates poor visual experience on 1080p display.
