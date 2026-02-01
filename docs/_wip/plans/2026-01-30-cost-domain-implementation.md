# Cost Domain Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a unified cost tracking system for API usage, utilities, subscriptions, and purchases with budget monitoring and alerts.

**Architecture:** DDD layered approach - domain entities/value objects define the model, ports define contracts, adapters implement persistence and cost sources, application services orchestrate ingestion/budgets/reporting, API exposes REST endpoints.

**Tech Stack:** Node.js ES modules (.mjs), YAML persistence, Vitest for testing, Express routers

**Design Document:** `docs/plans/2026-01-30-cost-domain-design.md`

---

## Phase 1: Domain Layer Foundation

### Task 1: Money Value Object

**Files:**
- Create: `backend/src/1_domains/cost/value-objects/Money.mjs`
- Test: `backend/tests/unit/suite/1_domains/cost/value-objects/Money.test.mjs`

**Step 1: Create test directory and write failing tests**

```javascript
// backend/tests/unit/suite/1_domains/cost/value-objects/Money.test.mjs
import { describe, it, expect } from 'vitest';
import { Money } from '../../../../../../src/1_domains/cost/value-objects/Money.mjs';

describe('Money', () => {
  describe('construction', () => {
    it('should create with amount and default USD currency', () => {
      const money = new Money(10.50);
      expect(money.amount).toBe(10.50);
      expect(money.currency).toBe('USD');
    });

    it('should create with explicit currency', () => {
      const money = new Money(10, 'EUR');
      expect(money.currency).toBe('EUR');
    });

    it('should throw for negative amount', () => {
      expect(() => new Money(-5)).toThrow();
    });

    it('should be immutable', () => {
      const money = new Money(10);
      expect(Object.isFrozen(money)).toBe(true);
    });
  });

  describe('arithmetic', () => {
    it('should add two Money objects', () => {
      const a = new Money(10.50);
      const b = new Money(5.25);
      const result = a.add(b);
      expect(result.amount).toBe(15.75);
    });

    it('should throw when adding different currencies', () => {
      const usd = new Money(10, 'USD');
      const eur = new Money(5, 'EUR');
      expect(() => usd.add(eur)).toThrow();
    });

    it('should subtract Money objects', () => {
      const a = new Money(10);
      const b = new Money(3);
      expect(a.subtract(b).amount).toBe(7);
    });

    it('should multiply by factor', () => {
      const money = new Money(10);
      expect(money.multiply(1.5).amount).toBe(15);
    });
  });

  describe('comparison', () => {
    it('should check equality', () => {
      const a = new Money(10.50);
      const b = new Money(10.50);
      expect(a.equals(b)).toBe(true);
    });

    it('should return false for different amounts', () => {
      const a = new Money(10);
      const b = new Money(20);
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('serialization', () => {
    it('should serialize to JSON', () => {
      const money = new Money(10.50);
      expect(money.toJSON()).toEqual({ amount: 10.50, currency: 'USD' });
    });

    it('should create from JSON', () => {
      const money = Money.fromJSON({ amount: 10.50, currency: 'USD' });
      expect(money.amount).toBe(10.50);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- backend/tests/unit/suite/1_domains/cost/value-objects/Money.test.mjs`
Expected: FAIL - Cannot find module

**Step 3: Create directory structure and implement**

```javascript
// backend/src/1_domains/cost/value-objects/Money.mjs
import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * Money value object - immutable monetary amount with currency
 * @class Money
 */
export class Money {
  #amount;
  #currency;

  /**
   * @param {number} amount - Monetary amount (non-negative)
   * @param {string} [currency='USD'] - ISO currency code
   */
  constructor(amount, currency = 'USD') {
    if (typeof amount !== 'number' || amount < 0) {
      throw new ValidationError('Amount must be a non-negative number', {
        code: 'INVALID_MONEY_AMOUNT',
        value: amount
      });
    }
    this.#amount = Math.round(amount * 100) / 100; // Round to cents
    this.#currency = currency;
    Object.freeze(this);
  }

  get amount() { return this.#amount; }
  get currency() { return this.#currency; }

  /**
   * Add another Money object
   * @param {Money} other
   * @returns {Money}
   */
  add(other) {
    this.#assertSameCurrency(other);
    return new Money(this.#amount + other.amount, this.#currency);
  }

  /**
   * Subtract another Money object
   * @param {Money} other
   * @returns {Money}
   */
  subtract(other) {
    this.#assertSameCurrency(other);
    const result = this.#amount - other.amount;
    return new Money(Math.max(0, result), this.#currency);
  }

  /**
   * Multiply by a factor
   * @param {number} factor
   * @returns {Money}
   */
  multiply(factor) {
    return new Money(this.#amount * factor, this.#currency);
  }

  /**
   * Check equality
   * @param {Money} other
   * @returns {boolean}
   */
  equals(other) {
    if (!(other instanceof Money)) return false;
    return this.#amount === other.amount && this.#currency === other.currency;
  }

  #assertSameCurrency(other) {
    if (this.#currency !== other.currency) {
      throw new ValidationError('Cannot operate on different currencies', {
        code: 'CURRENCY_MISMATCH',
        expected: this.#currency,
        actual: other.currency
      });
    }
  }

  toJSON() {
    return { amount: this.#amount, currency: this.#currency };
  }

  static fromJSON(data) {
    return new Money(data.amount, data.currency);
  }

  static zero(currency = 'USD') {
    return new Money(0, currency);
  }
}

export default Money;
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- backend/tests/unit/suite/1_domains/cost/value-objects/Money.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/cost/value-objects/Money.mjs backend/tests/unit/suite/1_domains/cost/value-objects/Money.test.mjs
git commit -m "feat(cost): add Money value object

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 2: Usage Value Object

**Files:**
- Create: `backend/src/1_domains/cost/value-objects/Usage.mjs`
- Test: `backend/tests/unit/suite/1_domains/cost/value-objects/Usage.test.mjs`

**Step 1: Write failing tests**

```javascript
// backend/tests/unit/suite/1_domains/cost/value-objects/Usage.test.mjs
import { describe, it, expect } from 'vitest';
import { Usage } from '../../../../../../src/1_domains/cost/value-objects/Usage.mjs';

describe('Usage', () => {
  it('should create with quantity and unit', () => {
    const usage = new Usage(1500, 'tokens');
    expect(usage.quantity).toBe(1500);
    expect(usage.unit).toBe('tokens');
  });

  it('should throw for negative quantity', () => {
    expect(() => new Usage(-1, 'tokens')).toThrow();
  });

  it('should throw for empty unit', () => {
    expect(() => new Usage(100, '')).toThrow();
  });

  it('should be immutable', () => {
    const usage = new Usage(100, 'kWh');
    expect(Object.isFrozen(usage)).toBe(true);
  });

  it('should serialize to JSON', () => {
    const usage = new Usage(3.5, 'kWh');
    expect(usage.toJSON()).toEqual({ quantity: 3.5, unit: 'kWh' });
  });

  it('should create from JSON', () => {
    const usage = Usage.fromJSON({ quantity: 100, unit: 'sms' });
    expect(usage.quantity).toBe(100);
    expect(usage.unit).toBe('sms');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- backend/tests/unit/suite/1_domains/cost/value-objects/Usage.test.mjs`
Expected: FAIL

**Step 3: Implement**

```javascript
// backend/src/1_domains/cost/value-objects/Usage.mjs
import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * Usage value object - quantity consumed with unit
 * @class Usage
 */
export class Usage {
  #quantity;
  #unit;

  /**
   * @param {number} quantity - Amount consumed
   * @param {string} unit - Unit of measure (tokens, kWh, sms, minutes)
   */
  constructor(quantity, unit) {
    if (typeof quantity !== 'number' || quantity < 0) {
      throw new ValidationError('Quantity must be non-negative', {
        code: 'INVALID_USAGE_QUANTITY',
        value: quantity
      });
    }
    if (!unit || typeof unit !== 'string') {
      throw new ValidationError('Unit is required', {
        code: 'INVALID_USAGE_UNIT',
        value: unit
      });
    }
    this.#quantity = quantity;
    this.#unit = unit;
    Object.freeze(this);
  }

  get quantity() { return this.#quantity; }
  get unit() { return this.#unit; }

  toJSON() {
    return { quantity: this.#quantity, unit: this.#unit };
  }

  static fromJSON(data) {
    return new Usage(data.quantity, data.unit);
  }
}

export default Usage;
```

**Step 4: Run tests**

Run: `npm test -- backend/tests/unit/suite/1_domains/cost/value-objects/Usage.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/cost/value-objects/Usage.mjs backend/tests/unit/suite/1_domains/cost/value-objects/Usage.test.mjs
git commit -m "feat(cost): add Usage value object

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 3: CostCategory Value Object

**Files:**
- Create: `backend/src/1_domains/cost/value-objects/CostCategory.mjs`
- Test: `backend/tests/unit/suite/1_domains/cost/value-objects/CostCategory.test.mjs`

**Step 1: Write failing tests**

```javascript
// backend/tests/unit/suite/1_domains/cost/value-objects/CostCategory.test.mjs
import { describe, it, expect } from 'vitest';
import { CostCategory } from '../../../../../../src/1_domains/cost/value-objects/CostCategory.mjs';

describe('CostCategory', () => {
  describe('construction', () => {
    it('should create from path array', () => {
      const cat = new CostCategory(['ai', 'openai', 'gpt-4o']);
      expect(cat.path).toEqual(['ai', 'openai', 'gpt-4o']);
    });

    it('should create from slash-separated string', () => {
      const cat = CostCategory.fromString('ai/openai/gpt-4o');
      expect(cat.path).toEqual(['ai', 'openai', 'gpt-4o']);
    });

    it('should throw for empty path', () => {
      expect(() => new CostCategory([])).toThrow();
    });
  });

  describe('hierarchy', () => {
    it('should get parent category', () => {
      const cat = new CostCategory(['ai', 'openai', 'gpt-4o']);
      const parent = cat.getParent();
      expect(parent.path).toEqual(['ai', 'openai']);
    });

    it('should return null for root parent', () => {
      const cat = new CostCategory(['ai']);
      expect(cat.getParent()).toBeNull();
    });

    it('should get root', () => {
      const cat = new CostCategory(['ai', 'openai', 'gpt-4o']);
      expect(cat.getRoot()).toBe('ai');
    });

    it('should check includes', () => {
      const parent = new CostCategory(['ai', 'openai']);
      const child = new CostCategory(['ai', 'openai', 'gpt-4o']);
      expect(parent.includes(child)).toBe(true);
      expect(child.includes(parent)).toBe(false);
    });
  });

  describe('serialization', () => {
    it('should convert to string', () => {
      const cat = new CostCategory(['ai', 'openai']);
      expect(cat.toString()).toBe('ai/openai');
    });

    it('should serialize to JSON as string', () => {
      const cat = new CostCategory(['utility', 'power']);
      expect(cat.toJSON()).toBe('utility/power');
    });
  });
});
```

**Step 2: Run test**

Run: `npm test -- backend/tests/unit/suite/1_domains/cost/value-objects/CostCategory.test.mjs`
Expected: FAIL

**Step 3: Implement**

```javascript
// backend/src/1_domains/cost/value-objects/CostCategory.mjs
import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * CostCategory value object - hierarchical cost classification
 * @class CostCategory
 *
 * @example
 * const cat = CostCategory.fromString('ai/openai/gpt-4o/chat');
 * cat.getRoot(); // 'ai'
 * cat.getParent(); // CostCategory(['ai', 'openai', 'gpt-4o'])
 */
export class CostCategory {
  #path;

  /**
   * @param {string[]} path - Hierarchical path segments
   */
  constructor(path) {
    if (!Array.isArray(path) || path.length === 0) {
      throw new ValidationError('Category path must be non-empty array', {
        code: 'INVALID_CATEGORY_PATH',
        value: path
      });
    }
    this.#path = Object.freeze([...path]);
    Object.freeze(this);
  }

  get path() { return this.#path; }

  /**
   * Get parent category or null if root
   * @returns {CostCategory|null}
   */
  getParent() {
    if (this.#path.length <= 1) return null;
    return new CostCategory(this.#path.slice(0, -1));
  }

  /**
   * Get root category name
   * @returns {string}
   */
  getRoot() {
    return this.#path[0];
  }

  /**
   * Check if this category includes another (is ancestor)
   * @param {CostCategory} other
   * @returns {boolean}
   */
  includes(other) {
    if (other.path.length <= this.#path.length) return false;
    return this.#path.every((seg, i) => seg === other.path[i]);
  }

  /**
   * Check if matches another category exactly or as ancestor
   * @param {CostCategory} other
   * @returns {boolean}
   */
  matches(other) {
    return this.equals(other) || this.includes(other);
  }

  /**
   * Check exact equality
   * @param {CostCategory} other
   * @returns {boolean}
   */
  equals(other) {
    if (!(other instanceof CostCategory)) return false;
    if (this.#path.length !== other.path.length) return false;
    return this.#path.every((seg, i) => seg === other.path[i]);
  }

  toString() {
    return this.#path.join('/');
  }

  toJSON() {
    return this.toString();
  }

  /**
   * Create from slash-separated string
   * @param {string} str
   * @returns {CostCategory}
   */
  static fromString(str) {
    return new CostCategory(str.split('/').filter(Boolean));
  }

  static fromJSON(data) {
    if (typeof data === 'string') return CostCategory.fromString(data);
    return new CostCategory(data);
  }
}

export default CostCategory;
```

**Step 4: Run tests**

Run: `npm test -- backend/tests/unit/suite/1_domains/cost/value-objects/CostCategory.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/cost/value-objects/CostCategory.mjs backend/tests/unit/suite/1_domains/cost/value-objects/CostCategory.test.mjs
git commit -m "feat(cost): add CostCategory value object with hierarchy

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 4: Attribution Value Object

**Files:**
- Create: `backend/src/1_domains/cost/value-objects/Attribution.mjs`
- Test: `backend/tests/unit/suite/1_domains/cost/value-objects/Attribution.test.mjs`

**Step 1: Write failing tests**

```javascript
// backend/tests/unit/suite/1_domains/cost/value-objects/Attribution.test.mjs
import { describe, it, expect } from 'vitest';
import { Attribution } from '../../../../../../src/1_domains/cost/value-objects/Attribution.mjs';

describe('Attribution', () => {
  it('should create with householdId only', () => {
    const attr = new Attribution({ householdId: 'default' });
    expect(attr.householdId).toBe('default');
    expect(attr.userId).toBeNull();
    expect(attr.feature).toBeNull();
    expect(attr.resource).toBeNull();
  });

  it('should create with all fields', () => {
    const attr = new Attribution({
      householdId: 'default',
      userId: 'teen',
      feature: 'assistant',
      resource: 'office_plug',
      tags: { room: 'office', device_type: 'computer' }
    });
    expect(attr.userId).toBe('teen');
    expect(attr.feature).toBe('assistant');
    expect(attr.resource).toBe('office_plug');
    expect(attr.tags.get('room')).toBe('office');
  });

  it('should throw without householdId', () => {
    expect(() => new Attribution({})).toThrow();
  });

  it('should be immutable', () => {
    const attr = new Attribution({ householdId: 'default' });
    expect(Object.isFrozen(attr)).toBe(true);
  });

  it('should serialize to JSON', () => {
    const attr = new Attribution({
      householdId: 'default',
      userId: 'teen',
      tags: { room: 'office' }
    });
    const json = attr.toJSON();
    expect(json.householdId).toBe('default');
    expect(json.userId).toBe('teen');
    expect(json.tags).toEqual({ room: 'office' });
  });

  it('should create from JSON', () => {
    const attr = Attribution.fromJSON({
      householdId: 'default',
      feature: 'fitness',
      tags: { type: 'hardware' }
    });
    expect(attr.feature).toBe('fitness');
    expect(attr.tags.get('type')).toBe('hardware');
  });
});
```

**Step 2: Run test**

Run: `npm test -- backend/tests/unit/suite/1_domains/cost/value-objects/Attribution.test.mjs`
Expected: FAIL

**Step 3: Implement**

```javascript
// backend/src/1_domains/cost/value-objects/Attribution.mjs
import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * Attribution value object - who/what incurred a cost
 * @class Attribution
 */
export class Attribution {
  #householdId;
  #userId;
  #feature;
  #resource;
  #tags;

  /**
   * @param {Object} data
   * @param {string} data.householdId - Required household identifier
   * @param {string} [data.userId] - User who incurred the cost
   * @param {string} [data.feature] - Feature/app that incurred the cost
   * @param {string} [data.resource] - Device/meter/resource ID
   * @param {Object} [data.tags] - Flexible key-value tags
   */
  constructor({ householdId, userId = null, feature = null, resource = null, tags = {} }) {
    if (!householdId) {
      throw new ValidationError('householdId is required', {
        code: 'MISSING_HOUSEHOLD_ID'
      });
    }
    this.#householdId = householdId;
    this.#userId = userId;
    this.#feature = feature;
    this.#resource = resource;
    this.#tags = Object.freeze(new Map(Object.entries(tags || {})));
    Object.freeze(this);
  }

  get householdId() { return this.#householdId; }
  get userId() { return this.#userId; }
  get feature() { return this.#feature; }
  get resource() { return this.#resource; }
  get tags() { return this.#tags; }

  toJSON() {
    const json = { householdId: this.#householdId };
    if (this.#userId) json.userId = this.#userId;
    if (this.#feature) json.feature = this.#feature;
    if (this.#resource) json.resource = this.#resource;
    if (this.#tags.size > 0) json.tags = Object.fromEntries(this.#tags);
    return json;
  }

  static fromJSON(data) {
    return new Attribution(data);
  }
}

export default Attribution;
```

**Step 4: Run tests**

Run: `npm test -- backend/tests/unit/suite/1_domains/cost/value-objects/Attribution.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/cost/value-objects/Attribution.mjs backend/tests/unit/suite/1_domains/cost/value-objects/Attribution.test.mjs
git commit -m "feat(cost): add Attribution value object with tags

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 5: Remaining Value Objects (BudgetPeriod, Thresholds, EntryType, SpreadSource)

**Files:**
- Create: `backend/src/1_domains/cost/value-objects/BudgetPeriod.mjs`
- Create: `backend/src/1_domains/cost/value-objects/Thresholds.mjs`
- Create: `backend/src/1_domains/cost/value-objects/EntryType.mjs`
- Create: `backend/src/1_domains/cost/value-objects/SpreadSource.mjs`
- Create: `backend/src/1_domains/cost/value-objects/index.mjs`
- Test: `backend/tests/unit/suite/1_domains/cost/value-objects/BudgetPeriod.test.mjs`

**Step 1: Write tests for BudgetPeriod**

```javascript
// backend/tests/unit/suite/1_domains/cost/value-objects/BudgetPeriod.test.mjs
import { describe, it, expect } from 'vitest';
import { BudgetPeriod, PERIOD_TYPES } from '../../../../../../src/1_domains/cost/value-objects/BudgetPeriod.mjs';

describe('BudgetPeriod', () => {
  it('should create monthly period', () => {
    const period = new BudgetPeriod('monthly');
    expect(period.type).toBe('monthly');
  });

  it('should throw for invalid type', () => {
    expect(() => new BudgetPeriod('biweekly')).toThrow();
  });

  it('should get current period start for monthly', () => {
    const period = new BudgetPeriod('monthly');
    const start = period.getCurrentPeriodStart(new Date('2026-01-15'));
    expect(start.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('should get current period end for monthly', () => {
    const period = new BudgetPeriod('monthly');
    const end = period.getCurrentPeriodEnd(new Date('2026-01-15'));
    expect(end.toISOString().slice(0, 10)).toBe('2026-01-31');
  });

  it('should export valid period types', () => {
    expect(PERIOD_TYPES).toContain('daily');
    expect(PERIOD_TYPES).toContain('weekly');
    expect(PERIOD_TYPES).toContain('monthly');
    expect(PERIOD_TYPES).toContain('yearly');
  });
});
```

**Step 2: Implement all remaining value objects**

```javascript
// backend/src/1_domains/cost/value-objects/BudgetPeriod.mjs
import { ValidationError } from '#domains/core/errors/index.mjs';

export const PERIOD_TYPES = Object.freeze(['daily', 'weekly', 'monthly', 'yearly']);

export class BudgetPeriod {
  #type;
  #anchor;

  constructor(type, anchor = null) {
    if (!PERIOD_TYPES.includes(type)) {
      throw new ValidationError(`Invalid period type: ${type}`, {
        code: 'INVALID_PERIOD_TYPE',
        validTypes: PERIOD_TYPES
      });
    }
    this.#type = type;
    this.#anchor = anchor ? new Date(anchor) : null;
    Object.freeze(this);
  }

  get type() { return this.#type; }
  get anchor() { return this.#anchor; }

  getCurrentPeriodStart(referenceDate = new Date()) {
    const d = new Date(referenceDate);
    switch (this.#type) {
      case 'daily':
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
      case 'weekly':
        const day = d.getDay();
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
      case 'monthly':
        return new Date(d.getFullYear(), d.getMonth(), 1);
      case 'yearly':
        return new Date(d.getFullYear(), 0, 1);
    }
  }

  getCurrentPeriodEnd(referenceDate = new Date()) {
    const d = new Date(referenceDate);
    switch (this.#type) {
      case 'daily':
        return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      case 'weekly':
        const day = d.getDay();
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (6 - day), 23, 59, 59, 999);
      case 'monthly':
        return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
      case 'yearly':
        return new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999);
    }
  }

  toJSON() {
    return { type: this.#type, anchor: this.#anchor?.toISOString() || null };
  }

  static fromJSON(data) {
    if (typeof data === 'string') return new BudgetPeriod(data);
    return new BudgetPeriod(data.type, data.anchor);
  }
}

export default BudgetPeriod;
```

```javascript
// backend/src/1_domains/cost/value-objects/Thresholds.mjs
export class Thresholds {
  #warning;
  #critical;
  #pace;

  constructor({ warning = 0.8, critical = 1.0, pace = true } = {}) {
    this.#warning = warning;
    this.#critical = critical;
    this.#pace = pace;
    Object.freeze(this);
  }

  get warning() { return this.#warning; }
  get critical() { return this.#critical; }
  get pace() { return this.#pace; }

  toJSON() {
    return { warning: this.#warning, critical: this.#critical, pace: this.#pace };
  }

  static fromJSON(data) {
    return new Thresholds(data);
  }

  static defaults() {
    return new Thresholds();
  }
}

export default Thresholds;
```

```javascript
// backend/src/1_domains/cost/value-objects/EntryType.mjs
export const EntryType = Object.freeze({
  USAGE: 'usage',
  SUBSCRIPTION: 'subscription',
  PURCHASE: 'purchase',
  TRANSACTION: 'transaction'
});

export const ENTRY_TYPES = Object.freeze(Object.values(EntryType));

export function isCountedInSpend(entryType) {
  return [EntryType.USAGE, EntryType.SUBSCRIPTION, EntryType.PURCHASE].includes(entryType);
}

export default EntryType;
```

```javascript
// backend/src/1_domains/cost/value-objects/SpreadSource.mjs
import { ValidationError } from '#domains/core/errors/index.mjs';
import { Money } from './Money.mjs';

export class SpreadSource {
  #name;
  #originalAmount;
  #spreadMonths;
  #startDate;
  #endsAt;

  constructor({ name, originalAmount, spreadMonths, startDate }) {
    if (!name) throw new ValidationError('name required', { code: 'SPREAD_NAME_REQUIRED' });
    if (!spreadMonths || spreadMonths < 1) {
      throw new ValidationError('spreadMonths must be >= 1', { code: 'INVALID_SPREAD_MONTHS' });
    }

    this.#name = name;
    this.#originalAmount = originalAmount instanceof Money ? originalAmount : new Money(originalAmount);
    this.#spreadMonths = spreadMonths;
    this.#startDate = new Date(startDate);

    const endDate = new Date(this.#startDate);
    endDate.setMonth(endDate.getMonth() + spreadMonths);
    this.#endsAt = endDate;

    Object.freeze(this);
  }

  get name() { return this.#name; }
  get originalAmount() { return this.#originalAmount; }
  get spreadMonths() { return this.#spreadMonths; }
  get startDate() { return this.#startDate; }
  get endsAt() { return this.#endsAt; }

  getMonthlyAmount() {
    return this.#originalAmount.multiply(1 / this.#spreadMonths);
  }

  getMonthsRemaining(asOf = new Date()) {
    const remaining = Math.ceil((this.#endsAt - asOf) / (30 * 24 * 60 * 60 * 1000));
    return Math.max(0, remaining);
  }

  toJSON() {
    return {
      name: this.#name,
      originalAmount: this.#originalAmount.amount,
      spreadMonths: this.#spreadMonths,
      startDate: this.#startDate.toISOString(),
      endsAt: this.#endsAt.toISOString()
    };
  }

  static fromJSON(data) {
    return new SpreadSource(data);
  }
}

export default SpreadSource;
```

```javascript
// backend/src/1_domains/cost/value-objects/index.mjs
export { Money } from './Money.mjs';
export { Usage } from './Usage.mjs';
export { CostCategory } from './CostCategory.mjs';
export { Attribution } from './Attribution.mjs';
export { BudgetPeriod, PERIOD_TYPES } from './BudgetPeriod.mjs';
export { Thresholds } from './Thresholds.mjs';
export { EntryType, ENTRY_TYPES, isCountedInSpend } from './EntryType.mjs';
export { SpreadSource } from './SpreadSource.mjs';
```

**Step 3: Run all value object tests**

Run: `npm test -- backend/tests/unit/suite/1_domains/cost/value-objects/`
Expected: PASS

**Step 4: Commit**

```bash
git add backend/src/1_domains/cost/value-objects/
git commit -m "feat(cost): add BudgetPeriod, Thresholds, EntryType, SpreadSource value objects

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 6: CostEntry Entity

**Files:**
- Create: `backend/src/1_domains/cost/entities/CostEntry.mjs`
- Test: `backend/tests/unit/suite/1_domains/cost/entities/CostEntry.test.mjs`

**Step 1: Write failing tests**

```javascript
// backend/tests/unit/suite/1_domains/cost/entities/CostEntry.test.mjs
import { describe, it, expect } from 'vitest';
import { CostEntry } from '../../../../../../src/1_domains/cost/entities/CostEntry.mjs';
import { Money } from '../../../../../../src/1_domains/cost/value-objects/Money.mjs';
import { Usage } from '../../../../../../src/1_domains/cost/value-objects/Usage.mjs';
import { CostCategory } from '../../../../../../src/1_domains/cost/value-objects/CostCategory.mjs';
import { Attribution } from '../../../../../../src/1_domains/cost/value-objects/Attribution.mjs';
import { EntryType } from '../../../../../../src/1_domains/cost/value-objects/EntryType.mjs';

describe('CostEntry', () => {
  const validData = {
    id: '20260130143022-abc123',
    occurredAt: new Date('2026-01-30T14:30:22Z'),
    amount: new Money(0.0234),
    category: CostCategory.fromString('ai/openai/gpt-4o'),
    usage: new Usage(1500, 'tokens'),
    entryType: EntryType.USAGE,
    attribution: new Attribution({ householdId: 'default', userId: 'teen' })
  };

  it('should create with all required fields', () => {
    const entry = new CostEntry(validData);
    expect(entry.id).toBe('20260130143022-abc123');
    expect(entry.amount.amount).toBe(0.02);
    expect(entry.entryType).toBe('usage');
  });

  it('should throw without id', () => {
    expect(() => new CostEntry({ ...validData, id: null })).toThrow();
  });

  it('should throw without amount', () => {
    expect(() => new CostEntry({ ...validData, amount: null })).toThrow();
  });

  it('should default reconcilesUsage to false', () => {
    const entry = new CostEntry(validData);
    expect(entry.reconcilesUsage).toBe(false);
  });

  it('should allow reconcilesUsage = true for transaction type', () => {
    const entry = new CostEntry({
      ...validData,
      entryType: EntryType.TRANSACTION,
      reconcilesUsage: true
    });
    expect(entry.reconcilesUsage).toBe(true);
  });

  it('should count in spend for usage type', () => {
    const entry = new CostEntry(validData);
    expect(entry.countsInSpend()).toBe(true);
  });

  it('should not count in spend when reconcilesUsage is true', () => {
    const entry = new CostEntry({
      ...validData,
      entryType: EntryType.TRANSACTION,
      reconcilesUsage: true
    });
    expect(entry.countsInSpend()).toBe(false);
  });

  it('should serialize to JSON', () => {
    const entry = new CostEntry(validData);
    const json = entry.toJSON();
    expect(json.id).toBe('20260130143022-abc123');
    expect(json.amount).toBe(0.02);
    expect(json.category).toBe('ai/openai/gpt-4o');
  });

  it('should create from JSON', () => {
    const json = {
      id: '20260130143022-abc123',
      occurredAt: '2026-01-30T14:30:22Z',
      amount: 0.02,
      category: 'ai/openai/gpt-4o',
      usage: { quantity: 1500, unit: 'tokens' },
      entryType: 'usage',
      attribution: { householdId: 'default' }
    };
    const entry = CostEntry.fromJSON(json);
    expect(entry.id).toBe('20260130143022-abc123');
    expect(entry.amount.amount).toBe(0.02);
  });
});
```

**Step 2: Run test**

Run: `npm test -- backend/tests/unit/suite/1_domains/cost/entities/CostEntry.test.mjs`
Expected: FAIL

**Step 3: Implement**

```javascript
// backend/src/1_domains/cost/entities/CostEntry.mjs
import { ValidationError } from '#domains/core/errors/index.mjs';
import { Money } from '../value-objects/Money.mjs';
import { Usage } from '../value-objects/Usage.mjs';
import { CostCategory } from '../value-objects/CostCategory.mjs';
import { Attribution } from '../value-objects/Attribution.mjs';
import { SpreadSource } from '../value-objects/SpreadSource.mjs';
import { isCountedInSpend } from '../value-objects/EntryType.mjs';

/**
 * CostEntry Entity - A single cost event
 * @class CostEntry
 */
export class CostEntry {
  #id;
  #occurredAt;
  #amount;
  #category;
  #usage;
  #entryType;
  #attribution;
  #description;
  #metadata;
  #spreadSource;
  #reconcilesUsage;
  #variance;

  constructor({
    id,
    occurredAt,
    amount,
    category,
    usage,
    entryType,
    attribution,
    description = null,
    metadata = {},
    spreadSource = null,
    reconcilesUsage = false,
    variance = null
  }) {
    if (!id) throw new ValidationError('id is required', { code: 'MISSING_ENTRY_ID' });
    if (!amount) throw new ValidationError('amount is required', { code: 'MISSING_AMOUNT' });
    if (!category) throw new ValidationError('category is required', { code: 'MISSING_CATEGORY' });
    if (!entryType) throw new ValidationError('entryType is required', { code: 'MISSING_ENTRY_TYPE' });
    if (!attribution) throw new ValidationError('attribution is required', { code: 'MISSING_ATTRIBUTION' });

    this.#id = id;
    this.#occurredAt = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
    this.#amount = amount instanceof Money ? amount : new Money(amount);
    this.#category = category instanceof CostCategory ? category : CostCategory.fromString(category);
    this.#usage = usage ? (usage instanceof Usage ? usage : Usage.fromJSON(usage)) : null;
    this.#entryType = entryType;
    this.#attribution = attribution instanceof Attribution ? attribution : Attribution.fromJSON(attribution);
    this.#description = description;
    this.#metadata = Object.freeze({ ...metadata });
    this.#spreadSource = spreadSource ? (spreadSource instanceof SpreadSource ? spreadSource : SpreadSource.fromJSON(spreadSource)) : null;
    this.#reconcilesUsage = reconcilesUsage;
    this.#variance = variance ? (variance instanceof Money ? variance : new Money(variance)) : null;
  }

  get id() { return this.#id; }
  get occurredAt() { return this.#occurredAt; }
  get amount() { return this.#amount; }
  get category() { return this.#category; }
  get usage() { return this.#usage; }
  get entryType() { return this.#entryType; }
  get attribution() { return this.#attribution; }
  get description() { return this.#description; }
  get metadata() { return this.#metadata; }
  get spreadSource() { return this.#spreadSource; }
  get reconcilesUsage() { return this.#reconcilesUsage; }
  get variance() { return this.#variance; }

  /**
   * Whether this entry should be counted in spend totals
   */
  countsInSpend() {
    if (this.#reconcilesUsage) return false;
    return isCountedInSpend(this.#entryType);
  }

  toJSON() {
    const json = {
      id: this.#id,
      occurredAt: this.#occurredAt.toISOString(),
      amount: this.#amount.amount,
      category: this.#category.toString(),
      entryType: this.#entryType,
      attribution: this.#attribution.toJSON(),
      reconcilesUsage: this.#reconcilesUsage
    };
    if (this.#usage) json.usage = this.#usage.toJSON();
    if (this.#description) json.description = this.#description;
    if (Object.keys(this.#metadata).length > 0) json.metadata = this.#metadata;
    if (this.#spreadSource) json.spreadSource = this.#spreadSource.toJSON();
    if (this.#variance) json.variance = this.#variance.amount;
    return json;
  }

  static fromJSON(data) {
    return new CostEntry({
      ...data,
      amount: new Money(data.amount),
      category: CostCategory.fromString(data.category),
      usage: data.usage ? Usage.fromJSON(data.usage) : null,
      attribution: Attribution.fromJSON(data.attribution),
      spreadSource: data.spreadSource ? SpreadSource.fromJSON(data.spreadSource) : null,
      variance: data.variance ? new Money(data.variance) : null
    });
  }

  /**
   * Generate a unique ID for a new entry
   */
  static generateId(timestamp = new Date()) {
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    const ts = [
      timestamp.getFullYear(),
      pad(timestamp.getMonth() + 1),
      pad(timestamp.getDate()),
      pad(timestamp.getHours()),
      pad(timestamp.getMinutes()),
      pad(timestamp.getSeconds())
    ].join('');
    const rand = Math.random().toString(36).slice(2, 8);
    return `${ts}-${rand}`;
  }
}

export default CostEntry;
```

**Step 4: Run tests**

Run: `npm test -- backend/tests/unit/suite/1_domains/cost/entities/CostEntry.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/cost/entities/CostEntry.mjs backend/tests/unit/suite/1_domains/cost/entities/CostEntry.test.mjs
git commit -m "feat(cost): add CostEntry entity

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 7: CostBudget Entity

**Files:**
- Create: `backend/src/1_domains/cost/entities/CostBudget.mjs`
- Create: `backend/src/1_domains/cost/entities/index.mjs`
- Test: `backend/tests/unit/suite/1_domains/cost/entities/CostBudget.test.mjs`

**Step 1: Write failing tests**

```javascript
// backend/tests/unit/suite/1_domains/cost/entities/CostBudget.test.mjs
import { describe, it, expect } from 'vitest';
import { CostBudget } from '../../../../../../src/1_domains/cost/entities/CostBudget.mjs';
import { Money } from '../../../../../../src/1_domains/cost/value-objects/Money.mjs';
import { CostCategory } from '../../../../../../src/1_domains/cost/value-objects/CostCategory.mjs';

describe('CostBudget', () => {
  const validData = {
    id: 'monthly-ai',
    name: 'Monthly AI Costs',
    category: CostCategory.fromString('ai'),
    period: 'monthly',
    amount: new Money(50),
    householdId: 'default'
  };

  it('should create with required fields', () => {
    const budget = new CostBudget(validData);
    expect(budget.id).toBe('monthly-ai');
    expect(budget.amount.amount).toBe(50);
  });

  it('should use default thresholds', () => {
    const budget = new CostBudget(validData);
    expect(budget.thresholds.warning).toBe(0.8);
    expect(budget.thresholds.critical).toBe(1.0);
  });

  it('should calculate remaining', () => {
    const budget = new CostBudget(validData);
    const spent = new Money(30);
    expect(budget.getRemaining(spent).amount).toBe(20);
  });

  it('should calculate percent spent', () => {
    const budget = new CostBudget(validData);
    const spent = new Money(25);
    expect(budget.getPercentSpent(spent)).toBe(50);
  });

  it('should check over budget', () => {
    const budget = new CostBudget(validData);
    expect(budget.isOverBudget(new Money(60))).toBe(true);
    expect(budget.isOverBudget(new Money(40))).toBe(false);
  });

  it('should check warning level', () => {
    const budget = new CostBudget(validData);
    expect(budget.isAtWarningLevel(new Money(40))).toBe(true); // 80%
    expect(budget.isAtWarningLevel(new Money(30))).toBe(false); // 60%
  });

  it('should allow null category for global budget', () => {
    const budget = new CostBudget({ ...validData, category: null });
    expect(budget.category).toBeNull();
  });
});
```

**Step 2: Implement**

```javascript
// backend/src/1_domains/cost/entities/CostBudget.mjs
import { ValidationError } from '#domains/core/errors/index.mjs';
import { Money } from '../value-objects/Money.mjs';
import { CostCategory } from '../value-objects/CostCategory.mjs';
import { BudgetPeriod } from '../value-objects/BudgetPeriod.mjs';
import { Thresholds } from '../value-objects/Thresholds.mjs';

/**
 * CostBudget Entity - A spending limit for a category
 * @class CostBudget
 */
export class CostBudget {
  #id;
  #name;
  #category;
  #period;
  #amount;
  #thresholds;
  #householdId;

  constructor({
    id,
    name,
    category = null,
    period,
    amount,
    thresholds = null,
    householdId
  }) {
    if (!id) throw new ValidationError('id is required', { code: 'MISSING_BUDGET_ID' });
    if (!name) throw new ValidationError('name is required', { code: 'MISSING_BUDGET_NAME' });
    if (!householdId) throw new ValidationError('householdId is required', { code: 'MISSING_HOUSEHOLD_ID' });

    this.#id = id;
    this.#name = name;
    this.#category = category ? (category instanceof CostCategory ? category : CostCategory.fromString(category)) : null;
    this.#period = period instanceof BudgetPeriod ? period : new BudgetPeriod(period);
    this.#amount = amount instanceof Money ? amount : new Money(amount);
    this.#thresholds = thresholds instanceof Thresholds ? thresholds : Thresholds.fromJSON(thresholds || {});
    this.#householdId = householdId;
  }

  get id() { return this.#id; }
  get name() { return this.#name; }
  get category() { return this.#category; }
  get period() { return this.#period; }
  get amount() { return this.#amount; }
  get thresholds() { return this.#thresholds; }
  get householdId() { return this.#householdId; }

  getRemaining(spent) {
    return this.#amount.subtract(spent);
  }

  getPercentSpent(spent) {
    if (this.#amount.amount === 0) return 0;
    return Math.round((spent.amount / this.#amount.amount) * 100);
  }

  isOverBudget(spent) {
    return spent.amount > this.#amount.amount;
  }

  isAtWarningLevel(spent) {
    const percent = spent.amount / this.#amount.amount;
    return percent >= this.#thresholds.warning && percent < this.#thresholds.critical;
  }

  isAtCriticalLevel(spent) {
    const percent = spent.amount / this.#amount.amount;
    return percent >= this.#thresholds.critical;
  }

  toJSON() {
    return {
      id: this.#id,
      name: this.#name,
      category: this.#category?.toString() || null,
      period: this.#period.type,
      amount: this.#amount.amount,
      thresholds: this.#thresholds.toJSON(),
      householdId: this.#householdId
    };
  }

  static fromJSON(data) {
    return new CostBudget({
      ...data,
      category: data.category ? CostCategory.fromString(data.category) : null,
      amount: new Money(data.amount),
      thresholds: Thresholds.fromJSON(data.thresholds || {})
    });
  }
}

export default CostBudget;
```

```javascript
// backend/src/1_domains/cost/entities/index.mjs
export { CostEntry } from './CostEntry.mjs';
export { CostBudget } from './CostBudget.mjs';
```

**Step 3: Run tests**

Run: `npm test -- backend/tests/unit/suite/1_domains/cost/entities/`
Expected: PASS

**Step 4: Commit**

```bash
git add backend/src/1_domains/cost/entities/
git commit -m "feat(cost): add CostBudget entity with threshold checks

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 8: CostAnalysisService (Domain Service)

**Files:**
- Create: `backend/src/1_domains/cost/services/CostAnalysisService.mjs`
- Create: `backend/src/1_domains/cost/services/index.mjs`
- Create: `backend/src/1_domains/cost/index.mjs`
- Test: `backend/tests/unit/suite/1_domains/cost/services/CostAnalysisService.test.mjs`

**Step 1: Write failing tests**

```javascript
// backend/tests/unit/suite/1_domains/cost/services/CostAnalysisService.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import { CostAnalysisService } from '../../../../../../src/1_domains/cost/services/CostAnalysisService.mjs';
import { CostEntry } from '../../../../../../src/1_domains/cost/entities/CostEntry.mjs';
import { Money } from '../../../../../../src/1_domains/cost/value-objects/Money.mjs';
import { Usage } from '../../../../../../src/1_domains/cost/value-objects/Usage.mjs';
import { CostCategory } from '../../../../../../src/1_domains/cost/value-objects/CostCategory.mjs';
import { Attribution } from '../../../../../../src/1_domains/cost/value-objects/Attribution.mjs';
import { EntryType } from '../../../../../../src/1_domains/cost/value-objects/EntryType.mjs';

describe('CostAnalysisService', () => {
  let service;
  let entries;

  beforeEach(() => {
    service = new CostAnalysisService();
    entries = [
      new CostEntry({
        id: '1',
        occurredAt: new Date('2026-01-15'),
        amount: new Money(10),
        category: CostCategory.fromString('ai/openai'),
        usage: new Usage(1000, 'tokens'),
        entryType: EntryType.USAGE,
        attribution: new Attribution({ householdId: 'default', userId: 'teen' })
      }),
      new CostEntry({
        id: '2',
        occurredAt: new Date('2026-01-16'),
        amount: new Money(5),
        category: CostCategory.fromString('ai/openai'),
        usage: new Usage(500, 'tokens'),
        entryType: EntryType.USAGE,
        attribution: new Attribution({ householdId: 'default', userId: 'parent' })
      }),
      new CostEntry({
        id: '3',
        occurredAt: new Date('2026-01-16'),
        amount: new Money(20),
        category: CostCategory.fromString('utility/power'),
        usage: new Usage(2, 'kWh'),
        entryType: EntryType.USAGE,
        attribution: new Attribution({ householdId: 'default', resource: 'office_plug' })
      })
    ];
  });

  describe('calculateSpend', () => {
    it('should sum all entry amounts', () => {
      const total = service.calculateSpend(entries);
      expect(total.amount).toBe(35);
    });

    it('should filter by category', () => {
      const aiCategory = CostCategory.fromString('ai');
      const total = service.calculateSpend(entries, { category: aiCategory });
      expect(total.amount).toBe(15);
    });

    it('should exclude reconciliation entries', () => {
      const reconcileEntry = new CostEntry({
        id: '4',
        occurredAt: new Date(),
        amount: new Money(100),
        category: CostCategory.fromString('ai/openai'),
        entryType: EntryType.TRANSACTION,
        attribution: new Attribution({ householdId: 'default' }),
        reconcilesUsage: true
      });
      const total = service.calculateSpend([...entries, reconcileEntry]);
      expect(total.amount).toBe(35); // Reconcile entry excluded
    });
  });

  describe('getCategoryBreakdown', () => {
    it('should break down by root category', () => {
      const breakdown = service.getCategoryBreakdown(entries, 1);
      expect(breakdown.get('ai')).toBe(15);
      expect(breakdown.get('utility')).toBe(20);
    });
  });

  describe('getUserBreakdown', () => {
    it('should break down by user', () => {
      const breakdown = service.getUserBreakdown(entries);
      expect(breakdown.get('teen')).toBe(10);
      expect(breakdown.get('parent')).toBe(5);
    });
  });

  describe('filterForSpend', () => {
    it('should exclude reconciliation entries', () => {
      const reconcileEntry = new CostEntry({
        id: '4',
        occurredAt: new Date(),
        amount: new Money(100),
        category: CostCategory.fromString('ai/openai'),
        entryType: EntryType.TRANSACTION,
        attribution: new Attribution({ householdId: 'default' }),
        reconcilesUsage: true
      });
      const filtered = service.filterForSpend([...entries, reconcileEntry]);
      expect(filtered.length).toBe(3);
    });
  });
});
```

**Step 2: Implement**

```javascript
// backend/src/1_domains/cost/services/CostAnalysisService.mjs
import { Money } from '../value-objects/Money.mjs';
import { CostCategory } from '../value-objects/CostCategory.mjs';

/**
 * CostAnalysisService - Domain service for cost calculations and breakdowns
 * @class CostAnalysisService
 */
export class CostAnalysisService {
  /**
   * Filter entries to only those that count in spend totals
   * @param {CostEntry[]} entries
   * @returns {CostEntry[]}
   */
  filterForSpend(entries) {
    return entries.filter(e => e.countsInSpend());
  }

  /**
   * Calculate total spend from entries
   * @param {CostEntry[]} entries
   * @param {Object} [options]
   * @param {CostCategory} [options.category] - Filter to category
   * @returns {Money}
   */
  calculateSpend(entries, options = {}) {
    let filtered = this.filterForSpend(entries);

    if (options.category) {
      filtered = filtered.filter(e =>
        options.category.equals(e.category) || options.category.includes(e.category)
      );
    }

    return filtered.reduce(
      (sum, entry) => sum.add(entry.amount),
      Money.zero()
    );
  }

  /**
   * Get spend breakdown by category
   * @param {CostEntry[]} entries
   * @param {number} [depth=1] - Category depth (1=root, 2=ai/openai, etc.)
   * @returns {Map<string, number>}
   */
  getCategoryBreakdown(entries, depth = 1) {
    const filtered = this.filterForSpend(entries);
    const breakdown = new Map();

    for (const entry of filtered) {
      const path = entry.category.path.slice(0, depth).join('/');
      const current = breakdown.get(path) || 0;
      breakdown.set(path, current + entry.amount.amount);
    }

    return breakdown;
  }

  /**
   * Get spend breakdown by user
   * @param {CostEntry[]} entries
   * @returns {Map<string, number>}
   */
  getUserBreakdown(entries) {
    const filtered = this.filterForSpend(entries);
    const breakdown = new Map();

    for (const entry of filtered) {
      const userId = entry.attribution.userId || 'system';
      const current = breakdown.get(userId) || 0;
      breakdown.set(userId, current + entry.amount.amount);
    }

    return breakdown;
  }

  /**
   * Get spend breakdown by feature
   * @param {CostEntry[]} entries
   * @returns {Map<string, number>}
   */
  getFeatureBreakdown(entries) {
    const filtered = this.filterForSpend(entries);
    const breakdown = new Map();

    for (const entry of filtered) {
      const feature = entry.attribution.feature || 'unattributed';
      const current = breakdown.get(feature) || 0;
      breakdown.set(feature, current + entry.amount.amount);
    }

    return breakdown;
  }

  /**
   * Get spend breakdown by resource
   * @param {CostEntry[]} entries
   * @returns {Map<string, number>}
   */
  getResourceBreakdown(entries) {
    const filtered = this.filterForSpend(entries);
    const breakdown = new Map();

    for (const entry of filtered) {
      const resource = entry.attribution.resource;
      if (resource) {
        const current = breakdown.get(resource) || 0;
        breakdown.set(resource, current + entry.amount.amount);
      }
    }

    return breakdown;
  }

  /**
   * Get spend breakdown by a specific tag
   * @param {CostEntry[]} entries
   * @param {string} tagName
   * @returns {Map<string, number>}
   */
  getTagBreakdown(entries, tagName) {
    const filtered = this.filterForSpend(entries);
    const breakdown = new Map();

    for (const entry of filtered) {
      const tagValue = entry.attribution.tags.get(tagName);
      if (tagValue) {
        const current = breakdown.get(tagValue) || 0;
        breakdown.set(tagValue, current + entry.amount.amount);
      }
    }

    return breakdown;
  }
}

export default CostAnalysisService;
```

```javascript
// backend/src/1_domains/cost/services/index.mjs
export { CostAnalysisService } from './CostAnalysisService.mjs';
```

```javascript
// backend/src/1_domains/cost/index.mjs
export * from './entities/index.mjs';
export * from './value-objects/index.mjs';
export * from './services/index.mjs';
```

**Step 3: Run tests**

Run: `npm test -- backend/tests/unit/suite/1_domains/cost/`
Expected: PASS

**Step 4: Commit**

```bash
git add backend/src/1_domains/cost/
git commit -m "feat(cost): add CostAnalysisService and domain barrel exports

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 2: Application Layer (Ports + Services)

### Task 9: Port Interfaces

**Files:**
- Create: `backend/src/3_applications/cost/ports/ICostSource.mjs`
- Create: `backend/src/3_applications/cost/ports/ICostRepository.mjs`
- Create: `backend/src/3_applications/cost/ports/ICostBudgetRepository.mjs`
- Create: `backend/src/3_applications/cost/ports/ICostAlertGateway.mjs`
- Create: `backend/src/3_applications/cost/ports/index.mjs`

**Step 1: Create port interfaces**

```javascript
// backend/src/3_applications/cost/ports/ICostSource.mjs
/**
 * ICostSource - Port interface for cost data sources
 */
export class ICostSource {
  getSourceId() { throw new Error('ICostSource.getSourceId must be implemented'); }
  getSupportedCategories() { throw new Error('ICostSource.getSupportedCategories must be implemented'); }
  async fetchCosts(since) { throw new Error('ICostSource.fetchCosts must be implemented'); }
  onCost(callback) { throw new Error('ICostSource.onCost must be implemented'); }
}

export default ICostSource;
```

```javascript
// backend/src/3_applications/cost/ports/ICostRepository.mjs
/**
 * ICostRepository - Port interface for cost entry persistence
 */
export class ICostRepository {
  async save(entry) { throw new Error('ICostRepository.save must be implemented'); }
  async saveBatch(entries) { throw new Error('ICostRepository.saveBatch must be implemented'); }
  async findByPeriod(start, end, filter) { throw new Error('ICostRepository.findByPeriod must be implemented'); }
  async findByCategory(category, period) { throw new Error('ICostRepository.findByCategory must be implemented'); }
  async findByAttribution(attribution, period) { throw new Error('ICostRepository.findByAttribution must be implemented'); }
  async compact(olderThan) { throw new Error('ICostRepository.compact must be implemented'); }
  async archive(entries, path) { throw new Error('ICostRepository.archive must be implemented'); }
}

export default ICostRepository;
```

```javascript
// backend/src/3_applications/cost/ports/ICostBudgetRepository.mjs
/**
 * ICostBudgetRepository - Port interface for budget persistence
 */
export class ICostBudgetRepository {
  async findAll(householdId) { throw new Error('ICostBudgetRepository.findAll must be implemented'); }
  async findByCategory(category) { throw new Error('ICostBudgetRepository.findByCategory must be implemented'); }
  async save(budget) { throw new Error('ICostBudgetRepository.save must be implemented'); }
}

export default ICostBudgetRepository;
```

```javascript
// backend/src/3_applications/cost/ports/ICostAlertGateway.mjs
/**
 * ICostAlertGateway - Port interface for sending cost alerts
 */
export class ICostAlertGateway {
  async sendAlert(alert) { throw new Error('ICostAlertGateway.sendAlert must be implemented'); }
}

export default ICostAlertGateway;
```

```javascript
// backend/src/3_applications/cost/ports/index.mjs
export { ICostSource } from './ICostSource.mjs';
export { ICostRepository } from './ICostRepository.mjs';
export { ICostBudgetRepository } from './ICostBudgetRepository.mjs';
export { ICostAlertGateway } from './ICostAlertGateway.mjs';
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/cost/ports/
git commit -m "feat(cost): add port interfaces for cost application layer

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 10: CostIngestionService

**Files:**
- Create: `backend/src/3_applications/cost/services/CostIngestionService.mjs`
- Test: `backend/tests/unit/suite/3_applications/cost/services/CostIngestionService.test.mjs`

**Step 1: Write failing tests**

```javascript
// backend/tests/unit/suite/3_applications/cost/services/CostIngestionService.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostIngestionService } from '../../../../../../src/3_applications/cost/services/CostIngestionService.mjs';
import { CostEntry } from '../../../../../../src/1_domains/cost/entities/CostEntry.mjs';
import { Money } from '../../../../../../src/1_domains/cost/value-objects/Money.mjs';
import { CostCategory } from '../../../../../../src/1_domains/cost/value-objects/CostCategory.mjs';
import { Attribution } from '../../../../../../src/1_domains/cost/value-objects/Attribution.mjs';
import { EntryType } from '../../../../../../src/1_domains/cost/value-objects/EntryType.mjs';

describe('CostIngestionService', () => {
  let service;
  let mockRepository;
  let mockBudgetService;

  beforeEach(() => {
    mockRepository = {
      save: vi.fn(),
      saveBatch: vi.fn()
    };
    mockBudgetService = {
      evaluateBudgets: vi.fn()
    };
    service = new CostIngestionService({
      costRepository: mockRepository,
      budgetService: mockBudgetService,
      logger: { info: vi.fn(), error: vi.fn() }
    });
  });

  describe('handleCostEvent', () => {
    it('should save entry to repository', async () => {
      const entry = new CostEntry({
        id: '1',
        occurredAt: new Date(),
        amount: new Money(10),
        category: CostCategory.fromString('ai/openai'),
        entryType: EntryType.USAGE,
        attribution: new Attribution({ householdId: 'default' })
      });

      await service.handleCostEvent(entry);

      expect(mockRepository.save).toHaveBeenCalledWith(entry);
    });

    it('should trigger budget evaluation', async () => {
      const entry = new CostEntry({
        id: '1',
        occurredAt: new Date(),
        amount: new Money(10),
        category: CostCategory.fromString('ai/openai'),
        entryType: EntryType.USAGE,
        attribution: new Attribution({ householdId: 'default' })
      });

      await service.handleCostEvent(entry);

      expect(mockBudgetService.evaluateBudgets).toHaveBeenCalledWith('default');
    });
  });

  describe('registerSource', () => {
    it('should register source and subscribe to costs', () => {
      const mockSource = {
        getSourceId: () => 'test',
        onCost: vi.fn()
      };

      service.registerSource(mockSource);

      expect(mockSource.onCost).toHaveBeenCalled();
    });
  });
});
```

**Step 2: Implement**

```javascript
// backend/src/3_applications/cost/services/CostIngestionService.mjs
/**
 * CostIngestionService - Handles incoming costs from various sources
 * @class CostIngestionService
 */
export class CostIngestionService {
  #costRepository;
  #budgetService;
  #sources;
  #logger;

  constructor({ costRepository, budgetService, sources = [], logger = console }) {
    if (!costRepository) throw new Error('costRepository is required');

    this.#costRepository = costRepository;
    this.#budgetService = budgetService;
    this.#sources = new Map();
    this.#logger = logger;

    for (const source of sources) {
      this.registerSource(source);
    }
  }

  /**
   * Register a cost source
   * @param {ICostSource} source
   */
  registerSource(source) {
    const sourceId = source.getSourceId();
    this.#sources.set(sourceId, source);

    source.onCost(async (entry) => {
      try {
        await this.handleCostEvent(entry);
      } catch (error) {
        this.#logger.error?.('cost.ingestion.failed', { sourceId, error: error.message });
      }
    });

    this.#logger.info?.('cost.source.registered', { sourceId });
  }

  /**
   * Handle an incoming cost event
   * @param {CostEntry} entry
   */
  async handleCostEvent(entry) {
    await this.#costRepository.save(entry);
    this.#logger.info?.('cost.entry.saved', {
      id: entry.id,
      amount: entry.amount.amount,
      category: entry.category.toString()
    });

    if (this.#budgetService) {
      await this.#budgetService.evaluateBudgets(entry.attribution.householdId);
    }
  }

  /**
   * Pull costs from all sources for reconciliation
   * @param {string} [sourceId] - Specific source or all
   * @param {Date} [since] - Fetch costs since this date
   * @returns {Promise<{imported: number, skipped: number}>}
   */
  async reconcile(sourceId = null, since = null) {
    const sources = sourceId
      ? [this.#sources.get(sourceId)].filter(Boolean)
      : Array.from(this.#sources.values());

    let imported = 0;
    let skipped = 0;

    for (const source of sources) {
      try {
        const entries = await source.fetchCosts(since);
        // TODO: Dedupe against existing entries
        await this.#costRepository.saveBatch(entries);
        imported += entries.length;
      } catch (error) {
        this.#logger.error?.('cost.reconcile.failed', {
          sourceId: source.getSourceId(),
          error: error.message
        });
      }
    }

    return { imported, skipped };
  }
}

export default CostIngestionService;
```

**Step 3: Run tests**

Run: `npm test -- backend/tests/unit/suite/3_applications/cost/services/CostIngestionService.test.mjs`
Expected: PASS

**Step 4: Commit**

```bash
git add backend/src/3_applications/cost/services/CostIngestionService.mjs backend/tests/unit/suite/3_applications/cost/services/
git commit -m "feat(cost): add CostIngestionService for cost event handling

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 11: CostBudgetService

**Files:**
- Create: `backend/src/3_applications/cost/services/CostBudgetService.mjs`
- Test: `backend/tests/unit/suite/3_applications/cost/services/CostBudgetService.test.mjs`

**Step 1: Write failing tests**

```javascript
// backend/tests/unit/suite/3_applications/cost/services/CostBudgetService.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostBudgetService } from '../../../../../../src/3_applications/cost/services/CostBudgetService.mjs';
import { CostBudget } from '../../../../../../src/1_domains/cost/entities/CostBudget.mjs';
import { CostEntry } from '../../../../../../src/1_domains/cost/entities/CostEntry.mjs';
import { Money } from '../../../../../../src/1_domains/cost/value-objects/Money.mjs';
import { CostCategory } from '../../../../../../src/1_domains/cost/value-objects/CostCategory.mjs';
import { Attribution } from '../../../../../../src/1_domains/cost/value-objects/Attribution.mjs';
import { EntryType } from '../../../../../../src/1_domains/cost/value-objects/EntryType.mjs';
import { CostAnalysisService } from '../../../../../../src/1_domains/cost/services/CostAnalysisService.mjs';

describe('CostBudgetService', () => {
  let service;
  let mockBudgetRepo;
  let mockCostRepo;
  let mockAlertGateway;

  beforeEach(() => {
    mockBudgetRepo = {
      findAll: vi.fn().mockResolvedValue([
        new CostBudget({
          id: 'monthly-ai',
          name: 'AI Budget',
          category: CostCategory.fromString('ai'),
          period: 'monthly',
          amount: new Money(50),
          householdId: 'default'
        })
      ])
    };
    mockCostRepo = {
      findByPeriod: vi.fn().mockResolvedValue([])
    };
    mockAlertGateway = {
      sendAlert: vi.fn()
    };

    service = new CostBudgetService({
      budgetRepository: mockBudgetRepo,
      costRepository: mockCostRepo,
      alertGateway: mockAlertGateway,
      analysisService: new CostAnalysisService(),
      logger: { info: vi.fn(), warn: vi.fn() }
    });
  });

  describe('evaluateBudgets', () => {
    it('should return budget status for household', async () => {
      mockCostRepo.findByPeriod.mockResolvedValue([
        new CostEntry({
          id: '1',
          occurredAt: new Date(),
          amount: new Money(30),
          category: CostCategory.fromString('ai/openai'),
          entryType: EntryType.USAGE,
          attribution: new Attribution({ householdId: 'default' })
        })
      ]);

      const statuses = await service.evaluateBudgets('default');

      expect(statuses).toHaveLength(1);
      expect(statuses[0].budgetId).toBe('monthly-ai');
      expect(statuses[0].spent).toBe(30);
      expect(statuses[0].percentSpent).toBe(60);
    });

    it('should send alert when at warning level', async () => {
      mockCostRepo.findByPeriod.mockResolvedValue([
        new CostEntry({
          id: '1',
          occurredAt: new Date(),
          amount: new Money(45), // 90% of $50
          category: CostCategory.fromString('ai/openai'),
          entryType: EntryType.USAGE,
          attribution: new Attribution({ householdId: 'default' })
        })
      ]);

      await service.evaluateBudgets('default');

      expect(mockAlertGateway.sendAlert).toHaveBeenCalled();
    });
  });
});
```

**Step 2: Implement**

```javascript
// backend/src/3_applications/cost/services/CostBudgetService.mjs
import { CostAnalysisService } from '#domains/cost/services/CostAnalysisService.mjs';

/**
 * CostBudgetService - Evaluates budgets and triggers alerts
 * @class CostBudgetService
 */
export class CostBudgetService {
  #budgetRepository;
  #costRepository;
  #alertGateway;
  #analysisService;
  #logger;
  #lastAlerts;

  constructor({ budgetRepository, costRepository, alertGateway, analysisService, logger = console }) {
    if (!budgetRepository) throw new Error('budgetRepository is required');
    if (!costRepository) throw new Error('costRepository is required');

    this.#budgetRepository = budgetRepository;
    this.#costRepository = costRepository;
    this.#alertGateway = alertGateway;
    this.#analysisService = analysisService || new CostAnalysisService();
    this.#logger = logger;
    this.#lastAlerts = new Map(); // budgetId -> { warning: Date, critical: Date, pace: Date }
  }

  /**
   * Evaluate all budgets for a household
   * @param {string} householdId
   * @returns {Promise<BudgetStatus[]>}
   */
  async evaluateBudgets(householdId) {
    const budgets = await this.#budgetRepository.findAll(householdId);
    const statuses = [];

    for (const budget of budgets) {
      const status = await this.#evaluateBudget(budget);
      statuses.push(status);
      await this.#checkAndAlert(budget, status);
    }

    return statuses;
  }

  async #evaluateBudget(budget) {
    const period = budget.period;
    const start = period.getCurrentPeriodStart();
    const end = period.getCurrentPeriodEnd();

    const entries = await this.#costRepository.findByPeriod(start, end, {
      category: budget.category
    });

    const spent = this.#analysisService.calculateSpend(entries, {
      category: budget.category
    });

    return {
      budgetId: budget.id,
      budgetName: budget.name,
      spent: spent.amount,
      limit: budget.amount.amount,
      percentSpent: budget.getPercentSpent(spent),
      remaining: budget.getRemaining(spent).amount,
      isOverBudget: budget.isOverBudget(spent),
      isWarning: budget.isAtWarningLevel(spent),
      isCritical: budget.isAtCriticalLevel(spent),
      periodStart: start,
      periodEnd: end
    };
  }

  async #checkAndAlert(budget, status) {
    if (!this.#alertGateway) return;

    const key = budget.id;
    const lastAlert = this.#lastAlerts.get(key) || {};
    const now = new Date();

    if (status.isCritical && !this.#alertedThisPeriod(lastAlert.critical, status.periodStart)) {
      await this.#alertGateway.sendAlert({
        type: 'threshold',
        severity: 'critical',
        budget: budget.toJSON(),
        currentSpend: status.spent,
        message: `Budget "${budget.name}" exceeded: $${status.spent.toFixed(2)} / $${status.limit.toFixed(2)}`
      });
      lastAlert.critical = now;
      this.#lastAlerts.set(key, lastAlert);
    } else if (status.isWarning && !this.#alertedThisPeriod(lastAlert.warning, status.periodStart)) {
      await this.#alertGateway.sendAlert({
        type: 'threshold',
        severity: 'warning',
        budget: budget.toJSON(),
        currentSpend: status.spent,
        message: `Budget "${budget.name}" at ${status.percentSpent}%: $${status.spent.toFixed(2)} / $${status.limit.toFixed(2)}`
      });
      lastAlert.warning = now;
      this.#lastAlerts.set(key, lastAlert);
    }
  }

  #alertedThisPeriod(lastAlertDate, periodStart) {
    if (!lastAlertDate) return false;
    return lastAlertDate >= periodStart;
  }
}

export default CostBudgetService;
```

**Step 3: Run tests**

Run: `npm test -- backend/tests/unit/suite/3_applications/cost/services/CostBudgetService.test.mjs`
Expected: PASS

**Step 4: Commit**

```bash
git add backend/src/3_applications/cost/services/CostBudgetService.mjs backend/tests/unit/suite/3_applications/cost/services/CostBudgetService.test.mjs
git commit -m "feat(cost): add CostBudgetService with alert deduplication

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 12: CostReportingService + Application Index

**Files:**
- Create: `backend/src/3_applications/cost/services/CostReportingService.mjs`
- Create: `backend/src/3_applications/cost/services/index.mjs`
- Create: `backend/src/3_applications/cost/index.mjs`

**Step 1: Implement CostReportingService**

```javascript
// backend/src/3_applications/cost/services/CostReportingService.mjs
import { CostAnalysisService } from '#domains/cost/services/CostAnalysisService.mjs';
import { Money } from '#domains/cost/value-objects/Money.mjs';

/**
 * CostReportingService - Dashboard and reporting orchestration
 * @class CostReportingService
 */
export class CostReportingService {
  #costRepository;
  #budgetService;
  #analysisService;
  #logger;

  constructor({ costRepository, budgetService, analysisService, logger = console }) {
    if (!costRepository) throw new Error('costRepository is required');

    this.#costRepository = costRepository;
    this.#budgetService = budgetService;
    this.#analysisService = analysisService || new CostAnalysisService();
    this.#logger = logger;
  }

  /**
   * Get cost dashboard data
   * @param {string} householdId
   * @param {Object} period - { start: Date, end: Date }
   * @returns {Promise<CostDashboard>}
   */
  async getDashboard(householdId, period) {
    const entries = await this.#costRepository.findByPeriod(period.start, period.end, {
      excludeReconciliation: true
    });

    const totalSpend = this.#analysisService.calculateSpend(entries);
    const categoryBreakdown = this.#analysisService.getCategoryBreakdown(entries, 1);
    const budgetStatuses = this.#budgetService
      ? await this.#budgetService.evaluateBudgets(householdId)
      : [];

    return {
      period,
      totalSpend: totalSpend.amount,
      categoryBreakdown: Object.fromEntries(categoryBreakdown),
      budgetStatuses,
      entryCount: entries.length
    };
  }

  /**
   * Get spend by category with configurable depth
   * @param {string} householdId
   * @param {Object} period
   * @param {number} [depth=2]
   * @returns {Promise<CategorySpend[]>}
   */
  async getSpendByCategory(householdId, period, depth = 2) {
    const entries = await this.#costRepository.findByPeriod(period.start, period.end);
    const breakdown = this.#analysisService.getCategoryBreakdown(entries, depth);

    return Array.from(breakdown.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }

  /**
   * Get spend by user
   * @param {string} householdId
   * @param {Object} period
   * @returns {Promise<UserSpend[]>}
   */
  async getSpendByUser(householdId, period) {
    const entries = await this.#costRepository.findByPeriod(period.start, period.end);
    const breakdown = this.#analysisService.getUserBreakdown(entries);

    return Array.from(breakdown.entries())
      .map(([userId, amount]) => ({ userId, amount }))
      .sort((a, b) => b.amount - a.amount);
  }

  /**
   * Get spend by resource (devices)
   * @param {string} householdId
   * @param {Object} period
   * @returns {Promise<ResourceSpend[]>}
   */
  async getSpendByResource(householdId, period) {
    const entries = await this.#costRepository.findByPeriod(period.start, period.end);
    const breakdown = this.#analysisService.getResourceBreakdown(entries);

    return Array.from(breakdown.entries())
      .map(([resource, amount]) => ({ resource, amount }))
      .sort((a, b) => b.amount - a.amount);
  }

  /**
   * Get entries with pagination
   * @param {Object} filter
   * @param {Object} pagination - { page, limit }
   * @returns {Promise<{entries: CostEntry[], total: number}>}
   */
  async getEntries(filter, pagination = { page: 1, limit: 50 }) {
    const { start, end, ...rest } = filter;
    const entries = await this.#costRepository.findByPeriod(start, end, rest);

    const offset = (pagination.page - 1) * pagination.limit;
    const paginated = entries.slice(offset, offset + pagination.limit);

    return {
      entries: paginated.map(e => e.toJSON()),
      total: entries.length,
      page: pagination.page,
      limit: pagination.limit
    };
  }
}

export default CostReportingService;
```

```javascript
// backend/src/3_applications/cost/services/index.mjs
export { CostIngestionService } from './CostIngestionService.mjs';
export { CostBudgetService } from './CostBudgetService.mjs';
export { CostReportingService } from './CostReportingService.mjs';
```

```javascript
// backend/src/3_applications/cost/index.mjs
export * from './ports/index.mjs';
export * from './services/index.mjs';
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/cost/
git commit -m "feat(cost): add CostReportingService and application layer exports

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 3: Adapter Layer

### Task 13: YamlCostDatastore

**Files:**
- Create: `backend/src/2_adapters/cost/YamlCostDatastore.mjs`
- Test: `backend/tests/unit/suite/2_adapters/cost/YamlCostDatastore.test.mjs`

**Step 1: Write failing tests**

```javascript
// backend/tests/unit/suite/2_adapters/cost/YamlCostDatastore.test.mjs
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { YamlCostDatastore } from '../../../../../../src/2_adapters/cost/YamlCostDatastore.mjs';
import { CostEntry } from '../../../../../../src/1_domains/cost/entities/CostEntry.mjs';
import { Money } from '../../../../../../src/1_domains/cost/value-objects/Money.mjs';
import { CostCategory } from '../../../../../../src/1_domains/cost/value-objects/CostCategory.mjs';
import { Attribution } from '../../../../../../src/1_domains/cost/value-objects/Attribution.mjs';
import { EntryType } from '../../../../../../src/1_domains/cost/value-objects/EntryType.mjs';

describe('YamlCostDatastore', () => {
  let datastore;
  let mockIo;

  beforeEach(() => {
    mockIo = {
      read: vi.fn().mockResolvedValue([]),
      write: vi.fn().mockResolvedValue(undefined),
      ensureDir: vi.fn().mockResolvedValue(undefined)
    };
    datastore = new YamlCostDatastore({
      dataRoot: '/data/household/apps/cost',
      io: mockIo
    });
  });

  describe('save', () => {
    it('should save entry to correct month file', async () => {
      const entry = new CostEntry({
        id: '20260130143022-abc123',
        occurredAt: new Date('2026-01-30'),
        amount: new Money(10),
        category: CostCategory.fromString('ai/openai'),
        entryType: EntryType.USAGE,
        attribution: new Attribution({ householdId: 'default' })
      });

      await datastore.save(entry);

      expect(mockIo.write).toHaveBeenCalled();
      const [path] = mockIo.write.mock.calls[0];
      expect(path).toContain('2026-01');
      expect(path).toContain('entries.yml');
    });
  });

  describe('findByPeriod', () => {
    it('should return entries within period', async () => {
      const entryData = {
        id: '1',
        occurredAt: '2026-01-15T10:00:00Z',
        amount: 10,
        category: 'ai/openai',
        entryType: 'usage',
        attribution: { householdId: 'default' }
      };
      mockIo.read.mockResolvedValue([entryData]);

      const entries = await datastore.findByPeriod(
        new Date('2026-01-01'),
        new Date('2026-01-31')
      );

      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe('1');
    });
  });
});
```

**Step 2: Implement**

```javascript
// backend/src/2_adapters/cost/YamlCostDatastore.mjs
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import yaml from 'yaml';
import { CostEntry } from '#domains/cost/entities/CostEntry.mjs';
import { ICostRepository } from '#apps/cost/ports/ICostRepository.mjs';

/**
 * YamlCostDatastore - YAML file persistence for cost entries
 * @class YamlCostDatastore
 * @extends ICostRepository
 */
export class YamlCostDatastore extends ICostRepository {
  #dataRoot;
  #io;

  constructor({ dataRoot, io = null }) {
    super();
    if (!dataRoot) throw new Error('dataRoot is required');
    this.#dataRoot = dataRoot;
    this.#io = io || { read: this.#defaultRead, write: this.#defaultWrite, ensureDir: this.#defaultEnsureDir };
  }

  async save(entry) {
    const monthPath = this.#getMonthPath(entry.occurredAt);
    const filePath = join(monthPath, 'entries.yml');

    await this.#io.ensureDir(monthPath);
    const entries = await this.#readEntriesFile(filePath);

    const existingIndex = entries.findIndex(e => e.id === entry.id);
    if (existingIndex >= 0) {
      entries[existingIndex] = entry.toJSON();
    } else {
      entries.push(entry.toJSON());
    }

    await this.#io.write(filePath, entries);
  }

  async saveBatch(entries) {
    // Group by month
    const byMonth = new Map();
    for (const entry of entries) {
      const monthPath = this.#getMonthPath(entry.occurredAt);
      if (!byMonth.has(monthPath)) byMonth.set(monthPath, []);
      byMonth.get(monthPath).push(entry);
    }

    // Save each month's entries
    for (const [monthPath, monthEntries] of byMonth) {
      const filePath = join(monthPath, 'entries.yml');
      await this.#io.ensureDir(monthPath);
      const existing = await this.#readEntriesFile(filePath);

      for (const entry of monthEntries) {
        const existingIndex = existing.findIndex(e => e.id === entry.id);
        if (existingIndex >= 0) {
          existing[existingIndex] = entry.toJSON();
        } else {
          existing.push(entry.toJSON());
        }
      }

      await this.#io.write(filePath, existing);
    }
  }

  async findByPeriod(start, end, filter = {}) {
    const months = this.#getMonthsInRange(start, end);
    const allEntries = [];

    for (const month of months) {
      const filePath = join(this.#dataRoot, month, 'entries.yml');
      const entries = await this.#readEntriesFile(filePath);
      allEntries.push(...entries);
    }

    return allEntries
      .map(data => CostEntry.fromJSON(data))
      .filter(entry => {
        const occurred = entry.occurredAt;
        if (occurred < start || occurred > end) return false;

        if (filter.category && !filter.category.matches(entry.category)) return false;
        if (filter.userId && entry.attribution.userId !== filter.userId) return false;
        if (filter.excludeReconciliation !== false && entry.reconcilesUsage) return false;

        return true;
      });
  }

  async findByCategory(category, period) {
    return this.findByPeriod(period.start, period.end, { category });
  }

  async findByAttribution(attribution, period) {
    return this.findByPeriod(period.start, period.end, attribution);
  }

  async compact(olderThan) {
    // TODO: Implement compaction
    return { entriesCompacted: 0, rollupsCreated: 0, bytesArchived: 0 };
  }

  async archive(entries, path) {
    // TODO: Implement archiving
  }

  #getMonthPath(date) {
    const d = new Date(date);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return join(this.#dataRoot, month);
  }

  #getMonthsInRange(start, end) {
    const months = [];
    const current = new Date(start);
    current.setDate(1);

    while (current <= end) {
      const month = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
      months.push(month);
      current.setMonth(current.getMonth() + 1);
    }

    return months;
  }

  async #readEntriesFile(filePath) {
    try {
      return await this.#io.read(filePath);
    } catch (e) {
      return [];
    }
  }

  #defaultRead = async (path) => {
    if (!existsSync(path)) return [];
    const content = await readFile(path, 'utf8');
    return yaml.parse(content) || [];
  };

  #defaultWrite = async (path, data) => {
    await writeFile(path, yaml.stringify(data), 'utf8');
  };

  #defaultEnsureDir = async (path) => {
    await mkdir(path, { recursive: true });
  };
}

export default YamlCostDatastore;
```

**Step 3: Run tests**

Run: `npm test -- backend/tests/unit/suite/2_adapters/cost/YamlCostDatastore.test.mjs`
Expected: PASS

**Step 4: Commit**

```bash
git add backend/src/2_adapters/cost/YamlCostDatastore.mjs backend/tests/unit/suite/2_adapters/cost/
git commit -m "feat(cost): add YamlCostDatastore for YAML persistence

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 14: OpenAICostSource

**Files:**
- Create: `backend/src/2_adapters/cost/openai/OpenAICostSource.mjs`

**Step 1: Implement**

```javascript
// backend/src/2_adapters/cost/openai/OpenAICostSource.mjs
import { CostEntry } from '#domains/cost/entities/CostEntry.mjs';
import { Money } from '#domains/cost/value-objects/Money.mjs';
import { Usage } from '#domains/cost/value-objects/Usage.mjs';
import { CostCategory } from '#domains/cost/value-objects/CostCategory.mjs';
import { Attribution } from '#domains/cost/value-objects/Attribution.mjs';
import { EntryType } from '#domains/cost/value-objects/EntryType.mjs';
import { ICostSource } from '#apps/cost/ports/ICostSource.mjs';

/**
 * OpenAICostSource - Tracks costs from OpenAI API usage
 * @class OpenAICostSource
 * @extends ICostSource
 */
export class OpenAICostSource extends ICostSource {
  #rateConfig;
  #logger;
  #callbacks;

  constructor({ rateConfig, logger = console }) {
    super();
    this.#rateConfig = rateConfig;
    this.#logger = logger;
    this.#callbacks = [];
  }

  getSourceId() {
    return 'openai';
  }

  getSupportedCategories() {
    return [
      CostCategory.fromString('ai/openai/gpt-4o/chat'),
      CostCategory.fromString('ai/openai/gpt-4o-mini/chat'),
      CostCategory.fromString('ai/openai/whisper/transcription')
    ];
  }

  async fetchCosts(since) {
    // OpenAI doesn't provide a cost history API - costs tracked in real-time only
    return [];
  }

  onCost(callback) {
    this.#callbacks.push(callback);
  }

  /**
   * Track an OpenAI API call
   * Called by OpenAI adapter after each API request
   * @param {Object} usage - { model, promptTokens, completionTokens, totalTokens }
   * @param {Object} attribution - { householdId, userId, feature }
   */
  trackUsage({ model, promptTokens = 0, completionTokens = 0, totalTokens = 0 }, attribution) {
    const rates = this.#rateConfig[model] || this.#rateConfig.default;
    if (!rates) {
      this.#logger.warn?.('cost.openai.no_rate', { model });
      return;
    }

    const inputCost = (promptTokens / 1000) * rates.input_tokens;
    const outputCost = (completionTokens / 1000) * rates.output_tokens;
    const totalCost = inputCost + outputCost;

    const categoryPath = model.includes('whisper')
      ? 'ai/openai/whisper/transcription'
      : `ai/openai/${model}/chat`;

    const entry = new CostEntry({
      id: CostEntry.generateId(),
      occurredAt: new Date(),
      amount: new Money(totalCost),
      category: CostCategory.fromString(categoryPath),
      usage: new Usage(totalTokens || promptTokens + completionTokens, 'tokens'),
      entryType: EntryType.USAGE,
      attribution: new Attribution(attribution),
      metadata: {
        model,
        promptTokens,
        completionTokens
      }
    });

    for (const callback of this.#callbacks) {
      callback(entry);
    }

    return entry;
  }
}

export default OpenAICostSource;
```

**Step 2: Commit**

```bash
git add backend/src/2_adapters/cost/openai/
git commit -m "feat(cost): add OpenAICostSource for tracking token costs

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 15: Adapter Index + Bootstrap Integration

**Files:**
- Create: `backend/src/2_adapters/cost/index.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs` (add cost services)

**Step 1: Create adapter index**

```javascript
// backend/src/2_adapters/cost/index.mjs
export { YamlCostDatastore } from './YamlCostDatastore.mjs';
export { OpenAICostSource } from './openai/OpenAICostSource.mjs';
```

**Step 2: Add to bootstrap (find and update existing file)**

Read `backend/src/0_system/bootstrap.mjs` first, then add a `createCostServices` function.

**Step 3: Commit**

```bash
git add backend/src/2_adapters/cost/index.mjs
git commit -m "feat(cost): add adapter exports

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 4: API Layer

### Task 16: Cost Router

**Files:**
- Create: `backend/src/4_api/v1/routers/cost.mjs`

**Step 1: Implement**

```javascript
// backend/src/4_api/v1/routers/cost.mjs
import { Router } from 'express';

/**
 * Create cost API router
 * @param {Object} config
 * @param {CostReportingService} config.reportingService
 * @param {CostBudgetService} config.budgetService
 * @param {Object} [config.logger]
 */
export default function createCostRouter(config) {
  const { reportingService, budgetService, logger = console } = config;
  const router = Router();

  // GET /api/v1/cost/dashboard
  router.get('/dashboard', async (req, res, next) => {
    try {
      const { household = 'default', period } = req.query;
      const [year, month] = (period || getCurrentMonth()).split('-');

      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0, 23, 59, 59, 999);

      const dashboard = await reportingService.getDashboard(household, { start, end });
      res.json(dashboard);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/cost/spend/category
  router.get('/spend/category', async (req, res, next) => {
    try {
      const { household = 'default', period, depth = 2 } = req.query;
      const { start, end } = parsePeriod(period);

      const breakdown = await reportingService.getSpendByCategory(household, { start, end }, parseInt(depth));
      res.json(breakdown);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/cost/spend/user
  router.get('/spend/user', async (req, res, next) => {
    try {
      const { household = 'default', period } = req.query;
      const { start, end } = parsePeriod(period);

      const breakdown = await reportingService.getSpendByUser(household, { start, end });
      res.json(breakdown);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/cost/spend/resource
  router.get('/spend/resource', async (req, res, next) => {
    try {
      const { household = 'default', period } = req.query;
      const { start, end } = parsePeriod(period);

      const breakdown = await reportingService.getSpendByResource(household, { start, end });
      res.json(breakdown);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/cost/entries
  router.get('/entries', async (req, res, next) => {
    try {
      const { household = 'default', period, category, userId, page = 1, limit = 50 } = req.query;
      const { start, end } = parsePeriod(period);

      const filter = { start, end };
      if (category) filter.category = category;
      if (userId) filter.userId = userId;

      const result = await reportingService.getEntries(filter, {
        page: parseInt(page),
        limit: parseInt(limit)
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/cost/budgets
  router.get('/budgets', async (req, res, next) => {
    try {
      const { household = 'default' } = req.query;
      const statuses = await budgetService.evaluateBudgets(household);
      res.json(statuses);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function parsePeriod(period) {
  if (!period) {
    const [year, month] = getCurrentMonth().split('-');
    return {
      start: new Date(year, month - 1, 1),
      end: new Date(year, month, 0, 23, 59, 59, 999)
    };
  }

  if (period.includes('..')) {
    const [startStr, endStr] = period.split('..');
    return { start: new Date(startStr), end: new Date(endStr) };
  }

  const [year, month] = period.split('-');
  return {
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 0, 23, 59, 59, 999)
  };
}
```

**Step 2: Commit**

```bash
git add backend/src/4_api/v1/routers/cost.mjs
git commit -m "feat(cost): add cost API router with dashboard and breakdown endpoints

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 5: Integration

### Task 17: Wire Up in Server

**Files:**
- Modify: `backend/src/server.mjs` (mount cost router)
- Modify: `backend/src/0_system/bootstrap.mjs` (add createCostServices)

**Step 1: Read existing files and add cost wiring**

**Step 2: Commit**

```bash
git commit -m "feat(cost): integrate cost domain into server

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 18: Run Full Test Suite

**Step 1: Run all cost domain tests**

Run: `npm test -- backend/tests/unit/suite/**/cost/`
Expected: All PASS

**Step 2: Run full backend test suite**

Run: `npm test`
Expected: All existing tests still pass

---

## Future Phases (Not in This Plan)

The following are documented in the design but deferred:

- **Phase 6: HomeAssistantCostSource** - Power meter polling
- **Phase 7: FinanceCostSource** - Subscription spreading
- **Phase 8: TelnyxCostSource** - SMS/voice costs (after telco adapter)
- **Phase 9: CostCompactionService** - Rollup and archive
- **Phase 10: Full Reporting** - Trends, export, reconciliation views

---

## Summary

This plan implements the core cost domain in 18 tasks:

1. **Tasks 1-5**: Value objects (Money, Usage, CostCategory, Attribution, etc.)
2. **Tasks 6-8**: Entities (CostEntry, CostBudget) and domain service
3. **Tasks 9-12**: Application layer ports and services
4. **Tasks 13-15**: Adapter layer (YAML persistence, OpenAI source)
5. **Tasks 16-18**: API layer and integration

Each task follows TDD with tests first, then implementation, then commit.
