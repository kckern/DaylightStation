import { readdir, readFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { makeThumbnail, addPageLabel, buildContactSheet, rotateImage, issueToRotation } from './images.mjs';
import { analyzeContactSheet } from './vision.mjs';
import { buildPdf, formatFilename } from './pdf.mjs';

const DIRS = {
  inbox: '/data/_Inbox',
  processing: '/data/_Processing',
  ready: '/data/_Ready',
  pending: '/data/_Pending',
};

function getCategories() {
  const env = process.env.CATEGORIES || '';
  return env.split(',').map(c => c.trim()).filter(Boolean);
}

async function collectJpgs(dir) {
  const entries = await readdir(dir);
  return entries
    .filter(f => /\.jpe?g$/i.test(f))
    .sort()
    .map(f => join(dir, f));
}

export async function stageBatch() {
  const jpgs = await collectJpgs(DIRS.inbox);
  if (jpgs.length === 0) return null;

  const batchId = `batch-${Date.now()}`;
  const batchDir = join(DIRS.processing, batchId);
  await mkdir(batchDir, { recursive: true });

  const stagedFiles = [];
  for (const src of jpgs) {
    const dest = join(batchDir, src.split('/').pop());
    await rename(src, dest);
    stagedFiles.push(dest);
  }

  return { batchDir, files: stagedFiles };
}

export async function processBatch(batch, log = console.log) {
  const { batchDir, files } = batch;
  const categories = getCategories();
  const scanDate = new Date().toISOString().slice(0, 10);
  const results = { documents: [], errors: [] };

  try {
    log(`Reading ${files.length} pages...`);
    const pageBuffers = await Promise.all(files.map(f => readFile(f)));

    log('Generating thumbnails...');
    const thumbnails = [];
    for (let i = 0; i < pageBuffers.length; i++) {
      const thumb = await makeThumbnail(pageBuffers[i]);
      thumbnails.push(await addPageLabel(thumb, i + 1));
    }

    log('Building contact sheet...');
    const contactSheet = await buildContactSheet(thumbnails);

    log('Analyzing with vision LLM...');
    const documents = await analyzeContactSheet(contactSheet, files.length, categories);
    log(`LLM identified ${documents.length} document(s)`);

    for (const doc of documents) {
      try {
        const fixedPages = [];
        for (const pageNum of doc.pages) {
          const idx = pageNum - 1;
          let buf = pageBuffers[idx];
          const issue = doc.issues?.[String(pageNum)];
          if (issue) {
            const degrees = issueToRotation(issue);
            if (degrees) {
              log(`Rotating page ${pageNum}: ${issue} (${degrees}deg)`);
              buf = await rotateImage(buf, degrees);
            }
          }
          fixedPages.push(buf);
        }

        const pdfBytes = await buildPdf(fixedPages);
        const filename = formatFilename(doc.date, doc.category, doc.description, scanDate);
        const destPath = join(DIRS.ready, filename);
        await writeFile(destPath, pdfBytes);
        log(`Created: ${filename} (${doc.pages.length} pages)`);
        results.documents.push({ filename, pages: doc.pages, category: doc.category });
      } catch (docErr) {
        log(`Error processing document [pages ${doc.pages}]: ${docErr.message}`);
        results.errors.push({ pages: doc.pages, error: docErr.message });
      }
    }

    if (results.errors.length === 0) {
      await rm(batchDir, { recursive: true });
      log('Batch complete, cleaned up processing dir');
    } else {
      const pendingDir = join(DIRS.pending, batchDir.split('/').pop());
      await rename(batchDir, pendingDir);
      log(`Partial failure — moved batch to _Pending`);
    }
  } catch (err) {
    log(`Batch failed: ${err.message}`);
    try {
      const pendingDir = join(DIRS.pending, batchDir.split('/').pop());
      await rename(batchDir, pendingDir);
    } catch (moveErr) {
      log(`Failed to move batch to _Pending: ${moveErr.message}`);
    }
    results.errors.push({ pages: 'all', error: err.message });
  }

  return results;
}

export async function processInbox(log = console.log) {
  const batch = await stageBatch();
  if (!batch) {
    log('No JPGs in _Inbox, nothing to process');
    return null;
  }
  log(`Staged ${batch.files.length} pages → ${batch.batchDir}`);
  return processBatch(batch, log);
}
