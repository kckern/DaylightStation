# Playback Hub validator-parity fixtures

Shared between `_extensions/playback-hub/validate_config.py` (Python) and
`backend/src/1_adapters/persistence/yaml/YamlHubConfigDatastore.mjs` (JS, future).

- `invalid/*.yml` — each must be REJECTED by both validators.
  Filename prefix `NN-` = rule index (matches the 11 rules in the design's
  Validation strategy section). File contents document the rule being tested.

- `valid/*.yml` — each must be ACCEPTED by both validators.
  Paired with `*.expected.json` showing the canonical normalized form
  (post-default-fill). Both validators must produce equivalent JSON.

Adding a new rule = adding a fixture in both sets AND adding the rejection
(or normalization) logic to both validators. CI catches drift.
