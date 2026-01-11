# Backend DDD Architecture

This directory contains the new Domain-Driven Design architecture.

**Full documentation:** `docs/_wip/plans/2026-01-10-backend-ddd-architecture.md`

## Layers

```
src/
├── 0_infrastructure/   # Foundation: wiring, bootstrap, cross-cutting concerns
├── 1_domains/          # Core: pure business logic, entities, no external deps
├── 2_adapters/         # Bridges: implements ports, talks to outside world
├── 3_applications/     # Orchestration: use cases, coordinates domain objects
└── 4_api/              # Presentation: HTTP routes, request/response handling
```

## Layer Responsibilities

| Layer | Purpose | Dependencies |
|-------|---------|--------------|
| `0_infrastructure` | Bootstrap, DI container, config loading | All layers (wires them together) |
| `1_domains` | Entities, value objects, domain services, ports | None (pure, isolated) |
| `2_adapters` | Implements domain ports, external integrations | `1_domains` |
| `3_applications` | Use case orchestration, business workflows | `1_domains`, `2_adapters` |
| `4_api` | HTTP controllers, routing, request validation | `3_applications`, `1_domains` |

## Dependency Rule

Dependencies flow **inward** toward the domain:

```
4_api → 3_applications → 1_domains ← 2_adapters
                              ↑
                       0_infrastructure (wires all)
```

## Guiding Principle

**Domain is heaven, adapter is earth.**

- Domains contain pure business logic with no I/O
- Adapters implement domain ports and handle external integrations
- Application layer is adapter-agnostic (receives interfaces, not implementations)
- Infrastructure wires everything together

## Migration Status

See `_legacy/` for the original backend code. Traffic routes through `_legacy/` until migration is complete.
