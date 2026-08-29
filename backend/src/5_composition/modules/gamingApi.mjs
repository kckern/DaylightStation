import crypto from 'node:crypto';
import { GameRuntime, GameSessionCoordinator, SessionActorAuthorization } from '#shared/gaming/kernel/index.mjs';
import { activityPartyRuleModule } from '#shared/gaming/rulesets/activity-party/index.mjs';
import { cardBattleRuleModule } from '#shared/gaming/rulesets/card-battle/index.mjs';
import { jeopardyRuleModule } from '#shared/gaming/rulesets/jeopardy/index.mjs';
import { diceRuleModule } from '#shared/gaming/rulesets/dice/index.mjs';
import { selectorRuleModule } from '#shared/gaming/rulesets/selector/index.mjs';
import { checkersRuleModule } from '#shared/gaming/rulesets/checkers/index.mjs';
import { chessRuleModule } from '#shared/gaming/rulesets/chess/index.mjs';
import { connectFourRuleModule } from '#shared/gaming/rulesets/connect-four/index.mjs';
import { GamingApplication } from '#apps/gaming/runtime/GamingApplication.mjs';
import { YamlGamingSnapshotRepository } from '#adapters/persistence/yaml/gaming/YamlGamingSnapshotRepository.mjs';
import { YamlGamingSessionJournal } from '#adapters/persistence/yaml/gaming/YamlGamingSessionJournal.mjs';
import { YamlGamingEffectStore } from '#adapters/persistence/yaml/gaming/YamlGamingEffectStore.mjs';
import { HostPacketRenderer } from '#rendering/gaming/host-packets/HostPacketRenderer.mjs';
import { NewestWinsAiPolicy } from '#apps/gaming/effects/NewestWinsAiPolicy.mjs';
import { OncePerSessionPrintPolicy } from '#apps/gaming/effects/OncePerSessionPrintPolicy.mjs';
import { GamingEffectService } from '#apps/gaming/effects/GamingEffectService.mjs';
import { GamingObservability } from '#apps/gaming/effects/GamingObservability.mjs';
import { YamlDrawingCheckpointRepository } from '#adapters/persistence/yaml/gaming/YamlDrawingCheckpointRepository.mjs';

export function createGamingApiModule({ definitionStore, manifestStore, snapshotsDir, journalsDir, effectsDir, drawingCheckpointsDir, partyGamesCatalog = null, aiGateway = null, aiConfig = {}, printer = null, broadcastEvent = null, logger = null, autoPrint = false, clock = { now: () => new Date() } }) {
  const snapshots = new YamlGamingSnapshotRepository({ snapshotsDir });
  const journal = new YamlGamingSessionJournal({ journalsDir });
  const runtime = new GameRuntime({ rulesets: [cardBattleRuleModule, jeopardyRuleModule, activityPartyRuleModule, diceRuleModule, selectorRuleModule, checkersRuleModule, chessRuleModule, connectFourRuleModule] });
  const ids = { session: () => `game:${crypto.randomUUID()}`, command: () => `cmd:${crypto.randomUUID()}`, seed: () => crypto.randomBytes(4).readUInt32LE(0) };
  const coordinator = new GameSessionCoordinator({ runtime, snapshots, journal, definitions: definitionStore, ids, clock, authorization: new SessionActorAuthorization() });
  const effectStore = effectsDir ? new YamlGamingEffectStore({ effectsDir }) : null;
  const drawingCheckpoints = drawingCheckpointsDir ? new YamlDrawingCheckpointRepository({ checkpointsDir: drawingCheckpointsDir }) : null;
  const observability = new GamingObservability({ logger, auditStore: effectStore });
  const effects = new GamingEffectService({
    aiPolicy: aiGateway ? new NewestWinsAiPolicy({ aiGateway, timeoutMs: aiConfig.timeout_ms }) : null,
    aiCommentary: aiConfig.commentary !== false,
    aiAdvisoryJudgment: aiConfig.advisory_judgment !== false,
    printPolicy: effectStore ? new OncePerSessionPrintPolicy({ renderer: new HostPacketRenderer(), printer, receipts: effectStore }) : null,
    store: effectStore, observability, broadcast: broadcastEvent, autoPrint, drawingCheckpoints,
  });
  return { gamingApplication: new GamingApplication({ coordinator, definitions: definitionStore, partyGamesCatalog, effects, manifestStore, drawingCheckpoints }), coordinator, runtime, snapshots, journal, effects, observability, drawingCheckpoints };
}
