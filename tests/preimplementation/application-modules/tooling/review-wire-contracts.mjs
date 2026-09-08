/** Field-level producer/consumer review; no satellite source is executed. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {root,packet,emit} from './census.mjs';
const read=name=>JSON.parse(fs.readFileSync(path.join(packet,name)));
const targets=read('external-targets.json'),graph=read('dependency-ledger.json'),source=read('source-ledger.json');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),inputs=new Map();
function at(file,token){const text=fs.readFileSync(path.join(root,file),'utf8'),index=text.indexOf(token);assert.ok(index>=0,'Missing wire anchor: '+file+':'+token);inputs.set(file,{path:file,sha256:hash(text)});return {path:file,line:text.slice(0,index).split('\n').length,anchor:token};}
const incoming=file=>graph.edges.filter(e=>e.target===file).map(e=>({edge:e.id,path:e.from,line:e.line}));
const midi='_extensions/piano/recorder/midi_message_converter.py',sender='_extensions/piano/recorder/midi_ws_broadcaster.py';
const firmware='_extensions/pressure-mat-relay/firmware/src/main.cpp',adapter='backend/src/1_adapters/hardware/pressure-mat/PressureMatAdapter.mjs';
const bus='backend/src/1_adapters/eventbus/WebSocketEventBus.mjs';
const portal='_extensions/portal-keys/app/app/src/main/java/net/kckern/portalkeys/';
const hid='_extensions/portal-keys/app/payload/src/main/java/net/kckern/portalkeys/payload/';
const audio='_extensions/audio-bridge/app/app/src/main/java/net/kckern/audiobridge/AudioBridgeService.java';
const documentRoot='_extensions/document-processor/src/';
const gateways='backend/src/1_adapters/hardware/firmware/EventBusFirmwareRelayGateways.mjs';
const hub='_extensions/playback-hub/',hubAdapter='backend/src/1_adapters/playback-hub/HttpPlaybackHubAdapter.mjs';
const pianoPayload='_extensions/piano-bridge/app/payload/src/main/java/net/kckern/pianobridge/';
const pianoShell='_extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/';
const pianoBrowser='frontend/src/modules/Piano/PianoKiosk/';
const fitnessRoot='_extensions/fitness/src/',fitnessGateway='backend/src/1_adapters/fitness/EventBusBiometricGateway.mjs';
const calcRelay='_extensions/ticalc-relay/firmware/src/',calcTools='_extensions/ti86-app/tools/';
const calcCodec='backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
const calcApps='backend/src/3_applications/school/schoolcalc/';
const firmwarePath=id=>'_extensions/'+id+'/firmware/src/main.cpp';
const provisioning=id=>({generator:at('_extensions/'+id+'/firmware/tools/gen-config.mjs','const OUT ='),
  declarations:at('_extensions/'+id+'/firmware/platformio.ini','platform ='),
  policy:'Generator reads explicit private YAML and writes include/config.h; do not execute, copy generated values or infer flashed identity from declared ranges. Keep generator/flash/build paths stable through rehearsal.'});
const reviews=[{
  id:'WIRE-PIANO-RECORDER',target:'TARGET-piano',
  producer:at(midi,'def midi_message_to_json('),sender:at(sender,'async def _send_queued_messages('),
  consumer:at('backend/src/app.mjs',"if (message.source === 'piano' && message.topic === 'midi')"),
  browser:at('frontend/src/modules/Piano/useMidiSubscription.js','const handleMidiMessage ='),
  browserConsumers:incoming('frontend/src/modules/Piano/useMidiSubscription.js'),
  envelope:{topic:'midi',source:'piano',timestamp:'UTC ISO string with milliseconds',sessionId:'nullable current session identifier',type:['note','control','session']},
  variants:[
    {type:'note',event:['note_on','note_off'],fields:['note','noteName','velocity','channel'],rule:'Zero-velocity note_on normalizes to note_off; MIDI channel retained'},
    {type:'control',event:'control_change',fields:['control','controlName','value','channel'],rule:'Browser sustain uses controlName sustain and value >= 64'},
    {type:'control',event:'pitchwheel',fields:['pitch','channel']},
    {type:'control',event:'program_change',fields:['program','channel']},
    {type:'session',event:'session_start',fields:['sessionId','device'],rule:'Browser clears active notes, sustain and note history'},
    {type:'session',event:'session_end',fields:['sessionId','duration','noteCount','filePath','deleted'],rule:'Duration rounded to two places. Builder can delete short recordings before returning payload; not a pure serializer.'}
  ],
  centralProjection:'Current app checks source/topic plus truthy type/timestamp, then broadcasts source/type/timestamp/sessionId/data. Other producer fields are not forwarded by this branch. Bus adds topic and default timestamp before payload spread.',
  browserClock:'Note-event time uses browser Date.now on receipt, not the producer timestamp; do not replace it with device time during relocation.',
  delivery:{source:at(sender,'DEFAULT_QUEUE_MAX_SIZE = 1000'),queue:'Bounded queue drops when full; batches up to 50; failed send requeues at tail. No replay deduplication or exactly-once guarantee.',
    heartbeat:at(sender,"'topic': 'heartbeat'"),policy:'Recorder ping/pong JSON uses topic heartbeat, type ping/pong and numeric timestamp; current server periodic JSON heartbeat is type heartbeat with ts. Do not claim these dialects are interchangeable or a round-trip is proved.'},
  operator:{entry:at('_extensions/piano/recorder/auto_midi_recorder.py','class AutoMIDIRecorder:'),
    effects:'Constructor creates output directory, opens script-relative midi_recorder.log, can start network thread and installs signal handlers. Source paths/log placement remain stable.',
    simulator:at('_extensions/piano/simulation.mjs',"import WebSocket from 'ws'"),
    build:'Simulator package has package-lock; Python recorder dependency installation/versions are not pinned by that Node lock.'},
  cases:[],remaining:'Synthetic producer serialization/browser replay and actual deployment identity remain unproved. Android piano-bridge is a separate target, not implicitly covered by this recorder wire review.'
},{
  id:'WIRE-PRESSURE-MAT',target:'TARGET-pressure-mat-relay',
  producer:at(firmware,'static void addReading('),consumer:at(adapter,'ingest(clientId, message)'),
  downstream:at('backend/src/3_applications/hardware/pressureMatRelay.mjs','export function createPressureMatRelay('),
  composition:at('backend/src/app.mjs','const pressureMatAdapter = new PressureMatAdapter('),consumers:incoming(adapter),
  envelope:{source:'pressure-mat-relay',type:['reading','presence','hello'],protocol_version:2,topic:'No topic field in firmware readings; central adapter chooses configured/default pressure-mat topic'},
  mappings:[['protocol_version','protocolVersion'],['firmware_build','firmwareBuild'],['boot_count','bootCount'],['id','id'],['voltage','voltage'],['rest_voltage','restVoltage'],['delta_v','deltaV'],['gradient_vps','gradientVps'],['occupied','occupied'],['occupancy_known','occupancyKnown'],['detection_state','detectionState'],['rearm_count','rearmCount'],['steps','steps'],['stomps','stomps'],['ts','deviceTs'],['peak_delta_v','peakDeltaV'],['peak_gradient_vps','peakGradientVps'],['press_duration_ms','pressDurationMs'],['classified_stomp','classifiedStomp']].map(([wire,normalized])=>({wire,normalized})),
  variants:{presence:{events:['pressed','released','stomped'],releaseSummary:['peak_delta_v','peak_gradient_vps','press_duration_ms','classified_stomp']},
    hello:{fields:['uptime_s','last_reset','rssi','ip','free_heap'],rule:'Central snapshot retains uptime/reset/RSSI/freeHeap, not device IP. Hello does not require finite reading metrics.'}},
  validation:'Source/type and nonempty trimmed ID; non-hello requires finite Number-coerced voltage/delta/gradient; presence event allowlist. Optional flags/counters/build ID use distinct type/value guards. Unknown IDs can be ingested; configured-host authority governs commands separately.',
  clock:'Firmware ts is millis since boot. Adapter adds ISO receivedAt using its own clock; online status uses receipt age < 90000ms. Persistence day buckets follow household timezone, not device uptime.',
  commands:{subscription:at(firmware,'pressure-mat-control:'),sender:at(adapter,'#sendCommand('),receiver:at(firmware,'const char* action = command["action"]'),
    topic:'pressure-mat-control:<id>',source:'pressure-mat-api',actions:['recalibrate','threshold','reboot'],fields:['delta','gradient','stompDelta','stompGradient'],
    meaning:'Adapter returns ok only when bus delivery count >= 1; this is not a device application acknowledgement.',
    mismatch:'Adapter requires positive finite delta/gradient; firmware independently accepts delta 0.01..2.0, gradient 0.01..5.0, stompDelta 0.02..2.5, stompGradient 0.02..8.0 and ignores out-of-range values. Preserve difference; do not silently tighten API.'},
  provisioning:{source:at('_extensions/pressure-mat-relay/firmware/tools/gen-config.mjs','const migratedInheritedPath ='),
    policy:'Generated include/config.h contains private provisioning. Config input supplied by argument/environment; explicit local settings override referenced sibling provisioning. Legacy bare sibling lookup has parent-directory fallback. Header is not source to copy into package.',
    toolchain:at('_extensions/pressure-mat-relay/firmware/platformio.ini','platform = espressif32@6.5.0')},
  cases:['CASE-WIRE-PRESSURE-INGEST','CASE-WIRE-PRESSURE-COMMAND'],remaining:'Actual firmware encoder replay, detector hardware, HTTP status/OTA and live acknowledgement are not tested by Node adapter cases.'
},{
  id:'WIRE-FINGERPRINT-PROFILES',target:'TARGET-fingerprint',kind:'pure profile representation; no tracked host daemon',
  producer:at('_extensions/fingerprint/src/profileStore.mjs','export function addFingerprintEntry('),
  consumer:at('backend/src/3_applications/fitness/fingerprintProfileWriter.mjs','export function createFingerprintProfileWriter('),
  related:at('_extensions/fitness/src/profileStore.mjs','export function addFingerprintEntry('),
  identityIndex:at('backend/src/3_applications/fitness/identityRelay.mjs','export function buildFingerprintIdentityIndex('),
  registry:{path:'user profile identities.fingerprints[]',fields:['id','finger','enrolled'],
    helperSemantics:'Fingerprint host and central append clone profile/identities/list shallowly, preserve prior entries and always include enrolled even when undefined; extra fields including simulated are discarded. Fitness helper omits undefined enrolled and preserves supplied simulated. These are not interchangeable byte/own-property contracts.',
    gallerySemantics:'Both helpers iterate supplied usernames in order and include every truthy ID, including duplicates. Host helper throws for undefined usernames; Fitness helper treats it as empty. Central identity index instead maps each ID to userId/finger with last enumerated owner winning and missing finger null.'},
  writer:{sequence:['readProfile(username) or {}','writeProfile(username, transformedProfile)','profileCache.refresh(username)'],
    semantics:'Injected methods are called synchronously, not awaited. A false write return does not suppress refresh; a thrown write does. A refresh exception rejects after a write has occurred. Removal filters all exact matching IDs. No transaction or rollback implied.'},
  population:source.files.filter(f=>f.path.startsWith('_extensions/fingerprint/')).map(f=>({path:f.path,source:f.id})),
  documentation:at('_extensions/fingerprint/README.md','## Responsibilities (planned)'),
  cases:['CASE-WIRE-FINGERPRINT-SHAPES','CASE-WIRE-FINGERPRINT-GALLERY','CASE-WIRE-FINGERPRINT-WRITE-REFRESH'],
  remaining:'Only helper, test and README are tracked in this target; its planned host enrollment/identify/bridge entries are not an implemented service here. Full fitness biometric transport and private template deployment belong to TARGET-fitness; no templates or user records inspected.'
},{
  id:'WIRE-AUDIO-ROUTER-LAUNCH',target:'TARGET-audio-router',kind:'launch declaration only; implementation unavailable in tracked source',
  declaration:at('_extensions/audio-router/audio-router.service','ExecStart='),
  implementation:{basename:'audio-router.sh',trackedMatches:source.files.filter(f=>path.basename(f.path)==='audio-router.sh').map(f=>f.path),
    gapId:'TARGET-AUDIO-ROUTER-IMPLEMENTATION',reviewer:'audio runtime/operator reviewer',
    nextAction:'Before changing this launcher or its controller-side assumptions, obtain the actual script/version and protocol inputs read-only under explicit operator scope. Do not infer them from a service name.'},
  unit:{type:'simple',after:['graphical.target','pipewire.service'],restart:'always',restartSec:5,wantedBy:'multi-user.target',
    environment:'EnvironmentFile value and absolute launch path retained in source; private deployment values excluded from packet'},
  cases:[],remaining:'No encoder/decoder or build artifact exists here to pair or test. This is an attributable inventory absence, not completed wire verification.'
},{
  id:'WIRE-DOCUMENT-PROCESSOR',target:'TARGET-document-processor',kind:'independent daemon and filesystem handoff',
  server:at(documentRoot+'server.mjs','export function createServer('),watcher:at(documentRoot+'watcher.mjs','chokidar.watch(INBOX,'),
  worker:at(documentRoot+'processor.mjs','export async function processInbox('),parser:at(documentRoot+'vision.mjs','export function parseResponse('),
  endpoints:[{method:'POST',path:'/process',success:{ok:true,result:'null for empty inbox or {documents, errors}'},
    errors:['409 with error when shared status.state is processing','500 with error for an uncaught processInbox failure'],
    status:'Successful invocation sets idle, lastRun ISO and lastResult; caught failure sets error and lastResult but does not update lastRun. A batch result containing errors is still a 200 success at this HTTP layer.'},
    {method:'GET',path:'/status',result:['state','lastRun','lastResult']}],
  lifecycle:'createServer immediately listens and returns the listener, not an inert Express factory. watcher starts chokidar and server at module evaluation. Its processing boolean is separate from server status: watcher sets shared status, but its guard does not read that status, so no single shared mutex is proved.',
  fileHandoff:{stage:at(documentRoot+'processor.mjs','export async function stageBatch('),
    paths:['/data/_Inbox','/data/_Processing','/data/_Ready','/data/_Pending'],
    input:'Case-insensitive JPG/JPEG names sorted lexically then renamed into batch-Date.now directory; staging is not atomic across the batch.',
    result:'PDF writes can succeed individually; no document errors removes batch inputs, partial or outer failure attempts a move to pending. Existing processBatch catches failures into result.errors; it does not necessarily throw to HTTP.',
    postConsume:at(documentRoot+'post-consume.sh','DOCS_ROOT='),
    archive:'Paperless DOCUMENT_FILENAME copied under Documents/year using parsed DOCUMENT_CREATED or current year. Despite the comment, DOCUMENT_ADDED is not read. Preserve environment and mounted path semantics; do not execute on private documents.'},
  modelBoundary:{request:at(documentRoot+'vision.mjs','getClient().chat.completions.create('),
    fields:['documents[].pages','documents[].category','documents[].description','documents[].date','documents[].issues'],
    validation:'Parser strips an optional fence, parses JSON and checks documents is an array only. Prompt asks complete/exclusive page grouping; parser does not enforce it. Do not silently add schema validation during relocation.'},
  build:at('_extensions/document-processor/Dockerfile','CMD ["node", "src/watcher.mjs"]'),
  cases:[],remaining:'No controller-side API binding was found by the recorded literal reference search; known consumers are watcher/manual HTTP and Paperless filesystem hook. Dynamic/external operators and actual dependency/image identity remain unproved. No daemon, model request or document mutation executed.'
},{
  id:'WIRE-PORTAL-KEYS',target:'TARGET-portal-keys',kind:'two browser input transports plus independent Android control plane',
  producer:at(portal+'ControlServer.java','public void broadcastKey('),
  service:at(portal+'PortalKeysService.java','protected boolean onKeyEvent('),
  consumer:at('frontend/src/screen-framework/usePortalKeys.js','export function usePortalKeys('),
  activation:at('frontend/src/screen-framework/PortalKeysBridge.jsx','const enabled = config?.enabled === true;'),
  volume:{envelope:['type:key','key','action:down|up','interactive','ts:epoch milliseconds'],
    connection:'Browser ws://localhost:<configured port>/; default 8771; ready and literal ping/JSON pong control messages separate from key events.',
    semantics:'Service publishes volume down and up before its display-off wake branch. Hook checks only type/key, stepping on both actions regardless of interactive; size uses stepSize || 0.05. Mute messages are observation-only in browser, while current service passes all non-volume keys through without broadcasting. Source comments do not override these branches.',
    lifecycle:'Hook retries 1s doubling to 30s, resets on open, retains current context handler via ref, clears retry timer/detaches handlers/closes on unmount. Service shutdown stops sender executor.'},
  keyboard:{encoder:at(hid+'HidKeyEvent.java','String toJson()'),sender:at(hid+'HidBridgeServer.java','void publish('),
    consumer:at('frontend/src/screen-framework/usePortalHidKeyboard.js','export function dispatchPortalHidMessage('),
    envelope:['type:keyboard','action','key','code','location','ctrlKey','shiftKey','altKey','metaKey','repeat','ts'],
    transport:'Loopback-only server/browser at 127.0.0.1, default 8774. Down starts repeat after 450ms every 50ms for repeatable usages; up cancels. Close stops executors and repeat tasks.',
    validation:'Browser accepts only keyboard, down/up and key/code strings <=64; empty strings are allowed. Location Number-coerced, flags Boolean-coerced; producer timestamp unused by dispatch.',
    effects:'Dispatches cancelable bubbling composed KeyboardEvent to active element/body with non-configurable portalHid marker. Only unprevented down performs manual editing/focus/activation/scroll. Native input value setter plus input event for text controls; optional execCommand for contenteditable. These are untrusted events, not native HID equivalence.'},
  control:{shell:at(portal+'ShellServer.java','private boolean authorized('),loader:at(portal+'PayloadLoader.java','String swap('),store:at(portal+'PayloadStore.java','synchronized void commit('),
    operator:at('_extensions/portal-keys/pkctl.mjs','async payload('),
    semantics:'Separate shell 8772 accepts x-portal-token or Bearer authorization; /payload POST uses URL and SHA256, /payload/rollback and /restart queue work. Accepted is not active/healthy. Loader verifies full hash before swap, loads exact net.kckern.portalkeys.payload.Main via parent shell classloader and can roll back. Android application/shell-api and separately compiled payload retain distinct artifacts and stable CLI path; no Node-workspace assumption.'},
  cases:['CASE-WIRE-PORTAL-HID-EDIT','CASE-WIRE-PORTAL-HID-ACTION','CASE-WIRE-PORTAL-VOLUME'],
  remaining:'Actual Android HID decoding, permissions/backlight, reconnect timing, all ops/control endpoints, payload install/rollback and browser layout/audio remain unverified. Selected jsdom cases are not device or complete control-plane proof.'
},{
  id:'WIRE-AUDIO-BRIDGE',target:'TARGET-audio-bridge',kind:'native microphone stream with two browser consumers',
  producer:at(audio,'public void onOpen(WebSocket conn,'),capture:at(audio,'byte[] buffer = new byte[FRAME_SIZE];'),
  consumer:at('frontend/src/modules/Input/hooks/useNativeAudioBridge.js','export const useNativeAudioBridge ='),
  additionalConsumer:at('frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js','function getBridgeStream()'),
  envelope:{header:{sampleRate:48000,channels:1,format:'pcm_s16le'},frames:'Binary PCM16 mono, nominal 960-byte/10ms buffer; actual bytesRead controls each send, not a guaranteed fixed packet length'},
  exclusivity:'First connected client owns capture; another receives error JSON then close code 1008. Active disconnect stops capture. Client-to-server messages are ignored; no ack/replay protocol.',
  browser:{native:'Config-enabled URL; ArrayBuffer transport. Uses header sampleRate or 48000, main-thread AEC plus AudioWorklet, base gain times shared effectiveMaster. Format/channels are not a complete negotiation/validation gate. Binary before pipeline readiness is not forwarded.',
    weekly:'Fixed loopback URL, 1500ms header timeout; rejects bad/error headers, derives sample rate, converts Int16 to floats in a worklet. Its timeout/fallback/cleanup are separate from the native bridge hook; not one interchangeable client.',
    resource:at('frontend/src/modules/Input/hooks/useNativeAudioBridge.js',"import speexWasmSource from '../../../lib/audio/speex_aec.js?raw'"),
    identity:'Preserve shared ScreenVolumeContext identity and raw Speex/worklet loading; no real microphone or AudioContext was opened in this review.'},
  deployment:{build:at('_extensions/audio-bridge/app/app/build.gradle',"applicationId 'net.kckern.audiobridge'"),
    recovery:at('backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs','async healAudioBridge('),
    policy:'Companion APK and device-specific launcher/heal contracts remain separate from central source movement. Gradle declarations are not installed APK/device identity.'},
  cases:[],remaining:'Actual PCM encoder replay, native/WebView audio graphs, AEC, contention/retry and deployed APK identity remain open. No device was accessed.'
},{
  id:'WIRE-CONTENT-BARCODE',target:'TARGET-content-barcode-relay',kind:'BLE scan producer and semantic barcode gateway',
  producer:at(firmwarePath('content-barcode-relay'),'static void relay(const char* code)'),
  consumer:at(gateways,'export class BarcodeFirmwareGateway'),
  policy:at('backend/src/3_applications/hardware/barcodeRelay.mjs','export function createBarcodeRelay('),
  composition:at('backend/src/app.mjs','relayGateway: new BarcodeFirmwareGateway('),
  envelope:{source:'barcode-relay',type:'scan',fields:['device','route','label','code','ts'],clock:'uint32 device uptime milliseconds'},
  projection:'Gateway also accepts kitchen-relay scan frames. Requires nonempty trimmed string code; device uses nonempty string or injected default; route allowlist content/nutribot otherwise injected default. Publishes source barcode-relay on fixed barcode-relay topic. Timestamp is current household-local receipt time; firmware ts and label are not preserved.',
  delivery:'Firmware records latest scan diagnostics even offline, but sends only when connected; this relay function has no replay queue/ack. Gateway invokes listener then broadcasts, ignoring false return. Application invokes onScan before serial append; catches synchronous onScan exceptions only. No exactly-once or awaited dispatch completion implied.',
  provisioning:provisioning('content-barcode-relay'),
  cases:['CASE-WIRE-KITCHEN-DISPATCH'],remaining:'BLE HID decoding/queue and offline hardware behavior, scan dispatch/authorization, all actual operator invocations and deployed firmware identity remain unproved.'
},{
  id:'WIRE-KITCHEN',target:'TARGET-kitchen-relay',kind:'one physical producer, separate scale and barcode contracts',
  producer:at(firmwarePath('kitchen-relay'),'static bool txReading('),scan:at(firmwarePath('kitchen-relay'),'static bool sendScan('),
  consumer:at(gateways,'export class FoodScaleFirmwareGateway'),barcode:at(gateways,'export class BarcodeFirmwareGateway'),
  policy:at('backend/src/3_applications/hardware/foodScaleRelay.mjs','export function createFoodScaleRelay('),
  composition:at('backend/src/app.mjs','relayGateway: new FoodScaleFirmwareGateway('),
  variants:[{type:'scale',fields:['id','grams','stable','unit','ts','delayed_ms if delay >1000']},
    {type:'button',fields:['id','press','ts','delayed_ms if delay >1000']},
    {type:'scan',fields:['device','route','code','ts','delayed_ms if delay >1000']},
    {type:'hello',fields:['id','uptime_s','boot_count','last_reset','free_heap','min_heap','rssi','ts']}],
  projection:'All source kitchen-relay, split by type. Scale gateway also accepts legacy food-scale-relay. Number-coerces finite grams (including null to zero), Boolean stable, default unit g; scale event source ble-relay. Button press long only for exact long, otherwise short; button event has no source property. Topic configured per scale or food-scale. Barcode follows its own gateway; hello feeds liveness separately.',
  clock:'Wire ts is capture uptime; delayed_ms indicates late send. Gateways use current household-local receipt time, do not rebase from either field.',
  queues:{source:at(firmwarePath('kitchen-relay'),'static void flushPendingEvents()'),
    scale:'16-slot RAM queue drops oldest; durable readings expire after 120000ms, buttons do not. Unstable/live readings are not retained as durable history. Flushed readings set stable true. A false send keeps the queued item.',
    scans:'Separate 24-slot RAM queue drops oldest. Producer comments about no queued readings are not a substitute for the actual scale-side queue.'},
  persistence:'Application logs stable nonempty measurements once until changed by threshold or pan empty; button captures latest weight. One serialized promise chain handles appends; errors logged, dispose unsubscribes but exposes no flush promise. No disk layout belongs to this policy.',
  provisioning:{...provisioning('kitchen-relay'),override:'DAYLIGHT_CONFIG_OUT can override generated header output; do not assume the tool is confined to its default location'},
  cases:['CASE-WIRE-KITCHEN-DISPATCH'],remaining:'Firmware BLE/button/debounce/offline queue replay, full application persistence matrix, HTTP simulation/control endpoints and actual flashed identities remain unverified.'
},{
  id:'WIRE-OMR',target:'TARGET-omr-relay',kind:'serial/NFC scan transport with echo acknowledgement and separate persistence',
  producer:at(firmwarePath('omr-relay'),'static uint16_t packColumn('),queue:at(firmwarePath('omr-relay'),'static void drainQueue()'),
  consumer:at(gateways,'export class OmrFirmwareGateway'),policy:at('backend/src/3_applications/hardware/omrRelay.mjs','export function createOmrRelay('),
  composition:at('backend/src/app.mjs','relayGateway: new OmrFirmwareGateway('),
  variants:[{type:'sheet',fields:['id','columns','markedColumns','marks']},{type:'nfc',fields:['id','uid','piccType','atqa','sak']},
    {type:'reader-error',fields:['id','echo']},{type:'raw',fields:['id','hex','len','truncated when applicable']},
    {type:'relay-status',fields:['id','queued','dropped','truncated','uptimeMs','boot_count','last_reset','wdt_s']}],
  encoding:'Firmware source omr-relay. Two serial bytes per 12-bit column. Truncated input never becomes sheet; short command frames ignored, trailing question-mark frames become reader-error, odd byte lengths raw. Gateway Number-coerces nonempty marks and accepts only integers 0..4095, recalculating counts; NFC trims/uppercases 8..20 hexadecimal characters.',
  clock:'Queue drain adds ageMs; gateway reconstructs read time as Date.now minus positive finite ageMs in household timezone. Other/invalid ages use receipt time. Numeric optional NFC null values coerce to zero; these are current coercion rules, not proposed stricter schema.',
  delivery:'64-item/40960-byte RAM queue evicts oldest and drains up to four per loop. sendTXT acceptance pops an item before an echo; this is not durable delivery. Firmware subscribes its own topic, recognizes reader id + event; NFC matches UID, sheets oldest outstanding without a unique correlation key.',
  acknowledgement:'Gateway calls listener then publishes unless it returns false. Application can suppress repeated NFC broadcasts but sheet persistence debounce does not suppress sheet echo. Persistence is asynchronous; echo can precede failed append. Two dedicated OMR cases prove selected normalization and this non-durable acknowledgement boundary.',
  operators:{replay:at('cli/school/omr.mjs','REPLAY PUBLISHES ONTO THE LIVE BUS.'),liveness:at('backend/src/1_adapters/hardware/omrReaderLiveness.mjs','const DEFAULT_GRACE_MS ='),
    policy:'Replay is another producer; liveness observes subscription/boot metadata independently of normalized gateway events. HTTP health/queue/recent/events are not storage acknowledgements.'},
  provisioning:provisioning('omr-relay'),cases:['CASE-WIRE-OMR-NORMALIZE','CASE-WIRE-OMR-ECHO-PERSIST'],
  remaining:'Actual serial bit packing, queue/echo hardware timings, raw manifest/School grading/NFC policy, watchdog and replay CLI effects, complete diagnostic surfaces and flashed identity remain unverified.'
},{
  id:'WIRE-OBD',target:'TARGET-obd-relay',kind:'live telemetry and buffered trip upload with destructive acknowledgement',
  producer:at(firmwarePath('obd-relay'),'static void sendJson('),upload:at(firmwarePath('obd-relay'),'doc["type"] = "trip";'),
  consumer:at(gateways,'export class AutomotiveFirmwareGateway'),policy:at('backend/src/3_applications/hardware/automotiveRelay.mjs','const handleTripChunk ='),
  composition:at('backend/src/app.mjs','relayGateway: new AutomotiveFirmwareGateway('),
  variants:[{type:'hello',fields:['id','fw','rssi','ts','telemetry_schema']},
    {type:'snapshot',fields:['id','ts','telemetry_schema','ecu_linked','battery_v','fuel_pct','coolant_c','rpm','speed_kph','gps','distance_since_cleared_km','odometer_km','diag','vin','dtc_read','dtc_codes']},
    {type:'event',fields:['id','event','ts','known motion details for relevant events']},
    {type:'trip',fields:['id','trip_id','seq','final','samples','meta on final']}],
  gateway:'Only obd-relay accepted; extracts type into kind, removes source/type from payload, retains remaining fields, resolves fallback id and adds current household-local receipt ts/epoch at. Topic per vehicle or automotive.',
  tripAssembly:'Application accumulates arrays by vehicle/trip ID in arrival order; seq is neither validated, sorted nor used to reset/deduplicate partials. Truthy final triggers completion; stale partials expire after 10 minutes when another trip arrives. New test preserves nonsequential seq behavior.',
  storageAndAck:'Normal path inspect-existing -> save trip -> append summary -> direct trip-ack. Any thrown save/log failure withholds that first ack. Existing-trip retry directly acknowledges, bypassing save and summary repair. Below-sample-floor path appends dropped breadcrumb then acknowledges. Domain publication occurs before writes settle; no atomic two-store transaction implied.',
  receiver:at(firmwarePath('obd-relay'),'LittleFS.remove(uploadingPath);'),
  receiverMeaning:'Firmware matches type trip-ack plus current uploadingTripId, deletes that buffered file and clears state. Disconnect clears upload state for retry. HTTP trip retrieval does not delete the buffer.',
  data:'Positional sample schema becomes keyed records with relative seconds, omitted no-reading fields, derived ECU/GPS summaries and device/rebased/boot-relative clock provenance. Schema-v2 clock rebase requires synchronized upload and same boot; do not conflate arrival time with trip start.',
  provisioning:{...provisioning('obd-relay'),vendor:at('_extensions/obd-relay/firmware/tools/fetch-libs.mjs',"const ref = refIdx !== -1 ? argv[refIdx + 1] : 'master'"),
    limit:'Freematics helper clones a selected/default moving branch and reports later ls-remote, not a lock of copied bytes. Native tests, bench simulation and hardware environments are distinct; no tool was executed.'},
  cases:['CASE-WIRE-AUTOMOTIVE-ACK','CASE-WIRE-AUTOMOTIVE-FAILURE'],remaining:'Actual flash persistence/ECU/GPS, complete telemetry/clock matrix, sample-floor path, HTTP recovery/OTA and fetched/flashed library identity remain open.'
},{
  id:'WIRE-EINK',target:'TARGET-eink-panel',kind:'sleeping HTTP consumer with plain-text snapshot and conditional image fetch policy',
  client:at(firmwarePath('eink-panel'),'static bool fetchConfig()'),server:at('backend/src/4_api/v1/routers/eink.mjs','export function createEinkRouter('),
  composition:at('backend/src/app.mjs','v1Routers.eink = createEinkRouter('),
  routes:[{method:'GET',path:'/api/v1/eink/:id/config',query:['bat','rssi','wake','up','heap','psram','rst'],
    format:'text/plain newline-separated key=value with trailing newline',fields:['id','rotation','btn_green','btn_right','btn_left','next_wake','image','image_hash']},
    {method:'GET',path:'/api/v1/eink/:id/panel',format:'unconditional image/png; res.end bypasses Express ETag freshness'},
    {method:'GET',path:'/api/v1/eink/:id/action/:action',format:'JSON ok plus application view/index result; mutates server view'},
    {method:'GET',path:'/api/v1/eink/:id/status',format:'JSON id/reported plus last telemetry, not a live device query'}],
  server:'Config records finite parsed numeric/nonempty wake telemetry before snapshot; synchronous telemetry exceptions are logged and do not fail config. Config/panel set no-cache. Image URL encodes snapshot id. Known missing panel error is mapped to 404; complete controller trust/auth is not exercised by isolated router tests.',
  clientPolicy:'Fetch config each wake, optional action GET then refetch. Parser applies known keys, ignores empty/oversized cached strings and nonpositive wake seconds. Compare advertised image hash with RTC cached hash; fetch/decode/render only on change. Commit hash only after successful decode/render. Retain cached config on fetch failure. No JSON schema substitution or 304 requirement.',
  resources:'Server-selected relative image path is prefixed with controller host; fallback is compiled panel URL. PNG decoder streams content and hardware selects gray16 or color dither profile. Source/package paths and stable public URLs are separate contracts.',
  provisioning:{...provisioning('eink-panel'),vendor:at('_extensions/eink-panel/firmware/tools/fetch-deps.mjs',"const RAW = 'https://raw.githubusercontent.com/Seeed-Studio/Seeed_GFX/master'"),
    limit:'Only bootstrap identity/network compiled; generated-header comment retains an old query-id/header description not matching current path/text protocol. Platform version and fetched Seeed decoder branch are not immutable locks.'},
  cases:['CASE-WIRE-EINK-CONFIG','CASE-WIRE-EINK-PANEL-ACTION'],remaining:'Actual PNG/dither/panel output, RTC/deep sleep, image-hash service completeness, loaded firmware, full telemetry/auth/not-found matrices and build identity remain unverified.'
},{
  id:'WIRE-IR-BLASTER',target:'TARGET-ir-blaster',kind:'independent HTTP actuator called by external operators',
  server:at(firmwarePath('ir-blaster'),'static void handleSend()'),transmitter:at(firmwarePath('ir-blaster'),'static bool blast('),
  routes:[{path:'/',meaning:'JSON status id/ip/uptime_ms/sends/last_code/codes'},{path:'/health',meaning:'same status'},
    {path:'/send',query:['code'],meaning:'Missing code 400; unknown 404 plus available; successful local send 200 or rejected local code 500; JSON ok/code/id'}],
  methods:'Source registers server.on(path, handler) without an explicit method filter; documented GET can actuate hardware. Do not invoke health/send by convenience during discovery.',
  codes:'Named code table generated from Tuya base64/FastLZ little-endian durations or raw integer microsecond arrays. Firmware rejects empty or >256 durations; sends raw array using configured carrier (default 38kHz). Success is transmitter invocation, not TV/device state verification.',
  consumers:'Firmware declares Home Assistant rest_command/curl callers and external verification/retry policy. No named central blaster adapter was found in the recorded backend search; private HA/operator config was not inspected.',
  provisioning:provisioning('ir-blaster'),cases:[],remaining:'Actual IR waveform/receiver, external HA commands/authorization/state verification, all methods and flashed/generated code identities remain unproved; do not invent a central service.'
},{
  id:'WIRE-RF-BLASTER',target:'TARGET-rf-blaster',kind:'independent HTTP transmitter/learner, not the IR protocol',
  server:at(firmwarePath('rf-blaster'),'static void handleSend()'),learner:at(firmwarePath('rf-blaster'),'static void handleLearn()'),
  routes:[{path:'/',meaning:'JSON status, additionally free_heap and tx/rx pins'},{path:'/health',meaning:'same status'},
    {path:'/send',query:['code','repeats'],meaning:'Same missing/unknown/local-success HTTP outcomes as IR; repeats toInt cast uint16, zero uses configured repeat count'},
    {path:'/learn',query:['ms'],meaning:'Capture window clamped 1000..30000ms, blocks handler while learning; response 200 if frame found else 404, includes ok/window_ms/edges_captured/edges_kept/overflowed/frames_seen/repeated plus timings or error'}],
  codes:'Raw microsecond arrays or {timings,repeats,gap_us}, not Tuya IR encoding. RMT baseband OOK (no IR carrier), long durations split into bounded items. Default configured repeats 8 and gap 10000us; generator accepts 2..400 timings and warns for odd count. Packed capacity can differ from input count after splitting; no physical emission proof.',
  consumers:'Home Assistant/manual HTTP operator shape analogous to IR; no direct named central blaster adapter found by scoped source search. Exact private consumers remain an attributable external gap.',
  hardwareStatus:at(firmwarePath('rf-blaster'),'UNTESTED ON HARDWARE.'),
  provisioning:provisioning('rf-blaster'),cases:[],remaining:'Source explicitly warns untested hardware; capture repetition only measures repeated length, not established device acknowledgement. Waveform, receiver, external operator config, complete boundary cases and flashed identity remain open.'
},{
  id:'WIRE-PLAYBACK-HUB',target:'TARGET-playback-hub',kind:'independent Python/shell/MPV Bluetooth appliance with central HTTP adapter',
  server:at(hub+'web.py','class Handler('),consumer:at(hubAdapter,'export class HttpPlaybackHubAdapter'),consumers:incoming(hubAdapter),
  status:{producer:at(hub+'web.py','def slot_status('),mapper:at(hubAdapter,'export function mapHubStatus('),
    endpoint:'GET /api/status returns an array; slot maps to domain position, NOT the legacy position field (playback seconds).',
    fields:['slot -> position','color','bt_connected','paused','now_playing','volume','playlist_pos','playlist_count','armed_source'],
    semantics:'Optional values default null. Domain validates positive integer slot, nonempty color and boolean flags without coercion; malformed domain fields can throw INVALID_SLOT_STATUS, while bad array/entry shape is HUB_BAD_RESPONSE. Python retains legacy UI and diagnostic fields that the adapter drops; now_playing is only present with process/title/queue and currently labels its source plex.'},
  command:{producer:at(hubAdapter,'#buildPlayBody('),receiver:at(hub+'web.py','def _post_play('),dispatcher:at(hub+'playback-hub.sh','handle_cmd() {'),
    endpoint:'POST /api/play',fields:['action','target (comma-joined color values)','content_id','volume','duration_min'],
    request:'plex queues send bare id, others source:id. Zero volume/duration retained; null/undefined omitted. Central adapter does not send resume_previous although Python accepts it; shell parses --resume but handle_cmd does not implement restoration.',
    execution:'Python invokes sibling playback-hub.sh cmd using argument array, truncates volume/duration via int, waits at most 70s, reads final stdout JSON line. Missing action/target -> 400; subprocess timeout -> 504; nonzero exit -> 500. Shell returns numeric applied/skipped counts and succeeds if any target applied; applied for play includes arming, not confirmed audible output.',
    result:'Central ignores body.ok. A positive numeric applied count maps to ALL requested colors, then positive numeric skipped marks only targets not already applied. Modern applied arrays retain every string, even unrequested/empty strings. Unknown skipped reasons become invalid-target; empty skipped color still fails the domain object. This does not establish target-specific success from legacy counts.',
    contention:'Adapter maps any HTTP409 to all targets skipped/contention even with non-JSON body. Current reviewed Python endpoint emits no409 path; support in adapter is not producer evidence.',
    stop:'Shell stop ends playback while disconnect additionally disarms and releases BlueZ; these are different device effects.'},
  verification:{source:at(hub+'web.py','def _verify_audio('),consumer:at(hubAdapter,'async verifyAudio('),
    meaning:'GET /api/verify/<color> maps color to configured device; unknown404, disconnected returns audio_flowing false and sampled_ms0; connected samples PipeWire monitor. Adapter URL-encodes color and accepts any object body, not a validated audio-result schema. Node cases fake response bytes, not monitor samples.'},
  transport:'requestRaw expects text, parses JSON defensively. Nonstring or invalid JSON becomes null. HTTP errors are distinct from HUB_TIMEOUT (TIMEOUT/AbortError/ABORT_ERR) and HUB_NETWORK_ERROR; default central timeout2s is shorter than Python command timeout70s and cancellation does not prove appliance rollback.',
  operator:{launcher:at(hub+'playback-hub.sh','source "$_SCRIPT_DIR/cache_manager.sh"'),validation:at(hub+'playback-hub.sh','refresh_config_cache || {'),
    server:at(hub+'web.py','server = http.server.HTTPServer('),
    meaning:'Independent single HTTPServer and shell processes; device config/cache, slot MPV sockets/PIDs/armed sentinels and playback/cache logs are persistent/runtime authority, not module source. All shell subcommands refresh config first; source-relative cache_manager.sh and deployed BASE_DIR Python helpers must remain available. No shell, BT, PipeWire, MPV or HTTP server started.',
    build:'Captured source/launcher/validator declarations do not lock installed shell binaries, Python packages, audio stack or actual running appliance. Hardcoded private endpoint values are withheld; exact installed roots remain external operator evidence.'},
  cases:['CASE-WIRE-HUB-STATUS','CASE-WIRE-HUB-COMMAND','CASE-WIRE-HUB-RESULT','CASE-WIRE-HUB-ERROR'],
  remaining:'Python/shell encoder execution, validation parity, all device/admin endpoints, queues/cache/schedule restart durability, audible output and installed toolchain identity remain open. Do not claim a failed/timed-out controller request reversed appliance effects.'
},{
  id:'WIRE-PIANO-BRIDGE',target:'TARGET-piano-bridge',kind:'Android shell/native engine plus separately replaceable Java payload and browser MIDI control',
  producer:at(pianoPayload+'ControlServer.java','private String buildNote('),consumer:at(pianoBrowser+'usePianoBridgeNotes.js','export function usePianoBridgeNotes('),
  consumers:incoming(pianoBrowser+'usePianoBridgeNotes.js'),
  notes:{envelope:['type:note.on|note.off','note','velocity (only note.on)'],
    semantics:'No recorder topic/source/session/time envelope. Browser passes note.on with velocity??0, note.off with velocity0; does not validate numeric range, ignores other dialects and catches parse/callback errors. Status includes engine/preset/cpu/xruns/speakerOk/speakerReason; three consecutive falsy speakerOk values disconnect, one truthy value immediately restores.',
    lifecycle:at(pianoPayload+'ControlServer.java','heartbeatTimer.scheduleAtFixedRate('),
    timing:'Server status every1s and WebSocket PING every3ticks; stop cancels timer/closes clients before listener stop. Browser never-connected fallback requires two closes plus8s grace on a plausible host; implausible hosts omit grace. Backoff starts250ms capped5s for plausible/existing links and60s for bridge-less clients. Selected case does not prove timers/reconnect or native lifecycle.'},
  midi:{sender:at(pianoBrowser+'usePianoBridgeNotes.js','const sendSysex ='),receiver:at(pianoPayload+'ControlServer.java','case "midi.raw":'),
    semantics:'Browser requires open socket and nonempty ordinary Array only, sends bytes/repeat verbatim and returns local send success. Android accepts hex or coerced byte array, clamps repeat1..10 with30ms gap, writes BLE and emits error on failure; no positive hardware ack. Inbound note.on/off drive the internal synth, whereas midi.raw goes to the physical instrument.'},
  repair:{client:at(pianoBrowser+'pianoBridgeClient.js','export async function resetPianoBridge('),server:at(pianoPayload+'ControlServer.java','case "/reset":'),operation:at(pianoPayload+'BridgeCore.java','public org.json.JSONObject forceResetLink()'),
    consumers:incoming(pianoBrowser+'pianoBridgeClient.js'),
    semantics:'Browser POST/reset to loopback uses65s abort timer. HTTP non-ok, invalidJSON, fixed!==true, AbortError and other network exceptions have distinct reasons. Only literal fixed:true is success, independently of body.ok; recoveredAt/verdict defaultnull. Server escalates BLE reconnect then radio bounce and echo verification; returns linkVerdict/steps additionally, which client does not project. Browser cancellation does not cancel a radio repair already running.'},
  control:{shell:at(pianoShell+'ShellServer.java','public Response serve('),loader:at(pianoShell+'PayloadLoader.java','public String requestSwap('),store:at(pianoShell+'PayloadStore.java','public synchronized void commit('),
    semantics:'Payload and shell use separate all-interface NanoHTTPD listeners, no authorization gate in the reviewed route tables (unlike Portal). Shell payload/restart/rollback control survives payload listener failure. POST returns queued/refused result strings, not active/healthy proof; full SHA256 check precedes commit and exact payload Main entry loads through shell-parent classloader. No endpoint called; trust model recorded, not changed.'},
  build:{layout:at('_extensions/piano-bridge/app/settings.gradle',"include ':app', ':shell-api', ':payload'"),
    sharedIdentity:at('_extensions/piano-bridge/app/payload/build.gradle',"compileOnly project(':shell-api')"),
    dex:at('_extensions/piano-bridge/app/payload-dex.gradle','task payloadDex('),verify:at('_extensions/piano-bridge/app/payload-dex.gradle','task payloadVerify('),bake:at('_extensions/piano-bridge/app/payload-dex.gradle','task bakePayload('),
    meaning:'Shell APK owns shell-api/NanoHTTPD classes and native engine; payload compileOnly avoids duplicate runtime identity. D8 classes enumerate at execution time; verification checks Java source classes and exact Main; sha step follows. bakePayload writes app/src/main/assets/payload-baked.jar, so ordinary build is NOT allowed under source freeze. SDK comes from local.properties/environment; build-tools chooses lexically last installed directory, not a complete lock proof.',
    operator:at('_extensions/piano-bridge/pbctl.mjs','async payload(args)'),centralOperator:at('cli/pianobridge.cli.mjs','async payload(args)'),
    operatorPolicy:'Two CLI copies plus shell fallback using a fixed default-port suffix substitution are path/protocol consumers; preserve both and independently record future consolidation. Private default hosts withheld. No build, install, payload update or reset executed.'},
  cases:['CASE-WIRE-PIANO-NOTES','CASE-WIRE-PIANO-RESET-RESULT','CASE-WIRE-PIANO-RESET-FAILURE'],
  remaining:'Native encoder/engine/asset resolution, remaining HTTP control routes, MIDI parser/clock/health and central heartbeat consumers, full reconnect/grace behavior, Android install/swap/recovery, permissions/audio and actual built/deployed identities remain open. Not covered by recorder or Portal tests.'
},{
  id:'WIRE-FITNESS',target:'TARGET-fitness',kind:'independent sensor/biometric/Bluetooth/serial daemon, not the fingerprint helper target',
  entry:at(fitnessRoot+'server.mjs','startServer().catch('),gateway:at(fitnessGateway,'export class EventBusBiometricGateway'),consumers:incoming(fitnessGateway),
  sensor:{ant:at(fitnessRoot+'ant.mjs','broadcastFitnessData(data)'),hr:at(fitnessRoot+'decoders/heart_rate.mjs','formatForWebSocket(userId)'),
    rope:at(fitnessRoot+'decoders/jumprope.mjs','formatForWebSocket(deviceConfig)'),central:at('backend/src/app.mjs',"message.source === 'fitness' || message.source === 'fitness-simulator'"),
    semantics:'ANT wraps topic/source fitness, type defaultant and ISO timestamp before data spread. BLE HR intentionally uses typeant/profileHR/deviceId ble_<user>/data.ComputedHeartRate,sensorContact,source:ble; decoder accepts8/16bit LE and current50..230 range. Rope uses typeble_jumprope and cumulative revolutions. Central source branch republishes whole message to fitness; biomechanical measurements and biometric auth topics are not interchangeable.'},
  biometric:{sender:at(fitnessRoot+'server.mjs','function sendBus('),handler:at(fitnessGateway,'#handle(message)'),
    requestTopics:['fitness.unlock.request','fitness.enroll.request','fitness.fingerprint.delete.request'],
    resultTopics:['fitness.unlock.result','fitness.enroll.result','fitness.enroll.progress','fitness.fingerprint.delete.result'],
    request:'Gateway allocates requestId, registers timeout then broadcasts; ignores delivery count. Unlock sends lockName/candidateUuids; enroll sends finger/username without UI clientToken; delete sends uuid. Default deadlines15s/60s/15s; finite unlock overrides include negative values.',
    result:'Unlock coerces matched with !!, projects userId even undefined and drops uuid/reason. Enroll success projects uuid; failure defaults enroll-failed and retains truthy matchedUuid. Progress re-broadcast substitutes clientToken and omits requestId. Delete retains success or default delete-failed.',
    correlation:'Pending map is keyed by requestId only: current gateway does not bind result kind, clientId or source to the pending operation; a different known result topic can settle it. It registers a client listener in constructor but retains no unsubscribe/dispose API. Record as existing validation/lifetime constraints, not a new shared-platform contract approval.',
    transport:'sendBus deliberately omits source:fitness, avoiding sensor rebroadcast branch. Offline send returns false without replay. WebSocket subscribes to requests on each open and reconnects every30s; a late result after local timeout is ignored, not proof the hardware operation was cancelled.'},
  scan:{producer:at(fitnessRoot+'continuousScanLoop.mjs','export function createContinuousScanLoop('),channel:at('backend/src/1_adapters/eventbus/FitnessIdentityChannel.mjs','onScan(handler)'),
    consumer:at('backend/src/3_applications/fitness/identityRelay.mjs','function handleScan(message)'),
    semantics:'Continuous full-store identify emits biometric.scan modalityfingerprint with matched/uuid or matchedfalse only for a real no-match. Missing templates, busy/preempted and faults do not emit false-touch events. Delay1500ms after touch,5000ms without templates,800ms rearm with exponential fault cap30s and30s overheat cooldown. sendBus false is not retried by loop. Central identity policy resolves user/finger/current authz at receipt time; raw UUID is not permission.'},
  templateAuthority:{helper:at(fitnessRoot+'fingerprint_helper.py','def cmd_enroll('),reader:at(fitnessRoot+'fingerprint_helper.py','def cmd_identify('),
    policy:'Separate persistent <store>/<uuid>.tpl libfprint serialization, not YAML profiles. UUID embedded as print username; direct whole-file wb write, no explicit temp/atomic replace/fsync/lock/mode in reviewed helper. Identify uses supplied UUID list or full glob and deserializes existing files. Profile writer belongs centrally. Do not relocate/read templates with source.',
    mismatches:'Server handles duplicate-enrollment result but this helper does not perform duplicate-gallery rejection. Server delete interpolates uuid into template path, treats ENOENT success, and is outside the sim/arbiter branches. These paths need dedicated validation/hardware/security review before changing them; no delete or helper executed.'},
  simulation:'Only auto-match/auto-deny/interactive select simulated request/enrollment handling. Startup disables continuous scan for ANY truthy FINGERPRINT_SIM; an unrecognized nonempty value therefore keeps real management requests but disables continuous scan. Interactive HTTP resolves/removes the newest held request before best-effort send; success is not backend receipt.',
  otherSurfaces:{inventory:at(fitnessRoot+'btInventory.mjs','export function startBtInventoryBroadcast('),pairing:at(fitnessRoot+'btPairing.mjs','export async function handleBtPairRequest('),
    routes:at(fitnessRoot+'server.mjs',"app.get('/tv/on'"),
    semantics:'BT inventory polls every3s and caches JSON BEFORE send, so unchanged data is not replayed after failed delivery; pairing/removal have separate progress/result topics. HTTP health/status plus GET TV serial-write, BLE start/stop/HR controls and POST fingerprint simulation are independent side-effecting surfaces. Do not probe GET endpoints against live daemon.'},
  lifecycle:'startServer executes on import: ANT initialization, BLE/rope, controller config fetch for BLE users, WebSocket, BT inventory, continuous scan then listener. SIGINT/SIGTERM stop loop/inventory, close socket and await ANT/BLE cleanup before process.exit; stop flag is not an awaited in-flight reader join. Never import server for preparation.',
  build:{docker:at('_extensions/fitness/Dockerfile','RUN npm install'),
    meaning:'Independent node18-slim image, npm install, unpinned apt/Python bleak inputs and passed-through device/native requirements; Node lock does not certify libfprint/BlueZ/USB/runtime identity. Source-relative helper and simulator/operator paths remain stable. No image built or private mount inspected.'},
  cases:['CASE-WIRE-FITNESS-BIOMETRIC-PROJECTION','CASE-WIRE-FITNESS-BIOMETRIC-CORRELATION','CASE-WIRE-FITNESS-SCAN-POLICY','CASE-WIRE-FITNESS-HR-ENCODING'],
  remaining:'Real hardware/ANT/rope/BT/full identity policy, helper duplicate/template validation, all HTTP/driver shutdown and deployed image/permissions need attributable further evidence. Selected pure JS contracts are not biometric enrollment or authorization certification.'
},{
  id:'WIRE-TICALC-RELAY',target:'TARGET-ticalc-relay',kind:'ESP32 SchoolCalc transport appliance with foreground and silent TI link modes',
  session:at(calcRelay+'SchoolCalcRelaySession.cpp','SessionOutcome SchoolCalcRelaySession::run('),http:at(calcRelay+'SchoolCalcEspAdapters.cpp','bool SchoolCalcHttpApi::syncBlocking('),
  central:at('backend/src/4_api/v1/routers/schoolCalc.mjs','export function createSchoolCalcRouter('),
  framing:{envelope:at(calcRelay+'SchoolCalcWire.cpp','DecodeStatus validateSchoolCalcEnvelope('),foreground:at(calcRelay+'SchoolCalcForegroundWire.cpp','DecodeStatus encodeFrame('),
    semantics:'TI packet has machine/command/LE length and additive checksum for data commands; direct-key header is an exception, not a data payload. TI String wraps record in2byte length. SchoolCalc record magic4/version1/payloadLengthLE16/payload/CRC16-CCITT is separate from packet integrity. Foreground SCF1 adds type/flags/sequenceLE16/lengthLE16 and CRC, maxpayload256/defaultchunk128, negotiated capability/nonce/key/phase/heartbeat state. No C++/electrical execution proof.'},
  ingress:{verifier:at('backend/src/1_adapters/schoolcalc/SchoolCalcRelayCredentialVerifier.mjs','verify({ authorization'),auth:at('backend/src/4_api/v1/middleware/schoolCalcIngress.mjs','export function createSchoolCalcIngressAuthenticator('),
    policy:'Firmware currently requires configured HTTP (not TLS) plus Bearer and X-SchoolCalc-Relay-Id. Central verifier requires exact case-sensitive Bearer syntax, unique relay IDs/tokens and32byte minimum secrets; missing asserted ID is allowed but conflicting truthy ID is rejected. Auth middleware runs before route body parsers and freezes verified identity; selected test proves middleware only, not device/agenda authorization.'},
  httpShape:{handler:at('backend/src/4_api/v1/handlers/schoolcalc/index.mjs','export function schoolCalcSyncHandler('),
    identify:'POST /devices/identify sends binary SCI1 and reads deviceId/platformId JSON; request success requires200.',
    sync:'POST /devices/<encoded id>/sync JSON carries rawInfo plus optional installedState/resultQueue/requestRecord/interactionRecord/studyEntry as {encoding:base64url,data}; optional catalogGeneration. Response plan has ready/catalog/artifacts/acknowledgement/manifest, plus profiles/progress and requested interaction/study records. C++ rejects missing/unsolicited response structures; record limits and envelope checks are separate.',
    artifacts:'Artifact GET checks metadata headers against plan then actual length and SHA256. Inline adaptive artifact path checks metadata shape, digest syntax, length and SCP1 envelope but does not call the same actual-byte sha256 comparison; retain this exact verification gap instead of claiming all artifact transfers have identical integrity checks.'},
  transaction:{inputs:['DSID/SCI1 required','DSINFO/SCI1 required','DSINST/SCM1','DSQ/SCQ1','DSREQ/SCD1','DSTREQ/SCTQ','DSENTRY/SCE1'],
    adaptive:'Resolved study stages optional artifact, DSSTDNEW/SCSP, then DSSYNC/SCSA LAST and returns awaiting calculator commit. This branch does not stage normal roster/progress/ack records, even though those response records were validated.',
    retained:'Other path stages DSUSRNEW, DSPRGNEW, optional DSTNEW, ready/changed catalog, ready artifacts, DSACKNEW then DSSYNC/SCM1 LAST. Failures preserve existing/staged data; no global rollback or exactly-once physical-transfer guarantee. Relay does not mutate DSLOCAL private continuation.',
    ceilings:{catalog:5832,resultQueue:6144,manifest:6144,learnerRoster:512,progress:4096,interactionRequest:512,interactionResponse:2048,studyEntry:64,studyPrescription:512,studyCommit:256,artifact:12288},
    completion:'Successful session reaches AwaitingCalculatorCommit; foreground Complete Ready/Blocked is not proof that the shell subsequently committed or consumed its marker. Sync worker continues until HTTP finishes even if peer health fails, then reports retained-request failure.'},
  orchestration:{source:at(calcApps+'SyncSchoolCalcDevice.mjs','async execute({'),queue:at(calcApps+'ImportSchoolCalcResultQueue.mjs','for (const queuedRecord of records)'),
    semantics:'Central order: profiles, optional observation/results/delivery/interaction/study, progress, plan. Ack IDs come only from current outcomes with acknowledge===true, not lifetime ledger. Late failure stops remaining stages, not already-completed effects. Queue preflight decodes and binds every record before sequential common import; it is not a multi-record storage transaction.'},
  operators:{routes:at(calcRelay+'main.cpp','http.on("/sync", HTTP_POST, syncHook);'),
    meaning:'Local POST sync/foreground queues a job and returns202 or409; transmit-disabled409, operation_id is not completion. Separate status/health/diagnostic screenshot/events/config and BLE pair/forget endpoints have their own effects. Source protocol subscriptions and physical/emulator/native tools stay independently owned; do not invoke operator probes here.',
    config:at('_extensions/ticalc-relay/firmware/tools/gen-config.mjs','const defaultOut ='),toolchain:at('_extensions/ticalc-relay/firmware/platformio.ini','platform = espressif32@6.5.0'),
    build:'Generator takes explicit private YAML/relay/output, validates credentials/HTTP/pins/BLE settings and emits private config.h with mode0600 on creation. Platform and NimBLE pinned declarations coexist with ranged other libraries; flashed identity unproved. Graph Link build uses versioned Debian archives without an in-script checksum lock, patches tilibs and compiles sibling TI86 native source.'},
  cases:['CASE-WIRE-SCHOOLCALC-AUTH','CASE-WIRE-SCHOOLCALC-SYNC','CASE-WIRE-SCHOOLCALC-SYNC-FAILURE'],
  remaining:'Full HTTP handlers/codec/authorization, adaptive digest/cut/ack recovery, C++/Z80 parity, foreground/silent timing/key/BLE/diagnostic surfaces, native build provenance and physical relay/ROM identity remain open. No firmware/native tool, server or calculator was run.'
},{
  id:'WIRE-TI86-APPLICATION',target:'TARGET-ti86-app',kind:'School-owned calculator application and development tools; not a generic relay framework',
  product:at('_extensions/ti86-app/docs/schoolcalc-v1-requirements.md','SchoolCalc Adaptive Study v1 is a code-first'),
  release:at(calcTools+'build-complete-install.mjs','const transfer = ['),legacyBuild:at(calcTools+'build-schoolcalc-client.mjs','const shellFile ='),
  releaseShape:'Canonical Adaptive Study install transfers SCHLCALC, SCLEARN, SCQUEUE, SCQR, SCSYNC, DSID and ASCHL launcher LAST. Catalog/profile/tutor/native/request routes are omitted from this release manifest, not deleted from source. Older build-schoolcalc-client/starter bundles are not the v1 default; provisioning builder still emits additional roster/progress files not included in canonical transfer list.',
  records:{codec:at(calcCodec,'export function encodeTi86ResultRecord('),wrapper:at(calcTools+'lib/ti86-string-file.mjs','export function createTi86StringFile('),
    consumer:at('_extensions/ti86-app/src/runtime-qr.asm','SCQR_RESULT_MAX_BYTES: equ 69'),
    semantics:'Record ABI1 is distinct from artifact codec revision5. Exact SCR1 results go into SCQ1 durable queue or RFC4648 BASE32 unpadded sch:r1: QR, with69byte adaptive QR ceiling. Transfer-file helper uppercases bounded TI String name and wraps exact Buffer bytes plus additive entry checksum; it does not validate SchoolCalc CRC or semantic record shape. Selected wrapper case proves bytes/headers only, not packet or calculator decoding.'},
  localCommit:{source:at('_extensions/ti86-app/src/sync-commit.asm','sync_commit_adaptive:'),reference:at(calcTools+'lib/ti86-sync-commit.mjs','export function commitTi86StagedSync('),
    adaptive:'Assembly examines DSSYNC/SCSA, compares device/request/code with retained DSENTRY and staged SCSP, checks prescription/artifact identity and artifact length/schema, copies DSSTDNEW to DSSTUDY, then removes DSENTRY/stage/marker last. This path skips digest-byte regions rather than implementing generic downloaded-artifact SHA validation; interruption/digest parity needs exact further proof.',
    retained:'Old SCM1 path selects alternating catalog/installed-state via SCL1 and maintains repairable DSINST uplink. The JS staged-sync reference models that retained path, not the adaptive SCSA path; passing it alone cannot certify current release recovery.'},
  backendAuthority:{source:at(calcApps+'ImportSchoolCalcResult.mjs','async execute({ record, transport }'),
    semantics:'QR and relay share importer. Enrolled device/platform, historical learner binding, immutable artifact, adaptive session and local-score consistency checked before a new ledger claim. Device/sequence/digest distinguish new/resume/duplicate/conflict; accepted/duplicate can ack, conflicts cannot. Backend received-time remains separate from offline result order. This is source review, not full ledger/grading/agenda durability proof.'},
  builds:{shell:at(calcTools+'build-schoolcalc-shell.mjs','writeFileSync(GENERATED,'),adaptive:at(calcTools+'build-standard-runtime.mjs',"const SOURCE = path.join(SOURCE_DIRECTORY, 'runtime-adaptive.asm')"),sync:at(calcTools+'build-sync-runtime.mjs','writeFileSync(GENERATED_UI,'),
    crossImport:incoming(calcCodec).filter(e=>e.path.startsWith('_extensions/ti86-app/')),
    meaning:'Builders execute at module top level, call z80asm and write dist AND source/generated include files; they are not safe import/discovery checks under freeze. JS tools import backend codec/domain-dependent helpers by relative path; Graph Link C source is built by calculator-relay script. Assets/fonts/ABI/include topology and both roots need exact replacement paths. Canonical installer checks transfer bytes/hashes, not actual device installation.',
    private:'Older starter builder reads an explicit private catalog location and optional household slots; do not run or copy private content/ROM/provisioning. Output existence or compiler version declaration is not a reproducible toolchain proof.'},
  cases:['CASE-WIRE-TI86-STRING-FILE'],
  remaining:'Exact emitted current release, all resource/includes and backend imports, Z80 runtime/cut/recovery/QR/cable parity, authored content budget and installed device/ROM/toolchain identity remain open. Full default bundle must not be inferred from the older research documentation or every program file present.'
}];
const busProjection=at(bus,'const message = {\n      topic,\n      timestamp: nowTs(),\n      ...payload');
const reviewed=new Set(reviews.map(r=>r.target));
const operatorBindings=[
  {id:'OPERATOR-FITNESS-SIMULATION',target:'TARGET-fitness',source:at('backend/src/1_adapters/fitness/FitnessSimulationProcess.mjs',"scriptPath = path.join(process.cwd(), '_extensions/fitness/simulation.mjs')"),
    kind:'runtime default path',meaning:'Default simulator path depends on working directory, not just adapter location; injected scriptPath and subprocess capabilities are separate. No simulator spawned or default constructor evaluated.'},
  {id:'OPERATOR-FITNESS-TEST-HELPER',target:'TARGET-fitness',source:at('tests/_lib/fitness-test-utils.mjs',"const SIMULATION_SCRIPT = path.join(PROJECT_ROOT, '_extensions/fitness/simulation.mjs')"),
    kind:'unsafe existing test helper',meaning:'URL-derived project root, .env/private path fallbacks and process-killing/server-start helpers make this a protected non-executable inspection target, not an approved baseline runner.'},
  {id:'OPERATOR-TI86-NATIVE-SOURCE',target:'TARGET-ti86-app',source:at('_extensions/ticalc-relay/tools/build-ti86-graph-link.sh','native_source='),
    kind:'cross-satellite build path',meaning:'TI calculator relay build reaches repository-relative TI-86 C source while emitting toolchain/bin outputs under relay. A relocation must preserve both roots or change this exact binding atomically; no fetch/build performed.'},
  {id:'OPERATOR-TI86-ROOT-SCRIPTS',target:'TARGET-ti86-app',source:at('package.json','"schoolcalc:gui:lint"'),
    kind:'package command source paths',meaning:'Root schoolcalc:gui:lint and schoolcalc:gui:render directly name TI-86 tools under _extensions. Neither script nor its output was run.'},
  {id:'OPERATOR-HUB-VALIDATOR-PARITY',target:'TARGET-playback-hub',source:at('backend/src/1_adapters/persistence/yaml/YamlHubConfigDatastore.mjs','Private — validation (JS-side mirror of validate_config.py)'),
    kind:'semantic twin, not runtime import',meaning:'JS validator declares parity with satellite Python validator and shared fixture set; a comment is not a runtime import. Preserve/review both validator behaviors separately.'},
  {id:'OPERATOR-OMR-REPLAY',target:'TARGET-omr-relay',source:at('cli/school/omr.mjs','REPLAY PUBLISHES ONTO THE LIVE BUS.'),
    kind:'wire producer/operator, not source import',meaning:'CLI replay emits firmware-compatible scans; applying can persist/grade real assessments. Source reference alone does not authorize invoking the CLI even for discovery.'},
  {id:'OPERATOR-CONTROLLER-EXCLUSION',target:'all satellites',source:at('.dockerignore','_extensions/'),
    kind:'build-context exclusion declaration',meaning:'Controller Docker context excludes extension tree; independent satellite source ownership must not imply that current controller image includes these runtimes. Actual image/context proof remains separate.'}
];
// Index literal source-root references outside each target, including build/CLI/docs.
// Do not emit full lines: launch declarations may contain private deployment data.
const externalReferences=[],referenceFiles=source.files.filter(f=>f.protected&&f.mode!=='120000'&&f.bytes<4*1024*1024
  && (/\.(?:md|mjs|js|jsx|ts|tsx|py|sh|bash|zsh|cpp|c|h|hpp|java|kt|ino|ini|xml|gradle|properties|service|plist|json|ya?ml|txt|cmake|conf|cfg|toml|bat|ps1|cmd)$/.test(f.path)
    || /(?:^|\/)(?:Dockerfile(?:\.[^/]+)?|[^/]+\.Dockerfile|Makefile(?:\.[^/]+)?|\.dockerignore|\.gitignore|\.gitmodules|\.npmrc)$/.test(f.path)));
for(const f of referenceFiles){
  const bytes=fs.readFileSync(path.join(root,f.path));assert.equal(hash(bytes),f.sha256,'Changed reference input '+f.path);
  const lines=bytes.toString('utf8').split('\n');
  lines.forEach((line,index)=>{
    for(const match of line.matchAll(/(?:^|[^A-Za-z0-9_-])_extensions\/([a-z0-9-]+)(?=\/|[^A-Za-z0-9_-]|$)/g)){
      const target=targets.targets.find(t=>t.id==='TARGET-'+match[1]);
      if(!target||f.path.startsWith(target.sourceRoot+'/'))continue;
      externalReferences.push({source:f.id,path:f.path,line:index+1,target:target.id,
        kind:f.path.endsWith('.md')?'documentation':/\.test\.|(?:^|\/)test[s]?\//.test(f.path)?'test':f.path.startsWith('_extensions/')?'other-satellite':'runtime/build/operator declaration',
        meaning:'literal source-root dependency candidate, not executed path or dynamic deployment proof'});
    }
  });
}
const remainingCount=targets.targets.length-reviewed.size;
emit('wire-contract-review.json',{schema:'daylight.preimplementation.wire-contract-review/v1',baseline:targets.baseline,reviews,busProjection,
  operatorBindings,
  remainingEvidence:reviews.map(review=>({id:'GAP-'+review.id,target:review.target,status:'open',
    owner:targets.targets.find(target=>target.id===review.target).logicalOwner+' reviewer',
    scope:review.remaining,affectedGate:'PRE-2.3.3 inventory disposition; affected future owner/build/contract changeset',
    nextAction:'Resolve the named source/control/resource/consumer edges into exact replacement and verification cards. Attribute unavailable external identity separately; device/build execution needs an inspected disposable setup or separate authority.',
    limits:'Initial source review and selected cases do not close this residual evidence obligation or authorize runtime effects.'})),
  externalReferences,externalReferenceScope:{files:referenceFiles.length,policy:'Frozen protected tracked text under 4MiB; exact _extensions/<known target> outside its own root; no full line contents or private values copied',
    limits:'Text index only; computed/absolute installed paths and operator state outside repository are not enumerated. Every positive source-root reference remains a consumer-impact candidate.'},
  targetStatus:targets.targets.map(t=>({id:t.id,logicalOwner:t.logicalOwner,runtime:t.runtime,
    review:reviews.find(r=>r.target===t.id)?.id||null,status:reviewed.has(t.id)?'selected source boundary reviewed or implementation absence attributed; see remaining limits, not full runtime/build proof':'initial field-level review still required',
    remainingEvidence:reviews.find(r=>r.target===t.id)?'GAP-'+reviews.find(r=>r.target===t.id).id:null,
    externalReferences:externalReferences.filter(r=>r.target===t.id),
    buildInputs:t.buildInputs,operatorEntries:t.operatorEntries,relocation:t.relocation})),
  remaining:remainingCount+' of '+targets.targets.length+' targets still require initial source-boundary review; selected reviews also retain their named runtime/control/build gaps. Do not mark PRE-2.3.3 complete.',
  inputs:[...inputs.values()],inventoryInputs:['external-targets.json','dependency-ledger.json','source-ledger.json'].map(name=>({name,sha256:hash(fs.readFileSync(path.join(packet,name)))})),toolHash:hash(fs.readFileSync(new URL(import.meta.url)))});
process.stdout.write(JSON.stringify({reviewed:reviews.length,targets:targets.targets.length,remaining:remainingCount,referenceFiles:referenceFiles.length,externalReferences:externalReferences.length})+'\n');
