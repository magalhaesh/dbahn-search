import {describe, it, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCache, SIX_MONTHS, FOUR_HOURS} from '../cache.mjs';

function makeTempDir() {
	return mkdtempSync(join(tmpdir(), 'dbahn-cache-test-'));
}

describe('createCache', () => {
	let dir;

	beforeEach(() => {
		dir = makeTempDir();
	});

	it('returns null for unknown keys', () => {
		const cache = createCache({dir});
		assert.equal(cache.get('nonexistent'), null);
	});

	it('stores and retrieves values', () => {
		const cache = createCache({dir});
		cache.set('key1', {name: 'Berlin Hbf'}, SIX_MONTHS);
		assert.deepEqual(cache.get('key1'), {name: 'Berlin Hbf'});
	});

	it('returns null for expired entries', () => {
		const cache = createCache({dir});
		// Set with TTL of 1ms
		cache.set('key1', 'value', 1);
		// Wait a tiny bit for expiry
		const start = Date.now();
		while (Date.now() - start < 5) { /* busy wait */ }
		assert.equal(cache.get('key1'), null);
	});

	it('persists data across instances via flush', () => {
		const cache1 = createCache({dir});
		cache1.set('station:berlin hbf', {id: '8011160', name: 'Berlin Hbf'}, SIX_MONTHS);
		cache1.flush();

		// New instance reads persisted data
		const cache2 = createCache({dir});
		assert.deepEqual(cache2.get('station:berlin hbf'), {id: '8011160', name: 'Berlin Hbf'});
	});

	it('prunes expired entries on flush', () => {
		const cache = createCache({dir});
		cache.set('alive', 'yes', SIX_MONTHS);
		cache.set('dead', 'no', 1);

		// Wait for expiry
		const start = Date.now();
		while (Date.now() - start < 5) { /* busy wait */ }

		cache.flush();

		const raw = JSON.parse(readFileSync(join(dir, 'cache.json'), 'utf8'));
		assert.ok(raw.alive, 'alive key should exist');
		assert.equal(raw.dead, undefined, 'dead key should be pruned');
	});

	it('handles corrupt cache.json gracefully', () => {
		writeFileSync(join(dir, 'cache.json'), 'NOT VALID JSON{{{', 'utf8');
		const cache = createCache({dir});
		assert.equal(cache.get('anything'), null);
		// Should still be able to set and flush
		cache.set('key', 'value', SIX_MONTHS);
		cache.flush();
		const raw = JSON.parse(readFileSync(join(dir, 'cache.json'), 'utf8'));
		assert.equal(raw.key.v, 'value');
	});

	it('handles missing cache dir gracefully on flush', () => {
		const nonexistent = join(dir, 'sub', 'deep');
		const cache = createCache({dir: nonexistent});
		cache.set('key', 'value', SIX_MONTHS);
		// Should create dir recursively
		cache.flush();
		const raw = JSON.parse(readFileSync(join(nonexistent, 'cache.json'), 'utf8'));
		assert.equal(raw.key.v, 'value');
	});

	it('writes cache atomically (via tmp file + rename)', () => {
		const cache = createCache({dir});
		cache.set('k', 'v', SIX_MONTHS);
		cache.flush();
		// cache.json should exist, .cache.json.tmp should not
		const cacheContent = readFileSync(join(dir, 'cache.json'), 'utf8');
		assert.ok(cacheContent.includes('"k"'));
		let tmpExists = false;
		try {
			readFileSync(join(dir, '.cache.json.tmp'), 'utf8');
			tmpExists = true;
		} catch { /* expected */ }
		assert.equal(tmpExists, false, 'tmp file should not remain after flush');
	});

	it('noRead mode returns null for cached values but still writes', () => {
		// Pre-populate cache
		const cache1 = createCache({dir});
		cache1.set('key', 'old-value', SIX_MONTHS);
		cache1.flush();

		// Open with noRead
		const cache2 = createCache({dir, noRead: true});
		assert.equal(cache2.get('key'), null, 'noRead should skip reads');
		cache2.set('new-key', 'new-value', SIX_MONTHS);
		cache2.flush();

		// New normal instance should see the new key (old key is gone since noRead started fresh)
		const cache3 = createCache({dir});
		assert.equal(cache3.get('new-key'), 'new-value');
	});
});

describe('logPrices', () => {
	let dir;

	beforeEach(() => {
		dir = makeTempDir();
	});

	it('appends NDJSON entries to prices.jsonl', () => {
		const cache = createCache({dir});
		const entries = [
			{ts: 1000, from: '8011160', to: '8000261', price: 23.90},
			{ts: 1001, from: '8011160', to: '8000261', price: 27.90},
		];
		cache.logPrices(entries);

		const content = readFileSync(join(dir, 'prices.jsonl'), 'utf8');
		const lines = content.trim().split('\n');
		assert.equal(lines.length, 2);
		assert.deepEqual(JSON.parse(lines[0]), entries[0]);
		assert.deepEqual(JSON.parse(lines[1]), entries[1]);
	});

	it('appends to existing file', () => {
		const cache = createCache({dir});
		cache.logPrices([{ts: 1, price: 10}]);
		cache.logPrices([{ts: 2, price: 20}]);

		const content = readFileSync(join(dir, 'prices.jsonl'), 'utf8');
		const lines = content.trim().split('\n');
		assert.equal(lines.length, 2);
	});

	it('skips empty entries array silently', () => {
		const cache = createCache({dir});
		cache.logPrices([]);
		let exists = false;
		try {
			readFileSync(join(dir, 'prices.jsonl'), 'utf8');
			exists = true;
		} catch { /* expected */ }
		assert.equal(exists, false, 'should not create file for empty entries');
	});
});
