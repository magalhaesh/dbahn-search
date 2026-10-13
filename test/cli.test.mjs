import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'dbahn-search.mjs');

function run(args, options = {}) {
	return new Promise((resolve) => {
		execFile('node', [CLI, ...args], {timeout: 30000, ...options}, (error, stdout, stderr) => {
			resolve({
				exitCode: error ? error.code ?? 1 : 0,
				stdout: stdout || '',
				stderr: stderr || '',
			});
		});
	});
}

describe('CLI basics', () => {
	it('--help exits 0 and shows usage', async () => {
		const {exitCode, stdout} = await run(['--help']);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('Usage:'), 'should show usage text');
		assert.ok(stdout.includes('--no-cache'), 'should document --no-cache');
		assert.ok(stdout.includes('--cheapest'), 'should document --cheapest');
	});

	it('missing args exits 1 and shows usage', async () => {
		const {exitCode, stdout} = await run([]);
		assert.equal(exitCode, 1);
		assert.ok(stdout.includes('Usage:'), 'should show usage on error');
	});

	it('single arg exits 1', async () => {
		const {exitCode} = await run(['Berlin Hbf']);
		assert.equal(exitCode, 1);
	});

	it('--cheapest with range > 31 days exits 1', async () => {
		const {exitCode, stderr} = await run([
			'Berlin Hbf', 'Hamburg Hbf',
			'--cheapest', '2026-05-01', '2026-06-15',
		]);
		assert.equal(exitCode, 1);
		assert.ok(stderr.includes('31 days'), 'should mention 31 day limit');
	});

	it('--cheapest with all past dates exits 1', async () => {
		const {exitCode, stderr} = await run([
			'Berlin Hbf', 'Hamburg Hbf',
			'--cheapest', '2020-01-01', '2020-01-07',
		]);
		assert.equal(exitCode, 1);
		assert.ok(stderr.includes('past'), 'should mention past dates');
	});
});

describe('CLI with API (slow)', () => {
	it('normal search returns formatted output', async () => {
		const {exitCode, stdout} = await run([
			'Berlin Hbf', 'Hamburg Hbf', '--results', '2',
		]);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('Berlin'), 'should mention origin');
		assert.ok(stdout.includes('Hamburg'), 'should mention destination');
		assert.ok(stdout.includes('#1'), 'should have at least one result');
	});

	it('--json outputs valid JSON', async () => {
		const {exitCode, stdout} = await run([
			'Berlin Hbf', 'Hamburg Hbf', '--results', '1', '--json',
		]);
		assert.equal(exitCode, 0);
		const parsed = JSON.parse(stdout);
		assert.ok(Array.isArray(parsed), 'JSON output should be an array');
		assert.ok(parsed.length > 0, 'should have at least one journey');
	});

	it('--no-cache flag is accepted', async () => {
		const {exitCode, stdout} = await run([
			'Berlin Hbf', 'Hamburg Hbf', '--results', '1', '--no-cache',
		]);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('Berlin'), 'should return results');
	});
});
