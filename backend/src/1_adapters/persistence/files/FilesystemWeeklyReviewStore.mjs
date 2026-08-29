import path from 'node:path';
import { IWeeklyReviewStore } from '#apps/weekly-review/ports/IWeeklyReviewStore.mjs';
import {
  appendTextFile,
  deleteFile,
  ensureDir,
  fileExists,
  getStats,
  listEntries,
  readBinaryFromPath,
  readTextFromPath,
  renameFile,
  writeBinary,
  writeFileAtomic,
  writeFile,
} from '#system/utils/FileIO.mjs';
import { truncateFile } from '#system/utils/FileIO.mjs';

export class FilesystemWeeklyReviewStore extends IWeeklyReviewStore {
  constructor({ householdDir, mediaPath, logger = console }) {
    super();
    if (!householdDir || !mediaPath) throw new Error('FilesystemWeeklyReviewStore requires householdDir and mediaPath');
    this.householdDir = householdDir;
    this.mediaPath = mediaPath;
    this.logger = logger;
  }

  #draftDir(week) { return path.join(this.mediaPath, 'weekly-review', week, '.drafts'); }
  #reviewDir(week) { return path.join(this.householdDir, 'weekly-review', 'log', week); }

  saveRecordingAudio({ localDate, localTime, extension, buffer }) {
    const directory = path.join(this.mediaPath, 'weekly-review', localDate);
    ensureDir(directory);
    const audioPath = path.join(directory, `recording-${localDate}-${localTime}.${extension}`);
    writeBinary(audioPath, buffer);
    return Object.freeze({ audioPath });
  }

  async convertRecordingToMp3(recordingArtifact, runCommand) {
    const audioPath = recordingArtifact?.audioPath;
    if (!audioPath) throw new Error('recording artifact required');
    const parsed = path.parse(audioPath);
    const mp3Path = path.join(parsed.dir, `${parsed.name}.mp3`);
    await runCommand('ffmpeg', ['-i', audioPath, '-y', '-codec:a', 'libmp3lame', '-q:a', '4', mp3Path]);
    return { size: getStats(mp3Path)?.size ?? 0 };
  }

  saveTranscript(week, transcript, manifest) {
    const directory = this.#reviewDir(week);
    ensureDir(directory);
    writeFile(path.join(directory, 'transcript.yml'), JSON.stringify(transcript, null, 2));
    writeFile(path.join(directory, 'manifest.yml'), JSON.stringify(manifest, null, 2));
  }

  appendDraftChunk({ sessionId, week, seq, buffer, nowIso }) {
    const directory = this.#draftDir(week);
    const draftPath = path.join(directory, `${sessionId}.webm`);
    const metaPath = path.join(directory, `${sessionId}.meta.json`);
    ensureDir(directory);
    let meta = { sessionId, week, seq: -1, totalBytes: 0, startedAt: nowIso };
    const metaExists = fileExists(metaPath);
    if (metaExists) {
      try { meta = JSON.parse(readTextFromPath(metaPath)); } catch (error) {
        this.logger.error?.('weekly-review.chunk.meta-corrupt', { sessionId, metaPath, error: error.message });
        if (fileExists(draftPath) && getStats(draftPath).size > 0) throw new Error('draft present but meta unreadable — refusing to proceed');
      }
    }
    if (fileExists(draftPath)) {
      const actualSize = getStats(draftPath).size;
      if (actualSize !== meta.totalBytes) {
        this.logger.warn?.('weekly-review.chunk.desync-recovery', { sessionId, seq, metaTotalBytes: meta.totalBytes, actualDraftBytes: actualSize });
        truncateFile(draftPath, meta.totalBytes);
      }
    }
    if (seq === meta.seq) return { ok: true, duplicate: true, bytesWritten: 0, totalBytes: meta.totalBytes, nextSeq: meta.seq + 1 };
    if (seq !== meta.seq + 1) throw new Error(`out-of-order chunk: expected ${meta.seq + 1}, got ${seq}`);
    if (seq === 0 && !metaExists) writeBinary(draftPath, buffer);
    else appendTextFile(draftPath, buffer);
    meta.seq = seq;
    meta.totalBytes += buffer.length;
    meta.updatedAt = nowIso;
    writeFileAtomic(metaPath, JSON.stringify(meta));
    return { ok: true, bytesWritten: buffer.length, totalBytes: meta.totalBytes, nextSeq: seq + 1 };
  }

  listDrafts(week) {
    const directory = this.#draftDir(week);
    if (!fileExists(directory)) return [];
    const drafts = [];
    for (const name of listEntries(directory).filter((item) => item.endsWith('.meta.json'))) {
      try {
        const meta = JSON.parse(readTextFromPath(path.join(directory, name)));
        drafts.push({ sessionId: meta.sessionId, week: meta.week, seq: meta.seq, totalBytes: meta.totalBytes, startedAt: meta.startedAt, updatedAt: meta.updatedAt });
      } catch (error) {
        this.logger.warn?.('weekly-review.listDrafts.meta-parse-failed', { name, error: error.message });
      }
    }
    return drafts;
  }

  beginFinalization(sessionId, week) {
    const directory = this.#draftDir(week);
    const draftPath = path.join(directory, `${sessionId}.webm`);
    if (!fileExists(draftPath)) throw new Error(`draft not found: ${sessionId}`);
    const processingPath = path.join(directory, `${sessionId}.processing-${Date.now()}.webm`);
    renameFile(draftPath, processingPath);
    return { sessionId, week, processingPath, draftPath, metaPath: path.join(directory, `${sessionId}.meta.json`), buffer: readBinaryFromPath(processingPath) };
  }

  completeFinalization(token) {
    deleteFile(token.processingPath);
    if (fileExists(token.metaPath) && !fileExists(token.draftPath)) deleteFile(token.metaPath);
  }

  sweepStaleDrafts(cutoff) {
    const baseDir = path.join(this.mediaPath, 'weekly-review');
    if (!fileExists(baseDir)) return [];
    const deleted = [];
    for (const week of listEntries(baseDir)) {
      const directory = this.#draftDir(week);
      if (!fileExists(directory)) continue;
      for (const name of listEntries(directory).filter((item) => item.endsWith('.meta.json'))) {
        try {
          const metaPath = path.join(directory, name);
          const meta = JSON.parse(readTextFromPath(metaPath));
          const timestamp = Date.parse(meta.updatedAt || meta.startedAt);
          if (Number.isFinite(timestamp) && timestamp < cutoff) {
            const draftPath = path.join(directory, `${meta.sessionId}.webm`);
            if (fileExists(draftPath)) deleteFile(draftPath);
            deleteFile(metaPath);
            deleted.push(meta.sessionId);
          }
        } catch (error) { this.logger.warn?.('weekly-review.sweep.meta-parse-failed', { name, error: error.message }); }
      }
      for (const name of listEntries(directory).filter((item) => item.includes('.processing-'))) {
        try {
          const orphanPath = path.join(directory, name);
          if (getStats(orphanPath).mtimeMs < cutoff) { deleteFile(orphanPath); deleted.push(name); }
        } catch (error) { this.logger.warn?.('weekly-review.sweep.orphan-failed', { name, error: error.message }); }
      }
    }
    return deleted;
  }

  discardDraft(sessionId, week) {
    const directory = this.#draftDir(week);
    const targets = [path.join(directory, `${sessionId}.webm`), path.join(directory, `${sessionId}.meta.json`)];
    let existed = false;
    for (const target of targets) if (fileExists(target)) { deleteFile(target); existed = true; }
    return existed;
  }

  getRecordingStatus(week) {
    const transcriptPath = path.join(this.#reviewDir(week), 'transcript.yml');
    if (!fileExists(transcriptPath)) return { exists: false };
    const data = JSON.parse(readTextFromPath(transcriptPath));
    return { exists: true, recordedAt: data.recordedAt, duration: data.duration };
  }
}

export default FilesystemWeeklyReviewStore;
