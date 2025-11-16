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

export function createNutribotService({ repos, ai, clock, observer, chatId }) {
	const currentTime = () => now(clock);
	const instrumentation = observer ?? {};
	const draftLogs = new Map();
 	const resolvedChatId = chatId ?? process.env.nutribot_chat_id ?? null;

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
		const normalizedItems = (parsed.items ?? []).map((item) => ({
			id: item.id ?? crypto.randomUUID(),
			label: item.label ?? 'Unknown item',
			grams: typeof item.grams === 'number' ? item.grams : 0,
			color: item.color ?? 'yellow'
		}));
		const usage = parsed.usage ?? {};
		const aiInputTokens = usage.inputTokens ?? null;
		const aiOutputTokens = usage.outputTokens ?? null;
		const aiMetadata = parsed.metadata ?? {};
		const aiRequestId = aiMetadata.requestId ?? null;
		const createdAt = currentTime();
		const logDate = aiMetadata.date ?? createdAt.slice(0, 10);
		const timeOfDay = aiMetadata.time ?? null;
		const logId = crypto.randomUUID();
		await repos.logs.createDraft({
			id: logId,
			user: event.actor,
			bot: event.bot,
			tenant: event.tenant,
			text: text.trim(),
			items: normalizedItems,
			createdAt,
			status: 'draft',
			aiInputTokens,
			aiOutputTokens,
			aiRequestId
		});
		draftLogs.set(logId, {
			items: normalizedItems,
			createdAt,
			date: logDate,
			timeOfDay,
			chatId: resolvedChatId
		});
		emit('nutrilog.saved', { logId, items: normalizedItems, status: 'draft' });
		const cardRef = `meal:${logId}`;
		emit('card.rendered', { logId, items: normalizedItems });
		return {
			responses: [
				response('SendCard', {
					cardKind: 'mealSummary',
					cardKindVersion: 'v1',
					cardRef,
					model: {
						logId,
						title: 'Review meal',
						mealDate: logDate,
						timeOfDay,
						items: normalizedItems.map((item) => ({
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
		const draft = draftLogs.get(logId);
		if (!draft) {
			throw new Error(`No draft items found for log ${logId}`);
		}
		emit('itemizing.start', { logId, items: draft.items });
		const itemizerPayload = buildItemizerSeed(draft.items);
		let itemizerResult;
		try {
			itemizerResult = await ai.itemizer.enrich(itemizerPayload);
		} catch (error) {
			console.error('Error enriching items for nutrilist:', error?.message || error);
		}
		const enrichedItems = mergeItemizerItems(draft.items, itemizerResult?.items ?? []);
		const listUsage = itemizerResult?.usage ?? {};
		await repos.list.saveItems({
			logId,
			items: enrichedItems,
			status: 'accepted',
			createdAt: draft.createdAt,
			date: draft.date,
			timeOfDay: draft.timeOfDay,
			chatId: draft.chatId,
			acceptedAt,
			aiInputTokens: listUsage.inputTokens ?? null,
			aiOutputTokens: listUsage.outputTokens ?? null,
			aiRequestId: itemizerResult?.requestId ?? null
		});
		emit('nutrilist.saved', { logId, items: enrichedItems });
		await repos.logs.markAccepted(logId, acceptedAt);
		emit('nutrilog.saved', { logId, items: draft.items, status: 'accepted' });
		draftLogs.delete(logId);
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

function buildItemizerSeed(items = []) {
	return items.map((item) => {
		const rawAmount = typeof item.grams === 'number' ? item.grams : Number(item.amount ?? 0);
		const amount = Number.isNaN(rawAmount) ? 0 : rawAmount;
		return {
			item: item.label ?? item.item ?? 'Unknown item',
			unit: item.unit ?? 'g',
			amount,
			noom_color: (item.color ?? item.noom_color ?? 'yellow').toLowerCase()
		};
	});
}

function mergeItemizerItems(draftItems = [], enrichedItems = []) {
	if (!Array.isArray(enrichedItems) || !enrichedItems.length) {
		return draftItems;
	}
	return enrichedItems.map((item, index) => {
		const source = draftItems[index] ?? draftItems[0] ?? {};
		const mergedId = source.id ?? item.id ?? item.uuid ?? crypto.randomUUID();
		const mergedLabel = item.label ?? item.item ?? source.label ?? 'Unknown item';
		const mergedColor = item.color ?? item.noom_color ?? source.color ?? 'yellow';
		const gramsCandidate =
			typeof item.grams === 'number'
				? item.grams
				: typeof source.grams === 'number'
					? source.grams
					: null;
		return {
			...item,
			id: mergedId,
			uuid: mergedId,
			label: mergedLabel,
			color: mergedColor,
			grams: gramsCandidate
		};
	});
}
