/** Share an open connection for one local store and retire it when the browser closes it. */
export function createIndexedDbOpener(name, version, upgrade, { waitWhileBlocked = false } = {}) {
  let opening = null;
  return function open() {
    if (opening) return opening;
    const retire = () => {
      if (opening === attempt) opening = null;
    };
    const attempt = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error('IndexedDB is unavailable'));
        return;
      }
      const request = globalThis.indexedDB.open(name, version);
      request.onupgradeneeded = () => upgrade(request.result);
      request.onsuccess = () => {
        const db = request.result;
        if (opening !== attempt) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          retire();
          db.close();
        };
        db.onclose = retire;
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
      if (!waitWhileBlocked) {
        request.onblocked = () => {
          retire();
          reject(new Error('IndexedDB open is blocked'));
        };
      }
    }).catch(error => {
      retire();
      throw error;
    });
    opening = attempt;
    return attempt;
  };
}

export function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}
