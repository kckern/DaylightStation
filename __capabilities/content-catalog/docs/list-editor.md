# Controlled list editor

`ListDraftEditor` renders a list supplied by its host and emits UID-addressed edit commands. The host owns the draft, ID allocation, persistence and conflict handling. It can provide item settings and a read-only state; the editor does not write a legacy list on its own.

`ContentCombobox` normally portals its dropdown to the document body. A host that places it inside a modal should pass `withinPortal={false}` so its choices remain inside the dialog's accessibility and focus boundary. The shared item editor does this for content and action choices. Modal hosts should verify dropdown placement at their supported viewport sizes, especially inside scrollable dialogs.
