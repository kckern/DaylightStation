# Work coordination

Work coordination separates contextual commitments in the Lifelog KB from authoritative tasks and project workflows in external providers. The lifelog records attributed history; Journalist is the conversational client. A refreshed snapshot or an old native in-progress label is not evidence of renewed user relevance.

## Configuration and routing

Household configuration lives only at `work/config.yml`; it does not inherit a legacy flat config file. The document contains a `work` block. See [the example](../../configuration/work.example.yml).

All features start disabled and read-only. Each participating username needs an explicit `work.users` entry. Provider aliases route domains to a provider type, logical account and explicit container ID. The same provider can serve personal actions and projects; a missing role is valid and an unknown domain never selects the first available list. Account references and state are scoped per user. Credentials stay in existing user/household auth stores.

Per-user scalar settings override household defaults. If a user supplies providers or domains, that map replaces the entire base map; hidden inherited destinations must not survive. Invalid routing/configuration disables Work participation. Invalid attention settings disable only proactive attention and retain valid manual read access. Empty review windows and opted-in domain lists schedule no housekeeping.

Configured provider operations are necessary permission, not proof a live adapter supports them. Command execution will separately check actual capability, current destination/account/version and authorized writer role. No external command path is active in the initial model/configuration increment.

## Source identity and dates

Work references include provider, account, object kind and opaque string ID. Never coerce IDs to numbers or match objects solely by title. Source creation, modification and completion timestamps are nullable and distinct from observedAt. A missing source date remains unknown. Recurring tasks retain occurrence identity separately from their enduring task ID.

## Implementation status

The first increment supplies model validation and per-user configuration contracts. Provider completeness, links, historical import, two-way commands and attention workflows are implemented in subsequent increments. Configuration alone does not start extraction, change provider status or authorize a backfill.
