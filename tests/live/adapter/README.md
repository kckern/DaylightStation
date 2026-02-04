# Live Adapter Tests

Live tests that connect to real external APIs. These tests serve a dual purpose:

1. **Integration Testing** - Verify adapters work with real services
2. **CLI Utilities** - Manual harvesting, backfilling, and data operations

## Philosophy

Unlike isolated/unit tests, live tests **do not use mocks**. They connect to real APIs with real credentials and perform real operations. This makes them useful as operational tools, not just test suites.

## Usage

### Running via Harness

```bash
# Run all live tests
node tests/live/adapter/harness.mjs

# Run specific service
node tests/live/adapter/harness.mjs --only=finance

# Skip specific services
node tests/live/adapter/harness.mjs --skip=gmail,withings

# Backfill mode
node tests/live/adapter/harness.mjs --backfill-since=2025-01-01

# Dry run (show what would run)
node tests/live/adapter/harness.mjs --dry-run
```

### Running Individual Tests

```bash
# Set data path
export DAYLIGHT_DATA_PATH=/path/to/data

# Run specific test
NODE_OPTIONS=--experimental-vm-modules npx jest tests/live/adapter/finance/buxfer-categorization.live.test.mjs
```

## Finance: Buxfer Categorization

The `buxfer-categorization.live.test.mjs` test categorizes untagged transactions using AI.

### Dry Run (Preview)

```bash
DRY_RUN=true \
DAYLIGHT_DATA_PATH=/path/to/data \
NODE_OPTIONS=--experimental-vm-modules \
npx jest tests/live/adapter/finance/buxfer-categorization.live.test.mjs \
  --testNamePattern="batch categorizes"
```

Shows which transactions would be categorized without making changes.

### Run Batch Categorization

```bash
BATCH_CATEGORIZE=true \
DAYLIGHT_DATA_PATH=/path/to/data \
NODE_OPTIONS=--experimental-vm-modules \
npx jest tests/live/adapter/finance/buxfer-categorization.live.test.mjs \
  --testNamePattern="batch categorizes"
```

Categorizes all untagged transactions from budget accounts via OpenAI and updates Buxfer.

### Categorize Single Transaction

```bash
TEST_TRANSACTION_ID=235351917 \
DAYLIGHT_DATA_PATH=/path/to/data \
NODE_OPTIONS=--experimental-vm-modules \
npx jest tests/live/adapter/finance/buxfer-categorization.live.test.mjs \
  --testNamePattern="categorizes untagged"
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DAYLIGHT_DATA_PATH` | Path to data directory (required) |
| `DRY_RUN=true` | Preview mode - show what would happen |
| `BATCH_CATEGORIZE=true` | Enable batch processing |
| `TEST_TRANSACTION_ID` | Target specific transaction |
| `BACKFILL_SINCE` | Date for backfill operations (YYYY-MM-DD) |

## Credentials

Live tests read credentials from ConfigService:

- **Buxfer**: `getUserAuth('buxfer')` or `getHouseholdAuth('buxfer')` → `{email, password}`
- **OpenAI**: `getSecret('OPENAI_API_KEY')`
- **Google**: `getUserAuth('google', username)` → `{refresh_token}`

Credentials are stored in household auth config, not hardcoded.

## Writing New Live Tests

1. **No mocks** - Connect to real APIs
2. **Require explicit flags** - Don't auto-run destructive operations
3. **Support dry-run** - Always preview before mutating
4. **Scope appropriately** - Only process configured accounts/users
5. **Rate limit** - Add delays between API calls
6. **Log clearly** - Show what's happening for CLI usage

Example pattern:

```javascript
it('batch processes items', async () => {
  const dryRun = process.env.DRY_RUN === 'true';
  const runBatch = process.env.BATCH_PROCESS === 'true';

  if (!dryRun && !runBatch) {
    console.log('Set DRY_RUN=true to preview or BATCH_PROCESS=true to run');
    return;
  }

  const items = await fetchItems();

  if (dryRun) {
    console.log('=== DRY RUN ===');
    items.forEach(i => console.log(`Would process: ${i.id}`));
    return;
  }

  // Actual processing with rate limiting
  for (const item of items) {
    await processItem(item);
    await sleep(1000); // Rate limit
  }
});
```

## Directory Structure

```
tests/live/adapter/
├── harness.mjs           # Test runner with quarantine behavior
├── harness.config.mjs    # Timeouts and service config
├── README.md             # This file
├── finance/
│   ├── buxfer-categorization.live.test.mjs  # CLI for transaction tagging
│   ├── budget.live.test.mjs
│   └── shopping.live.test.mjs
├── fitness/
│   └── strava.live.test.mjs
├── music/
│   └── lastfm.live.test.mjs
└── ...
```
