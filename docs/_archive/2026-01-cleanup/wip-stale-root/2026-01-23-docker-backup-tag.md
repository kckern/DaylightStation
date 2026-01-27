# Docker Image Backup - 2026-01-23

## Current Production Image Backup

Created a backup tag of the current production Docker image before potential changes.

**Image Details:**
- **Digest:** `sha256:4f678238c40c66394fde1d7ff520dfed063d8990e33106a8f0525b27fcdbb417`
- **Image ID:** `510e938d5f86`
- **Created:** 2026-01-21 07:22:52 -0800 PST
- **Backup Tag:** `kckern/daylight-station:backup-20260123-171816`

## Rollback Instructions

If needed, rollback to this version using:

```bash
ssh homeserver.local 'docker tag kckern/daylight-station:backup-20260123-171816 kckern/daylight-station:latest && docker restart daylight-station'
```

## Push Backup to Docker Hub (Optional)

To preserve this backup remotely:

```bash
ssh homeserver.local 'docker push kckern/daylight-station:backup-20260123-171816'
```

## Notes

- Tag created on homeserver.local production server
- This is the running version as of 2026-01-23 17:18:16
- Keep this tag available until the new deployment is verified stable
