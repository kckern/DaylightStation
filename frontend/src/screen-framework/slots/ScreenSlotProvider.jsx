import React, { createContext, useContext, useState, useCallback } from 'react';

const SlotContext = createContext({});

export function ScreenSlotProvider({ children }) {
  const [slots, setSlots] = useState({});

  const showSlot = useCallback((slotName, widget, props = {}) => {
    setSlots(prev => ({ ...prev, [slotName]: { widget, props } }));
  }, []);

  const dismissSlot = useCallback((slotName) => {
    setSlots(prev => {
      const next = { ...prev };
      delete next[slotName];
      return next;
    });
  }, []);

  return (
    <SlotContext.Provider value={{ slots, showSlot, dismissSlot }}>
      {children}
    </SlotContext.Provider>
  );
}

export function useSlot(slotName) {
  const { slots, showSlot, dismissSlot } = useContext(SlotContext);
  return {
    show: (widget, props) => showSlot(slotName, widget, props),
    dismiss: () => dismissSlot(slotName),
    active: Boolean(slots[slotName]),
  };
}

export function useSlotState(slotName) {
  const { slots } = useContext(SlotContext);
  return slots[slotName] || null;
}
