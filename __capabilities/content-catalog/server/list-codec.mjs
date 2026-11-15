// Public persistence compatibility entry for canonical and legacy list values.
export {
  normalizeListItem, normalizeListConfig, serializeListConfig, denormalizeItem,
  extractContentId, extractActionName, applyCascade, INHERITABLE_FIELDS, ListConfigCodec,
} from './domain/utils/listConfigCodec.mjs';
