# Transaction Offset Pairs Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow pairing transactions that cancel each other out so spending/income totals reflect actual financial activity, not noise from refunds, RSU vest+sell cycles, etc.

**Architecture:** New `transaction.pairs.yml` data file stores 1:1 pairs (debit ID, credit ID, description). During budget compilation, paired transactions have their amounts adjusted to only the delta. Frontend gets a `...` menu on transaction rows for creating/removing pairs via new API endpoints.

**Tech Stack:** Express API, YAML persistence, React (Mantine for menu), Highcharts (existing)

**Spec:** `docs/superpowers/specs/2026-03-13-transaction-offset-pairs-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `backend/src/1_adapters/persistence/yaml/YamlFinanceDatastore.mjs` | Add getPairs/savePairs/deletePair methods |
| Modify | `backend/src/3_applications/finance/BudgetCompilationService.mjs` | Apply pair adjustments before spending calc |
| Modify | `backend/src/4_api/v1/routers/finance.mjs` | Add GET/POST/DELETE /pairs endpoints |
| Modify | `frontend/src/Apps/FinanceApp.jsx` | Export baseUrl for use by drawer |
| Modify | `frontend/src/modules/Finances/drawer.jsx` | Add ... menu, pair/unpair actions, paired row styling |
| Create | `data/household/common/finances/transaction.pairs.yml` | Initial empty pairs file (via API on first save) |

---

## Chunk 1: Backend — Persistence + Compilation

### Task 1: Add pairs persistence to YamlFinanceDatastore

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlFinanceDatastore.mjs:279` (insert after memos section)

- [ ] **Step 1: Add getPairs method**

Insert after line 278 (end of `applyMemos`), before the AI Categorization section:

```javascript
  // ==========================================================================
  // Transaction Pairs
  // ==========================================================================

  /**
   * Get all transaction pairs
   * @param {string} [householdId]
   * @returns {Array<{debit: number, credit: number, desc: string}>}
   */
  getPairs(householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'transaction.pairs');
    return this.#readData(filePath) || [];
  }

  /**
   * Save all transaction pairs
   * @param {Array<{debit: number, credit: number, desc: string}>} pairs
   * @param {string} [householdId]
   */
  savePairs(pairs, householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'transaction.pairs');
    this.#writeData(filePath, pairs);
  }

  /**
   * Add a transaction pair
   * @param {{debit: number, credit: number, desc: string}} pair
   * @param {string} [householdId]
   */
  addPair(pair, householdId) {
    const pairs = this.getPairs(householdId);
    // Prevent duplicates
    const exists = pairs.some(p => p.debit === pair.debit && p.credit === pair.credit);
    if (!exists) {
      pairs.push(pair);
      this.savePairs(pairs, householdId);
    }
  }

  /**
   * Remove a transaction pair
   * @param {number} debit - Debit transaction ID
   * @param {number} credit - Credit transaction ID
   * @param {string} [householdId]
   */
  removePair(debit, credit, householdId) {
    const pairs = this.getPairs(householdId);
    const filtered = pairs.filter(p => !(p.debit === debit && p.credit === credit));
    this.savePairs(filtered, householdId);
  }
```

- [ ] **Step 2: Verify file saves correctly**

Test manually via node REPL or wait for API integration in Task 3.

- [ ] **Step 3: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlFinanceDatastore.mjs
git commit -m "feat(finance): add transaction pairs persistence to YamlFinanceDatastore"
```

### Task 2: Apply pair adjustments in BudgetCompilationService

**Files:**
- Modify: `backend/src/3_applications/finance/BudgetCompilationService.mjs:62` (insert after memo application)

- [ ] **Step 1: Add pair adjustment after memo application**

After line 62 (`const transactions = this.#financeStore.applyMemos(rawTransactions, householdId);`), insert:

```javascript
    // Apply transaction pair adjustments
    const pairs = this.#financeStore.getPairs(householdId);
    this.#applyPairAdjustments(transactions, pairs);
```

- [ ] **Step 2: Add the #applyPairAdjustments private method**

Add before the `#compileBudgetPeriod` method (before line 92):

```javascript
  /**
   * Adjust paired transactions so only the delta counts toward spending/income.
   * Mutates transactions in place.
   *
   * @param {Object[]} transactions
   * @param {Array<{debit: number, credit: number, desc: string}>} pairs
   */
  #applyPairAdjustments(transactions, pairs) {
    if (!pairs?.length) return;

    const txnById = new Map(transactions.map(t => [t.id, t]));

    for (const { debit: debitId, credit: creditId, desc } of pairs) {
      const debitTxn = txnById.get(debitId);
      const creditTxn = txnById.get(creditId);
      if (!debitTxn || !creditTxn) continue;

      const delta = debitTxn.amount - creditTxn.amount;

      if (delta > 0) {
        // Debit exceeds credit — delta is real spending
        debitTxn.amount = this.#round(delta);
        debitTxn.expenseAmount = this.#round(delta);
        creditTxn.amount = 0;
        creditTxn.expenseAmount = 0;
      } else if (delta < 0) {
        // Credit exceeds debit — delta is real income
        debitTxn.amount = 0;
        debitTxn.expenseAmount = 0;
        creditTxn.amount = this.#round(Math.abs(delta));
        creditTxn.expenseAmount = this.#round(-Math.abs(delta));
      } else {
        // Perfect wash
        debitTxn.amount = 0;
        debitTxn.expenseAmount = 0;
        creditTxn.amount = 0;
        creditTxn.expenseAmount = 0;
      }

      // Mark both as paired for UI
      debitTxn.paired = true;
      debitTxn.pairDesc = desc;
      debitTxn.pairedWith = creditId;
      creditTxn.paired = true;
      creditTxn.pairDesc = desc;
      creditTxn.pairedWith = debitId;
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/3_applications/finance/BudgetCompilationService.mjs
git commit -m "feat(finance): apply pair adjustments during budget compilation"
```

### Task 3: Add pairs API endpoints

**Files:**
- Modify: `backend/src/4_api/v1/routers/finance.mjs:488` (insert after memos section)

- [ ] **Step 1: Add pairs endpoints after line 488**

Insert after the GET /memos route, before the Payroll Sync section:

```javascript
  // =============================================================================
  // Transaction Pairs
  // =============================================================================

  /**
   * GET /api/finance/pairs - Get all pairs
   */
  router.get('/pairs', (req, res) => {
    const householdId = resolveHouseholdId(req.query.household);

    try {
      const pairs = financeStore?.getPairs(householdId) || [];
      return res.json({ pairs, household: householdId });
    } catch (error) {
      logger.error?.('finance.pairs.get.error', { error: error.message });
      return res.status(500).json({ error: 'Failed to load pairs' });
    }
  });

  /**
   * POST /api/finance/pairs - Create a pair
   * Body: { debit: number, credit: number, desc: string }
   */
  router.post('/pairs', async (req, res) => {
    const householdId = resolveHouseholdId(req.body.household || req.query.household);
    const { debit, credit, desc } = req.body;

    if (!debit || !credit) {
      return res.status(400).json({ error: 'debit and credit transaction IDs required' });
    }

    try {
      financeStore?.addPair({ debit: Number(debit), credit: Number(credit), desc: desc || '' }, householdId);
      // Recompile so changes take effect immediately
      if (compilationService) {
        await compilationService.compile(householdId);
      }
      return res.json({ ok: true, debit, credit, desc });
    } catch (error) {
      logger.error?.('finance.pairs.create.error', { debit, credit, error: error.message });
      return res.status(500).json({ error: 'Failed to create pair' });
    }
  });

  /**
   * DELETE /api/finance/pairs - Remove a pair
   * Body: { debit: number, credit: number }
   */
  router.delete('/pairs', async (req, res) => {
    const householdId = resolveHouseholdId(req.body.household || req.query.household);
    const { debit, credit } = req.body;

    if (!debit || !credit) {
      return res.status(400).json({ error: 'debit and credit transaction IDs required' });
    }

    try {
      financeStore?.removePair(Number(debit), Number(credit), householdId);
      if (compilationService) {
        await compilationService.compile(householdId);
      }
      return res.json({ ok: true, debit, credit });
    } catch (error) {
      logger.error?.('finance.pairs.delete.error', { debit, credit, error: error.message });
      return res.status(500).json({ error: 'Failed to delete pair' });
    }
  });
```

- [ ] **Step 2: Update router docblock at top of file**

Add to the endpoint listing at lines 4-16:

```
 * - GET  /api/finance/pairs - Get all transaction pairs
 * - POST /api/finance/pairs - Create a transaction pair
 * - DELETE /api/finance/pairs - Remove a transaction pair
```

- [ ] **Step 3: Test endpoints via curl**

```bash
# Create a pair
curl -s -X POST http://localhost:3111/api/v1/finance/pairs \
  -H "Content-Type: application/json" \
  -d '{"debit": 209058385, "credit": 209127468, "desc": "test pair"}'

# List pairs
curl -s http://localhost:3111/api/v1/finance/pairs

# Delete the pair
curl -s -X DELETE http://localhost:3111/api/v1/finance/pairs \
  -H "Content-Type: application/json" \
  -d '{"debit": 209058385, "credit": 209127468}'
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/finance.mjs
git commit -m "feat(finance): add pairs API endpoints (GET/POST/DELETE)"
```

---

## Chunk 2: Frontend — Transaction Row Menu + Pair UI

### Task 4: Add ... overflow menu to transaction rows

**Files:**
- Modify: `frontend/src/modules/Finances/drawer.jsx:102-156` (transaction table + row rendering)

- [ ] **Step 1: Add state and helpers for the menu**

Inside the `Drawer` component (around line 78, before `handleRowClick`), add:

```javascript
    const [menuOpenId, setMenuOpenId] = useState(null);
    const [pairMode, setPairMode] = useState(null); // { sourceTransaction } when selecting pair target
```

- [ ] **Step 2: Add the ... menu column header**

After the Tags `<th>` (line 118), add an empty header for the actions column:

```javascript
                      <th style={{ width: '2rem' }}></th>
```

- [ ] **Step 3: Add the ... button and menu to each row**

After `<td className="tags-col">` (line 146), before `</tr>`, add:

```javascript
                                        <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                                          {transaction.id && (
                                            <div style={{ position: 'relative' }}>
                                              <button
                                                className="txn-menu-btn"
                                                onClick={() => setMenuOpenId(menuOpenId === transaction.id ? null : transaction.id)}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', fontSize: '0.9rem', color: '#888' }}
                                              >⋯</button>
                                              {menuOpenId === transaction.id && (
                                                <div className="txn-menu-dropdown" style={{
                                                  position: 'absolute', right: 0, top: '100%', zIndex: 10,
                                                  background: '#1a1a2e', border: '1px solid #333', borderRadius: '4px',
                                                  minWidth: '120px', boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
                                                }}>
                                                  {transaction.paired ? (
                                                    <button
                                                      className="txn-menu-item"
                                                      onClick={() => handleUnpair(transaction)}
                                                      style={{ display: 'block', width: '100%', padding: '8px 12px', background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', textAlign: 'left', fontSize: '0.85rem' }}
                                                    >Unpair</button>
                                                  ) : (
                                                    <button
                                                      className="txn-menu-item"
                                                      onClick={() => handleStartPair(transaction)}
                                                      style={{ display: 'block', width: '100%', padding: '8px 12px', background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', textAlign: 'left', fontSize: '0.85rem' }}
                                                    >Pair</button>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </td>
```

- [ ] **Step 4: Add paired row styling**

Update the `rowClassName` logic at line 137 to include paired styling:

```javascript
                                const pairedClass = transaction.paired ? ' paired' : '';
                                const rowClassName = (!isIncome ? `expense ${evenOdd}` : `income ${evenOdd}`) + pairedClass;
```

And add a paired indicator next to the memo at line 145:

```javascript
                                const pairBadge = transaction.paired ? <span className="pair-badge" title={transaction.pairDesc}>🔗</span> : null;
```

Update the description cell (line 145):

```javascript
                                        <td className="description-col">{transaction.description}{memo}{pairBadge}</td>
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Finances/drawer.jsx
git commit -m "feat(finance): add ... overflow menu and paired styling to transaction rows"
```

### Task 5: Implement pair/unpair actions

**Files:**
- Modify: `frontend/src/modules/Finances/drawer.jsx` (add action handlers)
- Modify: `frontend/src/Apps/FinanceApp.jsx:18` (export baseUrl)

- [ ] **Step 1: Export baseUrl from FinanceApp**

In `frontend/src/Apps/FinanceApp.jsx`, change line 18:

```javascript
export const baseUrl = isLocalhost ? 'http://localhost:3112' : window.location.origin;
```

- [ ] **Step 2: Add pair/unpair handlers to Drawer component**

Import baseUrl at top of drawer.jsx:

```javascript
import { baseUrl } from '../../Apps/FinanceApp.jsx';
```

Add handlers inside the Drawer component, after the `pairMode` state (from Task 4):

```javascript
    const handleStartPair = (transaction) => {
      setMenuOpenId(null);
      setPairMode({ sourceTransaction: transaction });
    };

    const handleSelectPairTarget = async (targetTransaction) => {
      const source = pairMode.sourceTransaction;
      const isSourceExpense = source.expenseAmount > 0;
      const debit = isSourceExpense ? source.id : targetTransaction.id;
      const credit = isSourceExpense ? targetTransaction.id : source.id;
      const desc = prompt('Pair description (optional):') || `${source.description} ↔ ${targetTransaction.description}`;

      try {
        await fetch(`${baseUrl}/api/v1/finance/pairs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ debit, credit, desc })
        });
        setPairMode(null);
        // Trigger data reload — parent refetch
        window.location.reload();
      } catch (err) {
        console.error('Failed to create pair:', err);
      }
    };

    const handleUnpair = async (transaction) => {
      setMenuOpenId(null);
      try {
        await fetch(`${baseUrl}/api/v1/finance/pairs`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ debit: transaction.id, credit: transaction.pairedWith })
        });
        window.location.reload();
      } catch (err) {
        console.error('Failed to unpair:', err);
      }
    };
```

- [ ] **Step 3: Add pair-mode banner and row click override**

Above the `<table>` (around line 102), add a banner when in pair mode:

```javascript
              {pairMode && (
                <div style={{ padding: '8px 12px', background: '#1a3a5c', borderRadius: '4px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Select the offsetting transaction for: <strong>{pairMode.sourceTransaction.description}</strong></span>
                  <button onClick={() => setPairMode(null)} style={{ background: 'none', border: '1px solid #666', color: '#ccc', cursor: 'pointer', borderRadius: '3px', padding: '2px 8px' }}>Cancel</button>
                </div>
              )}
```

Override row click when in pair mode. Update the `<tr>` onClick at line 141:

```javascript
                                    <tr key={guid} className={rowClassName + (pairMode ? ' pair-selectable' : '')}
                                      onClick={() => pairMode ? handleSelectPairTarget(transaction) : handleRowClick(transaction)}
                                      style={{ cursor: pairMode ? 'crosshair' : (hasId ? 'pointer' : 'default') }}>
```

- [ ] **Step 4: Add CSS for paired rows**

Add to `frontend/src/Apps/FinanceApp.scss` (or wherever the drawer styles live):

```css
.transactions-table tr.paired {
  opacity: 0.5;
}
.transactions-table tr.paired:hover {
  opacity: 0.8;
}
.pair-badge {
  margin-left: 4px;
  font-size: 0.75rem;
  cursor: help;
}
.txn-menu-item:hover {
  background: #2a2a4e !important;
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/Apps/FinanceApp.jsx frontend/src/modules/Finances/drawer.jsx frontend/src/Apps/FinanceApp.scss
git commit -m "feat(finance): implement pair/unpair actions with API integration"
```

---

## Chunk 3: Integration Testing

### Task 6: End-to-end manual test

- [ ] **Step 1: Build and deploy**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 2: Test the AMC pair via API**

```bash
# Create the AMC accidental purchase + refund pair
curl -s -X POST http://localhost:3111/api/v1/finance/pairs \
  -H "Content-Type: application/json" \
  -d '{"debit": ORIGINAL_AMC_ID, "credit": REFUND_AMC_ID, "desc": "AMC accidental purchase + refund"}'

# Verify compilation adjusted the amounts
curl -s http://localhost:3111/api/v1/finance/data | jq '.budgets["2025-04-01"].shortTermBuckets["Learning & Leisure"]'
```

Replace `ORIGINAL_AMC_ID` and `REFUND_AMC_ID` with actual Buxfer transaction IDs from the data.

- [ ] **Step 3: Verify UI**

Open `/finances`, select 2025 Budget, drill into a bucket. Confirm:
- Paired transactions show dimmed with 🔗 badge
- ... menu shows "Unpair" on paired rows
- ... menu shows "Pair" on unpaired rows
- Spending totals reflect adjusted amounts

- [ ] **Step 4: Test unpair**

Click ... → Unpair on a paired transaction. Confirm the pair is removed and spending totals revert.

- [ ] **Step 5: Test pair creation via UI**

Click ... → Pair on a transaction. Confirm the banner appears, select target, enter description. Confirm pair is created and compilation updates.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(finance): transaction offset pairs — complete feature"
```
