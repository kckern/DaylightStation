import React, { useEffect, useState } from 'react';
import { Modal, Group, Button, Alert, Stack } from '@mantine/core';

/**
 * Modal that edits a list item's `params` with the item type's own Editor
 * (see ./registry.js). Save sends `{params: draft}`, Clear sends
 * `{params: null}`; both go through the row's `onUpdate`, which resolves to
 * `{ok, error}` from the Lists folder's mutation runner. A rejected or
 * `ok:false` save keeps the modal open and shows the error inline.
 */
export default function ItemParamsModal({ opened, onClose, paramsType, item, itemLabel, onUpdate, log }) {
  const [draft, setDraft] = useState(() => structuredClone(item.params || {}));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Start every opening from the stored params.
  useEffect(() => {
    if (!opened) return;
    setDraft(structuredClone(item.params || {}));
    setError(null);
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const send = async (kind, updates) => {
    const context = { index: item.index, type: paramsType.id };
    log?.info(`lists.item.params.${kind}`, context);
    setSaving(true);
    setError(null);
    let result;
    try {
      result = await onUpdate(updates);
    } catch (err) {
      result = { ok: false, error: err };
    }
    setSaving(false);
    if (result && result.ok === false) {
      // ok:false with no error means the folder refused the write because
      // another change was still in flight (ListsFolder mutate guard).
      const message = result.error
        ? (result.error.message || 'Could not save parameters')
        : 'Another change is still saving — try again';
      log?.warn(`lists.item.params.${kind}.failed`, { ...context, message });
      setError(message);
      return;
    }
    onClose();
  };

  const { Editor } = paramsType;
  const hasParams = item.params != null;

  return (
    <Modal opened={opened} onClose={onClose} size="lg" title={`${paramsType.label} · ${itemLabel}`}>
      <Stack gap="sm">
        {opened && <Editor value={draft} onChange={setDraft} />}
        {error && <Alert color="red" variant="light" role="alert">{error}</Alert>}
        <Group justify="flex-end" gap="xs">
          {hasParams && (
            <Button variant="subtle" color="red" size="xs" disabled={saving} onClick={() => send('clear', { params: null })}>
              Clear
            </Button>
          )}
          <Button variant="default" size="xs" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button size="xs" loading={saving} onClick={() => send('save', { params: draft })}>Save</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
