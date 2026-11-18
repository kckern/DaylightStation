import {createHash} from 'node:crypto';
/** Stable opaque revision for owner-selected metadata; it grants no authority. */
export function knowledgeRevision(serialized){return createHash('sha256').update(serialized).digest('hex');}
