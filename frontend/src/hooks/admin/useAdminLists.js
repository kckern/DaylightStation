import { useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

const API_BASE = '/api/v1/admin/content';

/**
 * Hook for managing admin config lists (menus, watchlists, programs)
 */
export function useAdminLists() {
  const logger = useMemo(() => getLogger().child({ hook: 'useAdminLists' }), []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lists, setLists] = useState([]);
  const [items, setItems] = useState([]);
  const [currentType, setCurrentType] = useState(null);
  const [currentList, setCurrentList] = useState(null);

  // Fetch all lists of a specific type
  const fetchLists = useCallback(async (type) => {
    setLoading(true);
    setError(null);
    try {
      const data = await DaylightAPI(`${API_BASE}/lists/${type}`);
      setLists(data.lists || []);
      setCurrentType(type);
      logger.info('admin.lists.fetched', { type, count: data.lists?.length });
      return data.lists;
    } catch (err) {
      setError(err);
      logger.error('admin.lists.fetch.failed', { type, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [logger]);

  // Fetch items in a list
  const fetchItems = useCallback(async (type, listName) => {
    setLoading(true);
    setError(null);
    try {
      const data = await DaylightAPI(`${API_BASE}/lists/${type}/${listName}`);
      setItems(data.items || []);
      setCurrentType(type);
      setCurrentList(listName);
      logger.info('admin.lists.items.fetched', { type, list: listName, count: data.items?.length });
      return data.items;
    } catch (err) {
      setError(err);
      logger.error('admin.lists.items.fetch.failed', { type, list: listName, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [logger]);

  // Create a new list
  const createList = useCallback(async (type, name) => {
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`${API_BASE}/lists/${type}`, { name }, 'POST');
      logger.info('admin.lists.created', { type, list: result.list });
      await fetchLists(type);
      return result;
    } catch (err) {
      setError(err);
      logger.error('admin.lists.create.failed', { type, name, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchLists, logger]);

  // Delete a list
  const deleteList = useCallback(async (type, listName) => {
    setLoading(true);
    setError(null);
    try {
      await DaylightAPI(`${API_BASE}/lists/${type}/${listName}`, {}, 'DELETE');
      logger.info('admin.lists.deleted', { type, list: listName });
      await fetchLists(type);
    } catch (err) {
      setError(err);
      logger.error('admin.lists.delete.failed', { type, list: listName, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchLists, logger]);

  // Add an item to current list
  const addItem = useCallback(async (item) => {
    if (!currentType || !currentList) throw new Error('No list selected');
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/items`, item, 'POST');
      logger.info('admin.lists.item.added', { type: currentType, list: currentList, index: result.index });
      await fetchItems(currentType, currentList);
      return result;
    } catch (err) {
      setError(err);
      logger.error('admin.lists.item.add.failed', { type: currentType, list: currentList, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentType, currentList, fetchItems, logger]);

  // Update an item
  const updateItem = useCallback(async (index, updates) => {
    if (!currentType || !currentList) throw new Error('No list selected');
    setLoading(true);
    setError(null);
    try {
      await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/items/${index}`, updates, 'PUT');
      logger.info('admin.lists.item.updated', { type: currentType, list: currentList, index });
      await fetchItems(currentType, currentList);
    } catch (err) {
      setError(err);
      logger.error('admin.lists.item.update.failed', { type: currentType, list: currentList, index, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentType, currentList, fetchItems, logger]);

  // Delete an item
  const deleteItem = useCallback(async (index) => {
    if (!currentType || !currentList) throw new Error('No list selected');
    setLoading(true);
    setError(null);
    try {
      await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/items/${index}`, {}, 'DELETE');
      logger.info('admin.lists.item.deleted', { type: currentType, list: currentList, index });
      await fetchItems(currentType, currentList);
    } catch (err) {
      setError(err);
      logger.error('admin.lists.item.delete.failed', { type: currentType, list: currentList, index, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentType, currentList, fetchItems, logger]);

  // Reorder items (full replacement)
  const reorderItems = useCallback(async (newItems) => {
    if (!currentType || !currentList) throw new Error('No list selected');
    setLoading(true);
    setError(null);
    try {
      await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}`, { items: newItems }, 'PUT');
      setItems(newItems.map((item, index) => ({ ...item, index })));
      logger.info('admin.lists.reordered', { type: currentType, list: currentList, count: newItems.length });
    } catch (err) {
      setError(err);
      logger.error('admin.lists.reorder.failed', { type: currentType, list: currentList, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentType, currentList, logger]);

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
    lists,
    items,
    currentType,
    currentList,

    // List operations
    fetchLists,
    createList,
    deleteList,

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
