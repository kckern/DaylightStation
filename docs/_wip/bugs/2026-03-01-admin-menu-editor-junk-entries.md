# Admin Menu Editor Creates Junk Entries

**Date:** 2026-03-01
**Severity:** Low (data corruption, not crash)
**Status:** Investigating

## Symptom

Junk entries appeared in `tvapp.yml` menu config:

```yaml
- active: true
  input: star wars
  label: star wars
- active: true
  input: star wars
  label: star wars
- label: star
  input: star
  action: Play
  active: true
```

These entries have no `uid`, no valid `input` format (missing source prefix like `plex:`), and appear to be raw text typed into the admin menu editor without proper validation.

## Impact

- Invalid menu items render in the TV app UI
- No `uid` means they can't be tracked or managed properly
- They "show up everywhere" — likely the list adapter treats them as generic items

## Immediate Fix

Removed the three junk entries from `tvapp.yml` and restarted the Docker container to clear the list cache.

## Root Cause (TODO)

Investigate the admin menu editor — it should:
1. Validate that `input` follows the `source:id` format (e.g., `plex:12345`)
2. Auto-generate a `uid` for new entries
3. Prevent saving entries with free-text input that doesn't resolve to a content source
