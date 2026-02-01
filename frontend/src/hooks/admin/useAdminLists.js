import { useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

const API_BASE = '/api/v1/admin/content';

/**
 * Hook for managing admin lists (folders and items)
 */
export function useAdminLists() {
  const logger = useMemo(() => getLogger().child({ hook: 'useAdminLists' }), []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [folders, setFolders] = useState([]);
  const [items, setItems] = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null);

  // Fetch all folders
  const fetchFolders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await DaylightAPI(`${API_BASE}/lists`);
      setFolders(data.folders || []);
      logger.info('admin.lists.folders.fetched', { count: data.folders?.length });
      return data.folders;
    } catch (err) {
      setError(err);
      logger.error('admin.lists.folders.fetch.failed', { message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [logger]);

  // Fetch items in a folder
  const fetchItems = useCallback(async (folder) => {
    setLoading(true);
    setError(null);
    try {
      const data = await DaylightAPI(`${API_BASE}/lists/${folder}`);
      setItems(data.items || []);
      setCurrentFolder(folder);
      logger.info('admin.lists.items.fetched', { folder, count: data.items?.length });
      return data.items;
    } catch (err) {
      setError(err);
      logger.error('admin.lists.items.fetch.failed', { folder, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [logger]);

  // Create a new folder
  const createFolder = useCallback(async (name) => {
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`${API_BASE}/lists`, { name }, 'POST');
      logger.info('admin.lists.folder.created', { folder: result.folder });
      await fetchFolders();
      return result;
    } catch (err) {
      setError(err);
      logger.error('admin.lists.folder.create.failed', { name, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchFolders, logger]);

  // Delete a folder
  const deleteFolder = useCallback(async (folder) => {
    setLoading(true);
    setError(null);
    try {
      await DaylightAPI(`${API_BASE}/lists/${folder}`, {}, 'DELETE');
      logger.info('admin.lists.folder.deleted', { folder });
      await fetchFolders();
    } catch (err) {
      setError(err);
      logger.error('admin.lists.folder.delete.failed', { folder, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchFolders, logger]);

  // Add an item to current folder
  const addItem = useCallback(async (item) => {
    if (!currentFolder) throw new Error('No folder selected');
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`${API_BASE}/lists/${currentFolder}/items`, item, 'POST');
      logger.info('admin.lists.item.added', { folder: currentFolder, index: result.index });
      await fetchItems(currentFolder);
      return result;
    } catch (err) {
      setError(err);
      logger.error('admin.lists.item.add.failed', { folder: currentFolder, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentFolder, fetchItems, logger]);

  // Update an item
  const updateItem = useCallback(async (index, updates) => {
    if (!currentFolder) throw new Error('No folder selected');
    setLoading(true);
    setError(null);
    try {
      await DaylightAPI(`${API_BASE}/lists/${currentFolder}/items/${index}`, updates, 'PUT');
      logger.info('admin.lists.item.updated', { folder: currentFolder, index });
      await fetchItems(currentFolder);
    } catch (err) {
      setError(err);
      logger.error('admin.lists.item.update.failed', { folder: currentFolder, index, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentFolder, fetchItems, logger]);

  // Delete an item
  const deleteItem = useCallback(async (index) => {
    if (!currentFolder) throw new Error('No folder selected');
    setLoading(true);
    setError(null);
    try {
      await DaylightAPI(`${API_BASE}/lists/${currentFolder}/items/${index}`, {}, 'DELETE');
      logger.info('admin.lists.item.deleted', { folder: currentFolder, index });
      await fetchItems(currentFolder);
    } catch (err) {
      setError(err);
      logger.error('admin.lists.item.delete.failed', { folder: currentFolder, index, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentFolder, fetchItems, logger]);

  // Reorder items (full replacement)
  const reorderItems = useCallback(async (newItems) => {
    if (!currentFolder) throw new Error('No folder selected');
    setLoading(true);
    setError(null);
    try {
      await DaylightAPI(`${API_BASE}/lists/${currentFolder}`, { items: newItems }, 'PUT');
      setItems(newItems.map((item, index) => ({ ...item, index })));
      logger.info('admin.lists.reordered', { folder: currentFolder, count: newItems.length });
    } catch (err) {
      setError(err);
      logger.error('admin.lists.reorder.failed', { folder: currentFolder, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentFolder, logger]);

  // Toggle item active state (inline)
  const toggleItemActive = useCallback(async (index) => {
    const item = items.find(i => i.index === index);
    if (!item) return;
    await updateItem(index, { active: !item.active });
  }, [items, updateItem]);

  return {
    // State
    loading,
    error,
    folders,
    items,
    currentFolder,

    // Folder operations
    fetchFolders,
    createFolder,
    deleteFolder,

    // Item operations
    fetchItems,
    addItem,
    updateItem,
    deleteItem,
    reorderItems,
    toggleItemActive,

    // Helpers
    clearError: () => setError(null)
  };
}

export default useAdminLists;
