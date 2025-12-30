import { useState, useEffect, useCallback } from 'react';
import { wsService } from '../services/WebSocketService';

/**
 * React hook to get WebSocket connection status
 * 
 * @returns {{ connected: boolean, connecting: boolean, reconnectAttempts: number }}
 * 
 * @example
 * const { connected, connecting } = useWebSocketStatus();
 * 
 * if (connecting) return <Spinner />;
 * if (!connected) return <ConnectionError />;
 */
export function useWebSocketStatus() {
  const [status, setStatus] = useState(() => wsService.getStatus());

  useEffect(() => {
    const unsubscribe = wsService.onStatusChange((newStatus) => {
      setStatus((prev) => ({
        ...prev,
        ...newStatus,
        reconnectAttempts: wsService.reconnectAttempts
      }));
    });

    return unsubscribe;
  }, []);

  return status;
}

/**
 * React hook to subscribe to WebSocket messages
 * 
 * @param {string|string[]|function} filter - Topic(s) or predicate function
 * @param {function} callback - Message handler
 * @param {Array} deps - Dependency array for the callback
 * 
 * @example
 * // Subscribe to specific topics
 * useWebSocketSubscription(['fitness', 'vibration'], (data) => {
 *   console.log('Received:', data);
 * }, []);
 * 
 * // Subscribe with a predicate
 * useWebSocketSubscription(
 *   (data) => data.menu || data.playback,
 *   handleCommand,
 *   [handleCommand]
 * );
 */
export function useWebSocketSubscription(filter, callback, deps = []) {
  // Memoize callback to prevent unnecessary re-subscriptions
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoizedCallback = useCallback(callback, deps);

  useEffect(() => {
    const unsubscribe = wsService.subscribe(filter, memoizedCallback);
    return unsubscribe;
  }, [filter, memoizedCallback]);
}

/**
 * React hook to send messages through WebSocket
 * 
 * @returns {function} Send function
 * 
 * @example
 * const sendMessage = useWebSocketSend();
 * sendMessage({ topic: 'fitness', action: 'start' });
 */
export function useWebSocketSend() {
  return useCallback((data) => {
    wsService.send(data);
  }, []);
}

export default useWebSocketStatus;
