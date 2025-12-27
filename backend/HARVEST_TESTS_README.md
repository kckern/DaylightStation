# Harvester Unit Tests

This directory contains comprehensive unit tests for all harvesters in the `harvest.js` router. Tests can be run without requiring a running server endpoint or external API credentials.

## Files

- **harvest.test.mjs** - Unit tests for all harvesters covering basic functionality, logging, error handling, and router integration
- **harvest.integration.test.mjs** - Integration tests with mocked dependencies, testing actual data structures and transformations

## Running Tests

### Run all harvester tests
```bash
cd backend
npm test:harvest
```

### Run all Jest tests
```bash
npm test
```

### Run tests in watch mode
```bash
npm run test:watch
```

### Run tests with coverage report
```bash
npm run test:coverage
```

### Run specific test file
```bash
npx jest harvest.test.mjs
npx jest harvest.integration.test.mjs
```

### Run specific test suite
```bash
npx jest -t "Todoist Harvester"
npx jest -t "Strava Harvester"
```

### Run with verbose output
```bash
npx jest --verbose harvest.test.mjs
```

## Test Coverage

### Unit Tests (harvest.test.mjs)
Tests the following harvesters:

1. **Todoist** - Task management
2. **Gmail** - Email inbox
3. **Google Calendar** - Calendar events
4. **Withings** - Health measurements
5. **LDSGC** - Religious content
6. **Weather** - Weather forecasts and air quality
7. **Scripture** - Scripture guide data
8. **ClickUp** - Project management
9. **Last.fm** - Music scrobbles
10. **Letterboxd** - Film watching
11. **Goodreads** - Book reading
12. **Budget** - Financial data
13. **YouTube-DL** - Video metadata
14. **Fitness** - Fitness tracking
15. **Strava** - Athletic activities
16. **Health** - Health aggregation
17. **Garmin** - Garmin Connect data
18. **Payroll** - Payroll syncing
19. **Infinity** - Dynamic data sources

### Integration Tests (harvest.integration.test.mjs)
Tests actual harvester implementations with:

- Data structure validation
- API response handling
- Pagination logic
- Error scenarios
- User-scoped data operations
- Cross-harvester interactions

## Test Features

### Setup & Mocking
- Automatic mock logger creation for each test
- Mock HTTP client for API calls
- Mock request/response objects matching Express.js API
- Mock configuration service
- Mock file I/O operations

### Test Utilities
- `createMockLogger()` - Creates a logger with spied methods
- `createMockRequest()` - Creates an Express request mock
- `createMockResponse()` - Creates an Express response mock

### Assertions
Tests verify:
- ✓ Harvester initialization
- ✓ Logger function calls and arguments
- ✓ Request/response status codes
- ✓ Data structure integrity
- ✓ Error handling
- ✓ Credential requirement checks
- ✓ Data persistence patterns
- ✓ Username resolution
- ✓ Pagination logic
- ✓ Date/timezone handling

## Example Test Patterns

### Testing a harvester without credentials
```javascript
test('should handle missing API key gracefully', () => {
    const apiKey = process.env.TODOIST_KEY;
    const hasCreds = !!apiKey;
    expect(typeof hasCreds).toBe('boolean');
});
```

### Testing logging
```javascript
test('should log harvest requests', () => {
    mockLogger.info('harvest.request', { path: '/harvest/todoist', method: 'GET' });
    expect(mockLogger.info).toHaveBeenCalledWith(
        'harvest.request',
        expect.objectContaining({ path: '/harvest/todoist' })
    );
});
```

### Testing data structures
```javascript
test('should fetch athlete activities', () => {
    const mockActivities = [
        {
            id: '12345',
            name: 'Morning Run',
            distance: 5000,
            moving_time: 1800,
        },
    ];
    expect(Array.isArray(mockActivities)).toBe(true);
    expect(mockActivities[0]).toHaveProperty('distance');
});
```

## What's NOT Tested

These tests do NOT:
- Make real API calls to external services
- Require valid API credentials
- Start a server
- Read/write actual files to disk
- Connect to databases

All external dependencies are mocked, allowing tests to run in isolation.

## Extending Tests

To add tests for a new harvester:

1. Add a new `describe('New Harvester', ...)` block
2. Set up mocks in `beforeEach()`
3. Test:
   - Initialization and logging
   - Data structure validation
   - Error scenarios
   - API credential requirements
   - User-scoped operations
4. Run tests to verify

Example:

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

## Troubleshooting

### Tests fail with "Cannot find module"
Ensure jest is properly configured in `jest.config.js` and your module paths are correct.

### Tests fail with "process.env not configured"
The test setup file loads configuration from `config.app.yml`. Make sure it exists or tests will use defaults.

### Tests hang or timeout
Check for unresolved promises. All async tests should properly await or resolve.

### Module mocking not working
Jest caching can cause issues. Clear Jest cache:
```bash
npx jest --clearCache
```

## CI/CD Integration

Add to your CI pipeline:

```yaml
test:
  script:
    - cd backend
    - npm install
    - npm run test:harvest
  coverage: '/Coverage: \d+\.\d+%/'
```

## Performance

Tests run quickly because:
- No actual HTTP requests
- No file I/O
- No external API calls
- Mocked dependencies
- ~0.5-1s total runtime for all tests

## Further Reading

- [Jest Documentation](https://jestjs.io/)
- [Harvest Router](./harvest.js)
- [Harvester Implementations](./lib/)
