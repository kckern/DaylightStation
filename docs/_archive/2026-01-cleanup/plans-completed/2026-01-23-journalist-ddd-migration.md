# Journalist DDD Migration - Implementation Plan

**STATUS: COMPLETE** (2026-01-23)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate journalist from `_legacy/chatbots/bots/journalist/` into proper DDD folder structure, aligning with nutribot patterns and maximizing shared adapter reuse.

**Key Difference from Nutribot:** Journalist is partially migrated - router and some adapters already exist in new structure. Main work is moving domain and application layers.

**Shared Adapters:** Both journalist and nutribot use `TelegramAdapter` and `OpenAIAdapter` from `2_adapters/`.

---

## Completion Summary

All phases complete. Tests pass (13/13 journalist integration tests).

**Legacy files ready for deletion after confidence period:**
- `backend/_legacy/chatbots/bots/journalist/` (entire directory)

**New DDD structure:**
- `backend/src/1_domains/journalist/` - Domain layer (entities, services, value-objects)
- `backend/src/3_applications/journalist/` - Application layer (ports, usecases, JournalistContainer)
- `backend/src/2_adapters/journalist/` - Adapters (DebriefRepository, LoggingAIGateway, JournalistInputRouter)
- `backend/src/4_api/routers/journalist.mjs` - API router
- `backend/src/4_api/handlers/journalist/` - API handlers

---

## Phase 1: Domain Layer

### Task 1.1: Create Journalist Domain Directory Structure

**Files:**
- Create: `backend/src/1_domains/journalist/index.mjs`
- Create: `backend/src/1_domains/journalist/entities/index.mjs`
- Create: `backend/src/1_domains/journalist/services/index.mjs`
- Create: `backend/src/1_domains/journalist/value-objects/index.mjs`

**Step 1: Create directory structure**

```bash
mkdir -p backend/src/1_domains/journalist/entities
mkdir -p backend/src/1_domains/journalist/services
mkdir -p backend/src/1_domains/journalist/value-objects
```

**Step 2: Create domain barrel export**

Create `backend/src/1_domains/journalist/index.mjs`:
```javascript
// backend/src/1_domains/journalist/index.mjs
// Journalist domain - journaling and morning debrief entities

export * from './entities/index.mjs';
export * from './services/index.mjs';
export * from './value-objects/index.mjs';
```

**Step 3: Create placeholder index files**

Create `backend/src/1_domains/journalist/entities/index.mjs`:
```javascript
// backend/src/1_domains/journalist/entities/index.mjs
// Entity exports will be added as entities are migrated

// export { JournalEntry } from './JournalEntry.mjs';
// export { ConversationMessage } from './ConversationMessage.mjs';
// export { MessageQueue } from './MessageQueue.mjs';
// export { QuizQuestion } from './QuizQuestion.mjs';
// export { QuizAnswer } from './QuizAnswer.mjs';
```

Create `backend/src/1_domains/journalist/services/index.mjs`:
```javascript
// backend/src/1_domains/journalist/services/index.mjs
// Service exports will be added as services are migrated

// export { HistoryFormatter } from './HistoryFormatter.mjs';
// export { MessageSplitter } from './MessageSplitter.mjs';
// export { PromptBuilder } from './PromptBuilder.mjs';
// export { QuestionParser } from './QuestionParser.mjs';
// export { QueueManager } from './QueueManager.mjs';
```

Create `backend/src/1_domains/journalist/value-objects/index.mjs`:
```javascript
// backend/src/1_domains/journalist/value-objects/index.mjs
// Value object exports will be added as they are migrated

// export { EntrySource, isValidEntrySource } from './EntrySource.mjs';
// export { PromptType } from './PromptType.mjs';
// export { QuizCategory } from './QuizCategory.mjs';
```

**Step 4: Commit**

```bash
git add backend/src/1_domains/journalist/
git commit -m "feat(journalist): create domain directory structure"
```

---

### Task 1.2: Migrate Value Objects

**Files:**
- Read: `backend/_legacy/chatbots/bots/journalist/domain/value-objects/*.mjs`
- Create: `backend/src/1_domains/journalist/value-objects/EntrySource.mjs`
- Create: `backend/src/1_domains/journalist/value-objects/PromptType.mjs`
- Create: `backend/src/1_domains/journalist/value-objects/QuizCategory.mjs`
- Modify: `backend/src/1_domains/journalist/value-objects/index.mjs`

**Step 1: Copy value objects**

Copy each value object file from legacy to new location. These are simple enums/constants and should not need modification.

**Step 2: Update index**

Edit `backend/src/1_domains/journalist/value-objects/index.mjs`:
```javascript
// backend/src/1_domains/journalist/value-objects/index.mjs
export { EntrySource, isValidEntrySource } from './EntrySource.mjs';
export { PromptType } from './PromptType.mjs';
export { QuizCategory } from './QuizCategory.mjs';
```

**Step 3: Commit**

```bash
git add backend/src/1_domains/journalist/value-objects/
git commit -m "feat(journalist): migrate value objects from legacy"
```

---

### Task 1.3: Migrate Domain Entities

**Files:**
- Read: `backend/_legacy/chatbots/bots/journalist/domain/entities/*.mjs`
- Create: `backend/src/1_domains/journalist/entities/JournalEntry.mjs`
- Create: `backend/src/1_domains/journalist/entities/ConversationMessage.mjs`
- Create: `backend/src/1_domains/journalist/entities/MessageQueue.mjs`
- Create: `backend/src/1_domains/journalist/entities/QuizQuestion.mjs`
- Create: `backend/src/1_domains/journalist/entities/QuizAnswer.mjs`
- Modify: `backend/src/1_domains/journalist/entities/index.mjs`

**Step 1: Copy entity files**

Copy each entity file from legacy to new location.

**Step 2: Update imports in each entity**

For each entity file, update imports:
- Change `import { ValidationError } from '../../../../_lib/errors/index.mjs'` to use a shared error or inline validation
- Change `import { EntrySource } from '../value-objects/EntrySource.mjs'` to `import { EntrySource } from '../value-objects/index.mjs'`

**Pattern for ValidationError:** Either:
1. Import from `backend/src/0_infrastructure/errors/ValidationError.mjs` (if exists)
2. Or create simple inline: `class ValidationError extends Error { constructor(msg) { super(msg); this.name = 'ValidationError'; } }`

**Step 3: Update entities index**

Edit `backend/src/1_domains/journalist/entities/index.mjs`:
```javascript
// backend/src/1_domains/journalist/entities/index.mjs
export { JournalEntry } from './JournalEntry.mjs';
export { ConversationMessage } from './ConversationMessage.mjs';
export { MessageQueue } from './MessageQueue.mjs';
export { QuizQuestion } from './QuizQuestion.mjs';
export { QuizAnswer } from './QuizAnswer.mjs';
```

**Step 4: Commit**

```bash
git add backend/src/1_domains/journalist/entities/
git commit -m "feat(journalist): migrate domain entities from legacy"
```

---

### Task 1.4: Migrate Domain Services

**Files:**
- Read: `backend/_legacy/chatbots/bots/journalist/domain/services/*.mjs`
- Create: `backend/src/1_domains/journalist/services/HistoryFormatter.mjs`
- Create: `backend/src/1_domains/journalist/services/MessageSplitter.mjs`
- Create: `backend/src/1_domains/journalist/services/PromptBuilder.mjs`
- Create: `backend/src/1_domains/journalist/services/QuestionParser.mjs`
- Create: `backend/src/1_domains/journalist/services/QueueManager.mjs`
- Modify: `backend/src/1_domains/journalist/services/index.mjs`

**Step 1: Copy service files**

Copy each service file from legacy to new location.

**Step 2: Update imports**

Update any imports that reference legacy paths to use new domain paths.

**Step 3: Update services index**

Edit `backend/src/1_domains/journalist/services/index.mjs`:
```javascript
// backend/src/1_domains/journalist/services/index.mjs
export { HistoryFormatter } from './HistoryFormatter.mjs';
export { MessageSplitter } from './MessageSplitter.mjs';
export { PromptBuilder } from './PromptBuilder.mjs';
export { QuestionParser } from './QuestionParser.mjs';
export { QueueManager } from './QueueManager.mjs';
```

**Step 4: Commit**

```bash
git add backend/src/1_domains/journalist/services/
git commit -m "feat(journalist): migrate domain services from legacy"
```

---

## Phase 2: Application Layer

### Task 2.1: Create Application Directory Structure

**Files:**
- Create: `backend/src/3_applications/journalist/index.mjs`
- Create: `backend/src/3_applications/journalist/ports/index.mjs`
- Create: `backend/src/3_applications/journalist/usecases/index.mjs`

**Step 1: Create directories**

```bash
mkdir -p backend/src/3_applications/journalist/ports
mkdir -p backend/src/3_applications/journalist/usecases
```

**Step 2: Create placeholder index files**

Create `backend/src/3_applications/journalist/index.mjs`:
```javascript
// backend/src/3_applications/journalist/index.mjs
export * from './ports/index.mjs';
export * from './usecases/index.mjs';
export { JournalistContainer } from './JournalistContainer.mjs';
```

**Step 3: Commit**

```bash
git add backend/src/3_applications/journalist/
git commit -m "feat(journalist): create application directory structure"
```

---

### Task 2.2: Migrate Port Interfaces

**Files:**
- Read: `backend/_legacy/chatbots/bots/journalist/application/ports/*.mjs`
- Create: `backend/src/3_applications/journalist/ports/IJournalEntryRepository.mjs`
- Create: `backend/src/3_applications/journalist/ports/IMessageQueueRepository.mjs`
- Create: `backend/src/3_applications/journalist/ports/IPromptTemplateRepository.mjs`
- Create: `backend/src/3_applications/journalist/ports/IQuizRepository.mjs`
- Modify: `backend/src/3_applications/journalist/ports/index.mjs`

**Step 1: Copy port interface files**

Copy each port interface file from legacy to new location.

**Step 2: Update ports index**

Edit `backend/src/3_applications/journalist/ports/index.mjs`:
```javascript
// backend/src/3_applications/journalist/ports/index.mjs
export { IJournalEntryRepository } from './IJournalEntryRepository.mjs';
export { IMessageQueueRepository } from './IMessageQueueRepository.mjs';
export { IPromptTemplateRepository } from './IPromptTemplateRepository.mjs';
export { IQuizRepository } from './IQuizRepository.mjs';
```

**Step 3: Commit**

```bash
git add backend/src/3_applications/journalist/ports/
git commit -m "feat(journalist): migrate port interfaces from legacy"
```

---

### Task 2.3: Migrate Use Cases

**Files:**
- Read: `backend/_legacy/chatbots/bots/journalist/application/usecases/*.mjs`
- Create: `backend/src/3_applications/journalist/usecases/` (20+ files)
- Modify: `backend/src/3_applications/journalist/usecases/index.mjs`

**Step 1: Copy all use case files**

Copy all use case files from legacy to new location:
- AdvanceToNextQuizQuestion.mjs
- ExportJournalMarkdown.mjs
- GenerateMorningDebrief.mjs
- GenerateMultipleChoices.mjs
- GenerateTherapistAnalysis.mjs
- HandleCallbackResponse.mjs
- HandleCategorySelection.mjs
- HandleDebriefResponse.mjs
- HandleQuizAnswer.mjs
- HandleSlashCommand.mjs
- HandleSourceSelection.mjs
- HandleSpecialStart.mjs
- InitiateDebriefInterview.mjs
- InitiateJournalPrompt.mjs
- ProcessTextEntry.mjs
- ProcessVoiceEntry.mjs
- RecordQuizAnswer.mjs
- ReviewJournalEntries.mjs
- SendMorningDebrief.mjs
- SendQuizQuestion.mjs

**Step 2: Update imports in each use case**

For each use case, update imports to reference new paths:
```javascript
// Old:
import { JournalEntry } from '../../domain/entities/JournalEntry.mjs';

// New:
import { JournalEntry } from '../../../1_domains/journalist/entities/index.mjs';
```

**Step 3: Update usecases index**

Edit `backend/src/3_applications/journalist/usecases/index.mjs` to export all use cases.

**Step 4: Commit**

```bash
git add backend/src/3_applications/journalist/usecases/
git commit -m "feat(journalist): migrate use cases from legacy"
```

---

### Task 2.4: Migrate JournalistContainer

**Files:**
- Read: `backend/_legacy/chatbots/bots/journalist/container.mjs`
- Create: `backend/src/3_applications/journalist/JournalistContainer.mjs`

**Step 1: Copy container file**

Copy container.mjs from legacy to new location.

**Step 2: Update all imports**

Update imports to reference:
- Domain entities from `../../1_domains/journalist/`
- Use cases from `./usecases/`
- Shared adapters from `../../2_adapters/messaging/TelegramAdapter.mjs` and `../../2_adapters/ai/OpenAIAdapter.mjs`
- Journalist adapters from `../../2_adapters/journalist/`
- Persistence from `../../2_adapters/persistence/yaml/`

**Step 3: Commit**

```bash
git add backend/src/3_applications/journalist/JournalistContainer.mjs
git commit -m "feat(journalist): migrate JournalistContainer from legacy"
```

---

## Phase 3: Integration Updates

### Task 3.1: Update Journalist Adapters

**Files:**
- Modify: `backend/src/2_adapters/journalist/JournalistInputRouter.mjs`
- Modify: `backend/src/2_adapters/journalist/LifelogAggregator.mjs`
- Modify: `backend/src/2_adapters/journalist/LoggingAIGateway.mjs`
- Modify: `backend/src/2_adapters/journalist/DebriefRepository.mjs`

**Step 1: Update imports in each adapter**

Update any imports that reference legacy paths to use new domain/application paths.

**Step 2: Commit**

```bash
git add backend/src/2_adapters/journalist/
git commit -m "refactor(journalist): update adapters to use new domain paths"
```

---

### Task 3.2: Update API Router

**Files:**
- Modify: `backend/src/4_api/routers/journalist.mjs`

**Step 1: Update import for JournalistContainer**

```javascript
// Old (if any legacy import):
import { JournalistContainer } from '../../_legacy/...';

// New:
import { JournalistContainer } from '../../3_applications/journalist/JournalistContainer.mjs';
```

**Step 2: Commit**

```bash
git add backend/src/4_api/routers/journalist.mjs
git commit -m "refactor(journalist): update router to use new application path"
```

---

### Task 3.3: Update API Handlers

**Files:**
- Modify: `backend/src/4_api/handlers/journalist/*.mjs` (if any reference legacy)

**Step 1: Update imports**

Check handlers for any legacy imports and update to new paths.

**Step 2: Commit**

```bash
git add backend/src/4_api/handlers/journalist/
git commit -m "refactor(journalist): update handlers to use new paths"
```

---

## Phase 4: Verification & Cleanup

### Task 4.1: Run Tests

**Step 1: Run journalist tests**

```bash
npm test -- --grep journalist
```

**Step 2: Fix any failing tests**

Update test imports if they reference legacy paths.

**Step 3: Commit fixes**

```bash
git add .
git commit -m "test(journalist): update tests for new DDD structure"
```

---

### Task 4.2: Document Legacy for Deletion

**Step 1: Verify all functionality works**

- [ ] Text message journaling
- [ ] Voice message transcription
- [ ] Morning debrief generation
- [ ] Morning debrief delivery
- [ ] Category selection callbacks
- [ ] Slash commands (/journal, /analysis, /morning)
- [ ] Quiz flow

**Step 2: Create deletion manifest**

Document files to delete after confidence period:
- `backend/_legacy/chatbots/bots/journalist/` (entire directory)

**Step 3: Final commit**

```bash
git add .
git commit -m "docs(journalist): complete DDD migration - ready for legacy cleanup"
```

---

## Summary

**Total Tasks:** 12 tasks across 4 phases

**Files Created:**
- `1_domains/journalist/entities/` (5 entities)
- `1_domains/journalist/services/` (5 services)
- `1_domains/journalist/value-objects/` (3 value objects)
- `3_applications/journalist/ports/` (4 port interfaces)
- `3_applications/journalist/usecases/` (20+ use cases)
- `3_applications/journalist/JournalistContainer.mjs`

**Files Modified:**
- `2_adapters/journalist/*.mjs` (import updates)
- `4_api/routers/journalist.mjs` (import updates)
- `4_api/handlers/journalist/*.mjs` (import updates)

**Shared Adapters Used:**
- `2_adapters/messaging/TelegramAdapter.mjs`
- `2_adapters/ai/OpenAIAdapter.mjs`

**Key Patterns:**
- Domain entities with private fields and immutability
- Port interfaces for dependency inversion
- Use case classes with `execute()` method
- Container for dependency injection
- Barrel exports (index.mjs) at each level
