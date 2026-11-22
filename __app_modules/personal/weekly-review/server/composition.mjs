import axios from "axios";
import { scopedGateway } from "#apps/common/ports/IAIGateway.mjs";
import { FilesystemWeeklyReviewStore } from "./adapters/persistence/FilesystemWeeklyReviewStore.mjs";
import { NodeCommandRunner } from "#adapters/process/NodeCommandRunner.mjs";
import { WeeklyReviewImmichAdapter } from "./adapters/WeeklyReviewImmichAdapter.mjs";
import { WeeklyReviewCalendarAdapter } from "./adapters/WeeklyReviewCalendarAdapter.mjs";
import { WeeklyReviewSchoolAdapter } from "./adapters/WeeklyReviewSchoolAdapter.mjs";
import { WeeklyReviewService } from "./application/WeeklyReviewService.mjs";
import { SchoolShowcaseService } from "./application/SchoolShowcaseService.mjs";
import { LearnerWinsService } from "./application/LearnerWinsService.mjs";
import { createWeeklyReviewRouter } from "./api/weekly-review.mjs";

export async function installWeeklyReview({ configService, dataService, immichConfig, sharedAiGateway, rootLogger, householdId, userDataService, dataBasePath, mediaBasePath, fitnessServices, v1Routers, schoolLearnerWork = null, economyService = null, fitnessRings = null, learners = null }) {

    const { ImmichClient } = await import("../../../../__capabilities/content-catalog/server/adapters/providers/gallery/immich/ImmichClient.mjs");
    const wrImmichClient = new ImmichClient(immichConfig, { httpClient: axios });
    const weeklyReviewAi = scopedGateway(sharedAiGateway, { app: 'weekly-review' });
    const weeklyReviewImmichAdapter = new WeeklyReviewImmichAdapter(
      {
        priorityPeople: [],
        proxyPath: '/api/v1/proxy/immich',
        hiddenTags: configService.getHouseholdAppConfig(householdId, 'weekly-review')?.hiddenTags,
      },
      { client: wrImmichClient, logger: rootLogger.child({ module: 'weekly-review-immich' }) }
    );

    const weeklyReviewCalendarAdapter = new WeeklyReviewCalendarAdapter(
      { householdId, defaultUser: configService.getHeadOfHousehold?.() || 'user_1' },
      { userDataService, logger: rootLogger.child({ module: 'weekly-review-calendar' }) }
    );

    // Weather history store for weekly review (reads daily snapshots)
    const { YamlWeatherDatastore } = await import("#adapters/persistence/yaml/YamlWeatherDatastore.mjs");
    const wrWeatherStore = new YamlWeatherDatastore({
      dataService,
      configService,
      logger: rootLogger.child({ module: 'weekly-review-weather' }),
    });

    const weeklyReviewHouseholdDir = configService.getHouseholdPath('', householdId);
    const weeklyReviewCommandRunner = new NodeCommandRunner();
    const weeklyReviewStore = new FilesystemWeeklyReviewStore({
      householdDir: weeklyReviewHouseholdDir,
      mediaPath: mediaBasePath,
      logger: rootLogger.child({ module: 'weekly-review-store' }),
    });
    const weeklyReviewShowcase = new SchoolShowcaseService({
      ai: weeklyReviewAi ? scopedGateway(weeklyReviewAi, { feature: 'school-showcase' }) : null,
      store: {
        load: (week) => weeklyReviewStore.loadSchoolShowcase(week),
        save: (week, data) => weeklyReviewStore.saveSchoolShowcase(week, data),
      },
      logger: rootLogger.child({ module: 'weekly-review-showcase' }),
    });
    // Each child's wins on their own showcase slide. Economy and fitness are
    // other owners: they come in as plain functions, never as imports.
    const weeklyReviewWins = (economyService || fitnessRings) ? new LearnerWinsService({
      ledger: economyService && typeof economyService.getHistory === 'function'
        ? async (learnerId) => (economyService.hasUser?.(learnerId) === false ? null : economyService.getHistory(learnerId))
        : null,
      // One session listing for the whole roster (`standings`), not one per child.
      ringStandings: fitnessRings && typeof fitnessRings.standings === 'function'
        ? ({ learnerIds, fromMs, toMs }) => fitnessRings.standings({ learnerIds, fromMs, toMs })
        : null,
      logger: rootLogger.child({ module: 'weekly-review-wins' }),
    }) : null;
    const weeklyReviewService = new WeeklyReviewService(
      {
        dataPath: dataBasePath,
        householdDir: weeklyReviewHouseholdDir,
        mediaPath: mediaBasePath,
        householdId,
        timezone: configService.getTimezone?.() || 'UTC',
      },
      {
        immichAdapter: weeklyReviewImmichAdapter,
        calendarData: weeklyReviewCalendarAdapter,
        sessionService: fitnessServices?.sessionService || null,
        weatherStore: wrWeatherStore,
        schoolWork: schoolLearnerWork
          ? new WeeklyReviewSchoolAdapter({
              schoolLearnerWork,
              logger: rootLogger.child({ module: 'weekly-review-school' }),
            })
          : null,
        transcriptionService: weeklyReviewAi ? {
          transcribe: async (buffer, opts) => {
            const raw = await weeklyReviewAi.transcribe(buffer, {
              filename: 'weekly-review.webm',
              contentType: opts.mimeType,
              prompt: opts.prompt,
            });
            const clean = await weeklyReviewAi.chat(
              [
                { role: 'system', content: 'Clean up this family conversation transcript. Fix spelling, grammar, and punctuation. Preserve the natural conversational tone. Do not add or remove content.' },
                { role: 'user', content: raw },
              ],
              { temperature: 0.2, maxTokens: 4000 }
            );
            return { transcriptRaw: raw, transcriptClean: clean };
          },
        } : null,
        reviewStore: weeklyReviewStore,
        schoolShowcase: weeklyReviewShowcase,
        learnerWins: weeklyReviewWins,
        learners: typeof learners === 'function' ? learners : null,
        runCommand: weeklyReviewCommandRunner.run,
        logger: rootLogger.child({ module: 'weekly-review' }),
      }
    );

    v1Routers['weekly-review'] = createWeeklyReviewRouter({
      weeklyReviewService,
      logger: rootLogger.child({ module: 'weekly-review-api' }),
    });

}
