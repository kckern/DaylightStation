// ControllersOverlay — the Bluetooth screen opened from the fitness Settings
// menu (Tools → Controllers). The screen owns its keys and focus
// (BluetoothScreen / useScreenNav); this host only supplies the dialog layer,
// input.yml (GET /api/v1/emulator/library → input) and the `bluetooth`
// object from FitnessBluetoothContext.
import React, { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';
import { useFitnessBluetoothState } from '../../context/FitnessBluetoothContext.jsx';
import { BluetoothScreen } from '../../../../../games/emulator/browser/input/BluetoothScreen.jsx';
import './ControllersOverlay.scss';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'fitness-controllers-overlay' }));
const NO_CONTROLLERS = [];

export default function ControllersOverlay({ open, onClose }) {
  const titleId = useId();
  const bluetooth = useFitnessBluetoothState()?.bluetooth || null;
  const [input, setInput] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setInput(null);
    setLoadFailed(false);
    logger().info('controllers-overlay.open', {});
    DaylightAPI('api/v1/emulator/library').then((lib) => {
      if (cancelled) return;
      const controllers = Array.isArray(lib?.input?.controllers) ? lib.input.controllers : NO_CONTROLLERS;
      setInput({ controllers, keyboard: lib?.input?.keyboard || null });
      logger().info('controllers-overlay.config-loaded', { controllers: controllers.length });
    }).catch((err) => {
      if (cancelled) return;
      setInput({ controllers: NO_CONTROLLERS, keyboard: null });
      setLoadFailed(true);
      logger().warn('controllers-overlay.config-failed', { error: err?.message });
    });
    return () => { cancelled = true; logger().info('controllers-overlay.close', {}); };
  }, [open]);

  if (!open) return null;
  const notice = input === null
    ? 'Loading the controller list…'
    : (loadFailed ? 'Could not load the controller list. Search and Forget still work.' : null);
  return createPortal(
    <div className="fitness-controllers-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="fitness-controllers-overlay__panel">
        <BluetoothScreen
          titleId={titleId}
          host="fitness-settings"
          controllers={input?.controllers || NO_CONTROLLERS}
          keyboardMap={input?.keyboard || null}
          bluetooth={bluetooth}
          onClose={onClose}
          notice={notice}
        />
      </div>
    </div>,
    document.body,
  );
}
