# Contributing to DaylightStation

## Development Setup

### Prerequisites

- Node.js 22.23.2 (see `.nvmrc`)
- npm
- Docker (for testing containerized builds)

### 1. Clone and install

```bash
git clone https://github.com/kckern/DaylightStation.git
cd DaylightStation
npm install
cd frontend && npm install && cd ..
cd __backend && npm install && cd ..
```

### 2. Configure for development

```bash
cp .env.example .env
# Set DAYLIGHT_DATA_PATH to your own configuration/data directory.
# Set DAYLIGHT_ENV to the environment you configure there.
```

Use the [configuration reference](__docs/reference/core/configuration.md) for
the system, household, and integration configuration layout. Credentials and
personal data belong in that external directory.

### 3. Start development servers

```bash
npm run dev
```

This starts both frontend and backend with hot reload. Logs are written to `dev.log`.

- Frontend: http://localhost:3111
- Backend: http://localhost:3112

## Project Structure

```
DaylightStation/
├── __app_modules/     # Application features: server, browser, CLI, satellites
├── __capabilities/    # Shared features
├── __backend/         # Server infrastructure and application composition
├── frontend/          # Browser shell, routing, shared UI
├── shared/            # Portable contracts and utilities
├── cli/               # Stable command entry points
├── docker/            # Production image and entry point
├── __docs/            # Maintained documentation
├── scripts/           # Development and build tooling
├── tests/             # Shared tests, fixtures, and harnesses
└── _extensions/       # Independent satellite components
```

Start feature work in `__app_modules/<category>/<app>/`. Work on shared behavior in
`__capabilities/<capability>/`. Many tests live beside their source. Test runner configs live under
`tests/_infrastructure/config/`. See the
[contributor map](__docs/reference/core/project-layout.md) for ownership and
dependency conventions.

## Running Tests

```bash
npm run check:parse         # Parse and conflict-marker checks
npm run audit:owners        # Application/capability boundaries
npm run audit:links         # Static local import contracts
npm run test:isolated       # Isolated feature tests
npm run test:unit:vitest    # Gated unit tests
npm run test:file -- <path> # One Vitest test file
```

## Code Style

- ES modules (`.mjs` for backend, `.jsx` for React components)
- Functional components with hooks
- Structured logging via DaylightLogger

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit with descriptive message
6. Push and open a Pull Request

## Documentation

- Update relevant docs in `__docs/` when changing functionality
- AI context files in `__docs/ai-context/` help Claude understand the codebase
- See [CLAUDE.md](CLAUDE.md) for project conventions
