// Where a fetched /api/v1/queue answer starts.
//
// An ordered work (a book, a talk series, a course heard as audio) is answered
// in its own order with `startIndex`: the part to play first, at its
// resumePosition. A show or a music list carries no startIndex; its order
// already starts at the next item. See __docs/reference/media/queue.md.

/**
 * @param {{startIndex?: number}|null|undefined} response - the queue answer
 * @param {number} length - how many items the caller kept from it
 * @returns {number} the index to start at; 0 when the answer names none or one out of range
 */
export function queueStartIndex(response, length) {
  const at = response?.startIndex;
  return Number.isInteger(at) && at > 0 && at < length ? at : 0;
}

export default queueStartIndex;
