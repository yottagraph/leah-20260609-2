# Data Dictionary: Finnhub Bonds (ISIN-LEI + Bond Prices)

Last updated: 2026-05-28

## Source Overview

This source combines two upstream datasets:

1. **GLEIF-ANNA ISIN-to-LEI mapping** — daily open-source file linking financial instruments (ISIN) to issuers (LEI). The published ZIP is a **full snapshot** of mappings from participating national numbering agencies (~8.7M pairs as of May 2026), refreshed daily. It is not a delta of only newly issued ISINs from the prior day.
2. **Finnhub bond prices** — end-of-day close prices from `GET /bond/price` for each ISIN in the mapping file, fetched for **yesterday UTC** each poll cycle.

The streamer uses the **diffing** pipeline (`DiffingStreamer`): each mapping pair and each ISIN price observation is stored as JSON under the raw download store, SHA-256 compared against the previous run, and only changed rows are atomized and published.

| Item | Value |
|------|--------|
| Stream source constant | `finnhubbond-source` |
| `Record.Source` | `finnhubbond` |
| GLEIF mapping API | `https://mapping.gleif.org/api/v2/isin-lei` |
| Finnhub price API | `https://finnhub.io/api/v1/bond/price` |
| Default poll cadence | 1440 min (`pollTimeMin`) |

**Data quality notes**

- GLEIF mapping coverage depends on participating NNAs; legacy ISINs outside the program may be absent.
- Finnhub `/bond/price` returns BondCandles (`c[]` close, `t[]` unix timestamps, `s` status). Status `no_data` produces no price record.
- Yield on `/bond/price` is only emitted when Finnhub returns a `y[]` array; TRACE trade-level yield is on `/bond/tick` (not ingested in v1).
- Many mapped ISINs may have no Finnhub price (non-US, non-TRACE, delisted). Failures are logged and skipped.

---

## Entity Types

### `organization`

A legal entity that **issued** a mapped security, identified by LEI from the GLEIF-ANNA CSV.

- **Subject name:** LEI string (no legal name in mapping file).
- **Strong id:** `lei` on the organization subject.
- **Resolver:** Organization flavor `NOT_MERGEABLE`; named entity `MERGEABLE` on LEI for cross-source merge with `gleif-source` entities.
- **Emitted when:** A `(LEI, ISIN)` mapping row is new or changed in the diffing pass.

### `financial_instrument`

A bond or fixed-income instrument identified by ISIN.

- **Subject name:** ISIN.
- **Strong id:** `isin`.
- **Resolver:** `MERGEABLE` on ISIN — aligns with `gleif`, `sanctions`, and EDGAR `holding_isin` resolution.
- **Emitted when:** (1) mapping rows add `issued_security` target entities, or (2) price rows publish close/yield observations.

---

## Properties

### Organization

* `lei`
  * Definition: Legal Entity Identifier (ISO 17442) of the issuer.
  * Examples: `"5493001KJTIIGC8Y1R12"`
  * Derivation: First CSV column in GLEIF ISIN-LEI mapping.

### Financial instrument

* `isin`
  * Definition: International Securities Identification Number (ISO 6166).
  * Examples: `"US0378331005"`, `"US46625HQW33"`
  * Derivation: Second CSV column in mapping; or Finnhub price query key.

* `close_price`
  * Definition: Bond close price in USD from Finnhub `/bond/price` field `c[]`.
  * Derivation: One atom per candle point in the response; timestamp from matching `t[]` entry.
  * Attribute: `price_date` (YYYY-MM-DD UTC) on each observation atom.

* `yield`
  * Definition: Bond yield when Finnhub returns field `y[]` alongside price candles.
  * Derivation: Optional; same indexing as `c[]` / `t[]`. Often absent on `/bond/price`.
  * Attribute: `price_date` on each observation atom.

---

## Relationships

* `issued_security`
  * Definition: The organization (issuer LEI) has issued the target financial instrument (ISIN).
  * Direction: `organization` → `financial_instrument`.
  * Derivation: Each GLEIF-ANNA mapping row where both LEI and ISIN are non-empty.
  * Note: Same relationship name and semantics as `gleif-source` ISIN enrichment (`buildISINAtoms`).

---

## Attributes

* `price_date`
  * Definition: UTC calendar date of the bond price observation.
  * Examples: `"2026-05-27"`
  * Derivation: From Finnhub candle timestamp `t[]`, or the configured yesterday date when timestamp missing.

---

## Pipeline Behavior

### FetchRows (single cycle)

1. Download latest GLEIF ISIN-LEI ZIP.
2. Parse CSV; emit one diffing row per `(LEI, ISIN)` pair (subject to `maxRows`).
3. Deduplicate ISINs; optionally cap with `maxIsins`.
4. Parallel Finnhub `/bond/price` for yesterday UTC (`priceWorkers`, `finnhubQPS`).
5. Emit one diffing price row per ISIN (`price-{ISIN}-{date}.json`).

### Atomization

- **Changed mapping rows:** One record per pair — organization subject + `lei` property + `issued_security` target.
- **Changed price rows:** One record per ISIN — financial_instrument subject + `isin` + `close_price` / optional `yield` atoms.

### Configuration args

| Arg | Default | Purpose |
|-----|---------|---------|
| `finnhubToken` | `$FINNHUB_TOKEN` | Required API token |
| `priceWorkers` | 16 | Parallel Finnhub workers |
| `finnhubQPS` | 10 | Client-side rate limit |
| `maxIsins` | 0 (all) | Cap price fetches for dev |
| `maxRows` | 0 (all) | Cap mapping rows emitted |
| `writeWorkers` | 8 | Diffing raw-store parallelism |
| `batchSize` | 100 | Publish batch size |
| `pollTimeMin` | 1440 | Poll interval (minutes) |

---

## Cross-Source Resolution

- **`lei`** property matches `gleif.organization.lei` — issuer orgs from this source should merge with GLEIF LEI records when both exist.
- **`isin`** property matches `financial_instrument.isin` across gleif, sanctions, EDGAR holdings.
- **`issued_security`** inverse query: find issuer org whose `issued_security` points at an ISIN instrument node.
