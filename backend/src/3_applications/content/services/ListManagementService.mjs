/**
 * ListManagementService - Application service for list CRUD operations
 *
 * Orchestrates list management operations using an IListStore port.
 * Contains all business logic: validation, field allowlists, denormalization,
 * section operations. No direct file I/O.
 */
import {
  ValidationError,
  NotFoundError,
  ConflictError
} from '#system/utils/errors/index.mjs';
import { extractContentId, extractActionName } from '#adapters/content/list/listConfigNormalizer.mjs';

// Valid list types
const LIST_TYPES = ['menus', 'watchlists', 'programs'];

// Validation pattern for list names (lowercase, alphanumeric, hyphens)
const LIST_NAME_PATTERN = /^[a-z0-9-]+$/;

/**
 * Convert display name to kebab-case list name
 * @param {string} name - Display name (e.g., "Morning Program")
 * @returns {string} - Kebab-case name (e.g., "morning-program")
 */
function toKebabCase(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Validate list type parameter
 */
function validateType(type) {
  if (!LIST_TYPES.includes(type)) {
    throw new ValidationError(`Invalid list type: ${type}`, {
      field: 'type',
      hint: `Must be one of: ${LIST_TYPES.join(', ')}`
    });
  }
}

/**
 * Convert a normalized item back to admin-friendly format.
 * Adds label, input, and action fields that the admin UI expects,
 * while preserving all original fields.
 */
function denormalizeForAdmin(item) {
  const result = { ...item };
  if (!result.label) result.label = result.title || '';
  if (!result.input) result.input = extractContentId(result);
  if (!result.action) result.action = extractActionName(result);
  return result;
}

export class ListManagementService {
  /**
   * @param {Object} deps
   * @param {import('../ports/IListStore.mjs').IListStore} deps.listStore - List persistence port
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor({ listStore, logger = console }) {
    this.listStore = listStore;
    this.logger = logger;
  }

  /**
   * Get overview of all list types with counts
   * @param {string} householdId
   * @returns {{ types: Array, total: number, household: string }}
   */
  getOverview(householdId) {
    const summary = this.listStore.getOverview(householdId);
    const total = summary.reduce((sum, t) => sum + t.count, 0);

    this.logger.info?.('admin.lists.overview', { household: householdId, total });

    return { types: summary, total, household: householdId };
  }

  /**
   * List all lists of a specific type
   * @param {string} type
   * @param {string} householdId
   * @returns {{ type: string, lists: Array, household: string }}
   */
  listByType(type, householdId) {
    validateType(type);

    const lists = this.listStore.listByType(type, householdId);

    this.logger.info?.('admin.lists.type.listed', { type, household: householdId, count: lists.length });

    return { type, lists, household: householdId };
  }

  /**
   * Get a single list with full details
   * @param {string} type
   * @param {string} listName
   * @param {string} householdId
   * @returns {Object} Full list with sections and denormalized items
   */
  getList(type, listName, householdId) {
    validateType(type);

    const list = this.listStore.getList(type, listName, householdId);

    if (list === null) {
      throw new NotFoundError('List', `${type}/${listName}`);
    }

    const totalItems = list.sections.reduce((sum, s) => sum + s.items.length, 0);

    this.logger.info?.('admin.lists.loaded', { type, list: listName, count: totalItems, household: householdId });

    return {
      type,
      name: listName,
      title: list.title,
      description: list.description,
      image: list.image,
      metadata: list.metadata,
      sections: list.sections.map((section, si) => ({
        ...section,
        index: si,
        items: section.items.map((item, ii) => ({ ...denormalizeForAdmin(item), sectionIndex: si, itemIndex: ii }))
      })),
      household: householdId
    };
  }

  /**
   * Create a new empty list
   * @param {string} type
   * @param {string} name - Display name to be converted to kebab-case
   * @param {string} householdId
   * @returns {{ ok: boolean, type: string, list: string, path: string }}
   */
  createList(type, name, householdId) {
    validateType(type);

    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('List name is required', { field: 'name' });
    }

    const listName = toKebabCase(name);

    if (!LIST_NAME_PATTERN.test(listName)) {
      throw new ValidationError('Invalid list name', {
        field: 'name',
        hint: 'Use alphanumeric characters and hyphens only'
      });
    }

    const created = this.listStore.createList(type, listName, householdId);

    if (!created) {
      throw new ConflictError('List already exists', { type, list: listName });
    }

    this.logger.info?.('admin.lists.created', { type, list: listName, household: householdId });

    return {
      ok: true,
      type,
      list: listName,
      path: `config/lists/${type}/${listName}.yml`
    };
  }

  /**
   * Update list settings (metadata)
   * @param {string} type
   * @param {string} listName
   * @param {string} householdId
   * @param {Object} settings - Fields to update
   * @returns {Object} Updated list info
   */
  updateSettings(type, listName, householdId, settings) {
    validateType(type);

    const list = this.listStore.getList(type, listName, householdId);
    if (list === null) {
      throw new NotFoundError('List not found', { type, list: listName });
    }

    // Top-level fields
    const topLevelFields = ['title', 'description', 'image'];
    for (const field of topLevelFields) {
      if (settings[field] !== undefined) {
        list[field] = settings[field];
      }
    }

    // Metadata fields
    const metadataFields = ['group', 'icon', 'sorting', 'days', 'active', 'fixed_order', 'defaultAction', 'defaultVolume', 'defaultPlaybackRate'];
    for (const field of metadataFields) {
      if (settings[field] !== undefined) {
        list.metadata[field] = settings[field];
      }
    }

    this.listStore.saveList(type, listName, householdId, list);

    this.logger.info?.('admin.lists.settings.updated', { type, list: listName, household: householdId });

    return {
      type,
      name: listName,
      ...list,
      household: householdId
    };
  }

  /**
   * Replace list contents (for reordering)
   * @param {string} type
   * @param {string} listName
   * @param {string} householdId
   * @param {Array} items - New items array
   * @param {number} [sectionIndex=0] - Section to replace items in
   * @returns {{ ok: boolean, type: string, list: string, count: number }}
   */
  replaceContents(type, listName, householdId, items, sectionIndex = 0) {
    validateType(type);

    if (!items || !Array.isArray(items)) {
      throw new ValidationError('Items array is required', { field: 'items' });
    }

    const list = this.listStore.getList(type, listName, householdId);
    if (list === null) {
      throw new NotFoundError('List', `${type}/${listName}`);
    }

    // Remove index/section fields if present (they're computed, not stored)
    const cleanItems = items.map(({ index, sectionIndex: si, itemIndex, ...item }) => item);

    const section = list.sections[sectionIndex];
    if (section) {
      section.items = cleanItems;
    } else if (sectionIndex === 0) {
      list.sections = [{ items: cleanItems }];
    } else {
      throw new NotFoundError('Section', sectionIndex, { type, list: listName });
    }

    this.listStore.saveList(type, listName, householdId, list);

    this.logger.info?.('admin.lists.reordered', { type, list: listName, sectionIndex, count: cleanItems.length, household: householdId });

    return {
      ok: true,
      type,
      list: listName,
      count: cleanItems.length
    };
  }

  /**
   * Delete an entire list
   * @param {string} type
   * @param {string} listName
   * @param {string} householdId
   * @returns {{ ok: boolean, deleted: { type: string, list: string } }}
   */
  deleteList(type, listName, householdId) {
    validateType(type);

    const deleted = this.listStore.deleteList(type, listName, householdId);

    if (!deleted) {
      throw new NotFoundError('List', `${type}/${listName}`);
    }

    this.logger.info?.('admin.lists.deleted', { type, list: listName, household: householdId });

    return {
      ok: true,
      deleted: { type, list: listName }
    };
  }

  /**
   * Add an item to a list
   * @param {string} type
   * @param {string} listName
   * @param {string} householdId
   * @param {Object} itemData - Item fields
   * @param {number} [sectionIndex=0] - Section to add item to
   * @returns {{ ok: boolean, index: number, type: string, list: string }}
   */
  addItem(type, listName, householdId, itemData, sectionIndex = 0) {
    validateType(type);

    // Validate required fields
    if (!itemData.label || typeof itemData.label !== 'string' || !itemData.label.trim()) {
      throw new ValidationError('Missing required field', { field: 'label' });
    }
    if (!itemData.input || typeof itemData.input !== 'string' || !itemData.input.trim()) {
      throw new ValidationError('Missing required field', { field: 'input' });
    }

    const list = this.listStore.getList(type, listName, householdId);
    if (list === null) {
      throw new NotFoundError('List', `${type}/${listName}`);
    }

    // Build new item - preserve all provided fields
    const newItem = {
      label: itemData.label.trim(),
      input: itemData.input.trim()
    };

    // Copy optional fields if provided
    if (itemData.action !== undefined) newItem.action = itemData.action;
    if (itemData.active !== undefined) newItem.active = itemData.active;
    if (itemData.image !== undefined) newItem.image = itemData.image;
    if (itemData.shuffle !== undefined) newItem.shuffle = itemData.shuffle;
    if (itemData.continuous !== undefined) newItem.continuous = itemData.continuous;
    if (itemData.days !== undefined) newItem.days = itemData.days;
    if (itemData.hold !== undefined) newItem.hold = itemData.hold;
    if (itemData.priority !== undefined) newItem.priority = itemData.priority;
    if (itemData.group !== undefined) newItem.group = itemData.group;

    const section = list.sections[sectionIndex] || (list.sections[sectionIndex] = { items: [] });
    section.items.push(newItem);
    this.listStore.saveList(type, listName, householdId, list);

    const newIndex = section.items.length - 1;

    this.logger.info?.('admin.lists.item.added', { type, list: listName, index: newIndex, label: newItem.label, household: householdId });

    return {
      ok: true,
      index: newIndex,
      type,
      list: listName
    };
  }

  /**
   * Update an item at a specific index
   * @param {string} type
   * @param {string} listName
   * @param {string} householdId
   * @param {number} index - Item index within the section
   * @param {Object} updates - Fields to update
   * @param {number} [sectionIndex=0] - Section containing the item
   * @returns {{ ok: boolean, index: number, type: string, list: string }}
   */
  updateItem(type, listName, householdId, index, updates, sectionIndex = 0) {
    validateType(type);

    if (isNaN(index) || index < 0) {
      throw new ValidationError('Invalid index', { field: 'index' });
    }

    const list = this.listStore.getList(type, listName, householdId);
    if (list === null) {
      throw new NotFoundError('List', `${type}/${listName}`);
    }

    const section = list.sections[sectionIndex];
    if (!section || index >= section.items.length) {
      throw new NotFoundError('Item', index, { type, list: listName });
    }

    // Merge updates with existing item
    const existingItem = section.items[index];
    const updatedItem = { ...existingItem };

    // Apply updates for any provided field
    const allowedFields = ['label', 'input', 'action', 'active', 'image', 'shuffle', 'continuous', 'days', 'hold', 'priority', 'skipAfter', 'waitUntil', 'group'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        updatedItem[field] = updates[field];
      }
    }

    section.items[index] = updatedItem;
    this.listStore.saveList(type, listName, householdId, list);

    this.logger.info?.('admin.lists.item.updated', { type, list: listName, index, household: householdId });

    return {
      ok: true,
      index,
      type,
      list: listName
    };
  }

  /**
   * Delete an item at a specific index
   * @param {string} type
   * @param {string} listName
   * @param {string} householdId
   * @param {number} index - Item index within the section
   * @param {number} [sectionIndex=0] - Section containing the item
   * @returns {{ ok: boolean, deleted: { index: number, label: string } }}
   */
  deleteItem(type, listName, householdId, index, sectionIndex = 0) {
    validateType(type);

    if (isNaN(index) || index < 0) {
      throw new ValidationError('Invalid index', { field: 'index' });
    }

    const list = this.listStore.getList(type, listName, householdId);
    if (list === null) {
      throw new NotFoundError('List', `${type}/${listName}`);
    }

    const section = list.sections[sectionIndex];
    if (!section || index >= section.items.length) {
      throw new NotFoundError('Item', index, { type, list: listName });
    }

    const deletedItem = section.items[index];
    section.items.splice(index, 1);
    this.listStore.saveList(type, listName, householdId, list);

    this.logger.info?.('admin.lists.item.deleted', { type, list: listName, index, label: deletedItem.label, household: householdId });

    return {
      ok: true,
      deleted: {
        index,
        label: deletedItem.label
      }
    };
  }

  /**
   * Move an item between sections
   * @param {string} type
   * @param {string} listName
   * @param {string} householdId
   * @param {{ section: number, index: number }} from
   * @param {{ section: number, index: number }} to
   * @returns {{ ok: boolean }}
   */
  moveItem(type, listName, householdId, from, to) {
    validateType(type);

    if (!from || !to) throw new ValidationError('from and to required');

    const list = this.listStore.getList(type, listName, householdId);
    if (list === null) throw new NotFoundError('List', `${type}/${listName}`);

    const fromSection = list.sections[from.section];
    const toSection = list.sections[to.section];
    if (!fromSection || !toSection) throw new NotFoundError('Section');

    const [item] = fromSection.items.splice(from.index, 1);
    if (!item) throw new NotFoundError('Item', from.index);
    toSection.items.splice(to.index, 0, item);
    this.listStore.saveList(type, listName, householdId, list);

    this.logger.info?.('admin.lists.item.moved', { type, list: listName, from, to, household: householdId });

    return { ok: true };
  }

  /**
   * Add a new section to a list
   * @param {string} type
   * @param {string} listName
   * @param {string} householdId
   * @param {Object} sectionData - Section metadata (items are ignored)
   * @returns {{ ok: boolean, sectionIndex: number }}
   */
  addSection(type, listName, householdId, sectionData) {
    validateType(type);

    const list = this.listStore.getList(type, listName, householdId);
    if (list === null) throw new NotFoundError('List', `${type}/${listName}`);

    const { items: _, ...rest } = sectionData;
    const newSection = { ...rest, items: [] };
    list.sections.push(newSection);
    this.listStore.saveList(type, listName, householdId, list);

    this.logger.info?.('admin.lists.section.added', { type, list: listName, household: householdId });

    return { ok: true, sectionIndex: list.sections.length - 1 };
  }

  /**
   * Split a section at an item index
   * @param {string} type
   * @param {string} listName
   * @param {string} householdId
   * @param {number} sectionIndex - Section to split
   * @param {number} afterItemIndex - Split after this item
   * @param {string} [title] - Title for the new section
   * @returns {{ ok: boolean, newSectionIndex: number, movedCount: number }}
   */
  splitSection(type, listName, householdId, sectionIndex, afterItemIndex, title) {
    validateType(type);

    if (afterItemIndex == null || afterItemIndex < 0) {
      throw new ValidationError('afterItemIndex is required', { field: 'afterItemIndex' });
    }

    const list = this.listStore.getList(type, listName, householdId);
    if (list === null) throw new NotFoundError('List', `${type}/${listName}`);

    const section = list.sections[sectionIndex];
    if (!section) throw new NotFoundError('Section', sectionIndex);
    if (afterItemIndex >= section.items.length - 1) {
      throw new ValidationError('Nothing to split — afterItemIndex is at or beyond last item');
    }

    // Split: items 0..afterItemIndex stay, afterItemIndex+1..end go to new section
    const keepItems = section.items.slice(0, afterItemIndex + 1);
    const moveItems = section.items.slice(afterItemIndex + 1);

    section.items = keepItems;
    const newSection = { items: moveItems };
    if (title) newSection.title = title;
    list.sections.splice(sectionIndex + 1, 0, newSection);

    this.listStore.saveList(type, listName, householdId, list);

    this.logger.info?.('admin.lists.section.split', {
      type, list: listName, sectionIndex, afterItemIndex,
      kept: keepItems.length, moved: moveItems.length, household: householdId
    });

    return { ok: true, newSectionIndex: sectionIndex + 1, movedCount: moveItems.length };
  }

  /**
   * Reorder sections within a list
   * @param {string} type
   * @param {string} listName
   * @param {string} householdId
   * @param {number[]} order - Array of section indices in desired order
   * @returns {{ ok: boolean }}
   */
  reorderSections(type, listName, householdId, order) {
    validateType(type);

    if (!Array.isArray(order)) throw new ValidationError('order array required', { field: 'order' });

    const list = this.listStore.getList(type, listName, householdId);
    if (list === null) throw new NotFoundError('List', `${type}/${listName}`);

    const reordered = order.map(i => list.sections[i]).filter(Boolean);
    list.sections = reordered;
    this.listStore.saveList(type, listName, householdId, list);

    this.logger.info?.('admin.lists.sections.reordered', { type, list: listName, household: householdId });

    return { ok: true };
  }

  /**
   * Update section settings
   * @param {string} type
   * @param {string} listName
   * @param {string} householdId
   * @param {number} sectionIndex
   * @param {Object} updates - Fields to update
   * @returns {{ ok: boolean, sectionIndex: number }}
   */
  updateSection(type, listName, householdId, sectionIndex, updates) {
    validateType(type);

    const list = this.listStore.getList(type, listName, householdId);
    if (list === null) throw new NotFoundError('List', `${type}/${listName}`);

    if (sectionIndex < 0 || sectionIndex >= list.sections.length) throw new NotFoundError('Section', sectionIndex);

    const section = list.sections[sectionIndex];
    const allowed = ['title', 'description', 'image', 'fixed_order', 'shuffle', 'limit',
      'priority', 'playbackrate', 'continuous', 'days', 'applySchedule',
      'hold', 'skip_after', 'wait_until', 'active'];
    for (const field of allowed) {
      if (updates[field] !== undefined) section[field] = updates[field];
    }
    this.listStore.saveList(type, listName, householdId, list);

    this.logger.info?.('admin.lists.section.updated', { type, list: listName, sectionIndex, household: householdId });

    return { ok: true, sectionIndex };
  }

  /**
   * Delete a section from a list
   * @param {string} type
   * @param {string} listName
   * @param {string} householdId
   * @param {number} sectionIndex
   * @returns {{ ok: boolean }}
   */
  deleteSection(type, listName, householdId, sectionIndex) {
    validateType(type);

    const list = this.listStore.getList(type, listName, householdId);
    if (list === null) throw new NotFoundError('List', `${type}/${listName}`);

    if (sectionIndex < 0 || sectionIndex >= list.sections.length) throw new NotFoundError('Section', sectionIndex);

    list.sections.splice(sectionIndex, 1);
    if (list.sections.length === 0) list.sections.push({ items: [] });
    this.listStore.saveList(type, listName, householdId, list);

    this.logger.info?.('admin.lists.section.deleted', { type, list: listName, sectionIndex, household: householdId });

    return { ok: true };
  }
}

export default ListManagementService;
