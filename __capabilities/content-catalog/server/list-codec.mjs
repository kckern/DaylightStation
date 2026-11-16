// Public persistence compatibility entry for canonical and legacy list values.
export {
  normalizeListItem, normalizeListConfig, serializeListConfig, denormalizeItem,
  extractContentId, extractActionName, applyCascade, INHERITABLE_FIELDS, ListConfigCodec,
} from './domain/utils/listConfigCodec.mjs';

export { validateEmbeddedList } from './embedded-list-validation.mjs';
import { validateEmbeddedList } from './embedded-list-validation.mjs';
import { ListConfigCodec as baseCodec } from './domain/utils/listConfigCodec.mjs';
function normalizeEmbeddedList(list) {
  const normalized=baseCodec.normalizeListConfig(list);
  const sourceSections=list.sections || [{items:list.items || []}];
  sourceSections.forEach((section,sectionIndex)=>(section.items || []).forEach((source,itemIndex)=>{
    const item=normalized.sections[sectionIndex]?.items[itemIndex];
    if (!item) return;
    if (source.android) item.android=structuredClone(source.android);
    for (const [key,value] of Object.entries(source)) {
      if (!['input','action','play','queue','display','list','open','android'].includes(key)) item[key]=structuredClone(value);
    }
  }));
  return normalized;
}
function serializeEmbeddedList(list) {
  const normalized=normalizeEmbeddedList(list);
  const output=baseCodec.serializeListConfig(normalized);
  if (normalized.sections.length === 0) { delete output.items; output.sections=[]; }
  const sections=output.sections || [{items:output.items}];
  normalized.sections.forEach((section,sectionIndex)=>section.items.forEach((item,itemIndex)=>{
    if (Object.hasOwn(item,'label')) sections[sectionIndex].items[itemIndex].label=item.label;
  }));
  return output;
}
export const EmbeddedListCodec = Object.freeze({...baseCodec, validateEmbeddedList, normalizeEmbeddedList, serializeEmbeddedList});
