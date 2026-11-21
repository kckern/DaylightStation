import { useState, useCallback, useMemo, useLayoutEffect, useRef } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import { invalidateApiResources } from '../../lib/hooks/useApiResource.js';
import { useRefreshableRead } from '../../lib/hooks/useRefreshableRead.js';
import getLogger from '../../lib/logging/Logger.js';

const API_BASE = '/api/v1/admin/content';

export const adminListsPath = type => `${API_BASE}/lists/${type}`;

export async function createAdminList(type, name) {
  const path = adminListsPath(type);
  const logger = getLogger().child({ component: 'admin-lists' });
  try {
    const result = await DaylightAPI(path, { name }, 'POST');
    logger.info('admin.lists.created', { type, list: result?.list ?? name });
  } catch (err) {
    logger.error('admin.lists.create.failed', { type, name, message: err.message });
    throw err;
  }
  invalidateApiResources(key => key === path);
}

/**
 * Hook for managing admin config lists (menus, watchlists, programs)
 */
export function useAdminLists(type, listName) {
  const logger = useMemo(() => getLogger().child({ hook: 'useAdminLists' }), []);

  const [reading, setReading] = useState(false);
  const [error, setError] = useState(null);
  const [readError, setReadError] = useState(null);
  const editable = useRef(false);
  useLayoutEffect(() => () => { editable.current = false; }, [type, listName]);
  const canEditList = useCallback(() => editable.current, []);
  const [sections, setSections] = useState([]);
  const [listMetadata, setListMetadata] = useState(null);
  const [currentType, setCurrentType] = useState(null);
  const [currentList, setCurrentList] = useState(null);

  const flatItems = useMemo(() =>
    sections.flatMap((section, si) =>
      section.items.map((item, ii) => ({ ...item, sectionIndex: si, itemIndex: ii, sectionTitle: section.title }))
    ), [sections]);

  // Fetch a list (sections + metadata)
  const readList = useCallback(async (isCurrent, signal, afterSave = false) => {
    setReading(true);
    setError(null);
    try {
      const data = await DaylightAPI(`${API_BASE}/lists/${type}/${listName}`, {}, 'GET', { signal });
      if (!isCurrent()) return;
      editable.current = true;
      setReadError(null);
      setSections(data.sections || []);
      const { sections: _sections, ...metadata } = data;
      setListMetadata(metadata);
      setCurrentType(type);
      setCurrentList(listName);
      logger.info('admin.lists.fetched', { type, list: listName, sectionCount: data.sections?.length });
    } catch (err) {
      if (!isCurrent()) return;
      editable.current = false;
      setReadError({ error: err, afterSave });
      logger.error('admin.lists.fetch.failed', { type, list: listName, message: err.message });
      throw err;
    } finally {
      if (isCurrent()) setReading(false);
    }
  }, [logger, type, listName]);
  const { reload: fetchList } = useRefreshableRead(readList);

  const write = useCallback(async (command, logFailure) => {
    if (!editable.current) throw new Error('Refresh the list before editing');
    setError(null);
    try {
      return await command();
    } catch (err) {
      setError(err);
      logFailure?.(err);
      throw err;
    }
  }, []);

  // Delete a list
  const deleteList = useCallback((type, listName) => write(async () => {
    await DaylightAPI(`${API_BASE}/lists/${type}/${listName}`, {}, 'DELETE');
    logger.info('admin.lists.deleted', { type, list: listName });
    invalidateApiResources(path => path === adminListsPath(type));
  }, err => logger.error('admin.lists.delete.failed', { type, list: listName, message: err.message })), [logger, write]);

  // Add an item to a section in the current list
  const addItem = useCallback((sectionIndex, item) => write(async () => {
    const result = await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/items?section=${sectionIndex}`, item, 'POST');
    logger.info('admin.lists.item.added', { type: currentType, list: currentList, sectionIndex });
    return result;
  }), [currentType, currentList, logger, write]);

  // Update an item
  const updateItem = useCallback((sectionIndex, itemIndex, updates) => write(async () => {
    await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/items/${itemIndex}?section=${sectionIndex}`, updates, 'PUT');
    logger.info('admin.lists.item.updated', { type: currentType, list: currentList, sectionIndex, itemIndex });
  }), [currentType, currentList, logger, write]);

  // Atomically swap content fields between two items (single backend call)
  const swapItems = useCallback((srcSection, srcIndex, dstSection, dstIndex) => write(async () => {
    await DaylightAPI(
      `${API_BASE}/lists/${currentType}/${currentList}/items/swap`,
      { a: { section: srcSection, index: srcIndex }, b: { section: dstSection, index: dstIndex } },
      'PUT'
    );
    logger.info('admin.lists.items.swapped', { type: currentType, list: currentList, srcSection, srcIndex, dstSection, dstIndex });
  }), [currentType, currentList, logger, write]);

  // Delete an item
  const deleteItem = useCallback((sectionIndex, itemIndex) => write(async () => {
    await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/items/${itemIndex}?section=${sectionIndex}`, {}, 'DELETE');
    logger.info('admin.lists.item.deleted', { type: currentType, list: currentList, sectionIndex, itemIndex });
  }), [currentType, currentList, logger, write]);

  // Reorder items within a section
  const reorderItems = useCallback((sectionIndex, newItems) => write(async () => {
    await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}?section=${sectionIndex}`, { items: newItems }, 'PUT');
    setSections(prev => prev.map((s, i) => i === sectionIndex ? { ...s, items: newItems } : s));
    logger.info('admin.lists.reordered', { type: currentType, list: currentList, sectionIndex, count: newItems.length });
  }), [currentType, currentList, logger, write]);

  // Toggle item active state
  const toggleItemActive = useCallback(async (sectionIndex, itemIndex) => {
    const section = sections[sectionIndex];
    if (!section) return;
    const item = section.items[itemIndex];
    if (!item) return;
    await updateItem(sectionIndex, itemIndex, { active: item.active === false ? true : false });
  }, [sections, updateItem]);

  // Add a section
  const addSection = useCallback((sectionData) => write(async () => {
    const result = await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/sections`, sectionData, 'POST');
    logger.info('admin.lists.section.added', { type: currentType, list: currentList });
    return result;
  }), [currentType, currentList, logger, write]);

  // Update a section
  const updateSection = useCallback((sectionIndex, updates) => write(async () => {
    await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/sections/${sectionIndex}`, updates, 'PUT');
    logger.info('admin.lists.section.updated', { type: currentType, list: currentList, sectionIndex });
  }), [currentType, currentList, logger, write]);

  // Delete a section
  const deleteSection = useCallback((sectionIndex) => write(async () => {
    await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/sections/${sectionIndex}`, {}, 'DELETE');
    logger.info('admin.lists.section.deleted', { type: currentType, list: currentList, sectionIndex });
  }), [currentType, currentList, logger, write]);

  // Reorder sections
  const reorderSections = useCallback((newOrder) => write(async () => {
    await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/sections/reorder`, { order: newOrder }, 'PUT');
    logger.info('admin.lists.sections.reordered', { type: currentType, list: currentList });
  }), [currentType, currentList, logger, write]);

  // Move an item between sections
  const moveItem = useCallback((from, to) => write(async () => {
    await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/items/move`, { from, to }, 'PUT');
    logger.info('admin.lists.item.moved', { type: currentType, list: currentList, from, to });
  }), [currentType, currentList, logger, write]);

  // Split a section at a given item index
  const splitSection = useCallback((sectionIndex, afterItemIndex, title) => write(async () => {
    const result = await DaylightAPI(
      `${API_BASE}/lists/${currentType}/${currentList}/sections/split`,
      { sectionIndex, afterItemIndex, title },
      'POST'
    );
    logger.info('admin.lists.section.split', { type: currentType, list: currentList, sectionIndex, afterItemIndex });
    return result;
  }), [currentType, currentList, logger, write]);

  // Update list settings (metadata)
  const updateListSettings = useCallback((settings) => write(async () => {
    const data = await DaylightAPI(
      `${API_BASE}/lists/${currentType}/${currentList}/settings`,
      settings,
      'PUT'
    );
    // Update local metadata state
    const { sections: _sections, ...metadata } = data;
    setListMetadata(metadata);
    logger.info('admin.lists.settings.updated', { type: currentType, list: currentList });
    return data;
  }, err => logger.error('admin.lists.settings.update.failed', {
    type: currentType,
    list: currentList,
    message: err.message
  })), [currentType, currentList, logger, write]);

  return {
    reading, error, readError, canEditList, sections, setSections, flatItems, listMetadata, currentType, currentList,
    deleteList, fetchList,
    addItem, updateItem, swapItems, deleteItem, reorderItems, toggleItemActive,
    addSection, updateSection, deleteSection, reorderSections, moveItem, splitSection,
    updateListSettings,
    clearError: () => setError(null)
  };
}

export default useAdminLists;
