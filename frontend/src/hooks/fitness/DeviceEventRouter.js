/**
 * DeviceEventRouter - Central dispatcher for device data payloads
 * 
 * Handles routing of different device types (ANT+, BLE, vibration) to their
 * respective handlers via a registry pattern. This allows easy addition of
 * new device types without modifying the core routing logic.
 * 
 * @example
 * const router = new DeviceEventRouter(deviceManager, equipmentLookup);
 * router.register('ant', antHandler);
 * router.register('ble_jumprope', jumpropeHandler);
 * 
 * // In data ingestion:
 * const device = router.route(payload);
 */

import getLogger from '../../lib/logging/Logger.js';

/**
 * @typedef {Object} RouteResult
 * @property {Object|null} device - The processed device object, or null if not handled
 * @property {boolean} handled - Whether the payload was handled by a registered handler
 * @property {string} [handlerName] - Name of the handler that processed the payload
 */

/**
 * @typedef {Object} HandlerContext
 * @property {import('./DeviceManager').DeviceManager} deviceManager
 * @property {Function} getEquipmentByBle - (bleAddress) => equipment config or null
 * @property {Function} getEquipmentByCadence - (cadenceId) => equipment config or null
 * @property {Function} getEquipmentByVibration - (equipmentId) => equipment config or null
 * @property {Array} equipmentCatalog - Full equipment list from config
 */

export class DeviceEventRouter {
  constructor() {
    /** @type {Map<string, (payload: any, ctx: HandlerContext) => Object|null>} */
    this._handlers = new Map();
    
    /** @type {HandlerContext} */
    this._context = {
      deviceManager: null,
      getEquipmentByBle: () => null,
      getEquipmentByCadence: () => null,
      getEquipmentByVibration: () => null,
      equipmentCatalog: []
    };
    
    // Debug logging throttle
    this._lastDebugLog = new Map();
    this._debugThrottleMs = 5000;
    
    // Register built-in handlers
    this._registerBuiltinHandlers();
  }

  /**
   * Set the device manager instance
   * @param {import('./DeviceManager').DeviceManager} deviceManager
   */
  setDeviceManager(deviceManager) {
    this._context.deviceManager = deviceManager;
  }

  /**
   * Set equipment catalog and build lookup maps
   * @param {Array} equipmentList - Equipment from config.yml
   */
  setEquipmentCatalog(equipmentList = []) {
    this._context.equipmentCatalog = equipmentList;
    
    // Build lookup maps
    const bleMap = new Map();
    const cadenceMap = new Map();
    const vibrationMap = new Map();
    
    equipmentList.forEach(entry => {
      if (!entry || !entry.id) return;
      
      // BLE devices (jumprope, etc.)
      if (entry.ble) {
        bleMap.set(String(entry.ble).trim(), entry);
      }
      
      // ANT+ cadence devices
      if (entry.cadence != null) {
        cadenceMap.set(String(entry.cadence).trim(), entry);
      }
      
      // Vibration sensors (by equipment ID since MQTT maps to equipment)
      if (entry.sensor?.type === 'vibration') {
        vibrationMap.set(String(entry.id).trim(), entry);
      }
    });
    
    this._context.getEquipmentByBle = (addr) => bleMap.get(String(addr).trim()) || null;
    this._context.getEquipmentByCadence = (id) => cadenceMap.get(String(id).trim()) || null;
    this._context.getEquipmentByVibration = (id) => vibrationMap.get(String(id).trim()) || null;
  }

  /**
   * Register a handler for a specific payload type
   * @param {string} type - Payload type (e.g., 'ant', 'ble_jumprope', 'vibration')
   * @param {(payload: any, ctx: HandlerContext) => Object|null} handler
   */
  register(type, handler) {
    if (typeof handler !== 'function') {
      throw new Error(`Handler for type '${type}' must be a function`);
    }
    this._handlers.set(type, handler);
  }

  /**
   * Unregister a handler
   * @param {string} type
   */
  unregister(type) {
    this._handlers.delete(type);
  }

  /**
   * Route a payload to the appropriate handler
   * @param {Object} payload - The incoming device data payload
   * @returns {RouteResult}
   */
  route(payload) {
    if (!payload) {
      return { device: null, handled: false };
    }

    // Determine payload type
    const payloadType = this._resolvePayloadType(payload);
    if (!payloadType) {
      return { device: null, handled: false };
    }

    // Find handler
    const handler = this._handlers.get(payloadType);
    if (!handler) {
      this._throttledDebug('unhandled_type', { type: payloadType });
      return { device: null, handled: false };
    }

    // Execute handler
    try {
      const device = handler(payload, this._context);
      return {
        device,
        handled: true,
        handlerName: payloadType
      };
    } catch (err) {
      getLogger().error('device_router.handler_error', {
        type: payloadType,
        error: err.message,
        stack: err.stack
      });
      return { device: null, handled: true, handlerName: payloadType };
    }
  }

  /**
   * Resolve the handler type from a payload
   * @param {Object} payload
   * @returns {string|null}
   */
  _resolvePayloadType(payload) {
    // Check topic first for fitness vs vibration routing
    if (payload.topic === 'vibration') {
      return 'vibration';
    }
    
    if (payload.topic === 'fitness') {
      // ANT+ data
      if (payload.type === 'ant' && payload.deviceId && payload.data) {
        return 'ant';
      }
      
      // BLE Jumprope
      if (payload.type === 'ble_jumprope' && payload.deviceId && payload.data) {
        return 'ble_jumprope';
      }
      
      // Future: other BLE device types
      // if (payload.type === 'ble_rower') return 'ble_rower';
    }
    
    return null;
  }

  /**
   * Throttled debug logging to avoid spam
   * @param {string} key
   * @param {Object} data
   */
  _throttledDebug(key, data) {
    const now = Date.now();
    const lastLog = this._lastDebugLog.get(key) || 0;
    if (now - lastLog > this._debugThrottleMs) {
      this._lastDebugLog.set(key, now);
      getLogger().debug(`device_router.${key}`, data);
    }
  }

  /**
   * Register built-in handlers for known device types
   * @private
   */
  _registerBuiltinHandlers() {
    // ANT+ Handler
    this.register('ant', (payload, ctx) => {
      if (!ctx.deviceManager) return null;
      
      const device = ctx.deviceManager.updateDevice(
        String(payload.deviceId),
        payload.profile,
        { ...payload.data, dongleIndex: payload.dongleIndex, timestamp: payload.timestamp }
      );
      
      return device;
    });

    // BLE Jumprope Handler
    this.register('ble_jumprope', (payload, ctx) => {
      if (!ctx.deviceManager) return null;
      
      const deviceIdStr = String(payload.deviceId);
      const equipment = ctx.getEquipmentByBle(deviceIdStr);
      const equipmentName = equipment?.name || null;
      
      const normalized = {
        id: deviceIdStr,
        name: equipmentName || payload.deviceName || 'Jumprope',
        type: 'jumprope',
        profile: 'jumprope',
        lastSeen: Date.now(),
        connectionState: 'connected',
        cadence: payload.data.rpm || 0,
        revolutionCount: payload.data.jumps || 0,
        timestamp: payload.timestamp ? new Date(payload.timestamp).getTime() : Date.now()
      };
      
      return ctx.deviceManager.registerDevice(normalized);
    });

    // Vibration Handler
    this.register('vibration', (payload, ctx) => {
      if (!ctx.deviceManager) return null;
      
      const equipmentId = payload.equipmentId;
      if (!equipmentId) return null;
      
      const equipment = ctx.getEquipmentByVibration(equipmentId);
      const equipmentName = equipment?.name || payload.equipmentName || equipmentId;
      const equipmentType = equipment?.type || payload.equipmentType || 'vibration';
      
      // Calculate intensity from axes if available
      const axes = payload.data || {};
      const intensity = Math.sqrt(
        Math.pow(axes.x_axis || 0, 2) +
        Math.pow(axes.y_axis || 0, 2) +
        Math.pow(axes.z_axis || 0, 2)
      );
      
      const normalized = {
        id: equipmentId,
        name: equipmentName,
        type: equipmentType,
        profile: 'vibration',
        lastSeen: Date.now(),
        connectionState: 'connected',
        vibration: payload.data?.vibration || false,
        intensity: Math.round(intensity * 10) / 10,
        axes: {
          x: axes.x_axis || 0,
          y: axes.y_axis || 0,
          z: axes.z_axis || 0
        },
        thresholds: payload.thresholds || equipment?.thresholds || { low: 5, medium: 15, high: 30 },
        battery: axes.battery,
        batteryLow: axes.battery_low,
        linkquality: axes.linkquality,
        timestamp: payload.timestamp || Date.now()
      };
      
      return ctx.deviceManager.registerDevice(normalized);
    });
  }

  /**
   * Get list of registered handler types
   * @returns {string[]}
   */
  getRegisteredTypes() {
    return Array.from(this._handlers.keys());
  }
}

export default DeviceEventRouter;
