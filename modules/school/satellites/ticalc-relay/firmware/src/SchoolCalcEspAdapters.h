#pragma once

#include <Arduino.h>

#include "SchoolCalcRelaySession.h"
#include "SchoolCalcTiLinkAdapters.h"

namespace schoolcalc_relay {

/**
 * Authenticated SchoolCalc HTTP client.
 *
 * It translates only transport shapes (binary, base64url, JSON and headers).
 * Calculator-family payloads remain opaque and are decoded by the backend's
 * registered codec adapter.
 */
class SchoolCalcHttpApi final : public ISchoolCalcApi {
public:
  SchoolCalcHttpApi(const char* scheme, const char* host, uint16_t port,
                    const char* basePath, const char* relayId,
                    const char* apiToken, IRelayIoObserver* observer = nullptr);

  bool identify(ByteView identityRecord, DeviceIdentity& identity) override;
  bool sync(const SyncRequest& request, SyncPlan& plan,
            MutableBytes& acknowledgement, MutableBytes& manifest,
            MutableBytes& learnerRoster,
            MutableBytes& progressProjection,
            MutableBytes& interactionResponse,
            INetworkWaitObserver* waitObserver = nullptr) override;
  bool fetchCatalog(const char* deviceId, const char* expectedGeneration,
                    MutableBytes& output) override;
  bool fetchArtifact(const ArtifactDescriptor& artifact, MutableBytes& output) override;
  const char* lastError() const override { return error_; }
  void setObserver(IRelayIoObserver* observer) { observer_ = observer; }

private:
  const char* scheme_;
  const char* host_;
  uint16_t port_;
  const char* basePath_;
  const char* relayId_;
  const char* apiToken_;
  IRelayIoObserver* observer_;
  char error_[192] = "none";

  String url(const String& relativePath) const;
  bool configured();
  bool decodeRecord(const char* label, const char* encoding, const char* data,
                    MutableBytes& output);
  bool fail(const char* message);
  bool failHttp(const char* operation, int status);
  bool syncBlocking(const SyncRequest& request, SyncPlan& plan,
                    MutableBytes& acknowledgement, MutableBytes& manifest,
                    MutableBytes& learnerRoster, MutableBytes& progressProjection,
                    MutableBytes& interactionResponse);
  struct SyncTaskContext;
  static void syncTask(void* parameter);
};

}  // namespace schoolcalc_relay
