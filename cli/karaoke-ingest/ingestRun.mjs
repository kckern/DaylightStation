// cli/karaoke-ingest/ingestRun.mjs
import path from 'node:path';
import { assignEpisodes, buildEpisodeFilename } from './filename.mjs';
import { buildSearchQuery, pinnedUrl, extractVideoId } from './query.mjs';
import { pickBest } from './ranker.mjs';

export async function runIngest({ rows, config, deps, options = {} }) {
  const { search, download, embed, fileExists, saveRows, log } = deps;
  const summary = { downloaded: 0, skipped: 0, failed: 0, planned: [] };
  let processed = 0;

  const withEps = assignEpisodes(rows);
  for (const row of withEps) {
    if (options.season && row.season !== options.season) { continue; }
    if (row.status === 'downloaded' && !options.force) { summary.skipped++; continue; }
    if (options.limit && processed >= options.limit) { break; }

    const filename = buildEpisodeFilename({
      show: config.showName, season: row.season, episode: row.episode, song: row.song, artist: row.artist,
    });
    const finalPath = path.join(config.mediaDir, filename);
    if (!options.force && (await fileExists(finalPath))) { row.status = 'downloaded'; summary.skipped++; continue; }
    processed++;

    // Choose the video.
    let videoId, videoUrl, chosenTitle, chosenChannel;
    const pin = pinnedUrl(row);
    if (pin) {
      videoUrl = pin; videoId = extractVideoId(pin); chosenTitle = '(pinned)'; chosenChannel = '(pinned)';
    } else {
      const query = buildSearchQuery(row);
      const cands = await search(query, { searchCount: config.searchCount });
      const best = pickBest(cands, { song: row.song, artist: row.artist }, config);
      if (!best) {
        row.status = 'failed'; summary.failed++;
        summary.planned.push({ row, action: 'no-match', query });
        log(`FAIL no match: ${row.song} — ${row.artist}`);
        continue;
      }
      videoId = best.id; videoUrl = `https://www.youtube.com/watch?v=${best.id}`;
      chosenTitle = best.title; chosenChannel = best.channel;
    }

    summary.planned.push({ row, filename, videoId, chosenTitle, chosenChannel });
    if (options.dryRun) { log(`PLAN ${filename}  <=  ${chosenTitle} [${chosenChannel}] (${videoId})`); continue; }

    try {
      const tmpPath = `${finalPath}.tmp.mp4`;
      await download({ url: videoUrl, outPath: tmpPath, formatSort: config.formatSort, mergeFormat: config.mergeFormat });
      const title = `${row.song} (${row.artist})`;
      const comment = `Karaoke • ${chosenChannel} • ${chosenTitle} • Category: ${config.seasonName(row.season)}`;
      await embed({ inPath: tmpPath, outPath: finalPath, title, comment });
      row.status = 'downloaded'; row.videoId = videoId; summary.downloaded++;
      log(`OK ${filename}`);
    } catch (e) {
      row.status = 'failed'; summary.failed++;
      log(`FAIL download ${row.song}: ${e.message}`);
    }
  }

  if (!options.dryRun && saveRows) await saveRows(withEps);
  return summary;
}
