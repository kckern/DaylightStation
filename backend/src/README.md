# Backend DDD Architecture

This directory contains the new Domain-Driven Design architecture.

**Full documentation:** `docs/_wip/plans/2026-01-10-backend-ddd-architecture.md`

## Structure

```
src/
├── domains/          # HEAVEN - pure business logic, no external deps
├── adapters/         # EARTH - implements ports, talks to outside world
├── infrastructure/   # Wiring, cross-cutting concerns
├── applications/     # Use case orchestration (bots, jobs)
└── api/              # HTTP entry points
```

## Guiding Principle

**Domain is heaven, adapter is earth.**

- Domains contain pure business logic with no I/O
- Adapters implement domain ports and handle external integrations
- Application layer is adapter-agnostic (receives interfaces, not implementations)
- Infrastructure wires everything together

## Migration Status

See `_legacy/` for the original backend code. Traffic routes through `_legacy/` until migration is complete.
