import { useApiResource, invalidateApiResources } from '../../../../frontend/src/lib/hooks/useApiResource.js';
import { FormDialog } from '../../../../frontend/src/lib/ui/FormDialog.jsx';
import { ErrorState } from '../../../../frontend/src/lib/ui/states.jsx';
import React, { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { Tabs, Image, Button, TextInput, Group, Stack, Text, Box, Loader } from '@mantine/core';
import { Dropzone, IMAGE_MIME_TYPE } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { IconUpload, IconPhoto, IconLink, IconX, IconTrash } from '@tabler/icons-react';
import { DaylightMediaPath, daylightApiResponse } from "../../../../frontend/src/lib/api.mjs";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const imageListPath = '/api/v1/admin/images/list';

/**
 * ImagePickerModal — Pick, upload, or paste URL for item override thumbnails.
 *
 * Each action (upload, browse-select, URL-set, remove) fires onSave immediately.
 * Modal stays open so user sees the preview update; "Done" closes it.
 */
function ImagePickerModal({ opened, onClose, currentImage, inheritedImage, onSave, inUseImages = new Set() }) {
  const [activeTab, setActiveTab] = useState('upload');
  const [uploading, setUploading] = useState(false);
  const pending = useRef(null);
  const [urlValue, setUrlValue] = useState('');

  useLayoutEffect(() => {
    setUploading(false);
    return () => { pending.current = null; };
  }, [opened]);

  function selectImage(value) {
    pending.current = null;
    setUploading(false);
    onSave(value);
  }

  // Reset URL input when modal opens
  useEffect(() => {
    if (opened) setUrlValue('');
  }, [opened]);

  const upload = useCallback(async (input, errorTitle, filename) => {
    if (pending.current) return;
    const request = Symbol();
    pending.current = request;
    setUploading(true);
    try {
      const fromUrl = typeof input === 'string';
      const data = fromUrl ? { url: input } : new FormData();
      if (!fromUrl) data.append('image', input, filename || input.name);
      const endpoint = fromUrl ? '/api/v1/admin/images/upload-url' : '/api/v1/admin/images/upload';
      const response = await daylightApiResponse(endpoint, { method: 'POST', data });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error || (fromUrl ? 'URL upload failed' : 'Upload failed'));
      }
      const result = await response.json();
      if (!result?.path) throw new Error('Upload did not return an image path');
      invalidateApiResources(path => path === imageListPath);
      if (pending.current === request) onSave(result.path);
    } catch (err) {
      if (pending.current === request) notifications.show({ title: errorTitle, message: err.message, color: 'red' });
    } finally {
      if (pending.current === request) {
        pending.current = null;
        setUploading(false);
      }
    }
  }, [onSave]);

  // Ctrl+V paste support: image data or URL string
  useEffect(() => {
    if (!opened) return;

    async function handlePaste(e) {
      if (pending.current) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      // Check for image blob first (screenshot / copied image)
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) return;
          await upload(blob, 'Paste upload failed', `paste-${Date.now()}.${blob.type.split('/')[1] || 'png'}`);
          return;
        }
      }

      // Check for URL text
      const text = e.clipboardData.getData('text/plain')?.trim();
      if (text && text.startsWith('http')) {
        e.preventDefault();
        await upload(text, 'Paste URL failed');
      }
    }

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [opened, upload]);

  // Resolve display URL for preview
  const previewSrc = currentImage
    ? (currentImage.startsWith('/media/') || currentImage.startsWith('media/')
        ? DaylightMediaPath(currentImage)
        : currentImage)
    : inheritedImage || null;

  const isCustom = !!currentImage;

  // --- Upload handlers ---

  function handleFileDrop(files) {
    if (files[0]) upload(files[0], 'Upload failed');
  }

  function handleUrlDrop(e) {
    const uri = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '';
    if (!uri.startsWith('http')) return;
    e.preventDefault();
    upload(uri, 'URL upload failed');
  }

  // --- URL handler ---

  function handleUrlSet() {
    const trimmed = urlValue.trim();
    if (!trimmed) return;
    selectImage(trimmed);
    setUrlValue('');
  }

  // --- Remove ---

  function handleRemove() {
    selectImage(null);
  }

  return (
    <FormDialog opened={opened} onClose={onClose} title="Item Image" centered size="md">
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
        <Tabs value={activeTab} onChange={setActiveTab}>
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
            {opened && activeTab === 'browse' && (
              <ImageInventory currentImage={currentImage} inUseImages={inUseImages} onSelect={selectImage} />
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
    </FormDialog>
  );
}

function ImageInventory({ currentImage, inUseImages, onSelect }) {
  const { data, loading, error, reload } = useApiResource(imageListPath, { swr: true });
  if (loading) return <Group justify="center" mih={120}><Loader size="sm" /></Group>;
  if (error) return <ErrorState label="Uploaded images" error={error} onRetry={reload} />;
  const images = data?.images || [];
  if (!images.length) return <Text size="sm" c="dimmed" ta="center" py="xl">No uploaded images yet</Text>;
  return (
    <div className="image-picker-grid">
      {images.map(img => {
        const imgSrc = DaylightMediaPath(img.path);
        const isInUse = inUseImages.has(img.path);
        const isSelected = currentImage === img.path;
        const cls = ['image-picker-thumb'];
        if (isInUse) cls.push('in-use');
        if (isSelected) cls.push('selected');
        return (
          <button type="button"
            key={img.filename}
            className={cls.join(' ')}
            onClick={() => onSelect(img.path)}
            title={img.filename}
          >
            <img src={imgSrc} alt={img.filename} />
          </button>
        );
      })}
    </div>
  );
}

export default ImagePickerModal;
