/*  
   Minimal YouTube Download Script  
   --------------------------------  
   1. Reads YouTube download config from config/youtube.  
   2. Cleans up old or invalid files.  
   3. Downloads a single MP4 file per config entry (named YYYYMMDD.mp4).  
   4. Retries with different yt-dlp format options.  
   5. Verifies codec.  
   6. Returns summary of deleted files, processed shortcodes, and the final list of valid files.  
*/

import { loadFile } from './io.mjs';
import child_process from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import moment from 'moment';

const exec = promisify(child_process.exec);

// ------------------- Configuration -------------------
const PROCESS_TIMEOUT = 300000; // 5 minutes
const RETRY_DELAY = 5000;      // 5 seconds
const DAYS_TO_KEEP = 10;       // files older than 10 days get removed
const LOCK_STALE_MS = 60 * 60 * 1000; // consider a lock stale after 1 hour

// Determine a shared lock file path
const LOCK_FILE = (() => {
  const baseDir = (process.env.path && process.env.path.data)
    ? path.join(process.env.path.data, 'tmp')
    : path.join(process.env.path.media || '.', 'news');
  try { fs.mkdirSync(baseDir, { recursive: true }); } catch (e) {}
  return path.join(baseDir, 'youtube.lock');
})();

const acquireLock = () => {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      try {
        const stat = fs.statSync(LOCK_FILE);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > LOCK_STALE_MS) {
          console.warn(`[YTCRON] Stale lock detected (age ${Math.round(ageMs/60000)}m). Removing ${LOCK_FILE}`);
          fs.unlinkSync(LOCK_FILE);
        }
      } catch (_) {
        // If stat fails, attempt to remove and continue
        try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
      }
    }
    const fd = fs.openSync(LOCK_FILE, 'wx'); // atomic create, fails if exists
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
    fs.closeSync(fd);
    const release = () => { try { fs.unlinkSync(LOCK_FILE); } catch (_) {} };
    return release;
  } catch (e) {
    // Another instance holds the lock
    return null;
  }
};

// ------------------- Cleanup Helpers -------------------
const clearOld = (mediaPath, deleted) => {
  const cutoff = moment().subtract(DAYS_TO_KEEP, 'days').format('YYYYMMDD');

  fs.readdirSync(mediaPath).forEach(item => {
    const itemPath = path.join(mediaPath, item);
    if (!fs.statSync(itemPath).isDirectory()) return;

    fs.readdirSync(itemPath).forEach(file => {
      const datePart = file.split('.')[0]; // e.g. 20231010
      if (datePart < cutoff) {
        const fullFilePath = path.join(itemPath, file);
        fs.unlinkSync(fullFilePath);
        deleted.push(fullFilePath);
        console.log(`[YTCRON] Removed old file: ${fullFilePath}`);
      }
    });
  });
};

const cleanupInvalidFiles = (targetPath) => {
  const validPattern = /^\d{8}\.mp4$/;
  let cleanedCount = 0;
  if (!targetPath || !fs.existsSync(targetPath)) return 0;

  const removeInvalidsInDir = (dirPath) => {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return;
    const files = fs.readdirSync(dirPath);
    files.forEach(file => {
      const filePath = path.join(dirPath, file);
      try {
        if (fs.statSync(filePath).isFile() && !validPattern.test(file)) {
          fs.unlinkSync(filePath);
          console.log(`[YTCRON] Removed invalid file: ${filePath}`);
          cleanedCount++;
        }
      } catch (err) {
        console.error(`[YTCRON] Failed to inspect/remove ${filePath}:`, err.message);
      }
    });
  };

  // If targetPath is a leaf directory with files, clean it
  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(targetPath);
    // Clean files directly under targetPath
    entries.forEach(name => {
      const p = path.join(targetPath, name);
      try {
        if (fs.statSync(p).isFile() && !validPattern.test(name)) {
          fs.unlinkSync(p);
          console.log(`[YTCRON] Removed invalid file: ${p}`);
          cleanedCount++;
        }
      } catch (_) {}
    });
    // Also clean any immediate subdirectories (channel folders)
    entries.forEach(name => {
      const p = path.join(targetPath, name);
      try { if (fs.statSync(p).isDirectory()) removeInvalidsInDir(p); } catch (_) {}
    });
  }

  if (cleanedCount > 0) {
    console.log(`[YTCRON] Cleaned up ${cleanedCount} invalid file(s)`);
  }
  return cleanedCount;
};

// ------------------- Codec Verification -------------------
const verifyVideoCodec = async (filePath) => {
  try {
    const { stdout } = await exec(
      `ffprobe -v quiet -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "${filePath}"`
    );
    return stdout.trim().length > 0;
  } catch (err) {
    console.error(`[YTCRON] FFprobe error for ${filePath}:`, err.message);
    return false;
  }
};

// ------------------- Download Parameter Variants -------------------
const getDownloadParams = (attempt) => {
  // A few fallback attempts with proper escaping
  const options = [
    // Attempt 1 - HEVC/AVC preference with fallback
    '-f \'bestvideo[vcodec^=hevc][height<=720]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc][height<=720]+bestaudio[ext=m4a]/best[height<=720]\' --remux-video mp4',
    // Attempt 2 - Simple best video + audio
    '-f \'bestvideo[height<=720]+bestaudio/best[height<=720]\' --remux-video mp4',
    // Attempt 3 - Just best available
    '-f \'best[height<=1080]\' --remux-video mp4',
  ];
  return options[Math.min(attempt - 1, options.length - 1)];
};

// ------------------- Download Execution -------------------
const executeYtDlp = (command) => {
  return new Promise((resolve, reject) => {
    // Replace the intermediate shell with yt-dlp to avoid leaving orphaned children
    const child = child_process.exec(`exec ${command}`, (error, stdout, stderr) => {
      if (error) return reject(error);
      return resolve({ stdout, stderr });
    });

    // Kill after timeout
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Process timeout after ${PROCESS_TIMEOUT}ms`));
    }, PROCESS_TIMEOUT);

    child.on('exit', () => clearTimeout(timer));
  });
};

// ------------------- Main Function -------------------
const getYoutube = async () => {
  // Single instance guard
  const releaseLock = acquireLock();
  if (!releaseLock) {
    console.warn(`[YTCRON] Another instance is running. Skipping this run. (${LOCK_FILE})`);
    return { deleted: [], shortcodes: [], files: [], skipped: true };
  }

  try {
    const youtubeData = loadFile('config/youtube');
    const mediaPath = `${process.env.path.media}/news`;
    const deleted = [];
    const shortcodes = [];
    const results = [];

    // 1. Clean up older files and invalid files
    clearOld(mediaPath, deleted);
    cleanupInvalidFiles(mediaPath);

    // 2. For each config entry, attempt download
    for (const item of youtubeData) {
      const { type, shortcode, playlist } = item;
      const today = moment().format('YYYYMMDD');
      const todayFile = `${today}.mp4`;
      const dirPath = path.join(mediaPath, shortcode);
      const filePath = path.join(dirPath, todayFile);

      // Ensure directory exists
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

      // Skip if today's file already exists
      if (fs.existsSync(filePath)) {
        console.log(`[YTCRON] Already exists: ${shortcode} -> ${todayFile}`);
        shortcodes.push(shortcode);
        continue;
      }

      let success = false;
      const maxAttempts = 3;
      const inputUrl = type === 'Channel'
        ? `https://www.youtube.com/channel/${playlist}`
        : playlist;

      for (let attempt = 1; attempt <= maxAttempts && !success; attempt++) {
        const params = getDownloadParams(attempt);
        const outputPath = `${dirPath}/%(upload_date)s.%(ext)s`;
        const cmd = `yt-dlp ${params} -o "${outputPath}" --max-downloads 1 --playlist-end 1 "${inputUrl}"`;
        
        try {
          console.log(`[YTCRON] Attempt ${attempt}/${maxAttempts} -> ${shortcode}`);
          console.log(`[YTCRON] Command: ${cmd}`);
          await executeYtDlp(cmd);
          
          // Small delay for the filesystem
          await new Promise(r => setTimeout(r, 1000));

          if (fs.existsSync(filePath)) {
            const validCodec = await verifyVideoCodec(filePath);
            if (validCodec) {
              success = true;
              console.log(`[YTCRON] Download complete: ${shortcode} -> ${todayFile}`);
            } else {
              fs.unlinkSync(filePath);
              console.log(`[YTCRON] Deleted corrupt file: ${filePath}`);
            }
          }
        } catch (err) {
          console.error(`[YTCRON] Download error for ${shortcode}, attempt ${attempt}:`, err.message);
        }

        if (!success && attempt < maxAttempts) {
          // Cleanup any partial files in this shortcode directory
          cleanupInvalidFiles(dirPath);
          console.log(`[YTCRON] Retrying in ${RETRY_DELAY / 1000}s...`);
          await new Promise(r => setTimeout(r, RETRY_DELAY));
        }
      }

      shortcodes.push(shortcode);
      if (!success) {
        console.error(`[YTCRON] Failed to download ${shortcode} after ${maxAttempts} attempts.`);
        // Final cleanup of partials in this shortcode directory
        cleanupInvalidFiles(dirPath);
      }
    }

    // 3. Gather final list of valid files (last 10 days only)
    const cutoff = moment().subtract(DAYS_TO_KEEP, 'days').format('YYYYMMDD');
    const files = [];
    fs.readdirSync(mediaPath).forEach(folder => {
      const folderPath = path.join(mediaPath, folder);
      if (!fs.statSync(folderPath).isDirectory()) return;

      fs.readdirSync(folderPath).forEach(f => {
        if (f.endsWith('.mp4')) {
          const datePart = f.split('.')[0];
          if (datePart >= cutoff) {
            files.push(path.join(folderPath, f));
          }
        }
      });
    });

    return { deleted, shortcodes, files };
  } finally {
    // Always release the lock
    try { releaseLock && releaseLock(); } catch (_) {}
  }
};

export default getYoutube;