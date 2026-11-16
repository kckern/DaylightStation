# Controlled list editor

`ListDraftEditor` renders a list supplied by its host and emits UID-addressed edit commands. The host owns the draft, ID allocation, persistence and conflict handling. It can provide item settings and a read-only state; the editor does not write a legacy list on its own.

`ContentCombobox` normally portals its dropdown to the document body. A host that places it inside a modal should pass `withinPortal={false}` so its choices remain inside the dialog's accessibility and focus boundary. The shared item editor does this for content and action choices. Modal hosts should verify dropdown placement at their supported viewport sizes, especially inside scrollable dialogs.

Row-handle pointer dragging moves a UID and keeps its content, artwork, and host settings together. Content-handle dragging swaps row contents while retaining row UIDs; Agenda swaps the associated activity bindings with those contents. Modal edits and deletion address the current UID after either operation. Read-only rows are inert and emit no edits. The isolated Chromium harness `node tests/_infrastructure/harnesses/agenda-editor-pointer.mjs` verifies these gestures, binding retention, modal focus return, and read-only behavior without a server.
