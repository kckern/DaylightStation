// Lightweight in-memory metrics for chatbots (placeholder until Prometheus integration)
// Usage: import { metrics, inc, observe } from './metrics.mjs';

if (!global.__chatbotMetrics) {
  global.__chatbotMetrics = {
    counters: new Map(),
    histograms: new Map()
  };
}

const registry = global.__chatbotMetrics;

export function inc(name, labels = {}, value = 1) {
  const key = name + JSON.stringify(labels);
  registry.counters.set(key, (registry.counters.get(key) || 0) + value);
}

export function observe(name, labels = {}, ms) {
  const key = name + JSON.stringify(labels);
  if (!registry.histograms.has(key)) registry.histograms.set(key, []);
  registry.histograms.get(key).push(ms);
}

export function snapshot() {
  const counters = {};
  for (const [k,v] of registry.counters.entries()) counters[k] = v;
  const histograms = {};
  for (const [k,arr] of registry.histograms.entries()) histograms[k] = { count: arr.length, p50: percentile(arr,0.5), p90: percentile(arr,0.9) };
  return { counters, histograms };
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a,b)=>a-b);
  const idx = Math.floor(p * (sorted.length-1));
  return sorted[idx];
}

export default { inc, observe, snapshot };