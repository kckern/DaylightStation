# Phase 3: Nutribot Domain & Core Use Cases

> **Phase:** 3 of 6  
> **Duration:** Week 5-6  
> **Dependencies:** Phase 2 (Ports & Infrastructure)  
> **Deliverables:** `nutribot/domain/`, core use cases, tests in `_tests/nutribot/`

---

## Critical Constraints

1. **All tests MUST be in `backend/chatbots/_tests/nutribot/`** - not in module folders
2. **All repositories MUST use `loadFile`/`saveFile` from `backend/lib/io.mjs`**
3. **Data Model Tiers:**
   - **Bronze (NutriLog):** `nutribot/nutrilog/{chatId}.yaml` - raw input
   - **Silver (NutriListItem):** `nutribot/nutrilist/{chatId}.yaml` - validated items
   - **Gold (NutriDay):** `nutribot/nutriday/{chatId}.yaml` - daily aggregates
4. **Phase is ONLY complete when `npm test -- --grep "Phase3"` passes**

---

## Objectives

1. Implement Nutribot domain model (value objects, entities, services)
2. Implement Nutribot-specific port interfaces
3. Implement Nutribot-specific repository adapters (using io.mjs)
4. Implement core food logging use cases
5. Wire up container with dependency injection
6. **Create corresponding tests in `_tests/nutribot/domain/` and `_tests/nutribot/usecases/`**

---

## Task Breakdown

### 3.1 Nutribot Value Objects

**File:** `nutribot/domain/value-objects/NoomColor.mjs`

```
PURPOSE: Calorie density classification

ENUM: NoomColor
├── GREEN = 'green'   // Low density (veggies, fruits)
├── YELLOW = 'yellow' // Moderate density (grains, dairy)
└── ORANGE = 'orange' // High density (nuts, oils)

FUNCTIONS:
├── isValidNoomColor(color: string): boolean
├── noomColorEmoji(color: NoomColor): string
│   - green → '🟢', yellow → '🟡', orange → '🟠'
├── noomColorSortOrder(color: NoomColor): number
│   - green → 0, yellow → 1, orange → 2
└── noomColorFromCalorieDensity(calPerGram: number): NoomColor
    - < 1.0 → green
    - 1.0-2.5 → yellow
    - > 2.5 → orange

TESTS:
- All enum values valid
- Emoji mapping correct
- Sort order correct
- Density classification boundaries
```

**File:** `nutribot/domain/value-objects/Portion.mjs`

```
PURPOSE: Amount and unit for food portions

CLASS: Portion
├── VALID_UNITS = ['g', 'ml', 'oz', 'cup', 'tbsp', 'tsp', 'piece', 'slice', 'serving']
│
├── #amount: number (private)
├── #unit: string (private)
│
├── constructor(amount: number, unit: string)
│   - Validate amount >= 0
│   - Validate unit in VALID_UNITS
│   - Freeze
│
├── get amount(): number
├── get unit(): string
├── toString(): string → "100g"
├── scale(factor: number): Portion
│   - Return new Portion with scaled amount
└── equals(other: Portion): boolean

TESTS:
- Creates valid Portion
- Rejects negative amount
- Rejects invalid unit
- scale() creates new instance
- Immutable
```

**File:** `nutribot/domain/value-objects/MacroBreakdown.mjs`

```
PURPOSE: Nutritional macro values

CLASS: MacroBreakdown
├── #calories: number
├── #protein: number (grams)
├── #carbs: number (grams)
├── #fat: number (grams)
├── #fiber: number (grams, optional)
├── #sugar: number (grams, optional)
├── #sodium: number (mg, optional)
├── #cholesterol: number (mg, optional)
│
├── constructor(props)
│   - Validate all numbers >= 0
│   - Default optional to 0
│   - Freeze
│
├── get calories(): number
├── get protein(): number
├── ... (all getters)
│
├── scale(factor: number): MacroBreakdown
│   - Scale all values
│   - Round to 2 decimal places
│
├── add(other: MacroBreakdown): MacroBreakdown
│   - Sum all values
│
├── toJSON(): object
│
└── static sum(breakdowns: MacroBreakdown[]): MacroBreakdown
    - Reduce to single breakdown

TESTS:
- Creates valid breakdown
- Rejects negative values
- scale() scales all fields
- add() sums correctly
- sum() aggregates array
- Immutable
```

**File:** `nutribot/domain/value-objects/TimeOfDay.mjs`

```
PURPOSE: Meal time classification

ENUM: TimeOfDay
├── MORNING = 'morning'   // 5:00 - 11:00
├── MIDDAY = 'midday'     // 11:00 - 14:00
├── EVENING = 'evening'   // 14:00 - 21:00
└── NIGHT = 'night'       // 21:00 - 5:00

FUNCTIONS:
├── isValidTimeOfDay(time: string): boolean
├── timeOfDayFromHour(hour: number): TimeOfDay
└── timeOfDayEmoji(time: TimeOfDay): string
    - morning → '🌅', midday → '☀️', evening → '🌆', night → '🌙'

TESTS:
- All enum values valid
- Hour boundaries correct
- Emoji mapping correct
```

**File:** `nutribot/domain/value-objects/ServingSize.mjs`

```
PURPOSE: UPC serving size information

CLASS: ServingSize
├── #quantity: number
├── #label: string
│
├── constructor(quantity: number, label: string)
├── get quantity(): number
├── get label(): string
├── toString(): string → "100g" or "1 serving"
│
└── static fromUPCData(data: object): ServingSize[]
    - Parse various UPC API formats

TESTS:
- Creates valid ServingSize
- Parses different UPC formats
```

---

### 3.2 Nutribot Entities

**File:** `nutribot/domain/entities/FoodItem.mjs`

```
PURPOSE: Single food item with nutrition data

CLASS: FoodItem
├── #uuid: string
├── #item: string (display name)
├── #icon: string (icon name)
├── #portion: Portion
├── #noomColor: NoomColor
├── #macros: MacroBreakdown
│
├── constructor(props)
│   - Generate uuid if not provided
│   - Validate all fields
│   - Freeze
│
├── get uuid(): string
├── get item(): string
├── get icon(): string
├── get portion(): Portion
├── get noomColor(): NoomColor
├── get macros(): MacroBreakdown
├── get calories(): number → this.macros.calories
│
├── withPortion(newPortion: Portion): FoodItem
│   1. Calculate scale factor
│   2. Scale macros
│   3. Return new FoodItem with new portion and scaled macros
│
├── withIcon(icon: string): FoodItem
├── withNoomColor(color: NoomColor): FoodItem
│
├── toJSON(): object
│
└── static fromGPTResponse(data: object): FoodItem
    - Parse GPT detection format
    - Create FoodItem with defaults for missing fields

TESTS:
- Creates valid FoodItem
- withPortion() scales macros correctly
- Immutable
- fromGPTResponse() handles various formats
```

**File:** `nutribot/domain/entities/NutriLog.mjs`

```
PURPOSE: Single food logging session (one photo/text/UPC submission)

CLASS: NutriLog
├── #uuid: string
├── #chatId: ChatId
├── #messageId: MessageId | null
├── #timestamp: Timestamp
├── #source: 'image' | 'text' | 'voice' | 'upc'
├── #status: NutriLogStatus
├── #rawInput: object (ImageInput | TextInput | UPCInput)
├── #foodData: object (detected food from GPT)
├── #revisions: Revision[]
│
├── ENUM NutriLogStatus:
│   ├── INIT = 'init'
│   ├── REVISING = 'revising'
│   ├── ACCEPTED = 'accepted'
│   ├── DISCARDED = 'discarded'
│   ├── ASSUMED = 'assumed'
│   └── CANCELED = 'canceled'
│
├── constructor(props)
├── get uuid(): string
├── ... (all getters)
│
├── withStatus(status: NutriLogStatus): NutriLog
├── withMessageId(messageId: MessageId): NutriLog
├── withFoodData(foodData: object): NutriLog
├── addRevision(revision: Revision): NutriLog
│
├── getFoodItems(): FoodItem[]
│   - Parse foodData into FoodItem array
│
├── toJSON(): object
│
└── static create(chatId, source, rawInput): NutriLog
    - Create new NutriLog with generated uuid and INIT status

TESTS:
- Creates valid NutriLog
- Status transitions work
- getFoodItems() parses correctly
- Immutable
```

**File:** `nutribot/domain/entities/NutriListItem.mjs`

```
PURPOSE: Itemized food entry with full nutrition (persisted after acceptance)

CLASS: NutriListItem
├── #uuid: string
├── #logUuid: string (reference to originating NutriLog)
├── #chatId: ChatId
├── #date: string (YYYY-MM-DD)
├── #timeOfDay: TimeOfDay
├── #foodItem: FoodItem
├── #createdAt: Timestamp
│
├── constructor(props)
├── get uuid(): string
├── ... (all getters)
│
├── withDate(date: string): NutriListItem
├── withTimeOfDay(timeOfDay: TimeOfDay): NutriListItem
├── withFoodItem(foodItem: FoodItem): NutriListItem
│
├── toJSON(): object
│
└── static fromNutriLog(nutriLog: NutriLog, foodItem: FoodItem, date: string, timeOfDay: TimeOfDay): NutriListItem

TESTS:
- Creates valid NutriListItem
- Links to NutriLog correctly
- Immutable
```

**File:** `nutribot/domain/entities/NutritionReport.mjs`

```
PURPOSE: Daily nutrition summary for report generation

CLASS: NutritionReport
├── #chatId: ChatId
├── #date: string
├── #items: NutriListItem[]
├── #totals: MacroBreakdown
├── #history: DayHistory[] (past N days)
├── #generatedAt: Timestamp
│
├── constructor(props)
│   - Calculate totals from items if not provided
│
├── get chatId(): ChatId
├── get date(): string
├── get items(): NutriListItem[]
├── get totals(): MacroBreakdown
├── get history(): DayHistory[]
│
├── getItemsSortedByCalories(): NutriListItem[]
├── getItemsSortedByNoomColor(): NutriListItem[]
│
├── getMacroPercentages(): { protein, carbs, fat }
│   - Calculate percentage of calories from each macro
│
└── toJSON(): object

TYPE: DayHistory
├── date: string
├── totalCalories: number
└── itemCount: number

TESTS:
- Calculates totals correctly
- Sorting works
- Macro percentages correct
```

---

### 3.3 Nutribot Domain Services

**File:** `nutribot/domain/services/NutritionCalculator.mjs`

```
PURPOSE: Pure functions for nutrition calculations

FUNCTIONS:
├── sumMacros(items: FoodItem[]): MacroBreakdown
│   - Aggregate all item macros
│
├── scaleMacros(macros: MacroBreakdown, factor: number): MacroBreakdown
│
├── calculateDailyTotals(items: NutriListItem[]): MacroBreakdown
│
├── percentageOfBudget(calories: number, budget: number): number
│   - Return 0-100+ percentage
│
├── macroPercentages(macros: MacroBreakdown): { protein, carbs, fat }
│   - Protein: 4 cal/g, Carbs: 4 cal/g, Fat: 9 cal/g
│
└── caloriesFromMacros(protein: number, carbs: number, fat: number): number

TESTS:
- All calculations correct
- Edge cases (zero values, empty arrays)
```

**File:** `nutribot/domain/services/ThresholdChecker.mjs`

```
PURPOSE: Detect calorie threshold crossings for coaching

FUNCTIONS:
├── checkThresholds(previousCalories: number, currentCalories: number, thresholds: number[]): number | null
│   - Return first threshold crossed, or null
│   - thresholds default: [400, 1000, 1600]
│
├── shouldGenerateCoaching(day: NutriDay, newCalories: number, thresholds: number[]): boolean
│   - Check if adding newCalories crosses a threshold not yet coached
│
└── getNextThreshold(currentCalories: number, thresholds: number[]): number | null
    - Return next threshold to be crossed

TESTS:
- Crossing 400 from 350→450 returns 400
- Crossing multiple thresholds returns first
- No crossing returns null
```

**File:** `nutribot/domain/services/FoodSorter.mjs`

```
PURPOSE: Sort food items for display

FUNCTIONS:
├── byNoomColor(items: FoodItem[]): FoodItem[]
│   - Green first, then yellow, then orange
│
├── byCalories(items: FoodItem[]): FoodItem[]
│   - Highest calories first
│
├── byColorThenCalories(items: FoodItem[]): FoodItem[]
│   - Sort by color, then by calories within each color
│
└── byTimeOfDay(items: NutriListItem[]): NutriListItem[]
    - Morning → midday → evening → night

TESTS:
- Each sort order correct
- Stable sort within groups
```

**File:** `nutribot/domain/services/PortionAdjuster.mjs`

```
PURPOSE: Portion adjustment utilities

FUNCTIONS:
├── availableFactors(): number[]
│   - Return [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0]
│
├── displayFraction(factor: number): string
│   - 0.25 → '¼'
│   - 0.5 → '½'
│   - 1.5 → '×1½'
│   - 2.0 → '×2'
│
├── parseFraction(str: string): number
│   - Parse display fraction back to number
│
└── buildPortionKeyboard(factors?: number[]): string[][]
    - Build keyboard button layout
    - Include delete and done buttons

TESTS:
- Display/parse roundtrip
- Keyboard layout correct
```

---

### 3.4 Nutribot-Specific Ports

**File:** `nutribot/application/ports/IUPCGateway.mjs`

```
INTERFACE: IUPCGateway

METHODS:
├── lookup(upc: string): Promise<UPCResult | null>
│
└── TYPE UPCResult:
    {
      label: string,
      image: string | null,
      nutrients: { calories, fat, carbs, protein, ... },
      servingSizes: ServingSize[],
      servingsPerContainer: number,
      brand: string | null,
      source: 'openfoodfacts' | 'edamam' | 'fatsecret'
    }
```

**File:** `nutribot/application/ports/INutrilogRepository.mjs`

```
INTERFACE: INutrilogRepository extends IRepository<NutriLog>

ADDITIONAL METHODS:
├── findByMessageId(chatId: ChatId, messageId: MessageId): Promise<NutriLog | null>
├── findPendingUPC(chatId: ChatId): Promise<NutriLog[]>
├── findNeedingListing(chatId: ChatId): Promise<NutriLog[]>
├── findRevising(chatId: ChatId): Promise<NutriLog | null>
├── assumeOld(chatId: ChatId, ageMinutes: number): Promise<{ assumed: string[], init: string[] }>
└── updateStatus(chatId: ChatId, uuid: string, status: NutriLogStatus, extra?: object): Promise<void>
```

**File:** `nutribot/application/ports/INutrilistRepository.mjs`

```
INTERFACE: INutrilistRepository extends IRepository<NutriListItem>

ADDITIONAL METHODS:
├── findByDate(chatId: ChatId, date: string): Promise<NutriListItem[]>
├── findByLogUuid(chatId: ChatId, logUuid: string): Promise<NutriListItem[]>
├── findRecent(chatId: ChatId, days: number): Promise<NutriListItem[]>
├── clearByLogUuid(chatId: ChatId, logUuid: string): Promise<void>
├── saveMany(items: NutriListItem[]): Promise<void>
└── getDailyTotals(chatId: ChatId, date: string): Promise<MacroBreakdown>
```

**File:** `nutribot/application/ports/IReportRenderer.mjs`

```
INTERFACE: IReportRenderer

METHODS:
├── renderDailyReport(report: NutritionReport): Promise<Buffer>
│   - Return PNG image buffer
│
└── renderFoodCard(item: FoodItem, imageUrl?: string): Promise<Buffer>
    - Return card image for UPC items
```

---

### 3.5 Core Use Cases

**File:** `nutribot/application/usecases/LogFoodFromImage.mjs`

```
CLASS: LogFoodFromImage
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - aiGateway: IAIGateway
│   - nutrilogRepository: INutrilogRepository
│   - logger: Logger
│
├── async execute(input: { chatId, imageUrl, messageId? }): Promise<Result>
│   1. Delete original user message (if messageId provided)
│   2. Send "Analyzing..." message with thumbnail
│   3. Call aiGateway.chatWithImage() for food detection
│   4. Parse response into FoodItems
│   5. Create NutriLog with INIT status
│   6. Save NutriLog
│   7. Update message with food list and Accept/Discard/Revise buttons
│   8. Return { success: true, nutrilogUuid, messageId }
│
├── PRIVATE:
│   ├── #buildDetectionPrompt(): ChatMessage[]
│   ├── #formatFoodList(foodData): string
│   └── #buildActionButtons(): string[][]

TESTS (with mocks):
- Creates NutriLog on success
- Handles empty food detection
- Handles AI errors
- Message updated with correct format
```

**File:** `nutribot/application/usecases/LogFoodFromText.mjs`

```
CLASS: LogFoodFromText
├── constructor(deps) - same as LogFoodFromImage
│
├── async execute(input: { chatId, text, messageId? }): Promise<Result>
│   1. Delete original user message
│   2. Send "Analyzing..." message
│   3. Call aiGateway.chat() for food detection (text-only)
│   4. Parse response
│   5. Create and save NutriLog
│   6. Update message with buttons
│
└── PRIVATE: similar to LogFoodFromImage

TESTS:
- Creates NutriLog on success
- Handles various text formats
- Handles empty detection
```

**File:** `nutribot/application/usecases/LogFoodFromUPC.mjs`

```
CLASS: LogFoodFromUPC
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - upcGateway: IUPCGateway
│   - aiGateway: IAIGateway (for classification)
│   - nutrilogRepository: INutrilogRepository
│   - logger: Logger
│
├── async execute(input: { chatId, upc, messageId? }): Promise<Result>
│   1. Delete original user message
│   2. Call upcGateway.lookup()
│   3. If not found → send error message, return
│   4. Call aiGateway to classify (icon, noom color)
│   5. Send image message with product photo and caption
│   6. Add portion selection keyboard
│   7. Create and save NutriLog with UPC data
│   8. Return result
│
└── PRIVATE:
    ├── #buildCaption(upcResult, classification): string
    └── #buildPortionKeyboard(servingSizes): string[][]

TESTS:
- Creates NutriLog on UPC found
- Handles UPC not found
- Handles missing nutrition data
- Portion keyboard correct
```

**File:** `nutribot/application/usecases/AcceptFoodLog.mjs`

```
CLASS: AcceptFoodLog
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - aiGateway: IAIGateway
│   - nutrilogRepository: INutrilogRepository
│   - nutrilistRepository: INutrilistRepository
│   - logger: Logger
│
├── async execute(input: { chatId, nutrilogUuid, messageId }): Promise<Result>
│   1. Load NutriLog by uuid
│   2. If not found or wrong status → error
│   3. Update status to ACCEPTED
│   4. Call aiGateway.chatWithJson() to itemize (add macros)
│   5. Create NutriListItem for each food
│   6. Save to nutrilist
│   7. Update message (remove buttons, add ✅)
│   8. Check if all pending complete
│   9. If complete → trigger report generation
│   10. Return result
│
└── PRIVATE:
    ├── #itemizeFoodData(foodData): Promise<FoodItem[]>
    └── #checkAllComplete(chatId): Promise<boolean>

TESTS:
- Updates status correctly
- Creates NutriListItems
- Triggers report when complete
- Handles invalid uuid
```

**File:** `nutribot/application/usecases/DiscardFoodLog.mjs`

```
CLASS: DiscardFoodLog
├── constructor(deps) - similar to Accept
│
├── async execute(input: { chatId, nutrilogUuid, messageId }): Promise<Result>
│   1. Load NutriLog
│   2. Update status to DISCARDED
│   3. Update message (remove buttons, add ❌)
│   4. Check if all complete
│   5. Return result

TESTS:
- Updates status to DISCARDED
- Does not create NutriListItems
```

**File:** `nutribot/application/usecases/ReviseFoodLog.mjs`

```
CLASS: ReviseFoodLog
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - nutrilogRepository: INutrilogRepository
│   - conversationStateStore: IConversationStateStore
│   - logger: Logger
│
├── async execute(input: { chatId, nutrilogUuid, messageId }): Promise<Result>
│   1. Load NutriLog
│   2. Set conversation state: revising = { uuid, messageId }
│   3. Update status to REVISING
│   4. Update message keyboard → prompt for revision input
│   5. Return result
│
└── Used by: ProcessRevisionInput.mjs (handles the actual revision text)

TESTS:
- Sets conversation state
- Updates message correctly
```

**File:** `nutribot/application/usecases/ProcessRevisionInput.mjs`

```
CLASS: ProcessRevisionInput
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - aiGateway: IAIGateway
│   - nutrilogRepository: INutrilogRepository
│   - conversationStateStore: IConversationStateStore
│   - logger: Logger
│
├── async execute(input: { chatId, revisionText, userMessageId }): Promise<Result>
│   1. Get conversation state (revising)
│   2. If not revising → ignore
│   3. Delete user's text message
│   4. Load original NutriLog
│   5. Build revision prompt with original context
│   6. Call AI with revision instruction
│   7. Update NutriLog with new food data
│   8. Add revision to history
│   9. Clear conversation state
│   10. Update message with new food list
│   11. Return result

TESTS:
- Only processes when revising state set
- AI receives original context
- Revision history tracked
```

**File:** `nutribot/application/usecases/SelectUPCPortion.mjs`

```
CLASS: SelectUPCPortion
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - nutrilogRepository: INutrilogRepository
│   - nutrilistRepository: INutrilistRepository
│   - logger: Logger
│
├── async execute(input: { chatId, nutrilogUuid, messageId, portionFactor }): Promise<Result>
│   1. Load NutriLog
│   2. Validate it's a UPC log with INIT status
│   3. Scale nutrients by portion factor
│   4. Create NutriListItem
│   5. Save to nutrilist
│   6. Update NutriLog status to ACCEPTED
│   7. Update message caption (remove keyboard)
│   8. Check all complete → report
│   9. Return result

TESTS:
- Scales macros correctly
- Creates NutriListItem with scaled values
- Updates message
```

---

### 3.6 Nutribot Container

**File:** `nutribot/container.mjs`

```
PURPOSE: Dependency injection container for Nutribot

CLASS: NutribotContainer
├── #config: Config
├── #logger: Logger
├── #instances: Map<string, any>
│
├── constructor(config, options?)
│   - options.mock: boolean (use mock implementations)
│
├── INFRASTRUCTURE:
│   ├── getMessagingGateway(): IMessagingGateway
│   ├── getAIGateway(): IAIGateway
│   ├── getUPCGateway(): IUPCGateway
│   ├── getNutrilogRepository(): INutrilogRepository
│   ├── getNutrilistRepository(): INutrilistRepository
│   ├── getConversationStateStore(): IConversationStateStore
│   └── getReportRenderer(): IReportRenderer
│
├── USE CASES:
│   ├── getLogFoodFromImage(): LogFoodFromImage
│   ├── getLogFoodFromText(): LogFoodFromText
│   ├── getLogFoodFromUPC(): LogFoodFromUPC
│   ├── getAcceptFoodLog(): AcceptFoodLog
│   ├── getDiscardFoodLog(): DiscardFoodLog
│   ├── getReviseFoodLog(): ReviseFoodLog
│   ├── getProcessRevisionInput(): ProcessRevisionInput
│   └── getSelectUPCPortion(): SelectUPCPortion
│
└── LIFECYCLE:
    ├── initialize(): Promise<void>
    └── shutdown(): Promise<void>

TESTS:
- Creates all use cases with correct dependencies
- Mock mode uses mock implementations
- Singleton instances reused
```

---

## Acceptance Criteria

- [ ] All Nutribot value objects have 100% test coverage
- [ ] All entities are immutable
- [ ] Domain services are pure functions
- [ ] All repositories use loadFile/saveFile from io.mjs
- [ ] Bronze/Silver/Gold data model correctly implemented
- [ ] All use cases work with mock gateways
- [ ] Container wires dependencies correctly
- [ ] LogFoodFromImage works end-to-end (with mocks)
- [ ] LogFoodFromText works end-to-end (with mocks)
- [ ] LogFoodFromUPC works end-to-end (with mocks)
- [ ] **`npm test -- --grep "Phase3"` passes**

---

## Test Files Created (in `_tests/`)

```
_tests/nutribot/
├── domain/
│   ├── NoomColor.test.mjs
│   ├── Portion.test.mjs
│   ├── MacroBreakdown.test.mjs
│   ├── FoodItem.test.mjs
│   ├── NutriLog.test.mjs
│   ├── NutriListItem.test.mjs
│   └── services.test.mjs           # NutritionCalculator, ThresholdChecker, etc.
│
├── usecases/
│   ├── LogFoodFromImage.test.mjs
│   ├── LogFoodFromText.test.mjs
│   ├── LogFoodFromUPC.test.mjs
│   ├── AcceptFoodLog.test.mjs
│   ├── DiscardFoodLog.test.mjs
│   └── ReviseFoodLog.test.mjs
│
└── infrastructure/
    ├── FileNutrilogRepository.test.mjs   # Tests io.mjs usage
    ├── FileNutrilistRepository.test.mjs
    └── FileNutriDayRepository.test.mjs
```

---

## Files Created (Summary)

```
nutribot/
├── domain/
│   ├── value-objects/
│   │   ├── NoomColor.mjs
│   │   ├── Portion.mjs
│   │   ├── MacroBreakdown.mjs
│   │   ├── TimeOfDay.mjs
│   │   ├── ServingSize.mjs
│   │   └── index.mjs
│   ├── entities/
│   │   ├── FoodItem.mjs
│   │   ├── NutriLog.mjs
│   │   ├── NutriListItem.mjs
│   │   ├── NutriDay.mjs              # GOLD tier entity
│   │   ├── NutritionReport.mjs
│   │   └── index.mjs
│   ├── services/
│   │   ├── NutritionCalculator.mjs
│   │   ├── ThresholdChecker.mjs
│   │   ├── FoodSorter.mjs
│   │   ├── PortionAdjuster.mjs
│   │   └── index.mjs
│   └── index.mjs
├── application/
│   ├── ports/
│   │   ├── IUPCGateway.mjs
│   │   ├── INutrilogRepository.mjs   # Bronze tier
│   │   ├── INutrilistRepository.mjs  # Silver tier
│   │   ├── INutriDayRepository.mjs   # Gold tier
│   │   ├── IReportRenderer.mjs
│   │   └── index.mjs
│   ├── usecases/
│   │   ├── LogFoodFromImage.mjs
│   │   ├── LogFoodFromText.mjs
│   │   ├── LogFoodFromUPC.mjs
│   │   ├── AcceptFoodLog.mjs
│   │   ├── DiscardFoodLog.mjs
│   │   ├── ReviseFoodLog.mjs
│   │   ├── ProcessRevisionInput.mjs
│   │   ├── SelectUPCPortion.mjs
│   │   └── index.mjs
│   └── index.mjs
└── container.mjs
```

**Total: 26 files**

---

*Next: [04-nutribot-advanced.md](./04-nutribot-advanced.md)*
