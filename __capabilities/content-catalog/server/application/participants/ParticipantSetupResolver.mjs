import { sha256Text } from "#system/utils/sha256.mjs";
import { canonicalJson } from "../../../portable/participant-launch.mjs";
import { createParticipantContext, selectParticipants, validateParticipantContext } from "../../../../household-identity/portable/participants.mjs";
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};
const hashValue = (value) => sha256Text(canonicalJson(value));
const sameRef = (a, b) => a?.id === b?.id && a?.version === b?.version;
class ParticipantSetupResolver {
  constructor({ registry }) {
    if (!registry) throw new Error("Registry required");
    this.registry = registry;
  }
  async resolve({ resolvedSource, viewer }) {
    const { target, action, settings } = resolvedSource;
    const consumer = this.registry.resolve({ target, action });
    if (!consumer || resolvedSource.consumer && !sameRef(consumer, resolvedSource.consumer)) fail("consumer_unavailable", "Consumer unavailable");
    const descriptor = consumer.describe(target);
    if (!descriptor || !["required", "optional"].includes(descriptor.participantRequirement) ||
        !Number.isSafeInteger(descriptor.minParticipants) || descriptor.minParticipants < 0 ||
        !Number.isSafeInteger(descriptor.maxParticipants) || descriptor.maxParticipants < descriptor.minParticipants ||
        !Array.isArray(descriptor.selectorSupport)) {
      fail("invalid_consumer_descriptor", "Invalid participant descriptor");
    }
    let participantContext;
    if (resolvedSource.scope) {
      if (!descriptor.selectorSupport?.includes(resolvedSource.selector?.mode)) fail("invalid_participant_selector", "Selector unsupported");
      participantContext = await createParticipantContext({ scope: resolvedSource.scope, participants: selectParticipants({ roster: resolvedSource.roster, selector: resolvedSource.selector }) });
    } else {
      participantContext = await consumer.resolveDefaultContext?.(target, viewer) ?? null;
      if (participantContext) {
        validateParticipantContext(participantContext);
        const expected = await createParticipantContext({scope:participantContext.scope, participants:participantContext.participants});
        if (participantContext.context_id !== expected.context_id) {
          fail("invalid_participant_context", "Context digest does not match its contents");
        }
      }
    }
    if (!participantContext) {
      if (descriptor.participantRequirement === "required") fail("participant_context_required", "Participant context required");
      return { participantContext: null, prepared: null, setupHash: null, consumer };
    }
    const n = participantContext.participants.length;
    if (n < Math.max(descriptor.minParticipants ?? 0, descriptor.participantRequirement === "required" ? 1 : 0) || n > descriptor.maxParticipants) fail("participant_context_required", "Participant count outside supported range");
    const prepared = await consumer.prepareSetup({ target, participantContext, settings, viewer });
    if (prepared?.schema !== "participant-prepared-setup/v1" || !sameRef(prepared.consumer, consumer) || !["required", "none"].includes(prepared.confirmation) || !Array.isArray(prepared.artifacts) ||
        typeof prepared.setup?.schema !== "string" || !Object.hasOwn(prepared.setup, "data") ||
        typeof prepared.preview?.schema !== "string" || !Object.hasOwn(prepared.preview, "data") ||
        prepared.artifacts.some(artifact => !artifact || typeof artifact.role !== "string" ||
          typeof artifact.id !== "string" || typeof artifact.hash !== "string")) {
      fail("invalid_prepared_setup", "Invalid prepared setup");
    }
    const setupHash = hashValue({ participant_context: participantContext, target, prepared });
    return { participantContext, prepared, setupHash, consumer };
  }
}
export {
  ParticipantSetupResolver,
  hashValue
};
