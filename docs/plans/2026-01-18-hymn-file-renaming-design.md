# Hymn File Renaming Design

## Goal
Rename hymn YAML and MP3 files from numeric-only names to descriptive kebab-case format for easier filesystem reference.

## File Format

**Before:**
- `17.yaml`, `1207.yml`, `017.mp3`

**After:**
- `0017-awake-ye-saints-of-god-awake.yml`
- `1207-still-still-still.yml`
- `0017-awake-ye-saints-of-god-awake.mp3`

**Rules:**
- 4-digit minimum with zero padding
- Kebab-case title (lowercase, hyphens for spaces/punctuation)
- Standardize YAML extension to `.yml`
- MP3 titles derived from matching YAML file

## Backend Changes

### New Helper: `loadFileByPrefix(basePath, prefix)`

Location: `backend/lib/io.mjs`

Logic:
1. Normalize input: strip leading zeros from prefix
2. List files in basePath directory
3. For each file, extract leading number and strip zeros
4. Return first match where normalized numbers equal
5. Parse and return file content

### Route Update

Location: `backend/routers/fetch.mjs:378`

```javascript
// Before
const hymnData = hymn_num ? loadFile(`${basePath}/${hymn_num}`) : loadRandom(basePath);

// After
const hymnData = hymn_num
  ? loadFileByPrefix(basePath, hymn_num)
  : loadRandom(basePath);
```

## Migration Script

One-time script: `scripts/rename-hymns.mjs`

Steps:
1. Read all YAML files, build map: hymn_num → title
2. Rename each YAML to new format
3. Rename each MP3 to new format (lookup title from map)
4. Skip macOS `._` resource fork files

Execution:
- `node scripts/rename-hymns.mjs --dry-run` (preview)
- `node scripts/rename-hymns.mjs` (execute)

## Implementation Order

1. Create `loadFileByPrefix` helper in io.mjs
2. Update hymn route in fetch.mjs
3. Create rename script
4. Run with --dry-run, verify output
5. Execute rename
6. Test app functionality
7. Delete migration script
