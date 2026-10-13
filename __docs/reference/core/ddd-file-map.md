# DDD File Map

**Last Updated:** 2026-10-13

Directory-level map of the retained backend layers in `__backend/src/`. Application and capability code lives in `__app_modules/<category>/<app>/server/` and `__capabilities/<cap>/server/`; see [Project Layout](./project-layout.md) for those. An earlier version of this page listed individual files with their legacy-source equivalents; the legacy tree has been removed and file-level listings went stale, so use the filesystem for file-level detail.

---

## 0_system/

Cross-cutting concerns (config, logging, eventbus, scheduling, http, persistence).

| Directory |
|-----------|
| `0_system/auth/` |
| `0_system/boot/` |
| `0_system/clock/` |
| `0_system/config/` |
| `0_system/encryption/` |
| `0_system/eventbus/` |
| `0_system/http/` |
| `0_system/libraries/` |
| `0_system/logging/` |
| `0_system/modules/` |
| `0_system/persistence/` |
| `0_system/proxy/` |
| `0_system/runtime/` |
| `0_system/scheduling/` |
| `0_system/secrets/` |
| `0_system/services/` |
| `0_system/testing/` |
| `0_system/utils/` |

## 1_adapters/

External integrations and persistence.

| Directory |
|-----------|
| `1_adapters/admin/` |
| `1_adapters/ai/` |
| `1_adapters/auth/` |
| `1_adapters/catalog/` |
| `1_adapters/config/` |
| `1_adapters/content/` |
| `1_adapters/cost/` |
| `1_adapters/devices/` |
| `1_adapters/entropy/` |
| `1_adapters/eventbus/` |
| `1_adapters/feedback/` |
| `1_adapters/finance/` |
| `1_adapters/google/` |
| `1_adapters/hardware/` |
| `1_adapters/harvester/` |
| `1_adapters/http/` |
| `1_adapters/identity/` |
| `1_adapters/integrations/` |
| `1_adapters/jamcorder/` |
| `1_adapters/komga/` |
| `1_adapters/logging/` |
| `1_adapters/messaging/` |
| `1_adapters/notification/` |
| `1_adapters/persistence/` |
| `1_adapters/process/` |
| `1_adapters/proxy/` |
| `1_adapters/qrcode/` |
| `1_adapters/reference/` |
| `1_adapters/runtime/` |
| `1_adapters/scan/` |
| `1_adapters/scheduling/` |
| `1_adapters/secrets/` |
| `1_adapters/telegram/` |
| `1_adapters/video/` |

## 1_rendering/

Server-side presentation (canvas, PDF, QR code).

| Directory |
|-----------|
| `1_rendering/canvas/` |
| `1_rendering/lib/` |
| `1_rendering/pdf/` |
| `1_rendering/placeholder/` |
| `1_rendering/qrcode/` |
| `1_rendering/static-assets/` |

## 2_domains/

Shared business logic.

| Directory |
|-----------|
| `2_domains/barcode/` |
| `2_domains/common/` |
| `2_domains/content/` |
| `2_domains/core/` |
| `2_domains/cost/` |
| `2_domains/devices/` |
| `2_domains/entropy/` |
| `2_domains/finance/` |
| `2_domains/journaling/` |
| `2_domains/messaging/` |
| `2_domains/midi/` |
| `2_domains/notification/` |
| `2_domains/scan/` |
| `2_domains/scheduling/` |
| `2_domains/shutdown/` |

## 3_applications/

Shared use-case orchestration and ports.

| Directory |
|-----------|
| `3_applications/admin/` |
| `3_applications/agents/` |
| `3_applications/ai/` |
| `3_applications/auth/` |
| `3_applications/common/` |
| `3_applications/config/` |
| `3_applications/cost/` |
| `3_applications/devices/` |
| `3_applications/entropy/` |
| `3_applications/eventbus/` |
| `3_applications/events/` |
| `3_applications/finance/` |
| `3_applications/hardware/` |
| `3_applications/harvester/` |
| `3_applications/journalist/` |
| `3_applications/logging/` |
| `3_applications/messaging/` |
| `3_applications/midi/` |
| `3_applications/notification/` |
| `3_applications/presentation/` |
| `3_applications/printer/` |
| `3_applications/qrcode/` |
| `3_applications/reference/` |
| `3_applications/scan/` |
| `3_applications/scheduling/` |
| `3_applications/shutdown/` |
| `3_applications/static-assets/` |
| `3_applications/tts/` |

## 4_api/

HTTP routing, middleware and v1 routers.

| Directory |
|-----------|
| `4_api/middleware/` |
| `4_api/utils/` |
| `4_api/v1/` |

## 5_composition/

Bootstrap and installed composition.

| Directory |
|-----------|
| `5_composition/integrations/` |
| `5_composition/modules/` |
| `5_composition/policies/` |

---

## See Also

- [Backend Architecture](./backend-architecture.md) - Architecture overview
- [Project Layout](./project-layout.md) - Contributor map
- [Migration Summary](./migration-summary.md) - Migration status
