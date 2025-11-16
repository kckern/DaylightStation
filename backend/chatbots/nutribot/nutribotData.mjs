import crypto from 'node:crypto';
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

function formatLogItems(items) {
	return (items ?? []).map((item) => ({
		id: item.id,
		label: item.label,
		grams: item.grams,
		color: item.color
	}));
}

function baseLogEntry(entry) {
	const log = {
		id: entry.id,
		user: entry.user,
		bot: entry.bot,
		tenant: entry.tenant,
		status: entry.status ?? 'draft',
		text: entry.text,
		items: formatLogItems(entry.items),
		createdAt: entry.createdAt,
		updatedAt: entry.updatedAt ?? entry.createdAt,
		aiInputTokens: entry.aiInputTokens ?? null,
		aiOutputTokens: entry.aiOutputTokens ?? null,
		aiRequestId: entry.aiRequestId ?? null
	};
	if (entry.acceptedAt) {
		log.acceptedAt = entry.acceptedAt;
	}
	return log;
}

function createNutrilogRepo(key) {
	return {
		async createDraft(entry) {
			const rows = readArray(key);
			const log = baseLogEntry(entry);
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

function normalizeNumber(value) {
	if (typeof value === 'number') {
		return Number.isNaN(value) ? null : value;
	}
	if (typeof value === 'string' && value.trim().length) {
		const parsed = Number(value);
		return Number.isNaN(parsed) ? null : parsed;
	}
	return null;
}

function normalizeColor(value, fallback = 'yellow') {
	if (typeof value === 'string' && value.trim()) {
		return value.trim().toLowerCase();
	}
	return fallback;
}

function formatDate(value) {
	if (!value) {
		return null;
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
			return trimmed;
		}
		const parsed = Date.parse(trimmed);
		if (!Number.isNaN(parsed)) {
			return new Date(parsed).toISOString().slice(0, 10);
		}
		return null;
	}
	const parsed = Date.parse(value);
	if (Number.isNaN(parsed)) {
		return null;
	}
	return new Date(parsed).toISOString().slice(0, 10);
}

function normalizeListItem(logId, item, meta) {
	const gramsValue = typeof item.grams === 'number' ? item.grams : normalizeNumber(item.amount);
	const safeGrams = gramsValue ?? null;
	const uuid = item.uuid ?? item.item_uuid ?? item.itemId ?? item.id ?? crypto.randomUUID();
	const label = item.label ?? item.item ?? 'Unknown item';
	const color = normalizeColor(item.noom_color ?? item.color ?? 'yellow');
	const unit = item.unit ?? (safeGrams !== null ? 'g' : null);
	const amount = normalizeNumber(item.amount ?? safeGrams);
	const date = item.date ?? meta.date ?? formatDate(meta.createdAt);
	const timeOfDay = item.timeofday ?? meta.timeOfDay ?? null;
	const record = {
		uuid,
		icon: item.icon ?? null,
		item: label,
		unit,
		amount,
		noom_color: color,
		calories: normalizeNumber(item.calories),
		fat: normalizeNumber(item.fat),
		carbs: normalizeNumber(item.carbs),
		protein: normalizeNumber(item.protein),
		fiber: normalizeNumber(item.fiber),
		sugar: normalizeNumber(item.sugar),
		sodium: normalizeNumber(item.sodium),
		cholesterol: normalizeNumber(item.cholesterol),
		chat_id: item.chat_id ?? meta.chatId ?? null,
		date,
		log_uuid: logId
	};
	if (timeOfDay) {
		record.timeofday = timeOfDay;
	}
	record.grams = safeGrams;
	record.color = color;
	record.label = label;
	record.status = meta.status;
	record.createdAt = meta.createdAt;
	record.acceptedAt = meta.acceptedAt;
	record.aiInputTokens = meta.aiInputTokens;
	record.aiOutputTokens = meta.aiOutputTokens;
	record.aiRequestId = meta.aiRequestId;
	return record;
}

function createNutrilistRepo(key) {
	return {
		async saveItems({
			logId,
			items,
			status,
			createdAt,
			acceptedAt = createdAt,
			date = null,
			timeOfDay = null,
			chatId = null,
			aiInputTokens = null,
			aiOutputTokens = null,
			aiRequestId = null
		}) {
			const rows = readArray(key);
			const meta = {
				status,
				createdAt,
				acceptedAt,
				aiInputTokens,
				aiOutputTokens,
				aiRequestId,
				date,
				timeOfDay,
				chatId
			};
			const enriched = (items ?? []).map((item) => normalizeListItem(logId, item, meta));
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
