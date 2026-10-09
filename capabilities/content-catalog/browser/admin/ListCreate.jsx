import React, { useState } from 'react';
import { Modal, TextInput, Button, Group, Stack } from '@mantine/core';

function ListCreate({ opened, onClose, onCreate, loading, typeLabel = 'List' }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(`${typeLabel} name is required`);
      return;
    }
    try {
      await onCreate(name.trim());
      setName('');
      setError('');
    } catch (err) {
      setError(err.message || `Failed to create ${typeLabel.toLowerCase()}`);
    }
  };

  const handleClose = () => {
    setName('');
    setError('');
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={`Create New ${typeLabel}`}
      centered
    >
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput
            label={`${typeLabel} Name`}
            placeholder={`e.g., My ${typeLabel}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={error}
            data-autofocus
            data-testid="list-name-input"
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={handleClose}>Cancel</Button>
            <Button type="submit" loading={loading} data-testid="create-list-submit">Create</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export default ListCreate;
