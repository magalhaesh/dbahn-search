#!/usr/bin/env node

import {createClient} from 'db-vendo-client';
import {profile as dbnavProfile} from 'db-vendo-client/p/dbnav/index.js';
import {data as loyaltyCards} from 'db-vendo-client/format/loyalty-cards.js';

const client = createClient(dbnavProfile, 'db-search-cli');

// --- Argument parsing ---

const args = process.argv.slice(2);
const flags = {};
const positional = [];

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
	console.log(`Usage: db-search <from> <to> [datetime] [options]

Arguments:
  from          Origin station (e.g. "Berlin Hbf")
  to            Destination station (e.g. "Hamburg Hbf")
  datetime      Departure date/time (default: now)
                Formats: "2026-03-10 10:00", "2026-03-10", "10:00"

Options:
  --results N      Number of results (default: 5)
  --bestprice      Find cheapest journeys across the day
  --first-class    Search first class prices
  --transfers N    Maximum transfers
  --bahncard N     Apply BahnCard discount (25, 50, or 100)
  --deutschlandticket  Show prices with Deutschlandticket
  --json           Output raw JSON
  -h, --help       Show this help`);
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
	const departure = parseDatetime(datetimeStr);

	const [from, to, fromBahnDe, toBahnDe] = await Promise.all([
		resolveStation(fromQuery),
		resolveStation(toQuery),
		resolveBahnDeStation(fromQuery),
		resolveBahnDeStation(toQuery),
	]);

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
