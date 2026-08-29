import WebSocket from 'ws';

/**
 * Home Assistant WebSocket/REST adapter for ambient illuminance readings.
 * Authentication frames, subscription protocol, reconnect policy, URL shape,
 * and raw event projection are intentionally contained here.
 */
export class HomeAssistantAmbientSensorGateway {
  #haGateway;
  #logger;
  #WebSocketImpl;
  #schedule;

  constructor({ haGateway, logger = console, WebSocketImpl = WebSocket, schedule = setTimeout }) {
    this.#haGateway = haGateway;
    this.#logger = logger;
    this.#WebSocketImpl = WebSocketImpl;
    this.#schedule = schedule;
  }

  async getCurrentStates(entities) {
    return this.#haGateway.getStates(entities);
  }

  subscribe(entities, onReading) {
    let socket = null;
    let stopped = false;
    let backoff = 1000;

    const connect = () => {
      if (stopped) return;
      const connection = this.#haGateway.getConnection?.();
      if (!connection?.baseUrl) {
        this.#logger.warn?.('ambient.no_connection');
        return;
      }

      const url = connection.baseUrl.replace(/^http/i, 'ws') + '/api/websocket';
      socket = new this.#WebSocketImpl(url);
      socket.on('open', () => {
        backoff = 1000;
        this.#logger.info?.('ambient.ws.open');
      });
      socket.on('message', (data) => {
        let message;
        try { message = JSON.parse(data.toString()); } catch { return; }
        if (message.type === 'auth_required') {
          socket.send(JSON.stringify({ type: 'auth', access_token: connection.token }));
          return;
        }
        if (message.type === 'auth_ok') {
          socket.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: 'state_changed' }));
          return;
        }
        if (message.type !== 'event' || message.event?.event_type !== 'state_changed') return;
        const entity = message.event.data?.entity_id;
        if (!entities.includes(entity)) return;
        onReading({ entity, state: message.event.data?.new_state?.state });
      });

      const retry = () => {
        if (stopped) return;
        this.#logger.warn?.('ambient.ws.reconnect', { inMs: backoff });
        this.#schedule(connect, backoff);
        backoff = Math.min(backoff * 2, 30000);
      };
      socket.on('close', retry);
      socket.on('error', (error) => {
        this.#logger.warn?.('ambient.ws.error', { error: error.message });
      });
    };

    connect();
    return () => {
      stopped = true;
      try { socket?.close(); } catch { /* ignore */ }
    };
  }
}

export default HomeAssistantAmbientSensorGateway;
