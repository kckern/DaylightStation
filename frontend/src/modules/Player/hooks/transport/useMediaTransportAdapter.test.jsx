/**
 * Regression tests for the 2026-07-21 fitness-kiosk memory leak (14 GB heap).
 *
 * Root cause: useMediaTransportAdapter captured the `resilienceBridge` and
 * `mediaAccess` VALUES as useCallback deps. Every re-registration minted a new
 * `getMediaEl` closure that captured the PREVIOUS generation's bridge object,
 * chaining every render generation into an unbounded retained list, while the
 * identity churn fed a setState feedback loop (Player.handleRegisterMediaAccess
 * <-> renderer registration effects) at ~13k renders/sec.
 *
 * The contract under test: the adapter's callbacks and the adapter object
 * itself keep ONE identity for the life of the component, no matter how many
 * times the bridge/mediaAccess objects are replaced — while still resolving
 * the CURRENT bridge/mediaAccess at call time.
 */
import React, { useRef } from 'react';
import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { useMediaTransportAdapter } from './useMediaTransportAdapter.js';

// Test harness component: exposes the adapter and lets us swap inputs.
function Harness({ capture, mediaAccess, bridgeValue, controller }) {
  const controllerRef = useRef(controller || null);
  const resilienceBridgeRef = useRef(null);
  resilienceBridgeRef.current = bridgeValue || null;
  const adapter = useMediaTransportAdapter({ controllerRef, mediaAccess, resilienceBridgeRef });
  capture(adapter);
  return null;
}

const makeBridge = (el) => ({
  getMediaEl: () => el,
  getContainerEl: () => el
});

describe('useMediaTransportAdapter identity stability (leak regression)', () => {
  it('keeps ONE adapter/getMediaEl identity across many bridge/mediaAccess replacements', () => {
    const adapters = [];
    const capture = (a) => adapters.push(a);
    const elA = { id: 'el-a' };

    const { rerender } = render(
      <Harness capture={capture} mediaAccess={null} bridgeValue={makeBridge(elA)} />
    );

    // Simulate the registration churn that drove the leak: 100 generations of
    // fresh bridge + mediaAccess objects (identical behavior, new identity).
    for (let i = 0; i < 100; i++) {
      const mediaAccess = {
        getMediaEl: () => elA,
        hardReset: null,
        fetchVideoInfo: null,
        autoplayBlocked: false,
        onAutoplayResolved: null
      };
      act(() => {
        rerender(
          <Harness capture={capture} mediaAccess={mediaAccess} bridgeValue={makeBridge(elA)} />
        );
      });
    }

    expect(adapters.length).toBeGreaterThan(100);
    const adapterIds = new Set(adapters);
    const getMediaElIds = new Set(adapters.map((a) => a.getMediaEl));
    const getContainerElIds = new Set(adapters.map((a) => a.getContainerEl));

    // THE boundedness property: if these grow with generations, every
    // generation is a fresh closure — the structure that chained the leak.
    expect(getMediaElIds.size).toBe(1);
    expect(getContainerElIds.size).toBe(1);
    expect(adapterIds.size).toBe(1);
  });

  it('resolves the CURRENT bridge at call time (no stale capture)', () => {
    const adapters = [];
    const capture = (a) => adapters.push(a);
    const elA = { id: 'el-a' };
    const elB = { id: 'el-b' };

    const { rerender } = render(
      <Harness capture={capture} mediaAccess={null} bridgeValue={makeBridge(elA)} />
    );
    const firstGetMediaEl = adapters[0].getMediaEl;
    expect(firstGetMediaEl()).toBe(elA);

    act(() => {
      rerender(<Harness capture={capture} mediaAccess={null} bridgeValue={makeBridge(elB)} />);
    });
    // The ORIGINAL closure must resolve the NEW bridge — stability must not
    // mean staleness.
    expect(firstGetMediaEl()).toBe(elB);
  });

  it('falls back bridge -> mediaAccess -> controller transport', () => {
    const adapters = [];
    const capture = (a) => adapters.push(a);
    const accessEl = { id: 'access-el' };
    const transportEl = { id: 'transport-el' };
    const controller = { transport: { getMediaEl: () => transportEl } };

    const { rerender } = render(
      <Harness
        capture={capture}
        mediaAccess={{ getMediaEl: () => accessEl }}
        bridgeValue={{ getMediaEl: () => null }}
        controller={controller}
      />
    );
    const adapter = adapters[adapters.length - 1];
    // bridge returns null -> falls through to mediaAccess
    expect(adapter.getMediaEl()).toBe(accessEl);

    act(() => {
      rerender(
        <Harness
          capture={capture}
          mediaAccess={{ getMediaEl: () => null }}
          bridgeValue={{ getMediaEl: () => null }}
          controller={controller}
        />
      );
    });
    // bridge + mediaAccess empty -> controller transport
    expect(adapter.getMediaEl()).toBe(transportEl);
  });
});
