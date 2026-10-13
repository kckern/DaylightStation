# Gaming Authored Artifacts

Artifacts stay separate because they have different owners and versioning rules:

| Artifact | Pinning | Responsibility |
|---|---|---|
| Rules definition | content hash | Deterministic rule inputs and replay |
| Content pack | content hash | Questions, prompts, courses, encounters |
| Experience manifest | semantic version | Supported surfaces, authority modes, inputs, presenters, lifecycle capabilities, result schema, renderer embeddings |
| Environment profile | deployment configuration | Hardware, mappings, AI, printer, kiosk policy |
| Session setup | session record | Participants, teams, host, difficulty, run choices |
| Asset catalog | content hash | Renderer art, geometry, licensing metadata |
| Session record | revisioned snapshot + append-only journal | Replayable truth |

No “game YAML” or capability plugin may combine these classes. A native surface may embed a renderer using a projection adapter, but the renderer never receives gameplay authority.

## Mounted content boundary

Repository code defines only generic protocols, rules, mechanics, projections, and content schemas. Branded or franchise-specific experiences are not compiled rulesets, manifests, presenters, opponent rosters, acceptance assumptions, or built-in definitions.

Names, characters, decks, encounters, progression maps, artwork, sounds, type labels, and theme-specific copy belong in mounted rules definitions, content packs, and asset catalogs. Generic rules modules such as `card-battle` consume those artifacts without recognizing any franchise. Removing or replacing a mounted pack therefore requires no source change.

Every mounted rules artifact declares `artifact: { kind: gaming-rules, version: 1, id }` and `rule_module: { id, version }`. Every mounted content pack declares `artifact: { kind: gaming-content, version: 1, id }`. The loader strips only these envelopes before composing the validated runtime input; missing or mismatched envelopes fail closed.

Production definitions are loaded from the household `gaming/games` mount and pinned by hash. Git may contain small fictional fixtures solely to verify the generic schema; fixtures must not reproduce a production or franchise pack.

## Experience manifest v2

An experience is portable. Its manifest has `schema_version: 2`, a non-empty `surfaces` list, and `result_schema: gaming-result/v1`. Each surface declares its presenter, accepted semantic input sources, and supported authority modes. The caller chooses a surface; launch fails closed if the surface or authority is incompatible.

Presentation V2 is an optional renderer embedding. It receives an authority-safe `gaming-presentation/v1` projection and returns semantic intents only. Every optional embedding declares a projection and normal presenter fallback. Missing catalogs, assets, WebGL, or renderer support therefore cannot make the game unplayable.
