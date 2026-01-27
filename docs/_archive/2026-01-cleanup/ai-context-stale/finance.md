# Finance Context

## Purpose

Financial tracking and budgeting. Integrates with Buxfer for transaction data, displays budgets, and syncs payroll information.

## Key Concepts

| Term | Definition |
|------|------------|
| **Buxfer** | External finance API for transactions/budgets |
| **Payroll** | Salary/income tracking and sync |
| **Budget** | Spending category with limits |
| **Transaction** | Individual financial entry |

## Exports

| Export | Location | Used By |
|--------|----------|---------|
| Finance module | `modules/Finance/` | FinanceApp, OfficeApp |
| Finances module | `modules/Finances/` | FinanceApp |
| Finance widgets | `modules/Finance/` | OfficeApp (embedded) |

## Imports

| Import | From | Purpose |
|--------|------|---------|
| Buxfer lib | backend | Transaction data |
| API client | foundations | HTTP requests |

## File Locations

### Frontend
- `frontend/src/Apps/FinanceApp.jsx` - Main finance dashboard (~9KB)
- `frontend/src/modules/Finance/` - Shared finance components
- `frontend/src/modules/Finances/` - Finance-specific views

### Backend
- `backend/lib/buxfer.mjs` - Buxfer API integration (~10KB)
- `backend/lib/budget.mjs` - Budget calculations (~11KB)
- `backend/routers/cron.mjs` - Payroll sync scheduled task

### Config
- `data/households/{hid}/apps/finance/config.yml`
- Config maps payroll accounts, budget categories

## Buxfer Integration

**Backend:** `lib/buxfer.mjs`

**Key Operations:**
- Fetch transactions by date range
- Get budget status
- Account balances

**Authentication:** Uses credentials from config/secrets.

## Payroll Sync

**Location:** `backend/routers/cron.mjs`

**Purpose:** Syncs payroll data on schedule.

**Related:** Recent commits added payroll sync test infrastructure.

## Common Tasks

- **Debug transaction fetch:** Check Buxfer credentials, verify lib/buxfer.mjs connection
- **Update budget display:** Work in `modules/Finance/` or `modules/Finances/`
- **Embed in OfficeApp:** Import Finance widgets into OfficeApp.jsx
- **Payroll sync issues:** Check cron.mjs, verify payroll config mapping
