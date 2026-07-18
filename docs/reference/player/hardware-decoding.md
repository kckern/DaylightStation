# Hardware-Accelerated Transcoding & Decode

Whether Plex offloads video **decode** and **encode** to the GPU instead of the CPU
— and, more importantly for this host, *which half of the work it can actually
offload*. This is the highest-leverage lever against the encode-bound stall
(`playback-encoding-resilience.md`) because, unlike lowering the transcode target,
hardware acceleration can eliminate the CPU cost **without degrading picture
quality**. But it is not a blanket win here: the host GPU cannot hardware-decode
AV1, so AV1 sources — the exact class that stalls today — get only *partial*
relief. This doc explains the boundary and lays out a benchmark plan to measure it
empirically before committing to a fix.

---

## Why this matters: the decode/encode split

A transcode is two costs, not one:

| Stage | Work | On this host |
|-------|------|--------------|
| **Decode** | Turn the source codec (av1/hevc/h264) into raw frames | Only some codecs offloadable (see matrix) |
| **Encode** | Turn raw frames into the client codec (h264/hevc) | H264 & HEVC offloadable |

The stall on `plex:685089` (AV1, 1080p, **59.94fps**) pinned Plex at **413% CPU**
doing a full **software** AV1-decode **+** software h264-encode in realtime, which
it can't sustain → segments arrive >60s late → `proxy.timeout` → DASH `header not
available` → the resilience ladder spins up *more* doomed sessions.

The critical, non-obvious point: **lowering the output resolution/bitrate cuts only
the encode cost, not the decode cost.** Plex must decode every AV1 frame regardless
of what it outputs. So a "downgrade the transcode target" fix attacks the encode
half of a problem that is substantially in the decode half. Hardware decode is the
only lever that attacks the decode half — *if the GPU supports the source codec.*

---

## The hardware on this host

> Values below are for **kckern-server**. Verify with the commands, don't trust the
> table if the box changed.

| Property | Value | How to check |
|----------|-------|--------------|
| GPU | **AMD Cezanne** iGPU (Radeon Vega, Ryzen 5000-series APU) | `lspci \| grep -iE 'vga\|3d'` |
| PCI ID | `1002:1638` | `cat /sys/class/drm/card1/device/device` |
| Kernel driver | `amdgpu` | `cat /sys/class/drm/card1/device/uevent` |
| Video engine | **VCN 2.2** | (implied by Cezanne) |
| Render node | `/dev/dri/renderD128` | `ls -l /dev/dri` |
| Mapped into Plex? | **Yes** — `/dev/dri` bind-mounted, `NVIDIA_DRIVER_CAPABILITIES` set (misleading — this is an AMD box) | `sudo docker inspect plex --format '{{json .HostConfig.Devices}}'` |

The GPU is **already exposed to the Plex container** — it is simply not being used
for this transcode. So enabling HW acceleration is a Plex-settings change, not a
Docker re-plumb.

### Codec capability matrix (VCN 2.2 / Cezanne)

This is the whole story. **AV1 decode is absent.**

| Codec | HW decode | HW encode |
|-------|-----------|-----------|
| H.264 | ✅ | ✅ (VCE) |
| HEVC (H.265) | ✅ (incl. 10-bit) | ✅ (VCE) |
| VP9 | ✅ decode | ❌ |
| **AV1** | **❌ no HW decode** | ❌ no HW encode |

AV1 hardware decode on AMD arrived with **VCN 3.0 (RDNA2 — RX 6000 / Rembrandt &
Phoenix APUs)**. Cezanne is VCN 2.2, one generation short. **Empirically confirm**
the matrix (this is also benchmark step 0):

```bash
# vainfo lists the VAProfiles the driver actually exposes.
sudo docker exec plex sh -c 'vainfo 2>/dev/null | grep -iE "VAProfile(AV1|H264|HEVC|VP9)"'
# Expect: VAProfileH264*, VAProfileHEVC*, VAProfileVP9* — and NO VAProfileAV1*.
# If vainfo is absent in the Plex image, install libva-utils on the host and run
# `vainfo --display drm --device /dev/dri/renderD128` there.
```

---

## What HW acceleration can and can't fix here

The asymmetry drives every conclusion:

| Source codec | Decode | Encode (→ h264/hevc) | Net effect of enabling HW |
|--------------|--------|----------------------|---------------------------|
| **H.264** 60fps | HW ✅ | HW ✅ | **Full win** — near-idle CPU, no quality loss |
| **HEVC** 60fps | HW ✅ | HW ✅ | **Full win** |
| **VP9** | HW ✅ | HW encode to h264/hevc ✅ | **Full win** |
| **AV1** 60fps (the stall) | **SW ❌** | HW encode ✅ | **Partial** — encode offloads, but AV1 SW-decode wall remains |

So for the content that actually stalls (AV1), HW acceleration removes the *encode*
half but leaves the *decode* half on the CPU. Whether that partial relief is enough
to sustain realtime is an **empirical question** — hence the benchmark. Two
outcomes are plausible and only measurement distinguishes them:

- **AV1 SW-decode alone keeps ≥1.0× realtime** → HW encode offload is sufficient;
  enable HW accel and AV1 stops stalling. Cheapest possible fix, no quality loss.
- **AV1 SW-decode alone is <1.0× realtime** → decode is the wall; HW accel won't
  save AV1. Then the real options are: downgrade target (encode-side only — won't
  help), **direct-play AV1 on the Shield** (it HW-decodes AV1 natively — zero
  transcode), or re-encode the source. See the encoding-resilience doc's fix menu.

---

## Benchmark plan

**Goal:** quantify, per source codec, (a) baseline SW-transcode CPU + realtime
speed, (b) HW-transcode CPU + speed, and (c) for AV1, the isolated SW-decode
ceiling — so we know whether HW accel fixes AV1 or only h264/hevc.

### Test sources

Pick three real library items, all **1080p ~60fps**, differing only in codec, so
the codec is the isolated variable:

| Label | Codec | Example |
|-------|-------|---------|
| `SRC_AV1` | av1 | `plex:685089` (Episode 4, FIFA — the known stall) |
| `SRC_HEVC` | hevc | any 1080p60 hevc item |
| `SRC_H264` | h264 | any 1080p60 h264 item |

Find codec/fps for a candidate:

```bash
TOKEN=$(sudo docker exec daylight-station sh -c 'cat data/household/auth/plex.yml' | awk '/token/{print $2}' | tr -d '"')
sudo docker exec daylight-station sh -c "curl -s 'http://plex:32400/library/metadata/<RATINGKEY>?X-Plex-Token=$TOKEN'" \
  | grep -oE '(videoCodec|frameRate|width|height|bitrate)="[^"]*"'
```

### Metrics to capture (per source, SW vs HW)

| Metric | What it tells you | How |
|--------|-------------------|-----|
| Plex CPU % | Total transcode cost | `sudo docker stats --no-stream plex` (sample a few times mid-transcode) |
| GPU busy % | Whether the GPU is actually doing the work | `radeontop -d - -l 1` on host (or `amdgpu_top`); 0% = SW path even if "HW" claimed |
| Transcode **speed** | <1.0 = losing to realtime = will stall | Plex session status (below) |
| `videoDecision` + HW flags | copy vs transcode; HW requested vs full-pipeline | Plex session status |
| Segment fetch time | ~150ms=copy, ~1.5s=encode-bound, ~12ms=cached | `dash.fragment-loaded` logs |
| Buffer depth | Never exceeding ~1 segment = encode-bound | `dash.buffer-level` logs |
| Stall count / `proxy.timeout` | The user-visible failure | `daylight-station` logs |

Read Plex's live transcode decision + speed + hardware flags:

```bash
sudo docker exec daylight-station sh -c "curl -s 'http://plex:32400/status/sessions?X-Plex-Token=$TOKEN'" \
  | grep -oE '(videoDecision|transcodeHwRequested|transcodeHwFullPipeline|speed|videoCodec)="[^"]*"'
# transcodeHwFullPipeline="1" = both decode+encode on GPU.
# transcodeHwRequested="1" transcodeHwFullPipeline="0" = HW encode only, SW decode
#   (this is the expected AV1 shape on Cezanne).
# speed>=1.0 = keeping realtime; speed<1.0 = falling behind → stall.
```

### Isolating decode from encode (the decisive test)

Plex bundles decode+encode, so it can't tell you which half is the wall. Use a
standalone `ffmpeg` micro-benchmark to measure the AV1 **decode ceiling alone**
(decode to null, no encode):

```bash
# Copy SRC_AV1's file path from the Part element, then, on the host or in a
# ffmpeg-capable container with /dev/dri:

# 1. AV1 software decode ONLY (no encode) — how fast can this CPU even decode AV1?
ffmpeg -benchmark -threads 0 -i "$AV1_FILE" -an -f null -  2>&1 | grep -E 'fps=|speed='
#    speed >= 1.0x → decode is NOT the wall (HW encode offload will fix AV1)
#    speed <  1.0x → decode IS the wall (HW accel won't save AV1)

# 2. VAAPI hardware decode attempt (should FAIL / fall back for AV1 on this GPU —
#    proving the matrix). Expect an error or SW fallback for av1_vaapi.
ffmpeg -hwaccel vaapi -vaapi_device /dev/dri/renderD128 -i "$AV1_FILE" -an -f null - 2>&1 | tail -5

# 3. For contrast, HEVC HW decode+encode round-trip (should succeed, GPU busy):
ffmpeg -hwaccel vaapi -vaapi_device /dev/dri/renderD128 -i "$HEVC_FILE" \
  -c:v h264_vaapi -f null - -benchmark 2>&1 | grep -E 'fps=|speed='
```

### Procedure

For each source, **twice** (HW accel OFF, then ON in Plex settings):

1. Restart Plex clean (kills stuck sessions): user runs the restart.
2. Cast the source to `livingroom-tv` (`?queue=plex:<id>`) and let it run ~2 min.
3. Sample `docker stats plex`, `radeontop`, and the session status 3–4× mid-play.
4. Grep `daylight-station` logs for `proxy.timeout`, `dash.buffer-stalled`, segment
   fetch times.
5. Record the row.

> ⚠️ **Do not benchmark while the garage is in an active fitness session or a live
> Player video is playing elsewhere** — the CPU/GPU contention will pollute results
> and you'd be competing with real use. See `CLAUDE.local.md` deploy-gate rules.

### Expected results & decision criteria

| Source | HW OFF (predicted) | HW ON (predicted) | If HW ON confirms… |
|--------|--------------------|--------------------|---------------------|
| H.264 60fps | high CPU, speed ~1.0 marginal | GPU busy, CPU low, speed ≫1.0 | Enable HW — done |
| HEVC 60fps | high CPU | GPU busy, CPU low, speed ≫1.0 | Enable HW — done |
| **AV1 60fps** | 413% CPU, speed <1.0, stalls | encode on GPU, **decode still SW**; CPU lower but maybe still <1.0 | **speed ≥1.0 → enable HW, AV1 fixed. speed <1.0 → decode wall confirmed → direct-play AV1 on Shield or re-encode source** |

The AV1 row is the whole reason for the benchmark. The ffmpeg decode-only test
(step 1 above) predicts its outcome before you even touch Plex settings.

---

## Enabling HW transcoding in Plex (for the "ON" runs)

1. Requires an active **Plex Pass** (hardware transcoding is a Plex Pass feature).
2. Plex → Settings → **Transcoder** → enable **"Use hardware acceleration when
   available"** and **"Use hardware-accelerated video encoding."**
3. The `/dev/dri` device is already mapped (verified above), so no container change
   is needed on this host.
4. Verify it engaged: start a transcode and confirm `transcodeHwFullPipeline` /
   `transcodeHwRequested` in `/status/sessions`, and that `radeontop` shows GPU
   busy. A "(hw)" tag appears next to the stream in the Plex dashboard.

---

## Where this lives

| Concern | File |
|---------|------|
| GPU mapping into Plex | host `docker inspect plex` / compose at `/media/kckern/DockerDrive/Docker/` |
| Which codec Plex is asked to produce (h264/hevc advertisement, caps) | `backend/src/1_adapters/content/media/plex/transcodeProfile.mjs` |
| Decision request + transcode-URL builder | `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs` |
| Client segment/buffer diagnostics used as benchmark metrics | `frontend/src/modules/Player/renderers/VideoPlayer.jsx` |

## Related docs

- `docs/reference/player/playback-encoding-resilience.md` — the copy-vs-re-encode
  decision, MSE h264/hevc-only constraint, encode-bound stall signature (the
  companion to this doc; HW accel is the "make the forced re-encode cheap" lever)
- `docs/reference/player/README.md` — the Player subsystem and its resilience layers
- `docs/reference/player/lessons-and-gotchas.md` — AV1/VP9 advertise history,
  force-re-encode reverts, idle-reap, warmup
- `docs/reference/media/dash-video-resilience.md` — stall/seek troubleshooting runbook
