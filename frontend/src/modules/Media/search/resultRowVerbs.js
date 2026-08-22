// frontend/src/modules/Media/search/resultRowVerbs.js
// Maps a ResultRow ⋯ verb ('playNow'|'playNext'|'upNext'|'add'|'detail') onto
// the actual queue appliers / navigation — shared by SearchMode.jsx (mobile)
// and MediaContentSearch.jsx (desktop) so the five actions behave IDENTICALLY
// on both surfaces. `queue` is the local session controller's queue facade
// (useSessionController('local').queue); its appliers are exactly playNow/
// playNext/addUpNext/add (LocalSessionController.js) — no new applier names
// invented here. `push` is NavProvider's push, for the "Open detail" verb.
import { resultToQueueInput } from './resultToQueueInput.js';

export function applyResultRowVerb(action, item, { queue, push }) {
  if (action === 'detail') {
    const id = item?.id;
    if (id) push('detail', { contentId: id });
    return;
  }
  const input = resultToQueueInput(item);
  if (!input) return;
  switch (action) {
    case 'playNow':
      queue.playNow(input, { clearRest: true });
      break;
    case 'playNext':
      queue.playNext(input);
      break;
    case 'upNext':
      queue.addUpNext(input);
      break;
    case 'add':
      queue.add(input);
      break;
    default:
      break;
  }
}

export default applyResultRowVerb;
