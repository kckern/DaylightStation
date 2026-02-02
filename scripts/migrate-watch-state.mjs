import fs from 'fs';
import path from 'path';

const KEY_MAPPING = {
  'songs': 'singing',
  'talks': 'narrated',
  'scripture': 'narrated',
  'poetry': 'narrated'
};

async function migrateWatchState(dataPath) {
  const watchStatePath = path.join(dataPath, 'system', 'watch-state');

  if (!fs.existsSync(watchStatePath)) {
    console.log('No watch state directory found, skipping migration');
    return;
  }

  for (const [oldKey, newKey] of Object.entries(KEY_MAPPING)) {
    const oldPath = path.join(watchStatePath, `${oldKey}.json`);
    const newPath = path.join(watchStatePath, `${newKey}.json`);

    if (fs.existsSync(oldPath)) {
      console.log(`Migrating ${oldKey} → ${newKey}`);

      const oldData = JSON.parse(fs.readFileSync(oldPath, 'utf-8'));

      // Merge with existing new data if any
      let newData = {};
      if (fs.existsSync(newPath)) {
        newData = JSON.parse(fs.readFileSync(newPath, 'utf-8'));
      }

      // Merge entries
      Object.assign(newData, oldData);

      // Write merged data
      fs.writeFileSync(newPath, JSON.stringify(newData, null, 2));

      // Backup old file
      fs.renameSync(oldPath, `${oldPath}.bak`);
    }
  }

  console.log('Watch state migration complete');
}

// Run
const dataPath = process.argv[2] || process.env.DATA_PATH;
if (!dataPath) {
  console.error('Usage: node migrate-watch-state.mjs <data-path>');
  process.exit(1);
}

migrateWatchState(dataPath);
