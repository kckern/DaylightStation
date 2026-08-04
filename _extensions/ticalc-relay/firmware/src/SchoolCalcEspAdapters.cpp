#include "SchoolCalcEspAdapters.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <mbedtls/sha256.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include "SchoolCalcBase64.h"

#include <ctype.h>
#include <stdlib.h>
#include <string.h>

namespace schoolcalc_relay {

static constexpr uint32_t HTTP_TIMEOUT_MS = 60000;
static constexpr uint32_t NETWORK_HEARTBEAT_INTERVAL_MS = 1000;
static constexpr uint32_t SYNC_HTTP_TASK_STACK_BYTES = 12288;
static constexpr size_t MIN_API_TOKEN_BYTES = 32;

static String encodePathSegment(const char* value);
static bool encodeRecord(JsonDocument& document, const char* field, ByteView record);
static bool readBinaryResponse(HTTPClient& client, MutableBytes& output, char* error,
                               size_t errorCapacity);
static bool copyText(const char* source, char* target, size_t targetCapacity);
static bool validSha256(const char* value);
static void sha256Hex(const uint8_t* bytes, size_t length, char output[65]);

class ScopedHttpObservation {
public:
  ScopedHttpObservation(IRelayIoObserver* observer, const char* operation,
                        const char* error)
    : observer_(observer), operation_(operation), error_(error), startedMs_(millis()) {}
  ~ScopedHttpObservation() {
    if (observer_ != nullptr) {
      observer_->onHttpIo(operation_, ok_, status_, requestBytes_, responseBytes_,
                          millis() - startedMs_, ok_ ? "none" : error_);
    }
  }

  bool ok_ = false;
  int status_ = 0;
  uint32_t requestBytes_ = 0;
  uint32_t responseBytes_ = 0;

private:
  IRelayIoObserver* observer_;
  const char* operation_;
  const char* error_;
  uint32_t startedMs_;
};

SchoolCalcHttpApi::SchoolCalcHttpApi(const char* scheme, const char* host,
                                     uint16_t port, const char* basePath,
                                     const char* relayId, const char* apiToken,
                                     IRelayIoObserver* observer)
  : scheme_(scheme), host_(host), port_(port), basePath_(basePath),
    relayId_(relayId), apiToken_(apiToken), observer_(observer) {}

bool SchoolCalcHttpApi::identify(ByteView identityRecord, DeviceIdentity& identity) {
  ScopedHttpObservation trace(observer_, "identify", error_);
  trace.requestBytes_ = identityRecord.length;
  if (!configured()) return false;
  HTTPClient client;
  WiFiClient network;
  client.setTimeout(HTTP_TIMEOUT_MS);
  client.setReuse(false);
  if (!client.begin(network, url("/devices/identify"))) return fail("could not open identify request");
  client.addHeader("Authorization", String("Bearer ") + apiToken_);
  client.addHeader("X-SchoolCalc-Relay-Id", relayId_);
  client.addHeader("Content-Type", "application/octet-stream");
  const int status = client.POST(const_cast<uint8_t*>(identityRecord.bytes), identityRecord.length);
  trace.status_ = status;
  if (status != HTTP_CODE_OK) {
    client.end();
    return failHttp("identify", status);
  }
  const String body = client.getString();
  trace.responseBytes_ = body.length();
  client.end();

  JsonDocument document;
  if (deserializeJson(document, body)) return fail("identify response is not valid JSON");
  const char* deviceId = document["deviceId"] | nullptr;
  const char* platformId = document["platformId"] | nullptr;
  if (!copyText(deviceId, identity.deviceId, sizeof(identity.deviceId))
      || !copyText(platformId, identity.platformId, sizeof(identity.platformId))) {
    return fail("identify response has invalid deviceId or platformId");
  }
  trace.ok_ = true;
  return true;
}

struct SchoolCalcHttpApi::SyncTaskContext {
  SchoolCalcHttpApi* api;
  const SyncRequest* request;
  SyncPlan* plan;
  MutableBytes* acknowledgement;
  MutableBytes* manifest;
  MutableBytes* learnerRoster;
  MutableBytes* progressProjection;
  MutableBytes* interactionResponse;
  TaskHandle_t waiter;
  volatile bool complete;
  bool result;
};

void SchoolCalcHttpApi::syncTask(void* parameter) {
  SyncTaskContext* context = static_cast<SyncTaskContext*>(parameter);
  context->result = context->api->syncBlocking(
    *context->request, *context->plan, *context->acknowledgement,
    *context->manifest, *context->learnerRoster, *context->progressProjection,
    *context->interactionResponse);
  __sync_synchronize();
  context->complete = true;
  xTaskNotifyGive(context->waiter);
  vTaskDelete(nullptr);
}

bool SchoolCalcHttpApi::sync(const SyncRequest& request, SyncPlan& plan,
                             MutableBytes& acknowledgement, MutableBytes& manifest,
                             MutableBytes& learnerRoster,
                             MutableBytes& progressProjection,
                             MutableBytes& interactionResponse,
                             INetworkWaitObserver* waitObserver) {
  if (waitObserver == nullptr) {
    return syncBlocking(request, plan, acknowledgement, manifest, learnerRoster,
                        progressProjection, interactionResponse);
  }
  SyncTaskContext context{
    this, &request, &plan, &acknowledgement, &manifest, &learnerRoster,
    &progressProjection, &interactionResponse, xTaskGetCurrentTaskHandle(),
    false, false,
  };
  if (xTaskCreate(syncTask, "schoolcalc-http", SYNC_HTTP_TASK_STACK_BYTES,
                  &context, 1, nullptr) != pdPASS) {
    return fail("could not start bounded backend sync task");
  }
  const uint32_t startedMs = millis();
  bool peerHealthy = true;
  while (!context.complete) {
    ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(NETWORK_HEARTBEAT_INTERVAL_MS));
    __sync_synchronize();
    if (!context.complete && peerHealthy) {
      peerHealthy = waitObserver->serviceNetworkWait(millis() - startedMs);
    }
  }
  if (!peerHealthy) {
    return fail("calculator disconnected while backend sync was running; request retained");
  }
  return context.result;
}

bool SchoolCalcHttpApi::syncBlocking(const SyncRequest& request, SyncPlan& plan,
                                     MutableBytes& acknowledgement, MutableBytes& manifest,
                                     MutableBytes& learnerRoster,
                                     MutableBytes& progressProjection,
                                     MutableBytes& interactionResponse) {
  ScopedHttpObservation trace(observer_, "sync", error_);
  if (!configured()) return false;
  if (request.deviceId == nullptr || request.deviceInfo.length == 0) {
    return fail("sync request is missing device identity or DSINFO");
  }

  JsonDocument outbound;
  if (!encodeRecord(outbound, "rawInfo", request.deviceInfo)
      || (request.installedState.length > 0
          && !encodeRecord(outbound, "installedState", request.installedState))
      || (request.resultQueue.length > 0
          && !encodeRecord(outbound, "resultQueue", request.resultQueue))
      || (request.deliveryRequests.length > 0
          && !encodeRecord(outbound, "requestRecord", request.deliveryRequests))
      || (request.interactionRequest.length > 0
          && !encodeRecord(outbound, "interactionRecord", request.interactionRequest))) {
    return fail("not enough memory to encode sync records");
  }
  if (request.catalogGeneration != nullptr && request.catalogGeneration[0] != '\0') {
    outbound["catalogGeneration"] = request.catalogGeneration;
  }
  String body;
  if (serializeJson(outbound, body) == 0) return fail("could not serialize sync request");
  trace.requestBytes_ = body.length();

  HTTPClient client;
  WiFiClient network;
  client.setTimeout(HTTP_TIMEOUT_MS);
  client.setReuse(false);
  const String path = String("/devices/") + encodePathSegment(request.deviceId) + "/sync";
  if (!client.begin(network, url(path))) return fail("could not open sync request");
  client.addHeader("Authorization", String("Bearer ") + apiToken_);
  client.addHeader("X-SchoolCalc-Relay-Id", relayId_);
  client.addHeader("Content-Type", "application/json");
  const int status = client.POST(body);
  trace.status_ = status;
  if (status != HTTP_CODE_OK) {
    client.end();
    return failHttp("sync", status);
  }
  const String response = client.getString();
  trace.responseBytes_ = response.length();
  client.end();

  JsonDocument inbound;
  if (deserializeJson(inbound, response)) return fail("sync response is not valid JSON");
  JsonObjectConst remotePlan = inbound["plan"].as<JsonObjectConst>();
  JsonObjectConst catalog = remotePlan["catalog"].as<JsonObjectConst>();
  if (remotePlan.isNull() || catalog.isNull()
      || !remotePlan["ready"].is<bool>() || !catalog["changed"].is<bool>()) {
    return fail("sync response is missing plan state");
  }
  const char* catalogGeneration = catalog["generation"] | nullptr;
  if (!copyText(catalogGeneration, plan.catalogGeneration, sizeof(plan.catalogGeneration))) {
    return fail("sync response has invalid Catalog generation");
  }
  plan.ready = remotePlan["ready"].as<bool>();
  plan.catalogChanged = catalog["changed"].as<bool>();

  JsonObjectConst acknowledgementRecord = remotePlan["acknowledgement"].as<JsonObjectConst>();
  JsonObjectConst manifestRecord = remotePlan["manifest"].as<JsonObjectConst>();
  JsonObjectConst profiles = inbound["profiles"].as<JsonObjectConst>();
  JsonObjectConst learnerRosterRecord = profiles["record"].as<JsonObjectConst>();
  JsonObjectConst progress = inbound["progress"].as<JsonObjectConst>();
  JsonObjectConst progressRecord = progress["record"].as<JsonObjectConst>();
  JsonObjectConst interaction = inbound["interaction"].as<JsonObjectConst>();
  JsonObjectConst interactionRecord = interaction["record"].as<JsonObjectConst>();
  if (acknowledgementRecord.isNull() || manifestRecord.isNull()
      || profiles.isNull() || learnerRosterRecord.isNull()
      || progress.isNull() || progressRecord.isNull()
      || !decodeRecord("acknowledgement", acknowledgementRecord["encoding"] | nullptr,
                       acknowledgementRecord["data"] | nullptr, acknowledgement)
      || !decodeRecord("manifest", manifestRecord["encoding"] | nullptr,
                       manifestRecord["data"] | nullptr, manifest)
      || !decodeRecord("learner roster", learnerRosterRecord["encoding"] | nullptr,
                       learnerRosterRecord["data"] | nullptr, learnerRoster)
      || !decodeRecord("progress projection", progressRecord["encoding"] | nullptr,
                       progressRecord["data"] | nullptr, progressProjection)) return false;
  interactionResponse.length = 0;
  if (request.interactionRequest.length > 0) {
    if (interaction.isNull() || interactionRecord.isNull()
        || !decodeRecord("interaction response", interactionRecord["encoding"] | nullptr,
                         interactionRecord["data"] | nullptr, interactionResponse)) return false;
  } else if (!interaction.isNull()) {
    return fail("sync response contains an unsolicited interaction response");
  }
  plan.acknowledgementLength = acknowledgement.length;
  plan.manifestLength = manifest.length;
  plan.learnerRosterLength = learnerRoster.length;
  plan.progressProjectionLength = progressProjection.length;
  plan.interactionResponseLength = interactionResponse.length;

  plan.artifactCount = 0;
  if (!plan.ready) {
    trace.ok_ = true;
    return true;
  }
  JsonArrayConst artifacts = remotePlan["artifacts"].as<JsonArrayConst>();
  if (artifacts.isNull() || artifacts.size() > MAX_ARTIFACTS_PER_SYNC) {
    return fail("sync response has too many artifacts for one transaction");
  }
  for (JsonObjectConst source : artifacts) {
    ArtifactDescriptor& target = plan.artifacts[plan.artifactCount];
    const char* artifactId = source["artifactId"] | nullptr;
    const char* variableName = source["variableName"] | nullptr;
    const char* byteDigest = source["byteDigest"] | nullptr;
    if (!source["byteLength"].is<unsigned int>()
        || !copyText(artifactId, target.artifactId, sizeof(target.artifactId))
        || !copyText(variableName, target.variableName, sizeof(target.variableName))
        || !copyText(byteDigest, target.byteDigest, sizeof(target.byteDigest))
        || !validSha256(target.byteDigest)) {
      return fail("sync response contains invalid artifact metadata");
    }
    const unsigned long byteLength = source["byteLength"].as<unsigned long>();
    if (byteLength == 0 || byteLength > 0xFFFF) {
      return fail("sync artifact length is outside the TI variable range");
    }
    target.byteLength = static_cast<uint16_t>(byteLength);
    plan.artifactCount += 1;
  }
  trace.ok_ = true;
  return true;
}

bool SchoolCalcHttpApi::fetchCatalog(const char* deviceId,
                                     const char* expectedGeneration,
                                     MutableBytes& output) {
  ScopedHttpObservation trace(observer_, "catalog", error_);
  if (!configured()) return false;
  if (deviceId == nullptr || expectedGeneration == nullptr) {
    return fail("Catalog request is missing identity or generation");
  }
  HTTPClient client;
  WiFiClient network;
  const char* headers[] = { "X-SchoolCalc-Catalog-Generation", "Content-Length" };
  client.collectHeaders(headers, 2);
  client.setTimeout(HTTP_TIMEOUT_MS);
  client.setReuse(false);
  const String path = String("/devices/") + encodePathSegment(deviceId) + "/catalog";
  if (!client.begin(network, url(path))) return fail("could not open Catalog request");
  client.addHeader("Authorization", String("Bearer ") + apiToken_);
  client.addHeader("X-SchoolCalc-Relay-Id", relayId_);
  const int status = client.GET();
  trace.status_ = status;
  if (status != HTTP_CODE_OK) {
    client.end();
    return failHttp("Catalog download", status);
  }
  const String generation = client.header("X-SchoolCalc-Catalog-Generation");
  if (generation != expectedGeneration) {
    client.end();
    return fail("Catalog response generation does not match the sync plan");
  }
  if (!readBinaryResponse(client, output, error_, sizeof(error_))) {
    client.end();
    return false;
  }
  client.end();
  trace.responseBytes_ = output.length;
  trace.ok_ = true;
  return true;
}

bool SchoolCalcHttpApi::fetchArtifact(const ArtifactDescriptor& artifact,
                                      MutableBytes& output) {
  ScopedHttpObservation trace(observer_, "artifact", error_);
  if (!configured()) return false;
  HTTPClient client;
  WiFiClient network;
  const char* headers[] = {
    "X-SchoolCalc-Artifact-Id", "X-SchoolCalc-Variable-Name",
    "X-SchoolCalc-Byte-Digest", "X-SchoolCalc-Byte-Length", "Content-Length",
  };
  client.collectHeaders(headers, 5);
  client.setTimeout(HTTP_TIMEOUT_MS);
  client.setReuse(false);
  const String path = String("/artifacts/") + encodePathSegment(artifact.artifactId);
  if (!client.begin(network, url(path))) return fail("could not open artifact request");
  client.addHeader("Authorization", String("Bearer ") + apiToken_);
  client.addHeader("X-SchoolCalc-Relay-Id", relayId_);
  const int status = client.GET();
  trace.status_ = status;
  if (status != HTTP_CODE_OK) {
    client.end();
    return failHttp("artifact download", status);
  }
  const long declaredLength = client.header("X-SchoolCalc-Byte-Length").toInt();
  if (client.header("X-SchoolCalc-Artifact-Id") != artifact.artifactId
      || client.header("X-SchoolCalc-Variable-Name") != artifact.variableName
      || client.header("X-SchoolCalc-Byte-Digest") != artifact.byteDigest
      || declaredLength != artifact.byteLength) {
    client.end();
    return fail("artifact response metadata does not match the sync plan");
  }
  if (!readBinaryResponse(client, output, error_, sizeof(error_))) {
    client.end();
    return false;
  }
  client.end();
  trace.responseBytes_ = output.length;
  if (output.length != artifact.byteLength) return fail("artifact response length changed in transit");
  char digest[65];
  sha256Hex(output.bytes, output.length, digest);
  if (strcmp(digest, artifact.byteDigest) != 0) return fail("artifact SHA-256 does not match the sync plan");
  trace.ok_ = true;
  return true;
}

String SchoolCalcHttpApi::url(const String& relativePath) const {
  return String(scheme_) + "://" + host_ + ":" + port_ + basePath_ + relativePath;
}

bool SchoolCalcHttpApi::configured() {
  if (WiFi.status() != WL_CONNECTED) return fail("Wi-Fi is not connected");
  if (scheme_ == nullptr || strcmp(scheme_, "http") != 0) {
    return fail("relay currently requires an http backend on the trusted LAN");
  }
  if (host_ == nullptr || host_[0] == '\0' || basePath_ == nullptr
      || relayId_ == nullptr || relayId_[0] == '\0' || apiToken_ == nullptr
      || strlen(apiToken_) < MIN_API_TOKEN_BYTES) {
    return fail("SchoolCalc HTTP credentials are missing or invalid");
  }
  snprintf(error_, sizeof(error_), "none");
  return true;
}

bool SchoolCalcHttpApi::decodeRecord(const char* label, const char* encoding,
                                     const char* data, MutableBytes& output) {
  output.length = 0;
  if (encoding == nullptr || strcmp(encoding, "base64url") != 0 || data == nullptr) {
    snprintf(error_, sizeof(error_), "%s record has an unsupported encoding", label);
    return false;
  }
  size_t length = 0;
  if (!schoolcalc_base64::decode(data, strlen(data), output.bytes, output.capacity, length)
      || length == 0 || length > 0xFFFF) {
    snprintf(error_, sizeof(error_), "%s record is invalid or exceeds its relay buffer", label);
    return false;
  }
  output.length = static_cast<uint16_t>(length);
  return true;
}

bool SchoolCalcHttpApi::fail(const char* message) {
  snprintf(error_, sizeof(error_), "%s", message == nullptr ? "unknown HTTP error" : message);
  return false;
}

bool SchoolCalcHttpApi::failHttp(const char* operation, int status) {
  snprintf(error_, sizeof(error_), "%s returned HTTP %d", operation, status);
  return false;
}

static String encodePathSegment(const char* value) {
  String encoded;
  if (value == nullptr) return encoded;
  static constexpr char HEX_DIGITS[] = "0123456789ABCDEF";
  for (const uint8_t* cursor = reinterpret_cast<const uint8_t*>(value); *cursor; ++cursor) {
    const uint8_t character = *cursor;
    if (isalnum(character) || character == '-' || character == '_' || character == '.' || character == '~') {
      encoded += static_cast<char>(character);
    } else {
      encoded += '%';
      encoded += HEX_DIGITS[character >> 4];
      encoded += HEX_DIGITS[character & 0x0F];
    }
  }
  return encoded;
}

static bool encodeRecord(JsonDocument& document, const char* field, ByteView record) {
  const size_t capacity = schoolcalc_base64::encodedLength(record.length) + 1;
  char* encoded = static_cast<char*>(malloc(capacity));
  if (encoded == nullptr) return false;
  size_t length = 0;
  const bool ok = schoolcalc_base64::encode(record.bytes, record.length,
                                             encoded, capacity, length);
  if (ok) {
    JsonObject wrapper = document[field].to<JsonObject>();
    wrapper["encoding"] = "base64url";
    wrapper["data"] = encoded;
  }
  free(encoded);
  return ok;
}

static bool readBinaryResponse(HTTPClient& client, MutableBytes& output,
                               char* error, size_t errorCapacity) {
  output.length = 0;
  const int declared = client.getSize();
  if (declared <= 0) {
    snprintf(error, errorCapacity, "binary response has no Content-Length");
    return false;
  }
  if (declared > output.capacity || declared > 0xFFFF) {
    snprintf(error, errorCapacity, "binary response exceeds relay buffer (%d bytes)", declared);
    return false;
  }
  WiFiClient* stream = client.getStreamPtr();
  if (stream == nullptr) {
    snprintf(error, errorCapacity, "binary response stream is unavailable");
    return false;
  }
  const size_t received = stream->readBytes(output.bytes, static_cast<size_t>(declared));
  if (received != static_cast<size_t>(declared)) {
    snprintf(error, errorCapacity, "binary response was truncated (%u/%d bytes)",
             static_cast<unsigned>(received), declared);
    return false;
  }
  output.length = static_cast<uint16_t>(received);
  return true;
}

static bool copyText(const char* source, char* target, size_t targetCapacity) {
  if (source == nullptr || source[0] == '\0' || target == nullptr || targetCapacity < 2) return false;
  const size_t length = strnlen(source, targetCapacity);
  if (length >= targetCapacity) return false;
  memcpy(target, source, length + 1);
  return true;
}

static bool validSha256(const char* value) {
  if (value == nullptr || strlen(value) != 64) return false;
  for (size_t index = 0; index < 64; ++index) {
    if (!((value[index] >= '0' && value[index] <= '9')
          || (value[index] >= 'a' && value[index] <= 'f'))) return false;
  }
  return true;
}

static void sha256Hex(const uint8_t* bytes, size_t length, char output[65]) {
  uint8_t digest[32];
  mbedtls_sha256_ret(bytes, length, digest, 0);
  static constexpr char HEX_DIGITS[] = "0123456789abcdef";
  for (size_t index = 0; index < sizeof(digest); ++index) {
    output[index * 2] = HEX_DIGITS[digest[index] >> 4];
    output[index * 2 + 1] = HEX_DIGITS[digest[index] & 0x0F];
  }
  output[64] = '\0';
}

}  // namespace schoolcalc_relay
