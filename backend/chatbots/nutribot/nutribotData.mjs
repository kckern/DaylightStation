import { loadFile, saveFile } from '../../lib/io.mjs';

function ensureArray(value) {
	if (!value) {
		return [];
	}
	if (Array.isArray(value)) {
		return value;
	}
	return [];
}

function readArray(key) {
	try {
		return ensureArray(loadFile(key));
	} catch (err) {
		console.error(`Failed to read nutribot data for key ${key}`, err);
		return [];
	}
}

function writeArray(key, data) {
	saveFile(key, Array.isArray(data) ? data : []);
}

function createNutrilogRepo(key) {
	return {
		async createDraft(entry) {
			const rows = readArray(key);
			const log = {
				id: entry.id,
				user: entry.user,
				bot: entry.bot,
				tenant: entry.tenant,
				status: entry.status ?? 'draft',
				text: entry.text,
				items: entry.items,
				createdAt: entry.createdAt,
				updatedAt: entry.createdAt,
				aiInputTokens: entry.aiInputTokens ?? null,
				aiOutputTokens: entry.aiOutputTokens ?? null,
				aiRequestId: entry.aiRequestId ?? null
			};
			rows.push(log);
			writeArray(key, rows);
			return log;
		},
		async markAccepted(id, acceptedAt) {
			const rows = readArray(key);
			const log = rows.find((row) => row.id === id);
			if (!log) {
				throw new Error(`nutrilog ${id} not found`);
			}
			log.status = 'accepted';
			log.acceptedAt = acceptedAt;
			log.updatedAt = acceptedAt;
			writeArray(key, rows);
			return log;
		},
		async all() {
			return readArray(key);
		}
	};
}

function createNutrilistRepo(key) {
	return {
		async saveItems({ logId, items, status, createdAt, aiInputTokens = null, aiOutputTokens = null, aiRequestId = null }) {
			const rows = readArray(key);
			const enriched = items.map((item) => ({
				logId,
				itemId: item.id,
				label: item.label,
				grams: item.grams,
				color: item.color,
				status,
				createdAt,
				aiInputTokens,
				aiOutputTokens,
				aiRequestId
			}));
			rows.push(...enriched);
			writeArray(key, rows);
			return enriched;
		},
		async markAccepted(logId, acceptedAt) {
			const rows = readArray(key);
			let updated = 0;
			rows.forEach((row) => {
				if (row.logId === logId) {
					row.status = 'accepted';
					row.acceptedAt = acceptedAt;
					updated += 1;
				}
			});
			writeArray(key, rows);
			return updated;
		},
		async all() {
			return readArray(key);
		}
	};
}

export function createRepos(config) {
	const logKey = config.nutrilogPath;
	const listKey = config.nutrilistPath;
	if (!logKey || !listKey) {
		throw new Error('nutribot data config requires nutrilogPath and nutrilistPath');
	}
	return {
		logs: createNutrilogRepo(logKey),
		list: createNutrilistRepo(listKey),
		__paths: { logKey, listKey }
	};
}

export function resetRepoFiles(config) {
	const targets = [config.nutrilogPath, config.nutrilistPath].filter(Boolean);
	targets.forEach((key) => writeArray(key, []));
}
