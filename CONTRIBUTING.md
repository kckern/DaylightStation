# Contributing to DaylightStation

## Development Setup

### Prerequisites

- Node.js 20.11.0 or higher
- npm
- Docker (for testing containerized builds)

### 1. Clone and install

```bash
git clone https://github.com/kckern/DaylightStation.git
cd DaylightStation
npm install
cd frontend && npm install && cd ..
cd backend && npm install && cd ..
```

### 2. Configure for development

```bash
cp config/secrets.example.yml config/secrets.yml
cp config/system.example.yml config/system.yml
# Edit with your test credentials
```

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
├── frontend/          # React application
├── backend/           # Express.js API
├── cli/               # Command-line tools
├── config/            # Configuration templates
├── docker/            # Docker files
├── docs/              # Documentation
├── scripts/           # Utility scripts
├── tests/             # Test files
└── _extensions/       # Satellite components (ANT+, MIDI)
```

## Running Tests

```bash
npm test                    # All tests
npm run test:harvest        # Harvester tests
npm run test:coverage       # With coverage report
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

- Update relevant docs in `docs/` when changing functionality
- AI context files in `docs/ai-context/` help Claude understand the codebase
- See [CLAUDE.md](CLAUDE.md) for project conventions
