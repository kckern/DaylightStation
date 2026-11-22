# List item parameters

A content-list item can carry `params`: a plain object whose keys belong to the
item's type. A list stays a list. The parameters give one row type-specific
settings without a separate editor or document.

```yaml
- label: Charades
  input: app:party-games/charades:fhe
  action: Open
  params:
    autostart: true
    participants: [<user id>, <named-guest id>, ...]
    clue_modes: { <id>: reader }   # ids not listed play with text clues
```

## Storage and the admin API

- `listConfigCodec.normalizeListItem` and `listItemInput.normalizeListItem` keep
  `params` when it is a plain object with at least one key. A string, an array,
  `{}` or a class instance is dropped. `isPlainObject` and `isParamsObject` are
  exported from `__capabilities/content-catalog/server/domain/utils/listConfigCodec.mjs`.
- Admin `addItem` and `updateItem` (`ListManagementService`) accept `params`:
  - `null` or `{}` removes the key;
  - any other value that is not a plain object is a `ValidationError`;
  - a valid value is stored as a clone.

  An update that leaves `params` out keeps the stored value.
- `swapItems` moves `params` with the content, not the row.

## Runtime: how params reach an app

1. `ListAdapter._buildListItems` attaches the item's params to its `open` action
   (`withParams`). Item params win over any `params` already inside a YAML `open:` block.
2. `toListItem` copies `open` whole, and the menu passes it to `AppContainer`.
3. `AppContainer.appPropsFromOpen` passes the object to the app as a `params` prop,
   next to the registry's single named param (e.g. `definitionId`).
4. Queues and programs: `resolvePlayables` stamps params on the `format:'app'`
   playables of an item that is itself an app (never on a nested list's apps).
   `toQueueItem` keeps them, and `PlayableAppShell` opens the app with `{app, params}`.
   Watchlist children do not carry params.

## Admin: editing parameters

A type registers once (in `frontend/src/Apps/AdminApp.jsx`):

```js
registerItemParams({
  id: 'charades', label: 'Charades',
  matches: input => /^app:party-games\/charades:/.test(input),
  summary: p => '…',            // tooltip and aria-label text
  Editor: CharadesItemParams,   // ({ value, onChange }) — modal body only
});
```

Then, in the Lists table:

- A row whose input matches a type gets a gear button in the Config column. The
  gear is dimmed until params are set, and its tooltip shows the summary. The row's
  ⋮ menu gets "Parameters…". Both open one modal holding the type's editor, with
  Clear / Cancel / Save. Nothing renders under or between rows.
- A list that has at least one such row gets `lists-view--has-params`, which widens
  the Config column to 80px for the header and every row together. Lists without
  parameterised rows keep the original 36px layout.
- The admin "Open" preview runs the app with the item's params.

Rows whose type has no registration look and behave exactly as before.

## Party Games (Charades)

`__app_modules/games/party-games/browser/app/itemParams.js`:

- `autostart` and `participants` become launch overrides. An explicit URL query
  (`?autostart=`, `?participants=`) still wins.
- `clue_modes` becomes `setup.charades_presentation`, covering every seated
  participant (default `text`). It is sent only when at least one seated id has a
  valid mode. Otherwise the `rules.yml` presentation applies, as it does for team seats.
- A saved session resumes against the merged launch roster, so item participants
  that differ from `rules.yml` do not discard the saved game on refresh.
- The editor (`browser/admin/CharadesItemParams.jsx`) shows people as photo pills
  built from the id (`/static/img/users/<id>`), with initials only when the image
  fails. People are added through one "Add person…" combobox, with "New guest…"
  as its last option. It reads `GET /api/v1/admin/people`, which works with Agenda
  disabled.

## Logs

- `lists.item.params.open`, `.save`, `.clear` (admin row)
- `app-container-open` (with `hasParams`)
- `party-games.item-params-applied`
- `charades.params.unknown-participant`
- `people.guest.create.failed`
