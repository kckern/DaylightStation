# Media Contracts

Single source of truth for wire-level shapes shared between the backend
media-control API and the screen-framework playback surface.

See `docs/reference/media/media-app-technical.md` §9 for canonical shape
definitions, §6.2 for the command envelope, §7 for topic layout.

Both backend and frontend resolve this directory via import alias.
Do not duplicate these shapes in consumer code.
