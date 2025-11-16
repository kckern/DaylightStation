import crypto from 'node:crypto';

function now(clock) {
	return clock ? clock() : new Date().toISOString();
}

function response(kind, extra = {}) {
	return {
		responseId: crypto.randomUUID(),
		version: 1,
		schemaHash: 'nutribot-tdd-v1',
		kind,
		...extra
	};
}

export function createNutribotService({ repos, ai, clock, observer }) {
	const currentTime = () => now(clock);
	const instrumentation = observer ?? {};
	const draftItems = new Map();

	const emit = (event, payload) => {
		if (typeof instrumentation.step === 'function') {
			instrumentation.step(event, payload);
		}
	};
	return {
		async handle(event) {
			switch (event.type) {
				case 'MealTextLogged':
					return handleMealText(event);
				case 'UserChoiceCommitted':
					return handleChoice(event);
				default:
					return { responses: [], jobs: [] };
			}
		}
	};

	async function handleMealText(event) {
		const text = event.payload?.text;
		if (!text) {
			throw new Error('MealTextLogged requires payload.text');
		}
		emit('input.received', { text, actor: event.actor, tenant: event.tenant });
		const parsed = await ai.foodText.analyze(text);
		const usage = parsed.usage ?? {};
		const aiInputTokens = usage.inputTokens ?? null;
		const aiOutputTokens = usage.outputTokens ?? null;
		const aiMetadata = parsed.metadata ?? {};
		const aiRequestId = aiMetadata.requestId ?? null;
		const createdAt = currentTime();
		const logId = crypto.randomUUID();
		await repos.logs.createDraft({
			id: logId,
			user: event.actor,
			bot: event.bot,
			tenant: event.tenant,
			text,
			items: parsed.items,
			createdAt,
			status: 'draft',
			aiInputTokens,
			aiOutputTokens,
			aiRequestId
		});
		await repos.list.saveItems({
			logId,
			items: parsed.items,
			status: 'pending',
			createdAt,
			aiInputTokens,
			aiOutputTokens,
			aiRequestId
		});
		draftItems.set(logId, parsed.items);
		emit('nutrilist.saved', { logId, items: parsed.items });
		const cardRef = `meal:${logId}`;
		emit('card.rendered', { logId, items: parsed.items });
		return {
			responses: [
				response('SendCard', {
					cardKind: 'mealSummary',
					cardKindVersion: 'v1',
					cardRef,
					model: {
						logId,
						title: 'Review meal',
						items: parsed.items.map((item) => ({
							id: item.id,
							label: item.label,
							grams: item.grams,
							color: item.color
						})),
						actions: [
							{
								action: 'acceptLog',
								label: 'Looks good',
								logId,
								cardRef
							}
						]
					}
				})
			],
			jobs: []
		};
	}

	async function handleChoice(event) {
		const { action, logId } = event.payload ?? {};
		if (action !== 'acceptLog' || !logId) {
			return {
				responses: [
					response('Acknowledge', {
						message: 'Unknown action',
						severity: 'warn'
					})
				],
				jobs: []
			};
		}
		emit('choice.received', { action, logId });
		const acceptedAt = currentTime();
		const items = draftItems.get(logId) ?? [];
		emit('itemizing.start', { logId, items });
		await repos.logs.markAccepted(logId, acceptedAt);
		await repos.list.markAccepted(logId, acceptedAt);
		emit('nutrilog.saved', { logId, items });
		draftItems.delete(logId);
		return {
			responses: [
				response('Acknowledge', {
					message: 'Meal saved',
					severity: 'info'
				})
			],
			jobs: []
		};
	}
}
