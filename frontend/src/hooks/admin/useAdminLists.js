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
  const [sections, setSections] = useState([]);
  const [listMetadata, setListMetadata] = useState(null);
  const [currentType, setCurrentType] = useState(null);
  const [currentList, setCurrentList] = useState(null);

  const flatItems = useMemo(() =>
    sections.flatMap((section, si) =>
      section.items.map((item, ii) => ({ ...item, sectionIndex: si, itemIndex: ii, sectionTitle: section.title }))
    ), [sections]);

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

  // Fetch a list (sections + metadata)
  const fetchList = useCallback(async (type, listName) => {
    setLoading(true);
    setError(null);
    try {
      const data = await DaylightAPI(`${API_BASE}/lists/${type}/${listName}`);
      setSections(data.sections || []);
      const { sections: _, ...metadata } = data;
      setListMetadata(metadata);
      setCurrentType(type);
      setCurrentList(listName);
      logger.info('admin.lists.fetched', { type, list: listName, sectionCount: data.sections?.length });
      return data.sections;
    } catch (err) {
      setError(err);
      logger.error('admin.lists.fetch.failed', { type, list: listName, message: err.message });
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

  // Add an item to a section in the current list
  const addItem = useCallback(async (sectionIndex, item) => {
    if (!currentType || !currentList) throw new Error('No list selected');
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/items?section=${sectionIndex}`, item, 'POST');
      logger.info('admin.lists.item.added', { type: currentType, list: currentList, sectionIndex });
      await fetchList(currentType, currentList);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentType, currentList, fetchList, logger]);

  // Update an item
  const updateItem = useCallback(async (sectionIndex, itemIndex, updates) => {
    if (!currentType || !currentList) throw new Error('No list selected');
    setLoading(true);
    setError(null);
    try {
      await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/items/${itemIndex}?section=${sectionIndex}`, updates, 'PUT');
      logger.info('admin.lists.item.updated', { type: currentType, list: currentList, sectionIndex, itemIndex });
      await fetchList(currentType, currentList);
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentType, currentList, fetchList, logger]);

  // Delete an item
  const deleteItem = useCallback(async (sectionIndex, itemIndex) => {
    if (!currentType || !currentList) throw new Error('No list selected');
    setLoading(true);
    setError(null);
    try {
      await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/items/${itemIndex}?section=${sectionIndex}`, {}, 'DELETE');
      logger.info('admin.lists.item.deleted', { type: currentType, list: currentList, sectionIndex, itemIndex });
      await fetchList(currentType, currentList);
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentType, currentList, fetchList, logger]);

  // Reorder items within a section
  const reorderItems = useCallback(async (sectionIndex, newItems) => {
    if (!currentType || !currentList) throw new Error('No list selected');
    setLoading(true);
    setError(null);
    try {
      await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}?section=${sectionIndex}`, { items: newItems }, 'PUT');
      setSections(prev => prev.map((s, i) => i === sectionIndex ? { ...s, items: newItems } : s));
      logger.info('admin.lists.reordered', { type: currentType, list: currentList, sectionIndex, count: newItems.length });
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentType, currentList, logger]);

  // Toggle item active state
  const toggleItemActive = useCallback(async (sectionIndex, itemIndex) => {
    const section = sections[sectionIndex];
    if (!section) return;
    const item = section.items[itemIndex];
    if (!item) return;
    await updateItem(sectionIndex, itemIndex, { active: item.active === false ? true : false });
  }, [sections, updateItem]);

  // Add a section
  const addSection = useCallback(async (sectionData) => {
    if (!currentType || !currentList) throw new Error('No list selected');
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/sections`, sectionData, 'POST');
      logger.info('admin.lists.section.added', { type: currentType, list: currentList });
      await fetchList(currentType, currentList);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentType, currentList, fetchList, logger]);

  // Update a section
  const updateSection = useCallback(async (sectionIndex, updates) => {
    if (!currentType || !currentList) throw new Error('No list selected');
    setLoading(true);
    setError(null);
    try {
      await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/sections/${sectionIndex}`, updates, 'PUT');
      logger.info('admin.lists.section.updated', { type: currentType, list: currentList, sectionIndex });
      await fetchList(currentType, currentList);
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentType, currentList, fetchList, logger]);

  // Delete a section
  const deleteSection = useCallback(async (sectionIndex) => {
    if (!currentType || !currentList) throw new Error('No list selected');
    setLoading(true);
    setError(null);
    try {
      await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/sections/${sectionIndex}`, {}, 'DELETE');
      logger.info('admin.lists.section.deleted', { type: currentType, list: currentList, sectionIndex });
      await fetchList(currentType, currentList);
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentType, currentList, fetchList, logger]);

  // Reorder sections
  const reorderSections = useCallback(async (newOrder) => {
    if (!currentType || !currentList) throw new Error('No list selected');
    setLoading(true);
    setError(null);
    try {
      await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/sections/reorder`, { order: newOrder }, 'PUT');
      logger.info('admin.lists.sections.reordered', { type: currentType, list: currentList });
      await fetchList(currentType, currentList);
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentType, currentList, fetchList, logger]);

  // Move an item between sections
  const moveItem = useCallback(async (from, to) => {
    if (!currentType || !currentList) throw new Error('No list selected');
    setLoading(true);
    setError(null);
    try {
      await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/items/move`, { from, to }, 'PUT');
      logger.info('admin.lists.item.moved', { type: currentType, list: currentList, from, to });
      await fetchList(currentType, currentList);
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentType, currentList, fetchList, logger]);

  // Split a section at a given item index
  const splitSection = useCallback(async (sectionIndex, afterItemIndex, title) => {
    if (!currentType || !currentList) throw new Error('No list selected');
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(
        `${API_BASE}/lists/${currentType}/${currentList}/sections/split`,
        { sectionIndex, afterItemIndex, title },
        'POST'
      );
      logger.info('admin.lists.section.split', { type: currentType, list: currentList, sectionIndex, afterItemIndex });
      await fetchList(currentType, currentList);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentType, currentList, fetchList, logger]);

  // Update list settings (metadata)
  const updateListSettings = useCallback(async (settings) => {
    if (!currentType || !currentList) throw new Error('No list selected');
    setLoading(true);
    setError(null);
    try {
      const data = await DaylightAPI(
        `${API_BASE}/lists/${currentType}/${currentList}/settings`,
        settings,
        'PUT'
      );
      // Update local metadata state
      const { sections: _, ...metadata } = data;
      setListMetadata(metadata);
      logger.info('admin.lists.settings.updated', { type: currentType, list: currentList });
      return data;
    } catch (err) {
      setError(err);
      logger.error('admin.lists.settings.update.failed', {
        type: currentType,
        list: currentList,
        message: err.message
      });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentType, currentList, logger]);

  return {
    loading, error, lists, sections, flatItems, listMetadata, currentType, currentList,
    fetchLists, createList, deleteList, fetchList,
    addItem, updateItem, deleteItem, reorderItems, toggleItemActive,
    addSection, updateSection, deleteSection, reorderSections, moveItem, splitSection,
    updateListSettings,
    clearError: () => setError(null)
  };
}

export default useAdminLists;
