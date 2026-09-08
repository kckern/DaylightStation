# Dependency cycles and boundary bindings

Status: static source-cycle and proposed binding review; no source has moved.
The machine-readable [cycle review](dependency-cycle-review.json) carries every
concrete edge in all six SCCs, including the 57-member Fitness SCC.

| SCC | Classification | Required disposition |
|---|---|---|
| Utility errors | Same platform/system owner | Preserve or intentionally break the three barrel/error/timestamp edges under the utility card; this is not a cross-owner permission. |
| School documents | Same School product | Retain pending a School-owned card. |
| Chess CLI | Same command/product | Retain; it is not a platform command. |
| Browser logging/realtime | Platform web, but observability ↔ realtime subowners | Keep one Logger/transport/WebSocket graph; no duplicate singleton/context during extraction. |
| Player/School | Cross-product experience surfaces | Player cannot become a generic host while importing installed School surfaces. Keep product composition or first extract a product-free host seam. |
| Fitness UI | Same Fitness product UI/context graph | Retain the entire context/widget SCC; a reusable-looking widget does not become platform by itself. |

## Ports are not hidden imports

The Gratitude-to-Feed query and Gratitude-to-Homebot command are composition-
returned functions from `@daylight/gratitude/server/compose`. Feed and Homebot
do not receive private Gratitude imports: composition binds the function to their
own adapter/port. Household presentation is similarly returned by the household
composition entry and injected into Gratitude; its server adapter imports only
its local application port. The web roster client is the one proposed cross-owner
browser import and targets the existing platform HTTP entry.

Those are proposed source layouts, not current runtime facts. The review retains
the actual current composition imports separately, so a port label cannot conceal
a concrete runtime dependency, startup effect, or mutable identity. Every future
card must preserve its SCC disposition, list its real imports, and prove that no
new cycle or duplicate singleton/context is introduced.
