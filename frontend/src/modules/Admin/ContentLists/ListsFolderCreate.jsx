import React, { useState } from 'react';
import { Modal, TextInput, Button, Group, Stack } from '@mantine/core';

function ListsFolderCreate({ opened, onClose, onCreate, loading }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Folder name is required');
      return;
    }
    try {
      await onCreate(name.trim());
      setName('');
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to create folder');
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
      title="Create New Folder"
      centered
    >
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput
            label="Folder Name"
            placeholder="e.g., Morning Program"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={error}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={handleClose}>Cancel</Button>
            <Button type="submit" loading={loading}>Create</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export default ListsFolderCreate;
