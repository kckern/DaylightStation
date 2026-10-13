import path from "path";
import { createLivestreamRouter } from "./api/livestream.mjs";
import { NodeApplicationScheduler } from "#adapters/scheduling/NodeApplicationScheduler.mjs";
import { YamlConfigFileStore } from "#adapters/persistence/yaml/YamlConfigFileStore.mjs";

export async function installLivestream({ configService, rootLogger, eventBus, mediaBasePath, v1Routers }) {
  const { ChannelManager } = await import("./application/ChannelManager.mjs");
  const { FFmpegStreamAdapter } = await import("./adapters/FFmpegStreamAdapter.mjs");
  const { SourceFeeder } = await import("./adapters/SourceFeeder.mjs");
  const { StreamChannelRuntimeAdapter } = await import("./adapters/StreamChannelRuntimeAdapter.mjs");
  const programsBasePath = configService.getHouseholdPath('livestream/programs');
  const livestreamConfigFiles = new YamlConfigFileStore({ logger: rootLogger.child({ module: 'livestream-config' }) });
  const channelManager = new ChannelManager({
    broadcastEvent: (topic, payload) => eventBus.broadcast(topic, payload),
    createChannelRuntime: (opts) => new StreamChannelRuntimeAdapter({
      ...opts,
      createEncoder: (encoderOpts) => new FFmpegStreamAdapter(encoderOpts),
      createFeeder: (feederOpts) => new SourceFeeder({
        ...feederOpts,
        resolveMediaAsset: (asset) => path.isAbsolute(asset) ? asset : path.join(mediaBasePath, asset),
      }),
    }),
    loadProgram: (programPath) => livestreamConfigFiles.readYaml(
      path.isAbsolute(programPath) ? programPath : path.join(programsBasePath, programPath),
    ),
    clock: () => Date.now(),
    random: Math.random,
    scheduler: new NodeApplicationScheduler(),
    logger: rootLogger.child({ module: 'livestream' }),
  });

  v1Routers.livestream = createLivestreamRouter({
    channelManager,
    logger: rootLogger.child({ module: 'livestream-api' }),
  });


}
