# db-search

CLI tool for searching Deutsche Bahn train journeys. Built on [db-vendo-client](https://github.com/public-transport/db-vendo-client), the current library for DB's Vendo/Movas API.

## Install

```bash
npm install -g db-search
```

Or run directly with npx:

```bash
npx db-search "Berlin Hbf" "Hamburg Hbf"
```

## Usage

```bash
db-search <from> <to> [datetime] [options]
```

### Examples

```bash
# Search for trains departing now
db-search "Berlin Hbf" "Hamburg Hbf"

# Specific date and time
db-search "Berlin Hbf" "München Hbf" "2026-04-20 10:00"

# Time only (uses today's date)
db-search "Frankfurt Hbf" "Köln Hbf" "14:30"

# Find cheapest journeys across the day
db-search "Berlin Hbf" "München Hbf" "2026-04-20" --bestprice

# With BahnCard 50 discount
db-search "Berlin Hbf" "Hamburg Hbf" --bahncard 50

# With Deutschlandticket
db-search "Berlin Hbf" "Dresden Hbf" --deutschlandticket

# Combine discounts
db-search "Berlin Hbf" "München Hbf" "2026-04-20" --bahncard 50 --deutschlandticket --bestprice

# Limit transfers
db-search "Marburg (Lahn)" "Berlin Hbf" --transfers 1

# JSON output (for scripting)
db-search "Berlin Hbf" "Hamburg Hbf" --json
```

### Options

| Flag | Description |
|------|-------------|
| `--results N` | Number of results (default: 5) |
| `--bestprice` | Find cheapest journeys across the day |
| `--first-class` | Search first class prices |
| `--transfers N` | Maximum number of transfers |
| `--bahncard N` | Apply BahnCard discount (25, 50, or 100) |
| `--deutschlandticket` | Show prices with Deutschlandticket |
| `--json` | Output raw JSON |
| `-h, --help` | Show help |

### Output

Each result shows departure/arrival times, duration, transfers, train types, price, and a direct booking link to bahn.de:

```
Berlin Hbf -> Hamburg Hbf  ·  Sat, 20 Apr 2026
────────────────────────────────────────────────────────────

 #1  10:02 -> 11:45  (1h 43m)  ·  direct  ·  ICE 1007
     Price: 23.90 EUR
     https://www.bahn.de/buchung/fahrplan/suche#...

 #2  11:02 -> 12:45  (1h 43m)  ·  direct  ·  ICE 1009
     Price: 27.90 EUR
     https://www.bahn.de/buchung/fahrplan/suche#...
```

## How it works

db-search queries Deutsche Bahn's current APIs via [db-vendo-client](https://github.com/public-transport/db-vendo-client). Station names are resolved using both the DB Navigator API and bahn.de's location API (for generating accurate booking links).

Prices shown are Sparpreis/Super Sparpreis fares when available. For exact fares and booking, follow the provided bahn.de links.

## License

MIT
