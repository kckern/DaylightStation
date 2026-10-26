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
npm ci --legacy-peer-deps
cd frontend && npm ci --legacy-peer-deps && cd ..
cd __backend && npm ci --legacy-peer-deps && cd ..
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

### Architecture CI

The [Architecture workflow](.github/workflows/architecture.yml) installs only root
locked dependencies with `npm ci --ignore-scripts --legacy-peer-deps --no-audit
--no-fund`. The peer-resolution setting matches the Docker build and the existing
lockfile graph. Skipping scripts keeps static checks independent of native builds,
frontend/backend setup, and household services.

The workflow runs ownership, layer, filesystem, ESM-link and public-tree audits,
then the architecture violation controls and static tooling tests. The public-tree
audit requires a documented exact-path allowance for large authored source;
generated fixtures should stay below its per-file limit. The frozen Jeopardy
journal is split across its main and continuation files and recombined by the
fixture loader without changing records or checksums.

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
