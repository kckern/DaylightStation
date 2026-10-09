import { createGamingSessionRuntime } from '../../../../capabilities/gaming/server/composition/session-runtime.mjs';
import path from 'node:path';
import { SessionActorAuthorization } from "../../../../capabilities/gaming/portable/kernel/index.mjs";
import { activityPartyRuleModule } from "../../../../capabilities/gaming/portable/rulesets/activity-party/index.mjs";
import { cardBattleRuleModule } from "../../../../capabilities/gaming/portable/rulesets/card-battle/index.mjs";
import { jeopardyRuleModule } from "../../../../capabilities/gaming/portable/rulesets/jeopardy/index.mjs";
import { diceRuleModule } from "../../../../capabilities/gaming/portable/rulesets/dice/index.mjs";
import { selectorRuleModule } from "../../../../capabilities/gaming/portable/rulesets/selector/index.mjs";
import { checkersRuleModule } from "../../../../capabilities/gaming/portable/rulesets/checkers/index.mjs";
import { chessRuleModule } from "../../../../capabilities/gaming/portable/rulesets/chess/index.mjs";
import { connectFourRuleModule } from "../../../../capabilities/gaming/portable/rulesets/connect-four/index.mjs";
import { GamingApplication } from "../application/runtime/GamingApplication.mjs";
import { GamingDiagnosticSessions } from "../application/runtime/GamingDiagnosticSessions.mjs";
import { YamlGamingEffectStore } from "../adapters/persistence/YamlGamingEffectStore.mjs";
import { HostPacketRenderer } from "../rendering/host-packets/HostPacketRenderer.mjs";
import { NewestWinsAiPolicy } from "../application/effects/NewestWinsAiPolicy.mjs";
import { AiProposalGenerator } from '#adapters/ai/AiProposalGenerator.mjs';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';
import { OncePerSessionPrintPolicy } from "../application/effects/OncePerSessionPrintPolicy.mjs";
import { GamingEffectService } from "../application/effects/GamingEffectService.mjs";
import { GamingObservability } from "../application/effects/GamingObservability.mjs";
import { YamlDrawingCheckpointRepository } from "../adapters/persistence/YamlDrawingCheckpointRepository.mjs";
import { YamlCharadesClueHistory } from "../adapters/persistence/YamlCharadesClueHistory.mjs";
import { createGamingIdentitySource } from "../application/GamingIdentityPolicy.mjs";

export function createGamingApiModule({ definitionStore, manifestStore, snapshotsDir, journalsDir, effectsDir, drawingCheckpointsDir, historyDir, partyGamesCatalog = null, aiGateway = null, aiConfig = {}, printer = null, broadcastEvent = null, logger = null, autoPrint = false, clock = { now: () => new Date() } }) {
  const { snapshots, journal, runtime, ids, coordinator } = createGamingSessionRuntime({
    definitions: definitionStore, snapshotsDir, journalsDir,
    rulesets: [cardBattleRuleModule, jeopardyRuleModule, activityPartyRuleModule, diceRuleModule, selectorRuleModule, checkersRuleModule, chessRuleModule, connectFourRuleModule],
    createIds: createGamingIdentitySource, clock,
  });
  const effectStore = effectsDir ? new YamlGamingEffectStore({ effectsDir }) : null;
  const drawingCheckpoints = drawingCheckpointsDir ? new YamlDrawingCheckpointRepository({ checkpointsDir: drawingCheckpointsDir }) : null;
  const clueHistory = historyDir ? new YamlCharadesClueHistory({ file: path.join(historyDir, 'charades.yml') }) : null;
  const observability = new GamingObservability({ logger, auditStore: effectStore });
  const effects = new GamingEffectService({
    aiPolicy: aiGateway ? new NewestWinsAiPolicy({
      proposalGenerator: new AiProposalGenerator({
        aiGateway,
        scheduler: new NodeApplicationScheduler(),
      }),
      timeoutMs: aiConfig.timeout_ms,
    }) : null,
    aiCommentary: aiConfig.commentary !== false,
    aiAdvisoryJudgment: aiConfig.advisory_judgment !== false,
    printPolicy: effectStore ? new OncePerSessionPrintPolicy({ renderer: new HostPacketRenderer(), printer, receipts: effectStore }) : null,
    store: effectStore, observability, broadcast: broadcastEvent, autoPrint, drawingCheckpoints,
  });
  const gamingApplication = new GamingApplication({ coordinator, definitions: definitionStore, partyGamesCatalog, effects, manifestStore, drawingCheckpoints, clueHistory });
  const gamingDiagnostics = new GamingDiagnosticSessions({
    runtime,
    definitions: definitionStore,
    manifestStore,
    partyGamesCatalog,
    ids,
    authorization: new SessionActorAuthorization(),
    clock,
  });
  return { gamingApplication, gamingDiagnostics, coordinator, runtime, snapshots, journal, effects, observability, drawingCheckpoints, clueHistory };
}
