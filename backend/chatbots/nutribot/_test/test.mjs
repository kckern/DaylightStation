import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'yaml';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');
const configPath = path.join(repoRoot, 'config.app.yml');
const secretsPath = path.join(repoRoot, 'config.secrets.yml');
const suitePath = path.join(__dirname, 'test_suite.yaml');

const config = parse(readFileSync(configPath, 'utf8'));
const secrets = parse(readFileSync(secretsPath, 'utf8'));
const nutribotConfig = config.nutribot;
const suite = parse(readFileSync(suitePath, 'utf8'));
const configuredChatId = config.nutribot_chat_id ?? 'nutribot-test-chat';

const openaiKey = secrets.OPENAI_API_KEY?.trim();
if (openaiKey) {
	if (!process.env.OPENAI_API_KEY) {
		process.env.OPENAI_API_KEY = openaiKey;
	}
	if (!process.env.OPEN_AI_API_KEY) {
		process.env.OPEN_AI_API_KEY = openaiKey;
	}
}

if (configuredChatId && !process.env.nutribot_chat_id) {
	process.env.nutribot_chat_id = configuredChatId;
}

const { createNutribotService } = await import('../nutribotCore.mjs');
const { createRepos, resetRepoFiles } = await import('../nutribotData.mjs');
const { createAIServices } = await import('../nutribotAI.mjs');
const { loadFile } = await import('../../../lib/io.mjs');

if (suite.version !== 1) {
	throw new Error(`Unsupported test suite version ${suite.version}`);
}

const storageConfig = {
	nutrilogPath: nutribotConfig.data.nutrilogPath,
	nutrilistPath: nutribotConfig.data.nutrilistPath
};

const SUITE_TMP_ROOT = path.join(repoRoot, 'tmp/nutribot-tests');

const stepHandlers = {
	invoke: handleInvokeStep,
	wait: handleWaitStep
};

async function runSuite() {
	for (const scenario of suite.scenarios) {
		await runScenario(scenario);
	}
	console.log('\n✅ All scenarios passed');
}

async function runScenario(scenario) {
	console.log(`\n▶︎ Scenario: ${scenario.name} — ${scenario.description}`);
	const dataRoot = path.join(SUITE_TMP_ROOT, scenario.name);
	resetDataRoot(dataRoot);
	configureEnvPaths(dataRoot);
	resetRepoFiles(storageConfig);
	const context = createScenarioContext(scenario);
	for (const step of scenario.steps ?? []) {
		await executeStep(step, context);
	}
	validateExitCriteria(scenario.exitCriteria, context.vars);
	const logId = context.vars.logId;
	assert.ok(logId, `Scenario ${scenario.name} completed without generating a logId`);
	const nutrilogPath = context.vars.nutrilogPath;
	assert.ok(nutrilogPath, `Scenario ${scenario.name} missing nutrilog path reference`);
	console.log(`✅ Scenario ${scenario.name} passed: UUID: ${logId} | File: ${nutrilogPath}`);
}

async function executeStep(step, context) {
	if (!step || !step.action) {
		throw new Error('Each step must include an action');
	}
	const handler = stepHandlers[step.action];
	if (!handler) {
		throw new Error(`No handler implemented for action "${step.action}"`);
	}
	const resolvedValue = interpolate(step.value ?? {}, context.vars);
	await handler({ ...step, value: resolvedValue }, context);
}

function createScenarioContext(scenario) {
	const repos = createRepos(storageConfig);
	const ai = createAIServices();
	const service = createNutribotService({ repos, ai, clock: fixedClock, chatId: configuredChatId });
	return {
		scenario,
		service,
		clock: fixedClock,
		storageConfig,
		vars: configuredChatId ? { chatId: configuredChatId } : {},
		lastResult: null,
		stepCounter: 0
	};
}


async function handleInvokeStep(step, context) {
	switch (step.target) {
		case 'service.handle':
			return handleServiceInvoke(step.value, context);
		default:
			throw new Error(`Unsupported invoke target "${step.target}"`);
	}
}

async function handleServiceInvoke(value, context) {
	const event = createEvent(value, context);
	const result = await context.service.handle(event);
	context.lastResult = result;
	captureResultVariables(result, context.vars);
}

async function handleWaitStep(step, context) {
	switch (step.target) {
		case 'responses':
			return waitForResponse(step.value, context);
		case 'nutrilog':
			return waitForNutrilog(step.value, context);
		case 'nutrilist':
			return waitForNutrilist(step.value, context);
		default:
			throw new Error(`Unsupported wait target "${step.target}"`);
	}
}

function waitForResponse(value, context) {
	if (!context.lastResult) {
		throw new Error('No invocation has been performed yet');
	}
	const index = value.at ?? 0;
	const responses = context.lastResult.responses ?? [];
	const response = responses[index];
	assert.ok(response, `Response at index ${index} not found`);
	const expectation = value.expect ?? {};
	assertSubset(response, expectation, `responses[${index}]`);
}

function waitForNutrilog(value, context) {
	const entries = readArray(context.storageConfig.nutrilogPath);
	const expectation = value.expect;
	if (!expectation) {
		return;
	}
	if (Array.isArray(expectation)) {
		assert.ok(entries.length >= expectation.length, 'Nutrilog does not contain enough entries');
		expectation.forEach((expectedEntry, idx) => {
			assertSubset(entries[idx], expectedEntry, `nutrilog[${idx}]`);
		});
		return;
	}
	assertSubset(entries, expectation, 'nutrilog');
}

function waitForNutrilist(value, context) {
	const entries = readArray(context.storageConfig.nutrilistPath);
	const expectation = value.expect;
	if (!expectation) {
		return;
	}
	if (Array.isArray(expectation)) {
		assert.ok(entries.length >= expectation.length, 'Nutrilist does not contain enough entries');
		expectation.forEach((expectedEntry, idx) => {
			assertSubset(entries[idx], expectedEntry, `nutrilist[${idx}]`);
		});
		return;
	}
	assertSubset(entries, expectation, 'nutrilist');
}

function createEvent(value, context) {
	if (!value?.type) {
		throw new Error('Invoke steps must provide an event type');
	}
	const scenario = context.scenario;
	const payload = value.payload ?? {};
	return {
		id: value.id ?? `event-${scenario.name}-${context.stepCounter++}`,
		type: value.type,
		actor: value.actor ?? scenario.context.actor,
		bot: value.bot ?? scenario.context.bot,
		tenant: value.tenant ?? scenario.context.tenant,
		occurredAt: value.occurredAt ?? context.clock(),
		payload
	};
}

function captureResultVariables(result, vars) {
	const responses = Array.isArray(result.responses) ? result.responses : [];
	const firstResponse = responses[0];
	vars.lastResponses = responses;
	vars.lastResponse = firstResponse;
	const logId = responses.find((resp) => resp?.model?.logId)?.model?.logId;
	if (logId) {
		vars.logId = logId;
	}
	const firstItems = firstResponse?.model?.items;
	const firstItemId = Array.isArray(firstItems) && firstItems[0]?.id ? firstItems[0].id : null;
	if (firstItemId) {
		vars.itemId = firstItemId;
	}
	const mealDate = firstResponse?.model?.mealDate;
	if (mealDate) {
		vars.logDate = mealDate;
	}
	const timeOfDay = firstResponse?.model?.timeOfDay;
	if (timeOfDay) {
		vars.timeOfDay = timeOfDay;
	}
}


function interpolate(value, vars) {
	if (value === null || value === undefined) {
		return value;
	}
	if (typeof value === 'string') {
		const exactMatch = value.match(/^\{\{(.*?)\}\}$/);
		if (exactMatch) {
			return resolveVar(exactMatch[1], vars);
		}
		return value.replace(/\{\{(.*?)\}\}/g, (_, key) => {
			const resolved = resolveVar(key, vars);
			return resolved ?? '';
		});
	}
	if (Array.isArray(value)) {
		return value.map((entry) => interpolate(entry, vars));
	}
	if (typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key, interpolate(entry, vars)])
		);
	}
	return value;
}

function resolveVar(key, vars) {
	const trimmed = key.trim();
	if (!(trimmed in vars)) {
		throw new Error(`Unknown variable "${trimmed}" in scenario step`);
	}
	return vars[trimmed];
}

function assertSubset(actual, expected, contextPath) {
	if (expected === undefined) {
		return;
	}
	if (Array.isArray(expected)) {
		assert.ok(Array.isArray(actual), `${contextPath} is not an array`);
		expected.forEach((value, idx) => {
			assertSubset(actual[idx], value, `${contextPath}[${idx}]`);
		});
		return;
	}
	if (expected && typeof expected === 'object') {
		assert.ok(actual && typeof actual === 'object', `${contextPath} is not an object`);
		for (const [key, value] of Object.entries(expected)) {
			assertSubset(actual[key], value, `${contextPath}.${key}`);
		}
		return;
	}
	assert.equal(actual, expected, `${contextPath} mismatch`);
}

function validateExitCriteria(exitCriteria, vars) {
	if (!exitCriteria) {
		return;
	}
	const inclusion = exitCriteria.nutrilogContainsLogId;
	if (inclusion) {
		const logId = vars.logId;
		assert.ok(logId, 'Exit criteria requires captured logId');
		const absolutePath = resolveDataFilePath(inclusion.path);
		assert.ok(absolutePath, `Exit criteria failed: ${inclusion.path} does not exist`);
		const rows = loadFile(inclusion.path);
		const entries = Array.isArray(rows) ? rows : [];
		const found = entries.some((entry) => entry?.id === logId);
		if (!found) {
			throw new Error(`Exit criteria failed: logId ${logId} not found in ${inclusion.path}`);
		}
		vars.nutrilogPath = absolutePath;
	}
}

function resolveDataFilePath(relativePath) {
	const dataRoot = process.env.path?.data;
	if (!dataRoot) {
		return null;
	}
	const yamlCandidate = path.join(dataRoot, `${relativePath}.yaml`);
	if (existsSync(yamlCandidate)) {
		return yamlCandidate;
	}
	const ymlCandidate = path.join(dataRoot, `${relativePath}.yml`);
	if (existsSync(ymlCandidate)) {
		return ymlCandidate;
	}
	return null;
}

function readArray(key) {
	const data = loadFile(key);
	return Array.isArray(data) ? data : [];
}

function resetDataRoot(dataRoot) {
	rmSync(dataRoot, { recursive: true, force: true });
	mkdirSync(dataRoot, { recursive: true });
	mkdirSync(path.join(dataRoot, 'img'), { recursive: true });
}

function configureEnvPaths(dataRoot) {
	const currentEnv = process.env;
	const existingPath = currentEnv.path;
	const normalizedPath = typeof existingPath === 'object' && existingPath !== null ? existingPath : {};
	process.env = {
		...currentEnv,
		path: {
			...normalizedPath,
			data: dataRoot,
			img: normalizedPath.img ?? path.join(dataRoot, 'img')
		}
	};
}

const fixedClock = () => new Date('2024-01-01T00:00:00Z').toISOString();

runSuite().catch((err) => {
	console.error(err);
	process.exit(1);
});
