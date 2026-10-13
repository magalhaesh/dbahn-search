# dbahn-search

CLI tool for searching Deutsche Bahn train journeys. Built on [db-vendo-client](https://github.com/public-transport/db-vendo-client), the current library for DB's Vendo/Movas API.

## Install

```bash
npm install -g dbahn-search
```

Or run directly with npx:

```bash
npx dbahn-search "Berlin Hbf" "Hamburg Hbf"
```

## Usage

```bash
dbahn-search <from> <to> [datetime] [options]
```

### Examples

```bash
# Search for trains departing now
dbahn-search "Berlin Hbf" "Hamburg Hbf"

# Specific date and time
dbahn-search "Berlin Hbf" "München Hbf" "2026-04-20 10:00"

# Time only (uses today's date)
dbahn-search "Frankfurt Hbf" "Köln Hbf" "14:30"

# Find cheapest journeys across the day
dbahn-search "Berlin Hbf" "München Hbf" "2026-04-20" --bestprice

# With BahnCard 50 discount
dbahn-search "Berlin Hbf" "Hamburg Hbf" --bahncard 50

# With Deutschlandticket
dbahn-search "Berlin Hbf" "Dresden Hbf" --deutschlandticket

# Combine discounts
dbahn-search "Berlin Hbf" "München Hbf" "2026-04-20" --bahncard 50 --deutschlandticket --bestprice

# Limit transfers
dbahn-search "Marburg (Lahn)" "Berlin Hbf" --transfers 1

# JSON output (for scripting)
dbahn-search "Berlin Hbf" "Hamburg Hbf" --json
```

### Find the cheapest day

```bash
# Cheapest day in the next 7 days
dbahn-search "Berlin Hbf" "München Hbf" --cheapest

# Cheapest day in a specific range
dbahn-search "Berlin Hbf" "München Hbf" --cheapest 2026-04-14 2026-04-28

# Cheapest day in a full month
dbahn-search "Berlin Hbf" "Hamburg Hbf" --cheapest 2026-05

# Combine with BahnCard and Deutschlandticket
dbahn-search "Berlin Hbf" "München Hbf" --cheapest --bahncard 50 --deutschlandticket
```

### Options

| Flag | Description |
|------|-------------|
| `--results N` | Number of results (default: 5) |
| `--bestprice` | Find cheapest journeys across the day |
| `--cheapest [start] [end]` | Find cheapest day in a date range |
| `--first-class` | Search first class prices |
| `--transfers N` | Maximum number of transfers |
| `--bahncard N` | Apply BahnCard discount (25, 50, or 100) |
| `--deutschlandticket` | Show prices with Deutschlandticket |
| `--no-cache` | Skip cached results (still writes to cache) |
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

## Caching

Results are cached locally in `~/.cache/dbahn-search/` (or `$XDG_CACHE_HOME/dbahn-search/`):

- **Station lookups** are cached for 6 months (station IDs rarely change)
- **Journey prices** are cached for 4 hours (prices within 3 days of departure are never cached)
- **Price history** is logged to `prices.jsonl` on every API fetch, building a passive price database

Use `--no-cache` to bypass cached results (fresh API calls are still cached for future use).

## How it works

dbahn-search queries Deutsche Bahn's current APIs via [db-vendo-client](https://github.com/public-transport/db-vendo-client). Station names are resolved using both the DB Navigator API and bahn.de's location API (for generating accurate booking links).

Prices shown are Sparpreis/Super Sparpreis fares when available. For exact fares and booking, follow the provided bahn.de links.

## Support

If you find this useful, consider [buying me a coffee](https://ko-fi.com/magalhaesh).

## License

MIT
