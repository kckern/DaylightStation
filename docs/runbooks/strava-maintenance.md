# Strava Maintenance Scripts

## Overview
This runbook covers the maintenance scripts for Strava data management.

## Scripts

### reharvest-strava.mjs
**Location:** `backend/scripts/reharvest-strava.mjs`

**Purpose:** Re-harvests Strava data from scratch, clearing existing data and fetching approximately 15 years of activity history.

**Usage:**
```bash
cd backend
node scripts/reharvest-strava.mjs
```

**Behavior:**
- Clears existing strava.yml summary file
- Fetches activities from the last ~15 years (5,475 days)
- Handles rate limiting (waits 16 minutes if rate limited)
- Saves individual activity files and creates lightweight summaries

**When to use:**
- When Strava data appears corrupted or incomplete
- After major changes to the Strava data structure
- For initial data population on new installations

### update-strava-token.mjs
**Location:** `backend/scripts/update-strava-token.mjs`

**Purpose:** Updates Strava OAuth tokens using an authorization code.

**Usage:**
```bash
cd backend
node scripts/update-strava-token.mjs <authorization_code>
```

**Prerequisites:**
- `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` environment variables must be set
- Valid authorization code from Strava OAuth flow

**When to use:**
- When Strava API tokens have expired
- During initial Strava integration setup
- When authentication errors occur with Strava API calls

**Related code:**
- `backend/lib/strava.mjs` - Main Strava integration
- `backend/lib/io.mjs` - User file operations