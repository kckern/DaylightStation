# Nutribot Architecture Design

> **Status:** Design Phase  
> **Last Updated:** December 2024  
> **Extends:** `_common.md`

---

## 1. Overview

Nutribot is a Telegram chatbot for food logging and nutrition tracking. Users can log food via photos, text descriptions, voice messages, or UPC barcode scans. The bot provides daily nutrition reports, macro breakdowns, and AI-powered coaching.

### 1.1 Data Model (Bronze/Silver/Gold)

| Tier | Entity | Storage Path | Purpose |
|------|--------|--------------|---------|
| **Bronze** | `NutriLog` | `nutribot/nutrilog/{chatId}.yaml` | Raw logging sessions (image/text/UPC submissions) |
| **Silver** | `NutriListItem` | `nutribot/nutrilist/{chatId}.yaml` | Validated, itemized food entries with macros |
| **Gold** | `NutriDay` | `nutribot/nutriday/{chatId}.yaml` | Pre-computed daily aggregates for fast reporting |

---

## 2. Domain Model

### 2.1 Value Objects (Nutribot-Specific)

```
┌─────────────────────────────────────────────────────────────────┐
│                    NUTRIBOT VALUE OBJECTS                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   NoomColor                                                     │
│   ├── GREEN  - Low calorie density (veggies, fruits)            │
│   ├── YELLOW - Moderate density (grains, dairy)                 │
│   └── ORANGE - High density (nuts, processed)                   │
│                                                                 │
│   Portion                                                       │
│   ├── amount: number                                            │
│   ├── unit: 'g' | 'ml' | 'oz' | 'cup' | 'tbsp' | 'serving'     │
│   └── scale(factor): Portion                                    │
│                                                                 │
│   MacroBreakdown                                                │
│   ├── calories: number                                          │
│   ├── protein: number (grams)                                   │
│   ├── carbs: number (grams)                                     │
│   ├── fat: number (grams)                                       │
│   ├── fiber: number (grams)                                     │
│   ├── sugar: number (grams)                                     │
│   ├── sodium: number (mg)                                       │
│   ├── cholesterol: number (mg)                                  │
│   └── scale(factor): MacroBreakdown                             │
│                                                                 │
│   TimeOfDay                                                     │
│   └── 'morning' | 'midday' | 'evening' | 'night'                │
│                                                                 │
│   FoodIcon                                                      │
│   └── One of ~200 predefined icon names (apple, burger, etc.)   │
│                                                                 │
│   ServingSize                                                   │
│   ├── quantity: number                                          │
│   └── label: string ('g', 'ml', 'serving', etc.)                │
│                                                                 │
│   UPC                                                           │
│   └── code: string (12-13 digit barcode)                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Entities

```
┌─────────────────────────────────────────────────────────────────┐
│                    NUTRIBOT ENTITIES                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   FoodItem                                                      │
│   ├── uuid: string                                              │
│   ├── item: string           (display name)                     │
│   ├── icon: FoodIcon                                            │
│   ├── portion: Portion                                          │
│   ├── noomColor: NoomColor                                      │
│   ├── macros: MacroBreakdown                                    │
│   └── withPortion(p): FoodItem  (immutable update)              │
│                                                                 │
│   NutriLog                                                      │
│   ├── uuid: string                                              │
│   ├── chatId: ChatId                                            │
│   ├── messageId: MessageId                                      │
│   ├── timestamp: Timestamp                                      │
│   ├── source: 'image' | 'text' | 'voice' | 'upc'                │
│   ├── status: NutriLogStatus                                    │
│   ├── rawInput: ImageInput | TextInput | UPCInput               │
│   ├── foodData: DetectedFood                                    │
│   └── revisions: Revision[]                                     │
│                                                                 │
│   NutriLogStatus (enum)                                         │
│   ├── INIT      - Just created, awaiting user action            │
│   ├── REVISING  - User requested changes                        │
│   ├── ACCEPTED  - User confirmed                                │
│   ├── DISCARDED - User rejected                                 │
│   ├── ASSUMED   - Auto-accepted after timeout                   │
│   └── CANCELED  - UPC cancelled without selection               │
│                                                                 │
│   NutriListItem (SILVER)                                        │
│   ├── uuid: string                                              │
│   ├── logUuid: string        (links to NutriLog)                │
│   ├── chatId: ChatId                                            │
│   ├── date: string (YYYY-MM-DD)                                 │
│   ├── timeOfDay: TimeOfDay                                      │
│   ├── foodItem: FoodItem                                        │
│   └── createdAt: Timestamp                                      │
│                                                                 │
│   NutriDay (GOLD)                                               │
│   ├── chatId: ChatId                                            │
│   ├── date: string (YYYY-MM-DD)                                 │
│   ├── itemUuids: string[]    (references to NutriListItem)      │
│   ├── totals: MacroBreakdown (pre-computed)                     │
│   ├── itemCount: number                                         │
│   ├── coachingGiven: boolean                                    │
│   ├── thresholdsCrossed: number[]                               │
│   ├── lastUpdated: Timestamp                                    │
│   └── reportMessageId: MessageId | null                         │
│                                                                 │
│   CoachingAdvice                                                │
│   ├── chatId: ChatId                                            │
│   ├── date: string (YYYY-MM-DD)                                 │
│   ├── threshold: number | null                                  │
│   ├── message: string                                           │
│   └── generatedAt: Timestamp                                    │
│                                                                 │
│   NutritionReport (transient, not persisted)                    │
│   ├── chatId: ChatId                                            │
│   ├── date: string (YYYY-MM-DD)                                 │
│   ├── items: NutriListItem[]                                    │
│   ├── totals: MacroBreakdown                                    │
│   ├── history: NutriDay[]    (past N days)                      │
│   └── generatedAt: Timestamp                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Data Tier Flow (Bronze → Silver → Gold)

```
┌─────────────────────────────────────────────────────────────────┐
│                    DATA TIER FLOW                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   USER INPUT (photo/text/voice/UPC)                             │
│         │                                                       │
│         ▼                                                       │
│   ┌─────────────────────────────────────────────┐               │
│   │  BRONZE: NutriLog                           │               │
│   │  Path: nutribot/nutrilog/{chatId}.yaml      │               │
│   │  - Raw input preserved                      │               │
│   │  - AI detection results (foodData)          │               │
│   │  - Status tracking (init→accepted)          │               │
│   └─────────────────────┬───────────────────────┘               │
│                         │ on Accept/Assume                      │
│                         ▼                                       │
│   ┌─────────────────────────────────────────────┐               │
│   │  SILVER: NutriListItem                      │               │
│   │  Path: nutribot/nutrilist/{chatId}.yaml     │               │
│   │  - Itemized food entries                    │               │
│   │  - Full macro breakdown                     │               │
│   │  - Linked to source NutriLog                │               │
│   └─────────────────────┬───────────────────────┘               │
│                         │ aggregate on change                   │
│                         ▼                                       │
│   ┌─────────────────────────────────────────────┐               │
│   │  GOLD: NutriDay                             │               │
│   │  Path: nutribot/nutriday/{chatId}.yaml      │               │
│   │  - Pre-computed daily totals                │               │
│   │  - Coaching state                           │               │
│   │  - Report metadata                          │               │
│   └─────────────────────────────────────────────┘               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.4 Entity Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                    ENTITY RELATIONSHIP DIAGRAM                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    ┌───────────────────┐                        │
│                    │     NutriLog      │                        │
│                    │  (logging session)│                        │
│                    └─────────┬─────────┘                        │
│                              │ 1:N                              │
│                              │ (one log → many list items)      │
│                              ▼                                  │
│                    ┌───────────────────┐                        │
│                    │   NutriListItem   │                        │
│                    │ (itemized food)   │                        │
│                    └─────────┬─────────┘                        │
│                              │ N:1                              │
│                              │ (many items → one day)           │
│                              ▼                                  │
│                    ┌───────────────────┐                        │
│                    │     NutriDay      │                        │
│                    │   (daily summary) │                        │
│                    └─────────┬─────────┘                        │
│                              │ 1:N                              │
│                              │ (one day → many coaching msgs)   │
│                              ▼                                  │
│                    ┌───────────────────┐                        │
│                    │  CoachingAdvice   │                        │
│                    │(threshold alerts) │                        │
│                    └───────────────────┘                        │
│                                                                 │
│   CONVERSATION STATE (ephemeral)                                │
│   ─────────────────────────────────────                         │
│   ConversationState                                             │
│   ├── revising: { uuid, messageId } | null                      │
│   └── adjusting: { level, date?, uuid?, offset? } | null        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Domain Services

```
┌─────────────────────────────────────────────────────────────────┐
│                    DOMAIN SERVICES                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   NutritionCalculator (pure)                                    │
│   ─────────────────────────────────────────────────────────     │
│   sumMacros(items: FoodItem[]): MacroBreakdown                  │
│   scaleMacros(macros, factor): MacroBreakdown                   │
│   calculateDailyTotals(items: NutriListItem[]): MacroBreakdown  │
│   percentageOfBudget(calories, budget): number                  │
│                                                                 │
│   ThresholdChecker (pure)                                       │
│   ─────────────────────────────────────────────────────────     │
│   checkThresholds(prev, current, thresholds[]): number | null   │
│   │  → Returns the threshold crossed (400, 1000, 1600) or null  │
│   │                                                             │
│   shouldGenerateCoaching(day: NutriDay, newCalories): boolean   │
│                                                                 │
│   FoodSorter (pure)                                             │
│   ─────────────────────────────────────────────────────────     │
│   byNoomColor(items): FoodItem[]                                │
│   │  → Green first, then yellow, then orange                    │
│   │                                                             │
│   byCalories(items): FoodItem[]                                 │
│   │  → Highest calories first                                   │
│   │                                                             │
│   byColorThenCalories(items): FoodItem[]                        │
│   │  → Within each color, sort by calories desc                 │
│                                                                 │
│   PortionAdjuster (pure)                                        │
│   ─────────────────────────────────────────────────────────     │
│   availableFactors(): number[]                                  │
│   │  → [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 1.25, 1.5, ...]      │
│   │                                                             │
│   displayFraction(factor): string                               │
│   │  → 0.5 → "½", 1.5 → "×1½", etc.                            │
│   │                                                             │
│   applyFactor(item: FoodItem, factor): FoodItem                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Port Interfaces (Nutribot-Specific)

### 4.1 IUPCGateway

```
┌─────────────────────────────────────────────────────────────────┐
│                    IUPCGateway                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   PURPOSE:                                                      │
│   Look up nutritional data from UPC barcodes via external APIs. │
│                                                                 │
│   METHODS:                                                      │
│   ─────────────────────────────────────────────────────────     │
│   lookup(upc: string): Promise<UPCResult | null>                │
│   │                                                             │
│   UPCResult:                                                    │
│   {                                                             │
│     label: string,                                              │
│     image: string | null,                                       │
│     nutrients: { calories, fat, carbs, protein, ... },          │
│     servingSizes: ServingSize[],                                │
│     servingsPerContainer: number,                               │
│     brand: string | null,                                       │
│     source: 'openfoodfacts' | 'edamam' | 'fatsecret'           │
│   }                                                             │
│                                                                 │
│   IMPLEMENTATIONS:                                              │
│   ─────────────────────────────────────────────────────────     │
│   • CompositeUPCGateway - Chains multiple providers             │
│     ├── OpenFoodFactsAdapter (free, community data)             │
│     ├── EdamamAdapter (API key required)                        │
│     └── FatSecretAdapter (API key required)                     │
│   • MockUPCGateway - Deterministic test responses               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 INutrilogRepository

```
┌─────────────────────────────────────────────────────────────────┐
│                    INutrilogRepository                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   EXTENDS: IRepository<NutriLog>                                │
│                                                                 │
│   ADDITIONAL METHODS:                                           │
│   ─────────────────────────────────────────────────────────     │
│   findByMessageId(chatId, messageId): Promise<NutriLog | null>  │
│   │                                                             │
│   findPendingUPC(chatId): Promise<NutriLog[]>                   │
│   │  → status = 'init' AND upc != null                          │
│   │                                                             │
│   findNeedingListing(chatId): Promise<NutriLog[]>               │
│   │  → status = 'accepted' AND not yet itemized                 │
│   │                                                             │
│   findRevising(chatId): Promise<NutriLog | null>                │
│   │  → status = 'revising' (should be max 1)                    │
│   │                                                             │
│   assumeOld(chatId, ageMinutes): Promise<{assumed, init}>       │
│   │  → Mark old 'init' items as 'assumed'                       │
│   │                                                             │
│   updateStatus(chatId, uuid, status, extra?): Promise<void>     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 INutrilistRepository (SILVER)

```
┌─────────────────────────────────────────────────────────────────┐
│                    INutrilistRepository                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   EXTENDS: IRepository<NutriListItem>                           │
│   STORAGE: nutribot/nutrilist/{chatId}.yaml via io.mjs          │
│                                                                 │
│   ADDITIONAL METHODS:                                           │
│   ─────────────────────────────────────────────────────────     │
│   findByDate(chatId, date): Promise<NutriListItem[]>            │
│   │                                                             │
│   findByLogUuid(chatId, logUuid): Promise<NutriListItem[]>      │
│   │                                                             │
│   findRecent(chatId, days): Promise<NutriListItem[]>            │
│   │                                                             │
│   clearByLogUuid(chatId, logUuid): Promise<void>                │
│   │  → Remove items when re-itemizing a log                     │
│   │                                                             │
│   saveMany(items: NutriListItem[]): Promise<void>               │
│   │                                                             │
│   getDailyTotals(chatId, date): Promise<MacroBreakdown>         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.4 INutriDayRepository (GOLD)

```
┌─────────────────────────────────────────────────────────────────┐
│                    INutriDayRepository                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   EXTENDS: IRepository<NutriDay>                                │
│   STORAGE: nutribot/nutriday/{chatId}.yaml via io.mjs           │
│                                                                 │
│   PURPOSE:                                                      │
│   Gold-tier aggregated data for fast report generation.         │
│   Updated whenever NutriListItem changes.                       │
│                                                                 │
│   METHODS:                                                      │
│   ─────────────────────────────────────────────────────────     │
│   getOrCreate(chatId, date): Promise<NutriDay>                  │
│   │  → Return existing or create new with zero totals           │
│   │                                                             │
│   updateTotals(chatId, date, totals: MacroBreakdown): Promise<void>
│   │  → Update pre-computed totals                               │
│   │                                                             │
│   addItemUuid(chatId, date, uuid): Promise<void>                │
│   │  → Track which items belong to this day                     │
│   │                                                             │
│   removeItemUuid(chatId, date, uuid): Promise<void>             │
│   │  → Remove item reference (on delete/move)                   │
│   │                                                             │
│   recordThresholdCrossed(chatId, date, threshold): Promise<void>│
│   │  → Track coaching thresholds                                │
│   │                                                             │
│   setReportMessageId(chatId, date, messageId): Promise<void>    │
│   │  → Track current report message for deletion                │
│   │                                                             │
│   getHistory(chatId, days): Promise<NutriDay[]>                 │
│   │  → Get past N days for history bar chart                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.5 IReportRenderer

```
┌─────────────────────────────────────────────────────────────────┐
│                    IReportRenderer                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   PURPOSE:                                                      │
│   Generate visual nutrition report images.                      │
│                                                                 │
│   METHODS:                                                      │
│   ─────────────────────────────────────────────────────────     │
│   renderDailyReport(report: NutritionReport): Promise<Buffer>   │
│   │  → PNG image buffer                                         │
│   │                                                             │
│   renderFoodCard(item: FoodItem, imageUrl?): Promise<Buffer>    │
│   │  → Card image for UPC items                                 │
│                                                                 │
│   IMPLEMENTATIONS:                                              │
│   ─────────────────────────────────────────────────────────     │
│   • CanvasReportRenderer - node-canvas based                    │
│   • MockReportRenderer   - Returns placeholder for tests        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Use Cases

### 5.1 Use Case Catalog

```
┌─────────────────────────────────────────────────────────────────┐
│                    NUTRIBOT USE CASES                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   FOOD LOGGING                                                  │
│   ─────────────────────────────────────────────────────────     │
│   UC-001: LogFoodFromImage                                      │
│   UC-002: LogFoodFromText                                       │
│   UC-003: LogFoodFromVoice                                      │
│   UC-004: LogFoodFromUPC                                        │
│                                                                 │
│   USER ACTIONS                                                  │
│   ─────────────────────────────────────────────────────────     │
│   UC-010: AcceptFoodLog                                         │
│   UC-011: DiscardFoodLog                                        │
│   UC-012: ReviseFoodLog                                         │
│   UC-013: SelectUPCPortion                                      │
│                                                                 │
│   ADJUSTMENTS                                                   │
│   ─────────────────────────────────────────────────────────     │
│   UC-020: StartAdjustmentFlow                                   │
│   UC-021: SelectDateForAdjustment                               │
│   UC-022: SelectItemForAdjustment                               │
│   UC-023: ApplyPortionAdjustment                                │
│   UC-024: DeleteListItem                                        │
│   UC-025: MoveItemToDate                                        │
│                                                                 │
│   REPORTING                                                     │
│   ─────────────────────────────────────────────────────────     │
│   UC-030: GenerateDailyReport                                   │
│   UC-031: GetReportAsJSON                                       │
│   UC-032: GetReportAsImage                                      │
│                                                                 │
│   COACHING                                                      │
│   ─────────────────────────────────────────────────────────     │
│   UC-040: GenerateThresholdCoaching                             │
│   UC-041: GenerateOnDemandCoaching                              │
│                                                                 │
│   COMMANDS                                                      │
│   ─────────────────────────────────────────────────────────     │
│   UC-050: HandleHelpCommand                                     │
│   UC-051: HandleReviewCommand                                   │
│   UC-052: HandleReportCommand                                   │
│   UC-053: HandleCoachCommand                                    │
│   UC-054: ConfirmAllPending                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Use Case Details

#### UC-001: LogFoodFromImage

```
┌─────────────────────────────────────────────────────────────────┐
│   UC-001: LogFoodFromImage                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ACTOR: User                                                   │
│   TRIGGER: User sends a photo to the bot                        │
│                                                                 │
│   PRECONDITIONS:                                                │
│   • Chat is valid                                               │
│   • Photo is accessible                                         │
│                                                                 │
│   FLOW:                                                         │
│   1. Delete user's original message (keep chat clean)           │
│   2. Send "Analyzing..." message with photo                     │
│   3. Convert image to base64 (resize if needed)                 │
│   4. Call AI gateway to detect food                             │
│   5. Create NutriLog entity with detected food                  │
│   6. Save NutriLog to repository                                │
│   7. Update message with detected items + Accept/Discard/Revise │
│   8. If auto-accept enabled & complete → trigger itemization    │
│                                                                 │
│   ALTERNATE FLOWS:                                              │
│   4a. AI returns empty food list                                │
│       → Update message with "No food detected"                  │
│       → Offer retry or discard                                  │
│   4b. AI call fails                                             │
│       → Retry up to 3 times                                     │
│       → On final failure, show error message                    │
│                                                                 │
│   POSTCONDITIONS:                                               │
│   • NutriLog exists with status 'init'                          │
│   • User sees detected food with action buttons                 │
│                                                                 │
│   DEPENDENCIES:                                                 │
│   • IMessagingGateway (send/update messages)                    │
│   • IAIGateway (detectFoodFromImage)                            │
│   • INutrilogRepository (save)                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### UC-004: LogFoodFromUPC

```
┌─────────────────────────────────────────────────────────────────┐
│   UC-004: LogFoodFromUPC                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ACTOR: User                                                   │
│   TRIGGER: User sends a numeric barcode string                  │
│                                                                 │
│   PRECONDITIONS:                                                │
│   • Message is all digits (UPC format)                          │
│                                                                 │
│   FLOW:                                                         │
│   1. Delete user's message                                      │
│   2. Look up UPC via UPC gateway                                │
│   3. If found with nutrition data:                              │
│      a. Call AI to classify (icon, noom color)                  │
│      b. Send image message with product photo + caption         │
│      c. Add portion selection keyboard                          │
│      d. Save NutriLog with status 'init'                        │
│   4. If found without nutrition data:                           │
│      → Show product info with "no data" message                 │
│   5. If not found:                                              │
│      → Show "UPC not found" error                               │
│                                                                 │
│   POSTCONDITIONS (success):                                     │
│   • NutriLog exists with UPC data and status 'init'             │
│   • User sees portion selection buttons                         │
│                                                                 │
│   DEPENDENCIES:                                                 │
│   • IMessagingGateway                                           │
│   • IUPCGateway (lookup)                                        │
│   • IAIGateway (classifyFoodItem)                               │
│   • INutrilogRepository                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### UC-013: SelectUPCPortion

```
┌─────────────────────────────────────────────────────────────────┐
│   UC-013: SelectUPCPortion                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ACTOR: User                                                   │
│   TRIGGER: User presses a portion button (0.5, 1, 2, etc.)      │
│                                                                 │
│   PRECONDITIONS:                                                │
│   • NutriLog exists for this message                            │
│   • NutriLog has UPC data                                       │
│   • Status is 'init'                                            │
│                                                                 │
│   FLOW:                                                         │
│   1. Look up NutriLog by message ID                             │
│   2. Parse portion factor from button data                      │
│   3. Scale nutrients by factor (domain service)                 │
│   4. Create NutriListItem with scaled data                      │
│   5. Save to nutrilist repository                               │
│   6. Update NutriLog status to 'accepted'                       │
│   7. Update message caption (remove buttons)                    │
│   8. Check if all pending items complete                        │
│   9. If complete → trigger report generation                    │
│                                                                 │
│   ALTERNATE FLOWS:                                              │
│   2a. Invalid factor (not a number)                             │
│       → Delete message, log warning                             │
│                                                                 │
│   POSTCONDITIONS:                                               │
│   • NutriListItem saved with correct macros                     │
│   • NutriLog status = 'accepted'                                │
│   • Message updated without buttons                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### UC-030: GenerateDailyReport

```
┌─────────────────────────────────────────────────────────────────┐
│   UC-030: GenerateDailyReport                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ACTOR: System (triggered after logging complete)              │
│   TRIGGER: All pending items accepted/discarded                 │
│                                                                 │
│   PRECONDITIONS:                                                │
│   • No pending NutriLogs for chat                               │
│   • At least one NutriListItem exists for today                 │
│                                                                 │
│   FLOW:                                                         │
│   1. Remove any existing report message                         │
│   2. Load today's NutriListItems                                │
│   3. Calculate totals (domain service)                          │
│   4. Load history (past 7 days)                                 │
│   5. Build NutritionReport entity                               │
│   6. Render report image (IReportRenderer)                      │
│   7. Send report image to chat                                  │
│   8. Check for threshold coaching                               │
│   9. If threshold crossed → generate & send coaching            │
│   10. Save report message ID as current report                  │
│                                                                 │
│   ALTERNATE FLOWS:                                              │
│   1a. No items for today                                        │
│       → Skip report generation                                  │
│   6a. Render fails                                              │
│       → Send text-only summary                                  │
│                                                                 │
│   POSTCONDITIONS:                                               │
│   • Report image visible in chat                                │
│   • Current report ID stored for cleanup                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Conversation Flows (State Machines)

### 6.1 Main Flow Router

```
┌─────────────────────────────────────────────────────────────────┐
│                    MAIN FLOW ROUTER                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   INCOMING EVENT                                                │
│        │                                                        │
│        ▼                                                        │
│   ┌─────────────────────────────────────────────────┐           │
│   │ Is conversation state "revising"?                │           │
│   └─────────────────┬───────────────────────────────┘           │
│                     │                                           │
│          ┌──────────┴──────────┐                                │
│          │ YES                 │ NO                             │
│          ▼                     ▼                                │
│   ┌─────────────┐      ┌─────────────────────────────┐          │
│   │  Process    │      │ Parse event type            │          │
│   │  Revision   │      │ (slash, text, image, voice, │          │
│   │  Input      │      │  callback_query, UPC)       │          │
│   └─────────────┘      └────────────┬────────────────┘          │
│                                     │                           │
│                    ┌────────────────┼────────────────┐          │
│                    ▼                ▼                ▼          │
│              ┌──────────┐    ┌──────────┐    ┌──────────┐       │
│              │  Slash   │    │   Input  │    │  Button  │       │
│              │ Command  │    │ (image/  │    │  Press   │       │
│              │ Handler  │    │text/voice│    │ Handler  │       │
│              │          │    │  /UPC)   │    │          │       │
│              └──────────┘    └──────────┘    └──────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Adjustment Flow State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│                    ADJUSTMENT FLOW                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   STATE: cursor.adjusting = { level, date?, uuid?, offset? }    │
│                                                                 │
│   LEVEL 0: Select Date                                          │
│   ────────────────────────────────────────────────              │
│   ┌────────────────────────────────────────────┐                │
│   │ Show date buttons:                          │                │
│   │ [☀️ Today] [Yesterday] [2 days ago] ...    │                │
│   │ [↩️ Done]                                   │                │
│   └────────────────────┬───────────────────────┘                │
│                        │ User selects date                      │
│                        ▼                                        │
│   LEVEL 1: Select Item                                          │
│   ────────────────────────────────────────────────              │
│   ┌────────────────────────────────────────────┐                │
│   │ Show items for selected date:               │                │
│   │ [Apple] [Banana] [Chicken] ...              │                │
│   │ [⏭️ Next] [☀️ Other Day] [↩️ Done]          │                │
│   └────────────────────┬───────────────────────┘                │
│                        │ User selects item                      │
│                        ▼                                        │
│   LEVEL 2: Select Action                                        │
│   ────────────────────────────────────────────────              │
│   ┌────────────────────────────────────────────┐                │
│   │ Show item details + actions:                │                │
│   │ 🟢 Apple (100g) - 52 cal                    │                │
│   │ [¼] [⅓] [½] [⅔] [¾]                        │                │
│   │ [×1¼] [×1½] [×2] [×3] [×4]                  │                │
│   │ [🗑️ Delete] [📅 Move Day] [↩️ Done]        │                │
│   └────────────────────┬───────────────────────┘                │
│                        │                                        │
│     ┌──────────────────┼──────────────────┐                     │
│     ▼                  ▼                  ▼                     │
│  [Factor]         [🗑️ Delete]       [📅 Move Day]              │
│     │                  │                  │                     │
│     │ Apply factor     │ Delete item      │ → LEVEL 3           │
│     │ & regenerate     │ & regenerate     │                     │
│     ▼                  ▼                  ▼                     │
│   EXIT               EXIT            LEVEL 3: Select New Date   │
│                                      ┌───────────────────────┐  │
│                                      │ [☀️ Today] [Yesterday]│  │
│                                      │ [↩️ Back]             │  │
│                                      └───────────┬───────────┘  │
│                                                  │               │
│                                                  ▼               │
│                                      Update date & regenerate   │
│                                                  │               │
│                                                  ▼               │
│                                                EXIT              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 Revision Flow State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│                    REVISION FLOW                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   STATE: cursor.revising = { uuid, messageId }                  │
│                                                                 │
│   ENTRY: User presses [🔄 Revise] button                        │
│   ────────────────────────────────────────────────              │
│   1. Set cursor.revising = { uuid, messageId }                  │
│   2. Update NutriLog status → 'revising'                        │
│   3. Update message keyboard → [🗒️ Input your revision:]        │
│                                                                 │
│   ACTIVE STATE                                                  │
│   ────────────────────────────────────────────────              │
│   ┌────────────────────────────────────────────┐                │
│   │ Awaiting text input from user              │                │
│   │                                            │                │
│   │ Any text message → process as revision     │                │
│   │ Any other input → route normally           │                │
│   └────────────────────┬───────────────────────┘                │
│                        │ User sends text                        │
│                        ▼                                        │
│   PROCESS REVISION                                              │
│   ────────────────────────────────────────────────              │
│   1. Clear cursor.revising                                      │
│   2. Delete user's text message                                 │
│   3. Show "Revising..." on original message                     │
│   4. Call AI with original context + revision text              │
│   5. Update NutriLog with new food data                         │
│   6. Show revised items with buttons                            │
│   7. Reset NutriLog status → 'init'                             │
│                                                                 │
│   EXIT: User can Accept/Discard/Revise again                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. AI Prompts Design

### 7.1 Food Detection Prompt (Image)

```
┌─────────────────────────────────────────────────────────────────┐
│                    IMAGE DETECTION PROMPT                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   SYSTEM:                                                       │
│   You are a nutrition analyzer. Given an image of food:         │
│   - Identify all food items visible                             │
│   - Estimate portion sizes in grams/ml                          │
│   - Classify each item by Noom color (green/yellow/orange)      │
│   - Assign an icon from the provided list                       │
│   - Return pure JSON, no markdown                               │
│                                                                 │
│   CONTEXT INJECTION:                                            │
│   - Current date/time/timezone                                  │
│   - List of valid icons (~200)                                  │
│   - Noom color definitions                                      │
│                                                                 │
│   OUTPUT SCHEMA:                                                │
│   {                                                             │
│     "date": "YYYY-MM-DD",                                       │
│     "time": "morning|midday|evening|night",                     │
│     "food": [                                                   │
│       {                                                         │
│         "icon": "apple",                                        │
│         "item": "Red Apple",                                    │
│         "amount": 150,                                          │
│         "unit": "g",                                            │
│         "noom_color": "green"                                   │
│       }                                                         │
│     ]                                                           │
│   }                                                             │
│                                                                 │
│   REVISION FLOW EXTENSION:                                      │
│   If previous attempt provided, include in context:             │
│   - Previous food list                                          │
│   - User's correction text                                      │
│   - Instruction to adjust without removing unless explicit      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Food Itemization Prompt

```
┌─────────────────────────────────────────────────────────────────┐
│                    ITEMIZATION PROMPT                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   PURPOSE:                                                      │
│   Expand food items with nutritional data (macros)              │
│                                                                 │
│   SYSTEM:                                                       │
│   Given a list of food items with name/amount/unit, add:        │
│   - calories, protein, carbs, fat (required)                    │
│   - fiber, sugar, sodium, cholesterol (optional)                │
│                                                                 │
│   INPUT:                                                        │
│   [                                                             │
│     { "icon": "apple", "item": "Apple", "amount": 100, ... }    │
│   ]                                                             │
│                                                                 │
│   OUTPUT:                                                       │
│   [                                                             │
│     {                                                           │
│       "icon": "apple",                                          │
│       "item": "Apple",                                          │
│       "amount": 100,                                            │
│       "unit": "g",                                              │
│       "noom_color": "green",                                    │
│       "calories": 52,                                           │
│       "protein": 0.3,                                           │
│       "carbs": 14,                                              │
│       "fat": 0.2,                                               │
│       "fiber": 2.4,                                             │
│       "sugar": 10,                                              │
│       "sodium": 1,                                              │
│       "cholesterol": 0                                          │
│     }                                                           │
│   ]                                                             │
│                                                                 │
│   FEW-SHOT EXAMPLES:                                            │
│   Include 3-4 examples covering:                                │
│   - Simple items (apple, egg)                                   │
│   - Complex dishes (burrito, stir fry)                          │
│   - Processed foods (protein bar)                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 Coaching Prompt

```
┌─────────────────────────────────────────────────────────────────┐
│                    COACHING PROMPT                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   TRIGGER: User crosses calorie threshold (400/1000/1600)       │
│   OR: User requests /coach command                              │
│                                                                 │
│   SYSTEM:                                                       │
│   You are a supportive nutrition coach. Provide:                │
│   - 2-3 sentences of encouragement                              │
│   - Acknowledge the milestone                                   │
│   - Guidance appropriate for calorie level                      │
│   - Positive, supportive tone                                   │
│                                                                 │
│   CONTEXT:                                                      │
│   {                                                             │
│     "threshold": 1000,                                          │
│     "dailyTotal": 1050,                                         │
│     "dailyBudget": 2000,                                        │
│     "remaining": 950,                                           │
│     "recentItems": ["Pizza (2 slices)", "Salad"]                │
│   }                                                             │
│                                                                 │
│   TONE GUIDELINES:                                              │
│   - At 400: "Great start to the day!"                           │
│   - At 1000: "Halfway there, mindful choices ahead"             │
│   - At 1600: "Getting close, choose wisely"                     │
│   - Over budget: "Tomorrow is a new day, no guilt"              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Report Image Design

```
┌─────────────────────────────────────────────────────────────────┐
│                    REPORT IMAGE LAYOUT                          │
│                    (1280 x 720 pixels)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                      HEADER                             │   │
│   │  📊 Daily Nutrition Report                              │   │
│   │  Friday, December 13, 2024                              │   │
│   └─────────────────────────────────────────────────────────┘   │
│   ┌───────────────────────┬─────────────────────────────────┐   │
│   │                       │                                 │   │
│   │      PIE CHART        │         FOOD LIST               │   │
│   │   (Macro Breakdown)   │   (Sorted by color, calories)   │   │
│   │                       │                                 │   │
│   │    🟡 Carbs: 45%      │   🟢 Salad 150g ......... 45cal │   │
│   │    🟠 Fat: 30%        │   🟢 Apple 100g ......... 52cal │   │
│   │    🔵 Protein: 25%    │   🟡 Rice 200g ......... 260cal │   │
│   │                       │   🟠 Pizza 2sl ......... 540cal │   │
│   │                       │                                 │   │
│   └───────────────────────┴─────────────────────────────────┘   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                    HISTORY BARS                         │   │
│   │  Past 7 days calorie trend                              │   │
│   │                                                         │   │
│   │   Mon  Tue  Wed  Thu  Fri  Sat  Sun                     │   │
│   │   ██   ██   ██   ██   ▓▓   --   --                      │   │
│   │  1800 2100 1950 2200 897                                │   │
│   │                                                         │   │
│   └─────────────────────────────────────────────────────────┘   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                      FOOTER                             │   │
│   │  Total: 897 cal | Budget: 2000 | Remaining: 1103       │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Directory Structure (Nutribot)

```
backend/chatbots/nutribot/
├── domain/                           # Nutribot-specific domain
│   ├── value-objects/
│   │   ├── NoomColor.mjs
│   │   ├── Portion.mjs
│   │   ├── MacroBreakdown.mjs
│   │   ├── TimeOfDay.mjs
│   │   ├── FoodIcon.mjs
│   │   └── index.mjs
│   │
│   ├── entities/
│   │   ├── FoodItem.mjs
│   │   ├── NutriLog.mjs
│   │   ├── NutriListItem.mjs
│   │   ├── NutriDay.mjs
│   │   ├── CoachingAdvice.mjs
│   │   ├── NutritionReport.mjs
│   │   └── index.mjs
│   │
│   ├── services/
│   │   ├── NutritionCalculator.mjs
│   │   ├── ThresholdChecker.mjs
│   │   ├── FoodSorter.mjs
│   │   ├── PortionAdjuster.mjs
│   │   └── index.mjs
│   │
│   └── index.mjs
│
├── application/
│   ├── ports/
│   │   ├── IUPCGateway.mjs
│   │   ├── INutrilogRepository.mjs
│   │   ├── INutrilistRepository.mjs
│   │   ├── IReportRenderer.mjs
│   │   └── index.mjs
│   │
│   ├── usecases/
│   │   ├── logging/
│   │   │   ├── LogFoodFromImage.mjs
│   │   │   ├── LogFoodFromText.mjs
│   │   │   ├── LogFoodFromVoice.mjs
│   │   │   └── LogFoodFromUPC.mjs
│   │   ├── actions/
│   │   │   ├── AcceptFoodLog.mjs
│   │   │   ├── DiscardFoodLog.mjs
│   │   │   ├── ReviseFoodLog.mjs
│   │   │   └── SelectUPCPortion.mjs
│   │   ├── adjustments/
│   │   │   ├── StartAdjustmentFlow.mjs
│   │   │   ├── SelectDateForAdjustment.mjs
│   │   │   ├── ApplyPortionAdjustment.mjs
│   │   │   └── MoveItemToDate.mjs
│   │   ├── reporting/
│   │   │   ├── GenerateDailyReport.mjs
│   │   │   └── GetReportAsImage.mjs
│   │   ├── coaching/
│   │   │   ├── GenerateThresholdCoaching.mjs
│   │   │   └── GenerateOnDemandCoaching.mjs
│   │   ├── commands/
│   │   │   ├── HandleHelpCommand.mjs
│   │   │   ├── HandleReviewCommand.mjs
│   │   │   └── ConfirmAllPending.mjs
│   │   └── index.mjs
│   │
│   ├── mappers/
│   │   ├── FoodItemMapper.mjs       # DTO ↔ Entity
│   │   └── NutriLogMapper.mjs
│   │
│   └── index.mjs
│
├── infrastructure/
│   ├── upc/
│   │   ├── CompositeUPCGateway.mjs
│   │   ├── OpenFoodFactsAdapter.mjs
│   │   ├── EdamamAdapter.mjs
│   │   └── FatSecretAdapter.mjs
│   │
│   ├── persistence/
│   │   ├── FileNutrilogRepository.mjs
│   │   ├── FileNutrilistRepository.mjs
│   │   └── FileNutriDayRepository.mjs
│   │
│   ├── rendering/
│   │   └── CanvasReportRenderer.mjs
│   │
│   ├── ai/
│   │   └── NutribotAIGateway.mjs    # Wraps common AI with nutribot prompts
│   │
│   └── index.mjs
│
├── adapters/
│   └── EventRouter.mjs              # Routes webhook events to use cases
│
├── handlers/                        # HTTP handlers (thin)
│   ├── webhook.mjs
│   ├── report.mjs
│   ├── reportImg.mjs
│   └── coach.mjs
│
├── container.mjs                    # Dependency injection setup
├── server.mjs                       # Express router
└── config.mjs                       # Nutribot-specific config schema
```

### NOTE: Tests are in `backend/chatbots/_tests/nutribot/`
See `_common.md` Section 7 for test structure.

---

## 10. Configuration Schema (Nutribot)

```yaml
# config/nutribot.yml
extends: _common.yml

telegram:
  token: ${TELEGRAM_NUTRIBOT_TOKEN}
  botId: ${NUTRIBOT_BOT_ID}

openai:
  model: gpt-4o
  maxTokens: 1000
  timeout: 60000

upc:
  providers:
    - name: openfoodfacts
      enabled: true
    - name: edamam
      enabled: true
      appId: ${ED_APP_ID}
      appKey: ${ED_APP_KEY}
    - name: fatsecret
      enabled: false

reporting:
  calorieThresholds: [400, 1000, 1600]
  dailyBudget: 2000
  historyDays: 7
  autoGenerateOnComplete: true

coaching:
  enabled: true
  onThreshold: true
  onDemand: true

rateLimit:
  gptCallsPerMinute: 20
  reportGenerationCooldownSeconds: 10

paths:
  nutrilogStore: journalist/nutribot/nutrilogs
  nutrilistStore: journalist/nutribot/nutrilists
  cursorStore: journalist/nutribot/nutricursors
  coachStore: journalist/nutribot/nutricoach
```

---

*This document details the Nutribot-specific design. See `_common.md` for shared architecture and `journalist.md` for the Journalist bot design.*
