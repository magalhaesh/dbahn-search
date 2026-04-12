#!/usr/bin/env node

import {createClient} from 'db-vendo-client';
import {profile as dbnavProfile} from 'db-vendo-client/p/dbnav/index.js';
import {data as loyaltyCards} from 'db-vendo-client/format/loyalty-cards.js';
import {styleText as _styleText} from 'node:util';

const styleText = _styleText || ((_, s) => s);
const client = createClient(dbnavProfile, 'dbahn-search');

// --- Argument parsing ---

const args = process.argv.slice(2);
const flags = {};
const positional = [];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

for (let i = 0; i < args.length; i++) {
	if (args[i] === '--results' && args[i + 1]) {
		flags.results = parseInt(args[i + 1], 10);
		i++;
	} else if (args[i] === '--transfers' && args[i + 1]) {
		flags.transfers = parseInt(args[i + 1], 10);
		i++;
	} else if (args[i] === '--bestprice') {
		flags.bestprice = true;
	} else if (args[i] === '--first-class') {
		flags.firstClass = true;
	} else if (args[i] === '--bahncard' && args[i + 1]) {
		flags.bahncard = parseInt(args[i + 1], 10);
		i++;
	} else if (args[i] === '--deutschlandticket') {
		flags.deutschlandticket = true;
	} else if (args[i] === '--json') {
		flags.json = true;
	} else if (args[i] === '--cheapest') {
		flags.cheapest = true;
		// Peek at next 1-2 args for date range
		if (args[i + 1] && (DATE_RE.test(args[i + 1]) || MONTH_RE.test(args[i + 1]))) {
			flags.cheapestStart = args[i + 1];
			i++;
			if (args[i + 1] && DATE_RE.test(args[i + 1])) {
				flags.cheapestEnd = args[i + 1];
				i++;
			}
		}
	} else if (args[i] === '--help' || args[i] === '-h') {
		printUsage();
		process.exit(0);
	} else {
		positional.push(args[i]);
	}
}

if (positional.length < 2) {
	printUsage();
	process.exit(1);
}

const [fromQuery, toQuery, ...datetimeParts] = positional;
const datetimeStr = datetimeParts.join(' ') || null;

function printUsage() {
	console.log(`Usage: dbahn-search <from> <to> [datetime] [options]

Arguments:
  from          Origin station (e.g. "Berlin Hbf")
  to            Destination station (e.g. "Hamburg Hbf")
  datetime      Departure date/time (default: now)
                Formats: "2026-03-10 10:00", "2026-03-10", "10:00"

Options:
  --results N      Number of results (default: 5)
  --bestprice      Find cheapest journeys across the day
  --cheapest [start] [end]
                   Find cheapest day in a date range
                   "2026-04-14 2026-04-28"  explicit range
                   "2026-04-14"             7 days from date
                   "2026-04"                full month
                   (no args)                next 7 days
  --first-class    Search first class prices
  --transfers N    Maximum transfers
  --bahncard N     Apply BahnCard discount (25, 50, or 100)
  --deutschlandticket  Show prices with Deutschlandticket
  --json           Output raw JSON
  -h, --help       Show this help

Useful? https://ko-fi.com/magalhaesh`);
}

// --- Date parsing ---

function parseDatetime(str) {
	if (!str) return new Date();

	// Time only: "10:00" or "10:30"
	if (/^\d{1,2}:\d{2}$/.test(str)) {
		const today = new Date();
		const [h, m] = str.split(':').map(Number);
		today.setHours(h, m, 0, 0);
		return today;
	}

	// Date only: "2026-03-10"
	if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
		return new Date(str + 'T00:00:00');
	}

	// Full: "2026-03-10 10:00"
	const d = new Date(str.replace(' ', 'T'));
	if (isNaN(d.getTime())) {
		console.error(`Error: Invalid date/time "${str}"`);
		process.exit(1);
	}
	return d;
}

// --- Cheapest day: date range ---

function parseCheapestRange(flags) {
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	let startDate, endDate;

	if (!flags.cheapestStart) {
		// No args: next 7 days
		startDate = new Date(today);
		endDate = new Date(today);
		endDate.setDate(endDate.getDate() + 6);
	} else if (MONTH_RE.test(flags.cheapestStart)) {
		// Month format: "2026-04"
		const [year, month] = flags.cheapestStart.split('-').map(Number);
		startDate = new Date(year, month - 1, 1);
		endDate = new Date(year, month, 0); // last day of month
	} else if (flags.cheapestEnd) {
		// Explicit range: "2026-04-14 2026-04-28"
		startDate = new Date(flags.cheapestStart + 'T00:00:00');
		endDate = new Date(flags.cheapestEnd + 'T00:00:00');
	} else {
		// Single date: 7 days from that date
		startDate = new Date(flags.cheapestStart + 'T00:00:00');
		endDate = new Date(startDate);
		endDate.setDate(endDate.getDate() + 6);
	}

	if (endDate < startDate) {
		console.error('Error: End date must be after start date.');
		process.exit(1);
	}

	const days = Math.round((endDate - startDate) / 86400000) + 1;
	if (days > 31) {
		console.error('Error: Maximum range is 31 days. Try a narrower range.');
		process.exit(1);
	}

	// Skip past dates
	if (startDate < today) {
		startDate = new Date(today);
	}
	if (endDate < today) {
		console.error('Error: All dates in range are in the past.');
		process.exit(1);
	}

	return {startDate, endDate};
}

function generateDateRange(startDate, endDate) {
	const dates = [];
	const current = new Date(startDate);
	const pad = n => String(n).padStart(2, '0');
	while (current <= endDate) {
		dates.push(`${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(current.getDate())}`);
		current.setDate(current.getDate() + 1);
	}
	return dates;
}

// --- Cheapest day: scanning ---

async function scanCheapestDays(fromId, toId, dates, opts) {
	const results = [];
	const batchSize = 5;
	const showProgress = process.stderr.isTTY;

	for (let i = 0; i < dates.length; i += batchSize) {
		const batch = dates.slice(i, i + batchSize);
		const promises = batch.map(async (date) => {
			try {
				const dayOpts = {
					...opts,
					departure: new Date(date + 'T00:00:00'),
					bestprice: true,
					results: 1,
				};
				let res = await client.journeys(fromId, toId, dayOpts);
				// bestprice can return 0 results with some flag combos (e.g. Deutschlandticket)
				// Fall back to normal search and pick cheapest
				if (!res.journeys?.length) {
					delete dayOpts.bestprice;
					dayOpts.results = 5;
					res = await client.journeys(fromId, toId, dayOpts);
				}
				const journeys = res.journeys || [];
				const journey = journeys
					.filter(j => j.price?.amount != null)
					.sort((a, b) => a.price.amount - b.price.amount)[0] || journeys[0] || null;
				return {
					date,
					journey,
					price: journey?.price?.amount ?? null,
					error: false,
				};
			} catch {
				return {date, journey: null, price: null, error: true};
			}
		});
		const batchResults = await Promise.all(promises);
		results.push(...batchResults);

		if (showProgress) {
			const done = Math.min(i + batchSize, dates.length);
			const filled = Math.round((done / dates.length) * 20);
			const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
			process.stderr.write(`\rScanning... ${bar} ${done}/${dates.length}`);
		}
	}

	if (showProgress) {
		process.stderr.write('\r' + ' '.repeat(50) + '\r');
	}

	return results;
}

// --- Cheapest day: formatting ---

function formatCheapestResults(fromName, toName, results, fromBahnDe, toBahnDe) {
	const withPrices = results.filter(r => r.price !== null);
	const sorted = [
		...withPrices.sort((a, b) => a.price - b.price),
		...results.filter(r => r.price === null),
	];

	if (withPrices.length === 0) {
		console.error('No prices found for any day in range.');
		process.exit(1);
	}

	// Color thresholds (percentiles of prices that exist)
	const prices = withPrices.map(r => r.price);
	const p25 = prices[Math.floor(prices.length * 0.25)];
	const p75 = prices[Math.floor(prices.length * 0.75)];
	const cheapest = prices[0];

	// Date range header
	const firstDate = new Date(results[0].date + 'T00:00:00');
	const lastDate = new Date(results[results.length - 1].date + 'T00:00:00');
	const rangeStr = formatDateRange(firstDate, lastDate);

	console.log(`${fromName} -> ${toName}  ·  cheapest days  ·  ${rangeStr}`);
	console.log('─'.repeat(60));
	console.log();

	for (const r of sorted) {
		const d = new Date(r.date + 'T00:00:00');
		const dayStr = d.toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short'});

		if (r.price === null) {
			const reason = r.error ? '(error)' : '';
			const line = `     ${dayStr.padEnd(14)}  --  ${reason}`;
			console.log(styleText('dim', line));
			continue;
		}

		const isCheapest = r.price === cheapest;
		const star = isCheapest ? '  ★' : '   ';
		const priceStr = `${r.price.toFixed(2)} EUR`;

		// Journey details
		const j = r.journey;
		const trainProduct = j.legs
			.filter(l => l.line)
			.map(l => l.line.productName || l.line.product || '')
			.find(p => p) || '';
		const depTime = formatTime(j.legs[0].departure || j.legs[0].plannedDeparture);
		const duration = formatDuration(j);

		const detailStr = `${trainProduct.padEnd(4)} dep ${depTime}   ${duration}`;
		const line = `${star}  ${dayStr.padEnd(14)}${priceStr.padStart(10)}   ${detailStr}`;

		// Color based on percentile
		if (isCheapest) {
			console.log(styleText('bold', styleText('green', line)));
		} else if (r.price <= p25) {
			console.log(styleText('green', line));
		} else if (r.price >= p75) {
			console.log(styleText('yellow', line));
		} else {
			console.log(line);
		}
	}

	// Summary
	console.log();
	console.log('─'.repeat(60));
	const cheapestDay = sorted[0];
	const cheapestDate = new Date(cheapestDay.date + 'T00:00:00');
	const cheapestDayStr = cheapestDate.toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short'});
	console.log(`${results.length} days scanned. Cheapest: ${cheapestDay.price.toFixed(2)} EUR on ${cheapestDayStr}.`);

	// Booking URL for cheapest day
	if (fromBahnDe && toBahnDe && cheapestDay.journey) {
		const depIso = cheapestDay.journey.legs[0].departure || cheapestDay.journey.legs[0].plannedDeparture;
		console.log(buildBookingUrl(fromBahnDe, toBahnDe, depIso));
	}
}

function formatDateRange(start, end) {
	const sMonth = start.toLocaleDateString('en-US', {month: 'short'});
	const eMonth = end.toLocaleDateString('en-US', {month: 'short'});
	const sDay = start.getDate();
	const eDay = end.getDate();
	const eYear = end.getFullYear();
	if (sMonth === eMonth) {
		return `${sDay} - ${eDay} ${sMonth} ${eYear}`;
	}
	return `${sDay} ${sMonth} - ${eDay} ${eMonth} ${eYear}`;
}

// --- Station resolution ---

async function resolveStation(query) {
	const results = await client.locations(query, {results: 10});
	const stops = results.filter(r => r.type === 'stop' || r.type === 'station');
	if (stops.length === 0) {
		console.error(`Error: Station not found: "${query}"`);
		console.error('Try a more specific name (e.g. "Berlin Hbf" instead of "Berlin")');
		process.exit(1);
	}
	const hbf = stops.find(s => s.name && /Hbf|Hauptbahnhof/i.test(s.name));
	return hbf || stops[0];
}

async function resolveBahnDeStation(query) {
	const url = `https://www.bahn.de/web/api/reiseloesung/orte?suchbegriff=${encodeURIComponent(query)}&typ=ALL&limit=5`;
	const res = await fetch(url);
	if (!res.ok) return null;
	const data = await res.json();
	const stations = data.filter(s => s.type === 'ST');
	if (stations.length === 0) return null;
	const hbf = stations.find(s => /Hbf|Hauptbahnhof/i.test(s.name));
	return hbf || stations[0];
}

// --- Formatting ---

function formatDuration(journey) {
	const firstLeg = journey.legs[0];
	const lastLeg = journey.legs[journey.legs.length - 1];
	const dep = new Date(firstLeg.departure || firstLeg.plannedDeparture);
	const arr = new Date(lastLeg.arrival || lastLeg.plannedArrival);
	const mins = Math.round((arr - dep) / 60000);
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	return `${h}h ${String(m).padStart(2, '0')}m`;
}

function formatTime(isoStr) {
	if (!isoStr) return '??:??';
	const d = new Date(isoStr);
	return d.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit', hour12: false});
}

function getTrainTypes(journey) {
	return journey.legs
		.filter(leg => !leg.walking && leg.line)
		.map(leg => leg.line.name || leg.line.productName || leg.line.product)
		.join(' > ');
}

function getTransferCount(journey) {
	return journey.legs.filter(l => !l.walking && l.line).length - 1;
}

function formatPrice(journey) {
	if (!journey.price) return null;
	if (journey.price.hint) {
		return `${journey.price.amount.toFixed(2)} EUR (${journey.price.hint})`;
	}
	return `${journey.price.amount.toFixed(2)} EUR`;
}

function toLocalIso(date) {
	const d = new Date(date);
	const pad = n => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function buildBookingUrl(fromBahnDe, toBahnDe, departureIso) {
	const hd = toLocalIso(departureIso);
	const so = encodeURIComponent(fromBahnDe.name);
	const zo = encodeURIComponent(toBahnDe.name);
	const soid = encodeURIComponent(fromBahnDe.id);
	const zoid = encodeURIComponent(toBahnDe.id);
	return `https://www.bahn.de/buchung/fahrplan/suche#sts=true&so=${so}&zo=${zo}&kl=2&soid=${soid}&zoid=${zoid}&sot=ST&zot=ST&soei=${fromBahnDe.extId}&zoei=${toBahnDe.extId}&hd=${hd}&hza=D&ar=false&s=true&d=false&hz=%5B%5D&fm=false&bp=false`;
}


function formatDate(date) {
	return date.toLocaleDateString('en-US', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
	});
}

// --- Main ---

async function main() {
	const [from, to, fromBahnDe, toBahnDe] = await Promise.all([
		resolveStation(fromQuery),
		resolveStation(toQuery),
		resolveBahnDeStation(fromQuery),
		resolveBahnDeStation(toQuery),
	]);

	// --- Cheapest day mode ---
	if (flags.cheapest) {
		if (datetimeStr) {
			console.error('Error: Cannot combine --cheapest with a specific departure time.');
			process.exit(1);
		}

		const {startDate, endDate} = parseCheapestRange(flags);
		const dates = generateDateRange(startDate, endDate);

		const opts = {
			firstClass: flags.firstClass || false,
			language: 'en',
		};
		if (flags.transfers !== undefined) opts.transfers = flags.transfers;
		if (flags.bahncard) {
			opts.loyaltyCard = {
				type: loyaltyCards.BAHNCARD,
				discount: flags.bahncard,
				class: flags.firstClass ? 1 : 2,
			};
		}
		if (flags.deutschlandticket) opts.deutschlandTicketDiscount = true;

		const results = await scanCheapestDays(from.id, to.id, dates, opts);

		if (flags.json) {
			const jsonOut = {
				from: from.name,
				to: to.name,
				range: {start: dates[0], end: dates[dates.length - 1]},
				days: results.map(r => ({
					date: r.date,
					price: r.price,
					currency: r.price !== null ? 'EUR' : null,
					departure: r.journey ? formatTime(r.journey.legs[0].departure || r.journey.legs[0].plannedDeparture) : null,
					train: r.journey ? getTrainTypes(r.journey) : null,
					duration_min: r.journey ? Math.round((new Date(r.journey.legs[r.journey.legs.length - 1].arrival || r.journey.legs[r.journey.legs.length - 1].plannedArrival) - new Date(r.journey.legs[0].departure || r.journey.legs[0].plannedDeparture)) / 60000) : null,
					error: r.error,
				})),
			};
			console.log(JSON.stringify(jsonOut, null, 2));
			return;
		}

		formatCheapestResults(from.name, to.name, results, fromBahnDe, toBahnDe);
		return;
	}

	// --- Normal search mode ---
	const departure = parseDatetime(datetimeStr);

	const opts = {
		departure,
		results: flags.results || 5,
		bestprice: flags.bestprice || false,
		firstClass: flags.firstClass || false,
		language: 'en',
	};
	if (flags.transfers !== undefined) {
		opts.transfers = flags.transfers;
	}
	if (flags.bahncard) {
		opts.loyaltyCard = {
			type: loyaltyCards.BAHNCARD,
			discount: flags.bahncard,
			class: flags.firstClass ? 1 : 2,
		};
	}
	if (flags.deutschlandticket) {
		opts.deutschlandTicketDiscount = true;
	}

	const res = await client.journeys(from.id, to.id, opts);

	if (!res.journeys || res.journeys.length === 0) {
		console.error('No journeys found. Try a different date/time or check station names.');
		process.exit(1);
	}

	const maxResults = flags.results || (flags.bestprice ? 10 : 5);
	const journeys = res.journeys.slice(0, maxResults);

	if (flags.json) {
		console.log(JSON.stringify(journeys, null, 2));
		return;
	}

	// Formatted output
	console.log(`${from.name} -> ${to.name}  ·  ${formatDate(departure)}`);
	console.log('─'.repeat(60));

	for (let i = 0; i < journeys.length; i++) {
		const j = journeys[i];
		const firstLeg = j.legs[0];
		const lastLeg = j.legs[j.legs.length - 1];
		const depTime = formatTime(firstLeg.departure || firstLeg.plannedDeparture);
		const arrTime = formatTime(lastLeg.arrival || lastLeg.plannedArrival);
		const duration = formatDuration(j);
		const transfers = getTransferCount(j);
		const transferStr = transfers === 0 ? 'direct' : `${transfers} transfer${transfers > 1 ? 's' : ''}`;
		const trains = getTrainTypes(j);
		const price = formatPrice(j);
		const depIso = firstLeg.departure || firstLeg.plannedDeparture;
		const url = fromBahnDe && toBahnDe
			? buildBookingUrl(fromBahnDe, toBahnDe, depIso)
			: null;
		console.log();
		console.log(` #${i + 1}  ${depTime} -> ${arrTime}  (${duration})  ·  ${transferStr}  ·  ${trains}`);
		if (price) console.log(`     Price: ${price}`);
		if (url) console.log(`     ${url}`);
	}

	console.log();
	console.log('─'.repeat(60));
	const total = res.journeys.length;
	const shown = journeys.length;
	const countMsg = total > shown ? `${shown} of ${total} journeys shown` : `${shown} journeys found`;
	console.log(`${countMsg}. Book on bahn.de for exact fares.`);
}

main().catch(err => {
	console.error(`Error: ${err.message || err}`);
	process.exit(1);
});
