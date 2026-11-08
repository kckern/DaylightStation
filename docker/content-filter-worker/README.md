# Content-filter worker

Runs the content-filter pipeline for Admin → Content filter ("Make filter", "Send back",
"Stage again"). The app only queues runs in `household/content-filter/jobs/<rk>.yml`; this
container claims them (one at a time), runs `contentfilter preflight | export | refine | scenes |
audit` with a heartbeat, and the app picks up the result. Card drafts are written by the app
when it sees a run finish (the worker has no AI gateway).

Why a separate image: the app image is Alpine, and faster-whisper (ctranslate2) and
torch/torchaudio publish no musl wheels.

## Build

```bash
sudo docker build -f docker/content-filter-worker/Dockerfile -t kckern/daylight-content-filter-worker:latest .
```

## Run (once, by the owner)

It shares the app's data and media volumes and its network (Plex, Jev):

```bash
docker run -d --name daylight-content-filter-worker --restart unless-stopped \
  --network <app-network> \
  -v <data-volume>:/usr/src/app/data \
  -v <media-volume>:/usr/src/app/media \
  kckern/daylight-content-filter-worker:latest
```

Use the same `<app-network>`, `<data-volume>` and `<media-volume>` as the app container
(`docker inspect` it). Models download on the first run into
`media/content-filter/models/` and are reused.

## Check

```bash
docker logs --tail 20 daylight-content-filter-worker      # content-filter.worker.started
docker exec daylight-content-filter-worker node __app_modules/media/media/cli/contentfilter.cli.mjs preflight <ratingKey>
```

A worker that dies mid-run leaves a heartbeat older than 60 s; the next worker start marks that
run "interrupted" and Admin offers "Run again".
