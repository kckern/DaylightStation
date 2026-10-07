// Network loss for a journey: the browser goes offline AND its WebSocket to the
// bus dies, the way a screen on flaky WiFi experiences it. `context.setOffline`
// alone stops new requests but leaves an already-open socket alone, so the
// socket is routed through Playwright (`page.routeWebSocket`) where the helper
// can drop it and refuse new ones until the network "comes back".
//
//   const net = await installNetworkControl(page);   // BEFORE the first goto
//   await page.goto('/media');
//   await net.lose();        // offline + live sockets closed + new sockets refused
//   ...assert the app's offline behaviour...
//   await net.restore();     // online again; the app's own reconnect runs
//   await net.waitForSocket();  // a fresh socket was accepted (the app reconnected)
//
// Only the app's own bus socket is touched (`**/ws`). Nothing here reaches a
// household screen.
const BUS_SOCKET = /\/ws(?:\?.*)?$/;

export async function installNetworkControl(page, { socketPattern = BUS_SOCKET } = {}) {
  const state = { offline: false, live: new Set(), accepted: 0, refused: 0, closedByLoss: 0 };
  await page.routeWebSocket(socketPattern, (route) => {
    if (state.offline) {
      state.refused += 1;
      route.close({ code: 1006, reason: 'network lost' });
      return;
    }
    const server = route.connectToServer();
    const handle = { route, server };
    state.live.add(handle);
    state.accepted += 1;
    route.onClose(() => state.live.delete(handle));
  });
  const context = page.context();
  return {
    state,
    get offline() { return state.offline; },
    /** Sockets accepted so far (a reconnect raises it). */
    get accepted() { return state.accepted; },
    get refused() { return state.refused; },
    async lose() {
      state.offline = true;
      await context.setOffline(true);
      for (const { route } of [...state.live]) {
        state.closedByLoss += 1;
        route.close({ code: 1006, reason: 'network lost' });
      }
      state.live.clear();
    },
    async restore() {
      state.offline = false;
      await context.setOffline(false);
    },
    /** Resolve once a socket beyond `after` has been accepted (the app reconnected). */
    async waitForSocket({ after = state.accepted, timeout = 30000 } = {}) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (state.accepted > after) return state.accepted;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`no new bus socket within ${timeout} ms (accepted ${state.accepted}, refused ${state.refused})`);
    },
  };
}
