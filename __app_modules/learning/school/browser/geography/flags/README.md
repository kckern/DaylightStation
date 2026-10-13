# Flag Assets (generated)

The `<iso>.svg` files in this folder are **not tracked**. `npm run prepare:assets` (frontend `prebuild`)
copies them from the `flag-icons` npm devDependency (lipis/flag-icons, MIT, `flags/4x3`).

- **Which flags:** the 50 ISO 3166-1 alpha-2 codes in `../flag-codes.json` (those used by `world.yml`).
- **Adding a flag:** add the code to `flag-codes.json`; `flags.test.js` asserts every listed code resolves.
- **Resolved at runtime** by `../flags.js` via a lazy `import.meta.glob` (`?url`) lookup.
