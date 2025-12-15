# CLI Chat Simulator

Interactive command-line interface for testing chatbots without server/webhook infrastructure.

## Quick Start

```bash
cd backend
node chatbots/cli/index.mjs --bot nutribot --real-ai
```

## Installation

The CLI requires the following dependencies (already in package.json):

```bash
npm install @inquirer/prompts chalk
```

## Command Line Options

| Option | Short | Description |
|--------|-------|-------------|
| `--bot <name>` | `-b` | Start with specific bot (nutribot, journalist) |
| `--debug` | `-d` | Enable verbose debug logging |
| `--session <name>` | `-s` | Use named session (state persists between runs) |
| `--real-ai` | | Use real OpenAI API instead of mock responses |
| `--help` | `-h` | Show help message |

## Usage Examples

### 1. Interactive Bot Selection

```bash
node chatbots/cli/index.mjs
```

**Expected output:**
```
🤖 Welcome to the Chatbot CLI Simulator

Select a chatbot:
❯ 🍎 NutriBot - Food logging & nutrition tracking
  📓 Journalist - Daily journaling & reflection
```

### 2. Start Directly with NutriBot

```bash
node chatbots/cli/index.mjs --bot nutribot --real-ai
```

**Expected output:**
```
🍎 NutriBot:
   Welcome to NutriBot! Send me a photo of your food, describe what you ate, or scan a barcode.

You: _
```

### 3. Debug Mode with Named Session

```bash
node chatbots/cli/index.mjs --debug --session mytest
```

Sessions persist conversation history and state between runs. Use the same session name to continue where you left off.

### 4. Use Real OpenAI API (Required)

```bash
node chatbots/cli/index.mjs --real-ai --bot nutribot
```

> ⚠️ **Required**: The CLI now uses real implementations only. You must:
> - Set `OPENAI_API_KEY` in environment or `config.secrets.yml`
> - Use the `--real-ai` flag
> 
> Mock responses have been removed to ensure CLI behavior matches production.

---

## In-Session Commands

Type these commands during a chat session:

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/switch` | Switch to another chatbot |
| `/clear` | Clear conversation history |
| `/state` | Show current conversation state (debug) |
| `/debug` | Toggle debug logging |
| `/quit` | Exit the CLI |

---

## Special Input Syntax

Simulate different input types using special syntax:

### Photo Input

```
[photo:/path/to/food.jpg]
```

**Example:**
```
You: [photo:/Users/me/Desktop/lunch.jpg]

🍎 NutriBot:
   🔍 Analyzing image...

🍎 NutriBot:
   📝 Got it! Here's what I understood:
   
   • 1 piece Grilled Chicken Breast (248 cal)
   • 2 cups Mixed Green Salad (20 cal)
   
   [✅ Accept] [✏️ Revise] [🗑️ Discard]
```

### Voice Input (Transcription Simulation)

```
[voice:I had a turkey sandwich for lunch]
```

The text after `voice:` is treated as if it were transcribed from a voice message.

### Barcode/UPC Scan

```
[upc:049000042566]
```

**Example:**
```
You: [upc:049000042566]

🍎 NutriBot:
   📦 Found: Coca-Cola Classic
   
   Select a serving size:
   ❯ 1 can (12 fl oz) - 140 cal
     1 bottle (20 fl oz) - 240 cal
```

---

## Example Sessions

### Session 1: Basic Food Logging

```
$ node chatbots/cli/index.mjs --bot nutribot

🍎 NutriBot:
   Welcome to NutriBot! Send me a photo of your food, describe what you ate, or scan a barcode.

You: I had a chicken salad for lunch

🍎 NutriBot:
   🔍 Analyzing...

🍎 NutriBot:
   📝 Got it! Here's what I understood:
   
   • 1 piece Grilled Chicken Breast (248 cal)
   • 2 cups Mixed Green Salad (20 cal)
   • 2 tbsp Caesar Dressing (150 cal)
   
   [✅ Accept] [✏️ Revise] [🗑️ Discard]

Choose an action:
❯ ✅ Accept
  ✏️ Revise
  🗑️ Discard

🍎 NutriBot:
   ✅ Logged! Total: 418 calories
   
   📊 Today's Progress:
   Calories: 418/2000 (21%)
   Protein:  49g/150g (33%)
```

### Session 2: UPC Barcode Lookup

```
$ node chatbots/cli/index.mjs --bot nutribot

You: [upc:722252100900]

🍎 NutriBot:
   📦 Found: RXBAR Chocolate Sea Salt
   
   ┌────────────────────────────────────────┐
   │        RXBAR Chocolate Sea Salt        │
   ├────────────────────────────────────────┤
   │  Brand: RXBAR                          │
   │  Calories: 210                         │
   │  Protein:  12g                         │
   │  Carbs:    24g                         │
   │  Fat:      9g                          │
   ├────────────────────────────────────────┤
   │  Servings:                             │
   │    • 1 bar                             │
   └────────────────────────────────────────┘

   Select portion:
   ❯ 1 bar (210 cal)
```

### Session 3: Multiple Foods

```
You: eggs and toast for breakfast

🍎 NutriBot:
   📝 Got it! Here's what I understood:
   
   • 2 large Scrambled Eggs (182 cal)
   • 1 slice Toast (79 cal)
   
   [✅ Accept] [✏️ Revise] [🗑️ Discard]
```

### Session 4: Revision Flow

```
You: I had pizza

🍎 NutriBot:
   📝 Got it! Here's what I understood:
   
   • 2 slices Pepperoni Pizza (596 cal)

Choose an action: ✏️ Revise

🍎 NutriBot:
   What would you like to change?

You: I only had 1 slice

🍎 NutriBot:
   📝 Updated:
   
   • 1 slice Pepperoni Pizza (298 cal)
   
   [✅ Accept] [✏️ Revise] [🗑️ Discard]
```

---

## Built-in Mock Data

### Canned AI Responses

The mock AI responds to these food keywords:

| Keyword | Response |
|---------|----------|
| chicken salad | Grilled chicken + salad + dressing |
| pizza | Pepperoni pizza slices |
| burger, hamburger | Beef burger + fries |
| apple, banana, fruit | Apple |
| coffee, latte, cappuccino | Latte |
| eggs, omelette | Scrambled eggs + toast |
| sandwich | Turkey sandwich |
| rice, fried rice | Fried rice |
| soup | Chicken noodle soup |
| steak | Ribeye steak |
| pasta, spaghetti | Spaghetti marinara |
| yogurt | Greek yogurt |
| smoothie | Berry smoothie |

### Built-in UPC Products

| UPC | Product |
|-----|---------|
| 049000042566 | Coca-Cola Classic |
| 012000001536 | Pepsi |
| 028400090865 | Lay's Classic Potato Chips |
| 040000495796 | M&M's Peanut |
| 030000311103 | Quaker Oats Old Fashioned |
| 070470496443 | Chobani Greek Yogurt Vanilla |
| 041220576074 | Fairlife 2% Milk |
| 722252100900 | RXBAR Chocolate Sea Salt |
| 850251004032 | Quest Bar Cookies & Cream |
| 613008739591 | Clif Bar Chocolate Chip |
| 072250013727 | Dave's Killer Bread 21 Whole Grains |
| 013000006408 | Heinz Tomato Ketchup |
| 054100710000 | Hidden Valley Ranch |
| 013120004315 | Amy's Cheese Pizza |
| 021131501167 | Trader Joe's Chicken Tikka Masala |
| 041130218231 | Applegate Turkey Breast |
| 021000658831 | Minute Rice White |

---

## Architecture

```
cli/
├── index.mjs                 # Entry point & arg parsing
├── CLIChatSimulator.mjs      # Main orchestrator
├── adapters/
│   └── CLIMessagingGateway.mjs  # IMessagingGateway for terminal
├── presenters/
│   └── CLIPresenter.mjs      # Terminal output formatting
├── input/
│   └── CLIInputHandler.mjs   # User input & special syntax
├── media/
│   └── CLIImageHandler.mjs   # Image file handling
├── session/
│   └── CLISessionManager.mjs # Session state persistence
└── mocks/
    ├── MockAIGateway.mjs     # Canned AI responses
    ├── MockUPCGateway.mjs    # UPC product database
    ├── MockReportRenderer.mjs # Text-based reports
    └── MemoryRepositories.mjs # In-memory storage
```

---

## Testing

Run all CLI tests:

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
NODE_OPTIONS=--experimental-vm-modules npm test -- --testPathPattern="backend/chatbots/cli/__tests__"
```

**Expected output:**
```
Test Suites: 9 passed, 9 total
Tests:       154 passed, 154 total
```

### Run Real AI Integration Tests

These tests call the actual OpenAI API:

```bash
export OPENAI_API_KEY=sk-...
NODE_OPTIONS=--experimental-vm-modules npm test -- --testPathPattern="RealAI.integration"
```

**Expected output:**
```
  Real AI Integration
    Thanksgiving Dinner Flow
      ✓ should parse thanksgiving dinner into itemized foods (3930 ms)
      ✓ should accept thanksgiving dinner and update nutrilist (3072 ms)
      ✓ should discard thanksgiving dinner and not add to nutrilist (3821 ms)
    Various Food Inputs
      ✓ should parse "a slice of pepperoni pizza"
      ✓ should parse "grilled chicken salad with ranch dressing"
      ✓ should parse "grande caramel latte from starbucks"
      ✓ should parse "big mac meal with large fries and coke"

Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total
```

**Sample AI Response (Thanksgiving Dinner):**
```json
[
  { "name": "roast turkey", "grams": 150, "calories": 335, "protein": 48, "carbs": 0, "fat": 15 },
  { "name": "mashed potatoes", "grams": 210, "calories": 210, "protein": 4, "carbs": 35, "fat": 8 },
  { "name": "stuffing", "grams": 140, "calories": 350, "protein": 10, "carbs": 40, "fat": 15 },
  { "name": "green bean casserole", "grams": 150, "calories": 143, "protein": 3, "carbs": 14, "fat": 8 },
  { "name": "cranberry sauce", "grams": 122, "calories": 209, "protein": 0, "carbs": 54, "fat": 0 }
]
```

### Test Files

| File | Coverage |
|------|----------|
| `CLIInputHandler.test.mjs` | Input parsing & special syntax |
| `CLISessionManager.test.mjs` | Session persistence |
| `CLIImageHandler.test.mjs` | Image file handling |
| `MockAIGateway.test.mjs` | AI response patterns |
| `MockUPCGateway.test.mjs` | UPC lookups |
| `MockReportRenderer.test.mjs` | Report generation |
| `MemoryRepositories.test.mjs` | In-memory storage |
| `CLIChatSimulator.integration.test.mjs` | End-to-end workflows (mock) |
| `RealAI.integration.test.mjs` | End-to-end with real OpenAI API |

---

## Troubleshooting

### "Cannot find module '@inquirer/prompts'"

```bash
npm install @inquirer/prompts
```

### "aiGateway not configured"

The NutriBot container requires all adapters. Make sure the CLI initializes properly:

```bash
node chatbots/cli/index.mjs --debug
```

### Session not persisting

Sessions are saved to `/tmp/cli-session-<name>.json`. Check file permissions and disk space.

### Real AI not working

1. Ensure `OPENAI_API_KEY` is set:
   ```bash
   export OPENAI_API_KEY=sk-...
   ```

2. Use the `--real-ai` flag:
   ```bash
   node chatbots/cli/index.mjs --real-ai
   ```

---

## Extending the CLI

### Adding Custom Mock Responses

```javascript
import { CLIChatSimulator } from './CLIChatSimulator.mjs';

const simulator = new CLIChatSimulator();
await simulator.initialize();

// Add custom AI response
simulator.getAIGateway().setMockResponse('my special food', {
  items: [
    { name: 'Special Food', calories: 500, protein: 25, carbs: 50, fat: 15 }
  ]
});

// Add custom UPC product
simulator.getUPCGateway().addProduct('123456789012', {
  name: 'My Custom Product',
  brand: 'My Brand',
  servings: [
    { name: '1 serving', grams: 100, calories: 200, protein: 10, carbs: 20, fat: 8 }
  ]
});
```

### Running in Test Mode

For automated testing without user interaction:

```javascript
const simulator = new CLIChatSimulator({
  testMode: true,  // Non-interactive
  sessionName: 'automated-test'
});

await simulator.initialize();

// The messaging gateway will auto-select choices
simulator.getMessagingGateway().setAutoSelectIndex(0); // Always pick first option
```

---

## License

Internal use only - DaylightStation project.
