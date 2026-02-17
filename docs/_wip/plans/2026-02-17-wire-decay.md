# Wire Decay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire tier items decay to 0% over N batches so that personal content (compass, library, scrapbook) dominates after extended scrolling.

**Architecture:** FeedPoolManager tracks batch count per user, passes it to TierAssemblyService which computes decayed wire allocation and proportionally redistributes freed slots to non-wire tiers. N is configurable via `wire_decay_batches` in scroll config.

**Tech Stack:** Node.js ES modules, existing feed assembly pipeline

---

### Task 1: Add batch counting to FeedPoolManager

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedPoolManager.mjs`

**Changes:**
1. Add `#batchCounts = new Map()` alongside other per-user Maps (line ~30)
2. In `reset()` (line 162): add `this.#batchCounts.delete(username)`
3. In `getPool()` (line 84): increment batch count after initialization
4. Add public `getBatchNumber(username)` method returning 1-indexed count

---

### Task 2: Add wire_decay_batches to ScrollConfigLoader

**Files:**
- Modify: `backend/src/3_applications/feed/services/ScrollConfigLoader.mjs`

**Changes:**
1. Add `wire_decay_batches: 10` to DEFAULTS (line 38)
2. Merge it in `#merge()` (line 171)

---

### Task 3: Compute decayed allocations in TierAssemblyService

**Files:**
- Modify: `backend/src/3_applications/feed/services/TierAssemblyService.mjs`

**Changes:**
1. Accept `batchNumber` and `wireDecayBatches` in `assemble()` options
2. Add `#computeDecayedAllocations()` method that:
   - Computes `decayFactor = clamp(1 - (batchNumber - 1) / wireDecayBatches, 0, 1)`
   - Calculates freed wire slots and distributes proportionally to non-wire tiers
3. Use decayed allocations in `#selectForTier()` and `#interleave()`

---

### Task 4: Wire it through FeedAssemblyService

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`

**Changes:**
1. Get `batchNumber` from `feedPoolManager.getBatchNumber(username)`
2. Pass `batchNumber` and `wireDecayBatches` to `tierAssemblyService.assemble()`

---

### Task 5: Document wire decay in reference docs

**Files:**
- Modify: `docs/reference/feed/feed-assembly-process.md`
- Modify: `docs/reference/feed/feed-system-architecture.md`
