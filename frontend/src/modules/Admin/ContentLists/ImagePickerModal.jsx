import React, { useState, useEffect } from 'react';
import { Modal, Tabs, Image, Button, TextInput, Group, Stack, Text, Box, Loader, ActionIcon } from '@mantine/core';
import { Dropzone, IMAGE_MIME_TYPE } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { IconUpload, IconPhoto, IconLink, IconX, IconTrash } from '@tabler/icons-react';
import { DaylightMediaPath } from '../../../lib/api.mjs';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * ImagePickerModal — Pick, upload, or paste URL for item override thumbnails.
 *
 * Each action (upload, browse-select, URL-set, remove) fires onSave immediately.
 * Modal stays open so user sees the preview update; "Done" closes it.
 */
function ImagePickerModal({ opened, onClose, currentImage, inheritedImage, onSave, inUseImages = new Set() }) {
  const [activeTab, setActiveTab] = useState('upload');
  const [uploading, setUploading] = useState(false);
  const [browseImages, setBrowseImages] = useState(null); // null = not loaded yet
  const [browseLoading, setBrowseLoading] = useState(false);
  const [urlValue, setUrlValue] = useState('');

  // Reset URL input when modal opens
  useEffect(() => {
    if (opened) setUrlValue('');
  }, [opened]);

  // Ctrl+V paste support: image data or URL string
  useEffect(() => {
    if (!opened) return;

    async function handlePaste(e) {
      if (uploading) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      // Check for image blob first (screenshot / copied image)
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) return;
          setUploading(true);
          try {
            const formData = new FormData();
            formData.append('image', blob, `paste-${Date.now()}.${blob.type.split('/')[1] || 'png'}`);
            const res = await fetch('/api/v1/admin/images/upload', { method: 'POST', body: formData });
            if (!res.ok) throw new Error('Upload failed');
            const result = await res.json();
            onSave(result.path);
          } catch (err) {
            notifications.show({ title: 'Paste upload failed', message: err.message, color: 'red' });
          } finally {
            setUploading(false);
          }
          return;
        }
      }

      // Check for URL text
      const text = e.clipboardData.getData('text/plain')?.trim();
      if (text && text.startsWith('http')) {
        e.preventDefault();
        setUploading(true);
        try {
          const res = await fetch('/api/v1/admin/images/upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: text })
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || 'URL upload failed');
          }
          const result = await res.json();
          onSave(result.path);
        } catch (err) {
          notifications.show({ title: 'Paste URL failed', message: err.message, color: 'red' });
        } finally {
          setUploading(false);
        }
      }
    }

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [opened, uploading, onSave]);

  // Resolve display URL for preview
  const previewSrc = currentImage
    ? (currentImage.startsWith('/media/') || currentImage.startsWith('media/')
        ? DaylightMediaPath(currentImage)
        : currentImage)
    : inheritedImage || null;

  const isCustom = !!currentImage;

  // --- Upload handlers ---

  async function handleFileDrop(files) {
    if (!files.length) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', files[0]);
      const res = await fetch('/api/v1/admin/images/upload', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      const result = await res.json();
      onSave(result.path);
    } catch (err) {
      notifications.show({ title: 'Upload failed', message: err.message, color: 'red' });
    } finally {
      setUploading(false);
    }
  }

  async function handleUrlDrop(e) {
    // Detect URL drops onto the dropzone
    const uri = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '';
    if (!uri.startsWith('http')) return;
    e.preventDefault();
    setUploading(true);
    try {
      const res = await fetch('/api/v1/admin/images/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: uri })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'URL upload failed');
      }
      const result = await res.json();
      onSave(result.path);
    } catch (err) {
      notifications.show({ title: 'URL upload failed', message: err.message, color: 'red' });
    } finally {
      setUploading(false);
    }
  }

  // --- Browse handlers ---

  async function loadBrowseImages() {
    if (browseImages !== null) return; // already loaded
    setBrowseLoading(true);
    try {
      const res = await fetch('/api/v1/admin/images/list');
      if (!res.ok) throw new Error('Failed to load images');
      const data = await res.json();
      setBrowseImages(data.images || []);
    } catch (err) {
      notifications.show({ title: 'Failed to load images', message: err.message, color: 'red' });
      setBrowseImages([]);
    } finally {
      setBrowseLoading(false);
    }
  }

  function handleBrowseSelect(img) {
    onSave(img.path);
  }

  // --- URL handler ---

  function handleUrlSet() {
    const trimmed = urlValue.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setUrlValue('');
  }

  // --- Remove ---

  function handleRemove() {
    onSave(null);
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Item Image" centered size="md">
      <Stack gap="md">
        {/* Current image preview */}
        <Box style={{ textAlign: 'center' }}>
          {previewSrc ? (
            <Image src={previewSrc} height={200} fit="contain" radius="sm" />
          ) : (
            <Box
              style={{
                height: 200,
                border: '2px dashed var(--mantine-color-dark-4)',
                borderRadius: 'var(--mantine-radius-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Text c="dimmed" size="sm">No image</Text>
            </Box>
          )}
          <Group justify="center" mt="xs" gap="xs">
            <Text size="xs" c={isCustom ? 'blue' : 'dimmed'}>
              {isCustom ? 'Custom' : 'Inherited'}
            </Text>
            {isCustom && (
              <Button
                size="compact-xs"
                variant="subtle"
                color="red"
                leftSection={<IconTrash size={12} />}
                onClick={handleRemove}
              >
                Remove Override
              </Button>
            )}
          </Group>
        </Box>

        {/* Tabs */}
        <Tabs value={activeTab} onChange={(v) => {
          setActiveTab(v);
          if (v === 'browse') loadBrowseImages();
        }}>
          <Tabs.List>
            <Tabs.Tab value="upload" leftSection={<IconUpload size={14} />}>Upload</Tabs.Tab>
            <Tabs.Tab value="browse" leftSection={<IconPhoto size={14} />}>Browse</Tabs.Tab>
            <Tabs.Tab value="url" leftSection={<IconLink size={14} />}>URL</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="upload" pt="sm">
            <Dropzone
              onDrop={handleFileDrop}
              onReject={() => notifications.show({ title: 'Invalid file', message: 'Use JPEG, PNG, or WebP under 5MB', color: 'red' })}
              maxSize={MAX_FILE_SIZE}
              accept={IMAGE_MIME_TYPE}
              loading={uploading}
              onDragOver={(e) => {
                // Allow URL drops
                const uri = e.dataTransfer?.types?.includes('text/uri-list') || e.dataTransfer?.types?.includes('text/plain');
                if (uri) e.preventDefault();
              }}
              onDropCapture={handleUrlDrop}
            >
              <Group justify="center" gap="xl" mih={120} style={{ pointerEvents: 'none' }}>
                <Dropzone.Accept>
                  <IconUpload size={40} stroke={1.5} />
                </Dropzone.Accept>
                <Dropzone.Reject>
                  <IconX size={40} stroke={1.5} />
                </Dropzone.Reject>
                <Dropzone.Idle>
                  <IconPhoto size={40} stroke={1.5} />
                </Dropzone.Idle>
                <div>
                  <Text size="sm" inline>Drag image here or click to browse</Text>
                  <Text size="xs" c="dimmed" inline mt={4}>JPEG, PNG, WebP — max 5MB. Ctrl+V to paste image or URL.</Text>
                </div>
              </Group>
            </Dropzone>
          </Tabs.Panel>

          <Tabs.Panel value="browse" pt="sm">
            {browseLoading ? (
              <Group justify="center" mih={120}><Loader size="sm" /></Group>
            ) : browseImages && browseImages.length > 0 ? (
              <div className="image-picker-grid">
                {browseImages.map(img => {
                  const imgSrc = DaylightMediaPath(img.path);
                  const isInUse = inUseImages.has(img.path);
                  const isSelected = currentImage === img.path;
                  const cls = ['image-picker-thumb'];
                  if (isInUse) cls.push('in-use');
                  if (isSelected) cls.push('selected');
                  return (
                    <div
                      key={img.filename}
                      className={cls.join(' ')}
                      onClick={() => handleBrowseSelect(img)}
                      title={img.filename}
                    >
                      <img src={imgSrc} alt={img.filename} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <Text size="sm" c="dimmed" ta="center" py="xl">No uploaded images yet</Text>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="url" pt="sm">
            <Group align="flex-end">
              <TextInput
                style={{ flex: 1 }}
                placeholder="Paste image URL..."
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleUrlSet(); }}
              />
              <Button onClick={handleUrlSet} disabled={!urlValue.trim()}>Set</Button>
            </Group>
          </Tabs.Panel>
        </Tabs>

        {/* Done button */}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>Done</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default ImagePickerModal;
