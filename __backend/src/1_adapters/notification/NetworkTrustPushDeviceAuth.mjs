import { IPushDeviceAuth } from '#apps/notification/ports/IPushDeviceAuth.mjs';

/**
 * PLACEHOLDER until the phone is paired with a device token: trusts the
 * household network (the owner's ruling, 2026-11-21). Safe only because a push
 * with Approve/Deny or a reply never goes to the app (PushRoute) and no app
 * action handler is registered.
 */
export class NetworkTrustPushDeviceAuth extends IPushDeviceAuth {
  get kind() { return 'network-trust'; }
  allowHello() { return true; }
  allowPress() { return true; }
}
