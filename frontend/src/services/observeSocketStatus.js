/** Observe the current connection and distinguish recovery from the initial connection. */
export function observeSocketStatus(subscribe, listener) {
  let connectedBefore = false;
  let interrupted = false;
  return subscribe(status => {
    const recovered = status.connected === true && interrupted;
    if (status.connected) {
      connectedBefore = true;
      interrupted = false;
    } else if (connectedBefore) {
      interrupted = true;
    }
    listener(status, recovered);
  });
}
