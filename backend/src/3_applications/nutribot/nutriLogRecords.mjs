import { v4 as uuidv4 } from 'uuid';
import { shortId } from '#system/utils/id.mjs';
import { NutriLog } from '#domains/nutrition/entities/NutriLog.mjs';
export { serializeFoodItem, serializeNutriLog } from '#apps/nutrition/NutriLogProjection.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createNutriLog(props, { newId = shortId, newUuid = uuidv4 } = {}) {
  return NutriLog.create({
    ...props,
    id: newId(),
    items: (props.items || []).map((item) => {
      const id = item.id || newId();
      return {
        ...item,
        id,
        uuid: item.uuid || (UUID_PATTERN.test(id) ? id : newUuid()),
      };
    }),
  });
}
