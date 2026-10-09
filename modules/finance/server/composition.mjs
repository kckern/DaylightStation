import { scopedGateway } from "#apps/common/ports/IAIGateway.mjs";
import { YamlFinanceDatastore } from "./adapters/persistence/YamlFinanceDatastore.mjs";
import { BudgetCompilationService } from "./application/BudgetCompilationService.mjs";
import { FinanceHarvestService } from "./application/FinanceHarvestService.mjs";
import { TransactionCategorizationService } from "./application/TransactionCategorizationService.mjs";
import { PayrollSyncService } from "./application/PayrollSyncService.mjs";
import { TriNetPayrollGateway } from "./adapters/TriNetPayrollGateway.mjs";
import { FinanceStorePayrollRepository } from "./adapters/FinanceStorePayrollRepository.mjs";

export function createFinanceServices(config) {
  const {
    configService,
    buxferAdapter: preloadedBuxferAdapter,
    aiGateway,
    decisionGateway = null,
    httpClient,
    defaultHouseholdId,
    logger = console
  } = config;

  // Finance store (YAML persistence)
  const financeStore = new YamlFinanceDatastore({
    configService
  });

  // Buxfer adapter (provided by composition root)
  const buxferAdapter = preloadedBuxferAdapter ?? null;

  // Budget compilation service
  const compilationService = new BudgetCompilationService({
    financeStore,
    logger
  });

  // Transaction categorization service (optional - requires AI gateway AND buxfer adapter)
  let categorizationService = null;
  if (aiGateway && buxferAdapter) {
    const categorizationConfig = financeStore.getCategorizationConfig(defaultHouseholdId);
    if (categorizationConfig) {
      categorizationService = new TransactionCategorizationService({
        aiGateway: scopedGateway(aiGateway, { feature: 'categorization' }),
        transactionSource: buxferAdapter,
        financeStore,
        decisionGateway: scopedGateway(decisionGateway, { feature: 'categorization' }),
        logger
      });
      logger.info?.('finance.categorization.enabled', {
        validTags: categorizationConfig.validTags?.length || 0,
        jev: !!decisionGateway && decisionGateway.isConfigured?.() !== false
      });
    } else {
      logger.warn?.('finance.categorization.skipped', { reason: 'no_config', householdId: defaultHouseholdId });
    }
  } else {
    logger.warn?.('finance.categorization.skipped', { reason: aiGateway ? 'no_buxfer_adapter' : 'no_ai_gateway' });
  }

  // Finance harvest service (optional - requires Buxfer adapter)
  let harvestService = null;
  if (buxferAdapter) {
    harvestService = new FinanceHarvestService({
      transactionSource: buxferAdapter,
      financeStore,
      compilationService,
      categorizationService,
      logger
    });
  }

  // Payroll sync service (optional - requires httpClient and configService)
  let payrollService = null;
  if (httpClient && configService) {
    const auth = configService.getUserAuth?.('payroll') || {};
    const payrollConfig = {
      baseUrl: auth.base_url || auth.base,
      authKey: auth.cookie_name || auth.authkey || auth.auth_key,
      authCookie: auth.auth_cookie || auth.auth,
      company: auth.company,
      employeeId: auth.employee_id || auth.employee,
    };
    const payrollGateway = new TriNetPayrollGateway({ httpClient, config: payrollConfig });
    const payrollRepository = new FinanceStorePayrollRepository({ financeStore, logger });
    payrollService = new PayrollSyncService({
      payrollGateway,
      payrollRepository,
      transactionGateway: buxferAdapter,
      householdId: defaultHouseholdId || configService.getDefaultHouseholdId?.() || 'default',
      payrollAccountId: auth.payroll_account_id,
      directDepositAccountId: auth.direct_deposit_account_id,
      logger
    });
  }

  return {
    financeStore,
    buxferAdapter,
    compilationService,
    categorizationService,
    harvestService,
    payrollService
  };
}
