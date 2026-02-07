# Menu-in-Menu Resolution Audit

Date: 2026-02-07
Status: Draft

## Scope
- Nested list references in menu entries ("list: <name>") that should resolve to other menu lists.
- Admin list metadata resolution via info and list endpoints.

## Symptoms
- Menu entries using `list: <name>` display as unresolved in admin list views.
- `list:` inputs do not resolve to list metadata or children, even when the target list exists.

## Findings
- `list:` is treated as a content source when parsing list item inputs, but it is not a valid prefix for `ListAdapter` item lookup.
- `ListAdapter.getItem()` only accepts `menu`, `program`, `watchlist`, and `query` prefixes, so `list:<name>` returns null.
- The info route uses a unified parser that does not recognize `list` as a known source or alias, so it passes `list:<name>` straight through to the adapter, which fails to resolve.
- There is no normalization step in list item building to reinterpret `list:<name>` as a menu prefix (or another list type).

## Missing Behavior
- A menu entry should be able to point at another menu list using a stable, user-friendly prefix.
- `list:<name>` needs to resolve to `menu:<name>` (or a list-type-aware alias) before `getItem()` and `getList()` are called.
- The list source needs an adapter shape that matches the expectations of `ContentSearchCombobox` (container detection, `items` list, `itemType: 'container'`, `source`, `id`, `localId`, and usable `metadata.parentTitle` for breadcrumbs).

## Impact
- Nested menu structures cannot be browsed or previewed in admin views.
- Content search and info calls show unresolved labels for valid list entries.
- Sibling browsing in `ContentSearchCombobox` fails for `list:` inputs because it relies on `/api/v1/info/:source/:id` and derives `source` from the value prefix.

## Likely Fix Surface
- `ListAdapter` prefix parsing and/or list item normalization.
- `actionRouteParser` known sources and alias handling.
- Info routing when resolving compound IDs for list sources.
- Frontend list browsers that call `/api/v1/info/:source/:id` with `list:` prefixes (e.g., `ContentSearchCombobox`).

## Adapter Needs (ContentSearchCombobox)
- `list` inputs must resolve via `/api/v1/info/:source/:id` to a container payload with `items` so sibling browsing works.
- Items should include `id` (compound), `source`, `localId`, `title`, `type`, `itemType` (container when drillable), and `thumbnail`/`imageUrl` for avatars.
- Container children should expose parent metadata (`metadata.parentTitle`, `metadata.parentId`) if available so the breadcrumb back link can populate.
- For top-level browsing, `/api/v1/info/list/` (or alias to `menu`) should return list containers, not unresolved rows.

## Suggested Fix Options
1. Treat `list` as an alias for `menu` in the unified parser and registry prefix resolution.
2. Normalize list item inputs that start with `list:` to `menu:` during `_buildListItems()`.
3. Extend `ListAdapter._parseId()` to accept `list:<name>` and map to `menu` internally.

## Test Ideas
- Info request for `list:<name>` returns list metadata and children when the target menu exists.
- Menu entries using `list:<name>` render with proper title, thumbnail, and type.
- List navigation can drill into nested menu lists without unresolved states.

## Related Code:
- [backend/src/1_adapters/content/list/ListAdapter.mjs](backend/src/1_adapters/content/list/ListAdapter.mjs)
- [backend/src/4_api/v1/routers/info.mjs](backend/src/4_api/v1/routers/info.mjs)
- [backend/src/4_api/v1/utils/actionRouteParser.mjs](backend/src/4_api/v1/utils/actionRouteParser.mjs)
