import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '../../..');
const source = (relativePath) => readFileSync(path.join(backendRoot, 'src', relativePath), 'utf8');

test('agent memory builders depend only on typed factories', () => {
  const memory = source('3_applications/agents/framework/buildAgentMemory.mjs');
  const processors = source('3_applications/agents/framework/buildObservationalMemory.mjs');
  assert.doesNotMatch(memory, /#system|#adapters|@mastra|buildMastraMemory/);
  assert.doesNotMatch(processors, /#system|#adapters|@mastra|new\s+ObservationalMemory|storage\.stores/);
});

test('MediaMemory has no application-layer compatibility module', () => {
  assert.equal(existsSync(path.join(
    backendRoot,
    'src/3_applications/content/services/MediaMemoryService.mjs',
  )), false);
  assert.doesNotMatch(source('3_applications/content/index.mjs'), /MediaMemoryService/);
});

test('NutriBotConfig delegates storage projection', () => {
  const config = source('3_applications/nutribot/config/NutriBotConfig.mjs');
  assert.doesNotMatch(config, /#system\/testing|TestContext|transformPath|replace\(['"]\{username\}/);
});

test('AmbientLightService has no raw Home Assistant WebSocket protocol', () => {
  const service = source('3_applications/home-automation/AmbientLightService.mjs');
  assert.doesNotMatch(service, /from ['"]ws['"]|new\s+WebSocket|JSON\.parse|getConnection|access_token|subscribe_events|state_changed/);
});

test('PayrollSyncService has no vendor HTTP or storage-key mechanics', () => {
  const service = source('3_applications/finance/PayrollSyncService.mjs');
  assert.doesNotMatch(service, /httpClient|configService|https:\/\/|response\.(?:data|status)|checkSummaries|paycheck-details|setTimeout|_checkId|-rsu|cookie|checkKey|payEndDt|curNetPay|curDedns|curTaxes|curEarnsEarn|taxWithholdings/i);
});

test('device applications delegate wire topics, envelopes, correlation, and delivery', () => {
  const files = [
    '3_applications/devices/services/SessionControlService.mjs',
    '3_applications/devices/services/DeviceSessionApiService.mjs',
    '3_applications/devices/services/DeviceLivenessService.mjs',
    '3_applications/devices/services/CommandHandlerLivenessService.mjs',
    '3_applications/devices/services/WakeAndLoadService.mjs',
  ];
  for (const file of files) {
    const body = source(file);
    assert.doesNotMatch(body, /#shared-contracts\/media\/(?:envelopes|topics)/, file);
    assert.doesNotMatch(body, /\beventBus\b|subscribePattern|onClientMessage|waitForMessage|DEVICE_ACK_TOPIC|SCREEN_COMMAND_TOPIC/, file);
  }
});

test('fitness applications delegate broker topics and request correlation', () => {
  for (const file of ['3_applications/fitness/unlockService.mjs', '3_applications/fitness/manageService.mjs']) {
    const body = source(file);
    assert.doesNotMatch(body, /\beventBus\b|onClientMessage|broadcast\(|requestId|fitness\.(?:unlock|enroll|fingerprint)/, file);
  }
  assert.equal(existsSync(path.join(backendRoot, 'src/3_applications/fitness/unlockBroker.mjs')), false);
  assert.equal(existsSync(path.join(backendRoot, 'src/3_applications/fitness/manageBroker.mjs')), false);
});

test('firmware relay applications contain policy, not raw bus frames or topics', () => {
  const files = [
    '3_applications/hardware/foodScaleRelay.mjs',
    '3_applications/hardware/omrRelay.mjs',
    '3_applications/hardware/barcodeRelay.mjs',
    '3_applications/hardware/relayWatchdog.mjs',
    '3_applications/hardware/automotiveRelay.mjs',
  ];
  for (const file of files) {
    const body = source(file);
    assert.doesNotMatch(body, /\beventBus\b|\.onClientMessage\(|\.broadcast\(|\.sendToClient\(|frame\.(?:source|type)|RELAY_SOURCE|DEFAULT_TOPIC|topicForId/, file);
  }
});
