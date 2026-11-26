# yt-dlp sidecar for DaylightStation's share router: the ytdlp-fetch HTTP
# service (server.mjs) in the VPN container's network namespace, beside the
# PO-token provider (ytdlp-pot, reached by the bgutil plugin at 127.0.0.1:4416).
# Node (real binary) for JS challenges; ffmpeg for muxing.
# yt-dlp pinned to 2026.8.19 (2026.6.9 hit a hard 403 on all SABR/PO-token-gated
# adaptive formats as of 2026-09-06 -- only the 360p progressive format worked.
# 2026.8.19 resolved it. Re-pin forward if this recurs; check `pip index versions yt-dlp`.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip ffmpeg ca-certificates curl findutils sed && \
    rm -rf /var/lib/apt/lists/* && \
    pip install --no-cache-dir --break-system-packages \
      "yt-dlp==2026.8.19" bgutil-ytdlp-pot-provider
COPY server.mjs /opt/ytdlp-fetch/server.mjs
ENV PORT=8790 FETCH_DIR=/fetch
HEALTHCHECK --interval=60s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "/opt/ytdlp-fetch/server.mjs"]
