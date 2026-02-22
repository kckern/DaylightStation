import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import wsService from '../../../services/WebSocketService.js';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useHomeline' });
  return _logger;
}

export const useHomeline = (role, deviceId, peer) => {
  const [peerConnected, setPeerConnected] = useState(false);
  const [status, setStatus] = useState(role === 'tv' ? 'waiting' : 'idle');
  const peerId = useMemo(() => `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, [role]);
  const heartbeatRef = useRef(null);
  const connectedDeviceRef = useRef(null);
  const answerUnsubRef = useRef(null);

  const topic = useCallback((devId) => `homeline:${devId}`, []);

  const send = useCallback((devId, type, payload = {}) => {
    wsService.send({ topic: topic(devId), type, from: peerId, ...payload });
  }, [topic, peerId]);

  // TV: broadcast waiting heartbeat
  useEffect(() => {
    if (role !== 'tv' || !deviceId) return;

    let count = 0;
    logger().info('heartbeat-start', { deviceId });
    const sendWaiting = () => {
      count++;
      send(deviceId, 'waiting', { label: deviceId });
      if (count <= 3 || count % 12 === 0) {
        logger().debug('heartbeat-sent', { deviceId, count });
      }
    };
    sendWaiting();
    heartbeatRef.current = setInterval(sendWaiting, 5000);

    return () => {
      logger().debug('heartbeat-stop', { deviceId, count });
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [role, deviceId, send]);

  // Set up ICE candidate relay
  useEffect(() => {
    const devId = role === 'tv' ? deviceId : connectedDeviceRef.current;
    if (!devId) return;

    peer.onIceCandidate((candidate) => {
      send(devId, 'candidate', { candidate });
    });
  }, [role, deviceId, peer, send]);

  // TV: listen for signaling messages
  useEffect(() => {
    if (role !== 'tv' || !deviceId) return;

    const unsubscribe = wsService.subscribe(
      (data) => data.topic === topic(deviceId) && data.from !== peerId,
      async (message) => {
        try {
          if (message.type === 'ready') {
            // Phone is listening — respond immediately so it doesn't wait for next heartbeat
            logger().info('ready-received', { from: message.from });
            send(deviceId, 'waiting', { label: deviceId });
          } else if (message.type === 'offer') {
            if (peerConnected) {
              logger().info('offer-rejected-occupied', { from: message.from });
              send(deviceId, 'occupied');
              return;
            }
            logger().info('offer-received', { from: message.from });
            setStatus('connecting');
            const answer = await peer.handleOffer({ type: 'offer', sdp: message.sdp });
            send(deviceId, 'answer', { sdp: answer.sdp });
            setPeerConnected(true);
            setStatus('connected');
          } else if (message.type === 'candidate') {
            await peer.addIceCandidate(message.candidate);
          } else if (message.type === 'hangup') {
            logger().info('peer-hangup');
            peer.reset();
            setPeerConnected(false);
            setStatus('waiting');
          }
        } catch (err) {
          logger().warn('signaling-error', { error: err.message });
        }
      }
    );

    return unsubscribe;
  }, [role, deviceId, topic, peerId, peer, peerConnected, send]);

  // Phone: connect to a specific device (drop-in model)
  // Subscribes to the device's topic and waits for its "waiting" heartbeat
  // before sending the SDP offer, so the TV has time to boot up.
  const connect = useCallback(async (targetDeviceId) => {
    if (role !== 'phone') return;
    connectedDeviceRef.current = targetDeviceId;
    setStatus('connecting');
    logger().info('connect-waiting-for-tv', { target: targetDeviceId });

    peer.onIceCandidate((candidate) => {
      send(targetDeviceId, 'candidate', { candidate });
    });

    // Clean up previous subscription
    if (answerUnsubRef.current) answerUnsubRef.current();

    let offerSent = false;

    const unsubAnswer = wsService.subscribe(
      (data) => data.topic === topic(targetDeviceId) && data.from !== peerId,
      async (message) => {
        try {
          if (message.type === 'waiting' && !offerSent) {
            // TV is alive and listening — send the offer now
            offerSent = true;
            logger().info('tv-ready', { target: targetDeviceId });
            const offer = await peer.createOffer();
            send(targetDeviceId, 'offer', { sdp: offer.sdp });
            logger().info('offer-sent', { target: targetDeviceId });
          } else if (message.type === 'answer') {
            logger().info('answer-received', { from: message.from });
            await peer.handleAnswer({ type: 'answer', sdp: message.sdp });
            setPeerConnected(true);
            setStatus('connected');
            logger().info('call-connected', { target: targetDeviceId });
          } else if (message.type === 'occupied') {
            logger().info('device-occupied', { target: targetDeviceId });
            setStatus('occupied');
          } else if (message.type === 'candidate') {
            await peer.addIceCandidate(message.candidate);
          } else if (message.type === 'hangup') {
            logger().info('remote-hangup', { target: targetDeviceId });
            peer.reset();
            setPeerConnected(false);
            setStatus('idle');
            connectedDeviceRef.current = null;
          }
        } catch (err) {
          logger().warn('signaling-error', { error: err.message });
        }
      }
    );

    answerUnsubRef.current = unsubAnswer;

    // Tell the TV we're listening — it will respond immediately with "waiting"
    // This eliminates the race where we miss the periodic heartbeat
    send(targetDeviceId, 'ready');
    logger().info('ready-sent', { target: targetDeviceId });
  }, [role, peer, peerId, topic, send]);

  // Phone: warn if stuck waiting for TV heartbeat
  useEffect(() => {
    if (role !== 'phone' || status !== 'connecting') return;

    const timer = setTimeout(() => {
      logger().warn('connect-timeout', {
        target: connectedDeviceRef.current,
        waitedMs: 10000,
        hint: 'No heartbeat received from TV in 10s'
      });
    }, 10_000);

    return () => clearTimeout(timer);
  }, [role, status]);

  // Hang up
  const hangUp = useCallback(() => {
    const devId = role === 'tv' ? deviceId : connectedDeviceRef.current;
    logger().info('hangup', { role, devId });
    if (devId) send(devId, 'hangup');
    peer.reset();
    setPeerConnected(false);
    setStatus(role === 'tv' ? 'waiting' : 'idle');
    connectedDeviceRef.current = null;
    if (answerUnsubRef.current) {
      answerUnsubRef.current();
      answerUnsubRef.current = null;
    }
  }, [role, deviceId, peer, send]);

  // Send hangup on unmount
  useEffect(() => {
    return () => {
      const devId = role === 'tv' ? deviceId : connectedDeviceRef.current;
      if (devId) {
        wsService.send({ topic: topic(devId), type: 'hangup', from: peerId });
      }
      if (answerUnsubRef.current) answerUnsubRef.current();
    };
  }, [role, deviceId, topic, peerId]);

  return { peerConnected, status, connect, hangUp };
};
