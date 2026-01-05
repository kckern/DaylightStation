# Harvester Testing Guide

> **Related code:** `backend/tests/harvest.test.mjs`, `backend/tests/harvest.integration.test.mjs`, `backend/routers/harvest.js`

Comprehensive unit and integration tests for all 19 harvesters. Tests run without requiring a server, external APIs, or credentials.

---

## Quick Start

```bash
cd backend

# Run all harvester tests
npm run test:harvest

# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

## Test Files

| File | Purpose |
|------|---------|
| `harvest.test.mjs` | Unit tests - initialization, logging, error handling |
| `harvest.integration.test.mjs` | Integration tests - data structures, transformations |

## Covered Harvesters

Todoist, Gmail, Google Calendar, Withings, LDSGC, Weather, Scripture, ClickUp, Last.fm, Letterboxd, Goodreads, Budget, YouTube-DL, Fitness, Strava, Health, Garmin, Payroll, Infinity

## Running Specific Tests

```bash
# Single harvester
npx jest -t "Todoist"

# Integration tests only
npx jest harvest.integration.test.mjs

# Verbose output
npx jest --verbose harvest.test.mjs
```

## Test Features

- **Zero Setup** - No credentials, API keys, or external services needed
- **Fast Execution** - ~0.5-1 second total runtime
- **Full Mocking** - Logger, HTTP client, request/response, file I/O

### Test Utilities

```javascript
createMockLogger()   // Logger with spied methods
createMockRequest()  // Express request mock
createMockResponse() // Express response mock
```

## Extending Tests

```javascript
describe('New Harvester', () => {
  let mockLogger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    jest.clearAllMocks();
  });

  test('should initialize successfully', () => {
    expect(mockLogger).toBeDefined();
  });

  test('should fetch data', () => {
    const mockData = [];
    expect(Array.isArray(mockData)).toBe(true);
  });
});
```

## CI/CD Integration

```yaml
- name: Run Harvester Tests
  run: |
    cd backend
    npm install
    npm run test:harvest
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Tests won't run | `npx jest --clearCache && npm install` |
| Module not found | Check jest.config.js paths |
| Tests hang | Check for unresolved promises |

## Stats

- **100+ tests** across 2 files
- **19 harvesters** covered
- **<1 second** execution time
- **0 external dependencies** (all mocked)
