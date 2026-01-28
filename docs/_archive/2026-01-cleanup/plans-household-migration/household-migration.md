# Household Structure Migration Runbook

Migrate from nested `households/{id}/` structure to flat `household[-{id}]/` structure.

## Prerequisites

- Backup your data directory before running
- No services should be running that write to household directories

## Migration Script

Save this script locally and run it:

```bash
#!/bin/bash
# migrate-households.sh
# Safely migrate from households/ to flat household/ structure

set -e

DATA_PATH="${1:?Usage: migrate-households.sh <data-path>}"
cd "$DATA_PATH"

echo "=== Household Structure Migration ==="
echo "Data path: $DATA_PATH"
echo ""

# Check if already migrated
if [ -d "household" ] || ls -d household-* 2>/dev/null | grep -q .; then
  echo "Warning: Flat structure already exists. Aborting to avoid data loss."
  echo "   Remove household/ and household-*/ directories first if you want to re-run."
  exit 1
fi

# Check for source data
if [ ! -d "households" ]; then
  echo "Error: No households/ directory found. Nothing to migrate."
  exit 1
fi

echo "Found households:"
ls -d households/*/ 2>/dev/null | while read dir; do
  echo "  - $(basename "$dir")"
done
echo ""

# Confirmation
read -p "Proceed with migration? (y/N) " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "=== Copying data (originals preserved) ==="

# Copy default household to new location
if [ -d "households/default" ]; then
  echo "Copying households/default -> household/"
  cp -r households/default household
fi

# Copy secondary households
for dir in households/*/; do
  name=$(basename "$dir")
  if [ "$name" != "default" ] && [ "$name" != "example" ]; then
    echo "Copying households/$name -> household-$name/"
    cp -r "$dir" "household-$name"
  fi
done

echo ""
echo "=== Migration complete ==="
echo ""
echo "New structure:"
ls -d household*/ 2>/dev/null || echo "  (none)"
echo ""
echo "Old 'households/' directory left intact."
echo "After verifying the new structure works, run:"
echo "  rm -rf $DATA_PATH/households/"
echo ""
```

## Usage

```bash
# Save script to a local file
cat > /tmp/migrate-households.sh << 'SCRIPT'
# ... paste the script above ...
SCRIPT
chmod +x /tmp/migrate-households.sh

# Run the migration
/tmp/migrate-households.sh /path/to/data
```

## Structure Changes

| Before | After | Household ID |
|--------|-------|--------------|
| `households/default/` | `household/` | `default` |
| `households/jones/` | `household-jones/` | `jones` |
| `households/test/` | `household-test/` | `test` |

## Verification

After migration, verify:

1. Backend starts without errors
2. Config loads correctly (check logs for household discovery)
3. Auth credentials are found for each household
4. API routes resolve to correct household

## Rollback

If issues occur, the original `households/` directory is preserved:

```bash
# Remove new structure
rm -rf household household-*/

# Old structure is still intact
ls households/
```

## Cleanup

After successful verification:

```bash
rm -rf /path/to/data/households/
```
