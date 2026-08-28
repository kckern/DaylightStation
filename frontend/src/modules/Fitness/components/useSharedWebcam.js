// useSharedWebcam.js — consumer hooks for FitnessWebcamProvider.jsx's
// WebcamContext, split out so Fast Refresh can hot-reload the provider on
// its own.
import { useContext } from 'react';
import { WebcamContext } from './FitnessWebcamProvider.jsx';

export function useSharedWebcam() {
  return useContext(WebcamContext);
}

export function useSharedWebcamStream() {
  const ctx = useSharedWebcam();
  return {
    stream: ctx?.stream ?? null,
    status: ctx?.status ?? 'idle',
    error: ctx?.error ?? null,
    permissionError: ctx?.permissionError ?? null,
  };
}
