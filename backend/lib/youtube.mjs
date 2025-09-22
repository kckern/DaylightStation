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

const cleanupInvalidFiles = (mediaPath) => {
  const validPattern = /^\d{8}\.mp4$/;
  let cleanedCount = 0;

  fs.readdirSync(mediaPath).forEach(item => {
    const dirPath = path.join(mediaPath, item);
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return;

    const files = fs.readdirSync(dirPath);
    files.forEach(file => {
      if (!validPattern.test(file)) {
        const filePath = path.join(dirPath, file);
        try {
          fs.unlinkSync(filePath);
          console.log(`[YTCRON] Removed invalid file: ${filePath}`);
          cleanedCount++;
        } catch (err) {
          console.error(`[YTCRON] Failed to remove invalid file ${filePath}:`, err.message);
        }
      }
    });
  });

  if (cleanedCount > 0) {
    console.log(`[YTCRON] Cleaned up ${cleanedCount} invalid file(s)`);
  }
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
    const child = child_process.exec(command, (error, stdout, stderr) => {
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
        // Cleanup any partial files
        cleanupInvalidFiles(dirPath);
        console.log(`[YTCRON] Retrying in ${RETRY_DELAY / 1000}s...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY));
      }
    }

    shortcodes.push(shortcode);
    if (!success) {
      console.error(`[YTCRON] Failed to download ${shortcode} after ${maxAttempts} attempts.`);
      // Final cleanup of partials
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
};

export default getYoutube;