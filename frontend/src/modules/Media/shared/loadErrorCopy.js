// The one place Media decides what a failed load SAYS. Server text, HTTP
// codes and adapter messages ("HTTP 403: Forbidden - ...") are for the log,
// never for the screen: a household member can do nothing with them.
const NOUNS = {
  suggestions: 'suggestions',
  recent: 'recent items',
  section: 'this section',
  item: 'this item',
  search: 'search results',
};

export function loadErrorMessage(kind = 'section', error = null) {
  if (kind === 'search') {
    return error?.kind === 'connection' ? 'Lost connection to the search service.' : "Couldn't load search results.";
  }
  return `Couldn't load ${NOUNS[kind] ?? NOUNS.section}.`;
}

export const LOAD_ERROR_RETRY_LABEL = 'Try again';
