# Flag Assets

50 flag SVGs, one per ISO country code used in `world.yml` (geography quiz source data).

- **Source:** [lipis/flag-icons](https://github.com/lipis/flag-icons)
- **Version:** 7.5.0
- **License:** MIT
- **Variant:** `4x3` (4:3 aspect ratio rectangular flags)

Files are named `<iso>.svg` with lowercase ISO 3166-1 alpha-2 codes (e.g. `fr.svg`, `us.svg`), matching the `iso` field in `world.yml`. Resolved at runtime by `../flags.js` via a lazy `import.meta.glob` (`?url`) lookup.
