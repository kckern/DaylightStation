# Gratitude ownership

The server implementation owns domain records, application services/ports, YAML
persistence, HTTP router, printing, events and installed composition. Production
composition imports `server/public.mjs` (two factories); Fitness imports only
`server/print-gateway.mjs`. `server/rendering.mjs` stays behind the existing lazy
try/catch so native-renderer failure does not disable the API.

The owner factory receives the existing dataService authority explicitly. Feed
gets its default-household raw `readSelectionQuotes`; HomeBot gets only the
five-argument `addSelections` command. Household user ordering/display projection
belongs to `capabilities/household-identity/server/public.mjs`. Shared errors,
FileIO/render helpers and fonts remain canonical. The narrow backend system
library bridge preserves installed uuid/moment/Express identity; remove it only
when destination dependency ownership can preserve those versions natively.

Deployment remains outside this extraction checkpoint.

Browser consumers use `browser/public.mjs`, the separate `browser/admin.mjs`, and
`browser/assets.mjs` (the icon entry does not eagerly import the UI). FamilySelector
and its stylesheet/test belong to `capabilities/household-identity/browser/public.mjs`.
Vite anchors React/Mantine to frontend dependencies, resolves date-fns from that
same frontend package scope, and deduplicates React. Docker copies both owner roots.
