# Logging Consistency Audit

You are auditing the DaylightStation codebase for logging quality and consistency.

## Context

DaylightStation uses structured logging via Winston:
- Backend: `createLogger({ source: 'backend', app: '<module-name>' })` from `backend/lib/logging/logger.js`
- Loggers should be created at module level (e.g., `const fitnessLogger = createLogger(...)`)
- Log methods: `logger.info()`, `logger.warn()`, `logger.error()`, `logger.debug()`
- Console methods (`console.log/warn/error`) should NOT be used in production code

## Your Tasks

Based on the parameters provided, perform the following checks:

### 1. Find Console Usage (if checkConsoleLogs=true)
- Search for `console.log`, `console.warn`, `console.error`, `console.debug` in the codebase
- Exclude: node_modules, test files, build output
- Report each occurrence with file path and line number
- Categorize by severity:
  - **Critical**: console.error in error handlers
  - **High**: console.warn or console.log in route handlers or core logic
  - **Medium**: console.log in utility functions
  - **Low**: console.log in development/debug code with comments

### 2. Verify Logger Usage (if checkLoggerUsage=true)
- Find all `.mjs` and `.js` files in `backend/routers/` and `backend/lib/`
- Check each file:
  - Does it import `createLogger`?
  - Is a logger instance created at module level?
  - Are the logger fields appropriate (source, app)?
- Report files that should have logging but don't

### 3. Check for Sensitive Data (if checkSensitiveData=true)
- Search log statements for potential PII or secrets:
  - Passwords, tokens, API keys
  - Email addresses, phone numbers
  - User IDs without context
  - Full request/response bodies that might contain sensitive data
- Patterns to flag:
  - `password`, `token`, `apiKey`, `secret`, `bearer`
  - Email regex patterns
  - Large objects being logged without filtering
- Report with file, line number, and reason for concern

### 4. Verify Log Levels (if checkLogLevels=true)
- Check that log levels are used appropriately:
  - **error**: Exceptions, failures, data loss
  - **warn**: Recoverable issues, deprecated usage, rate limits
  - **info**: Normal operations, state changes, completions
  - **debug**: Detailed diagnostic info
- Common issues to flag:
  - Using `info` for errors
  - Using `error` for normal validation failures
  - Excessive `debug` logs in production paths

### 5. Auto-fix (if autofix=true)
For simple issues, offer to fix them:
- Replace `console.log(...)` with appropriate logger calls
- Add missing logger imports and initialization
- Suggest log level changes

## Output Format

### Summary Format
```
Logging Consistency Audit Results
==================================
Scope: {scope}
Files scanned: {count}

Issues Found:
- Console usage: {count} ({critical} critical, {high} high, {medium} medium, {low} low)
- Missing loggers: {count} files
- Sensitive data risks: {count}
- Log level issues: {count}

Overall Grade: {A/B/C/D/F}
```

### Detailed Format
Group findings by category with file paths, line numbers, code snippets, and recommendations.

### Checklist Format
- [ ] Issue description (file:line)
Format for easy copy-paste into GitHub issues.

## Execution Steps

1. Determine scope (backend, frontend, or all)
2. Use Glob to find relevant files
3. Use Grep to search for patterns
4. Read flagged files to analyze context
5. Compile findings
6. Generate report in requested format
7. If autofix=true, ask user which fixes to apply

## Important Notes

- Be thorough but don't overwhelm with false positives
- Consider context - test files and development utilities have different standards
- Prioritize high-impact issues (error handlers, authentication, data processing)
- When in doubt about sensitive data, flag it
