import {mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';

const SIX_MONTHS = 6 * 30 * 24 * 3600 * 1000;
const FOUR_HOURS = 4 * 3600 * 1000;
const THREE_DAYS = 3 * 24 * 3600 * 1000;

export {SIX_MONTHS, FOUR_HOURS, THREE_DAYS};

export function createCache(options = {}) {
	const cacheHome = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
	const dir = options.dir || join(cacheHome, 'dbahn-search');
	const noRead = options.noRead || false;

	const cacheFile = join(dir, 'cache.json');
	const tmpFile = join(dir, '.cache.json.tmp');
	const pricesFile = join(dir, 'prices.jsonl');

	let data = {};

	// Load existing cache
	if (!noRead) {
		try {
			data = JSON.parse(readFileSync(cacheFile, 'utf8'));
		} catch {
			// Missing or corrupt — start fresh
		}
	}

	function get(key) {
		if (noRead) return null;
		const entry = data[key];
		if (!entry) return null;
		if (Date.now() > entry.exp) {
			delete data[key];
			return null;
		}
		return entry.v;
	}

	function set(key, value, ttlMs) {
		data[key] = {v: value, exp: Date.now() + ttlMs};
	}

	function logPrices(entries) {
		if (!entries.length) return;
		try {
			ensureDir(dir);
			const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
			appendFileSync(pricesFile, lines, 'utf8');
		} catch {
			// Silent — price logging is best-effort
		}
	}

	function flush() {
		// Prune expired entries
		const now = Date.now();
		for (const key of Object.keys(data)) {
			if (data[key].exp <= now) delete data[key];
		}

		try {
			ensureDir(dir);
			writeFileSync(tmpFile, JSON.stringify(data), 'utf8');
			renameSync(tmpFile, cacheFile);
		} catch {
			// Silent — cache persistence is best-effort
		}
	}

	return {get, set, logPrices, flush};
}

function ensureDir(dir) {
	mkdirSync(dir, {recursive: true});
}
