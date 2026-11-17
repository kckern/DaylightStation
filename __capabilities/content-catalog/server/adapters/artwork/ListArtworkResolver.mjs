import path from 'node:path';
import {isFile} from '#system/utils/FileIO.mjs';

export function createListArtworkResolver({mediaDir}) {
 if (typeof mediaDir !== 'string' || !path.isAbsolute(mediaDir)) throw Error('Absolute media directory required');
 return async ({item}) => {
  const uid=item?.uid;
  if (typeof uid !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(uid)) throw Object.assign(Error('Invalid item identity'),{code:'invalid_id'});
  return isFile(path.join(mediaDir,'img','lists',`${uid}.jpg`)) ? `/media/img/lists/${uid}.jpg` : null;
 };
}
