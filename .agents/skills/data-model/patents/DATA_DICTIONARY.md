# Data Dictionary: Patents (Google Patents Public Datasets / BigQuery)

*Last updated: 2026-04-29 — aligned with `patentsBQQueryBase` / streamer in `moongoose/fetch/patents_streamer.go` (US-only SQL, English title/abstract, no publication dedupe).*

## Purpose / Source Overview

This source ingests **granted US patent publications** from the Google-hosted BigQuery table `patents-public-data.patents.publications`. Each row is atomized into one **patent** record carrying its own metadata (publication number, grant date, title, abstract), CPC classifications (multi-valued: code + human-readable description), and **person** / **organization** edges for inventors and assignees. Data is structured from BigQuery only (no LLM extraction). The CPC code → description map is loaded at streamer startup from the public BigQuery table `patents-public-data.cpc.definition` (see "Reference Data" below).

The upstream query scans `publications` with **`WHERE p.country_code = 'US'`** (hardcoded in SQL, not a stream arg), **`grant_date`** in the current poll window, **`ORDER BY grant_date, publication_number`**, and an optional **`LIMIT`** when `maxPatents` is set. It selects **`publication_number`**, **`country_code`**, dates, **`kind_code`**, English-only **`title`** / **`title_language`** and **`abstract`** / **`abstract_language`** (subqueries over `title_localized` / `abstract_localized` with `WHERE language = 'en'`), aggregated CPC and inventor/assignee/citation lists. There is **no `QUALIFY`** deduplication in SQL and **no Go-side deduplication** of publication numbers: each BigQuery row returned for the window is processed as one publication. (In the public dataset, `publication_number` is unique per row at table scale; if upstream ever returned duplicates within a window, they would be emitted twice.)

| `Record.Source` value | Meaning |
|----------------------|---------|
| `patents` | Patent publication record and its atoms |

Poll cadence and grant-date windows are configured per stream (`pollTimeMin`, `windowDays`, required `initialGrantDateMin`). Optional: `maxPatents`, `batchSize`, `projectId`.

## Entity Types

### `patent` (patent publication)

Represents one patent publication identified by Google’s publication number (for example `US-12345678-B2`). The `patent` flavor is distinct from the generic `document` flavor used by other sources (news, EDGAR filings) so that queries can filter to patents directly.

- **Primary key:** `patent_publication_number` (strong ID on the subject entity)

### `person` (inventor)

A named inventor appearing on the publication’s harmonized inventor list.

- **Primary key:** none in source data; entity resolution uses mergeable name + disambiguation snippet (patent publication context).

### `organization` (assignee)

A named assignee from the harmonized assignee list (typically a company).

- **Primary key:** none in source data; mergeable name + snippet for resolution.

## Properties

### On `patent`

* `patent_publication_number`
  * **Definition:** Canonical publication identifier from the `publication_number` field.
  * **Examples:** `US-12345678-B2`
  * **Derivation:** BigQuery `publication_number`, copied verbatim.

* `patent_grant_date`
  * **Definition:** Grant date in `YYYY-MM-DD` (UTC calendar interpretation of the integer `grant_date`).
  * **Examples:** `2025-10-15`
  * **Derivation:** BigQuery `grant_date` (YYYYMMDD) reformatted.

* `patent_filing_date`
  * **Definition:** Application filing date in `YYYY-MM-DD`.
  * **Derivation:** BigQuery `filing_date` (YYYYMMDD) reformatted. Omitted when null.

* `patent_priority_date`
  * **Definition:** Earliest priority date claimed by the patent in `YYYY-MM-DD`.
  * **Derivation:** BigQuery `priority_date` (YYYYMMDD) reformatted. Omitted when null.

* `patent_kind_code`
  * **Definition:** Document kind code (e.g. `A1`, `B1`, `B2`, `C1`, `S`, `P`).
  * **Derivation:** BigQuery `kind_code`, copied verbatim.

* `patent_country`
  * **Definition:** WIPO country/office code identifying the issuing patent office. Two-letter ISO 3166-1 alpha-2 for national offices (`US`, `JP`, `DE`, …) plus regional/international codes (`EP` for the European Patent Office, `WO` for WIPO/PCT).
  * **Derivation:** BigQuery `country_code` on the selected row. The patents stream only ingests **`US`** (`WHERE` clause); the atom reflects the column when present, with a streamer fallback to `US` if empty.

* `title`
  * **Definition:** Title of the patent publication **when an English row exists** in `title_localized`; otherwise empty (no fallback to other languages).
  * **Examples:** “Example fusion reactor control”
  * **Derivation:** `(SELECT t.text FROM UNNEST(p.title_localized) AS t WHERE t.language = 'en' LIMIT 1)`.

* `patent_title_language`
  * **Definition:** ISO 639-1 lower-case code of the language used for the title atom (here **`en`** when English text exists).
  * **Derivation:** `(SELECT t.language FROM UNNEST(p.title_localized) AS t WHERE t.language = 'en' LIMIT 1)`. Emitted only when a title is present.

* `patent_abstract`
  * **Definition:** Abstract text **when an English row exists** in `abstract_localized`; otherwise empty. Not truncated in the current BigQuery SQL (full English text as stored).
  * **Derivation:** `(SELECT a.text FROM UNNEST(p.abstract_localized) AS a WHERE a.language = 'en' LIMIT 1)`.

* `patent_abstract_language`
  * **Definition:** ISO 639-1 lower-case code of the language used for the abstract atom (here **`en`** when English text exists).
  * **Derivation:** `(SELECT a.language FROM UNNEST(p.abstract_localized) AS a WHERE a.language = 'en' LIMIT 1)`. Emitted only when an abstract is present.

* `cpc_code` (multi-valued)
  * **Definition:** A direct CPC symbol assigned to this patent. One atom per code.
  * **Derivation:** `STRING_AGG` of `cpc.code` from unnested `cpc`, then split on `,`.
  * **Attribute `cpc_description`:** When the code exists in the in-memory CPC map (loaded at streamer startup from `patents-public-data.cpc.definition`), the human-readable taxonomy path is attached as quad attribute **`cpc_description`** on that `cpc_code` atom (kgschema quad attr id 24). Codes not present in the map emit `cpc_code` only with no attribute.

## Entity Relationships Summary

```
patent ──[has_inventor]──→ person
patent ──[has_assignee]──→ organization
patent ──[cites_patent]──→ patent           (other publications cited as prior art)
patent (multi-valued `cpc_code`; optional `cpc_description` quad attribute per code)
```

The `patent` subject's primary citation text is always the canonical Google
Patents URL: `https://patents.google.com/patent/<UNHYPHENATED_PUBNUM>` (Google
Patents URLs require the publication number with hyphens removed — e.g.
`US12433179B2`, `JPH01160014U`). The same form is used for `cites_patent` target
citations.

Inventor and assignee names come from `STRING_AGG` lists on `inventor_harmonized` and `assignee_harmonized`, split on `;` after export.

## Reference Data

### CPC code → description mapping

The streamer needs a CPC code → human-readable description map to populate
the `cpc_description` quad attributes on `cpc_code` atoms. It hydrates the map by querying the public
BigQuery table **`patents-public-data.cpc.definition`** — the same project /
credentials already used to scan `patents-public-data.patents.publications`.
The query is hardcoded inside the streamer (`cpcTaxonomySQL` in
`patents_streamer.go`).

The map is **refreshed at the start of every polling cycle** so that newly
published CPC codes (the EPO updates the taxonomy a few times per year) are
picked up without requiring a streamer restart. If a refresh fails due to a
transient BQ outage and a previous successful load is cached, the streamer
logs a warning and continues with the cached map for that cycle; if the
first-ever load fails (no cache yet), the cycle is skipped without advancing
the checkpoint. Either way, no grant_date window is silently lost.

Codes referenced by patents but absent from the loaded map emit
`cpc_code` only, without a `cpc_description` attribute. The streamer never fails on
missing codes — gaps in the taxonomy are tolerated and reported only by
the absence of descriptions in the output.

### How the description query works

CPC is a tree: each symbol stores its own short title fragment in
`titlePart` plus a `parents` array listing every ancestor up to the root
(e.g. `H05H 1/02` → `H05H 1/00` → `H05H` → `H05` → `H`). To produce a
useful, *self-contained* description for any one code, the query walks
that ancestor chain for every leaf and concatenates each ancestor's
`titlePart` into a single root → leaf path string. So `H05H 1/02` becomes
something like *"PHYSICS > NUCLEAR PHYSICS > Plasma technique >
Generating plasma > Glow discharges"* rather than just *"Glow
discharges"*. Each patent gets one description per code without the
streamer needing the rest of the taxonomy at atomization time.

The mechanics:

1. Compute a normalized `sym_key` (whitespace stripped) for each row so
   ancestor lookups are robust to spacing differences (`H05H 1/02` vs
   `H05H1/02`).
2. For each leaf, build an ordered `path_keys` array of normalized
   ancestor keys, root-first, ending with the leaf itself.
3. Unnest `path_keys` so each (leaf, ancestor, position) is one row.
4. Join back to the definition table to recover each ancestor's title
   fragment and group on the leaf, ordering by position so the output
   reads from root to leaf.

The streamer consumes the `code` and `description` columns; `parent` is
informational and currently retained on the in-memory `CPCNode` but not
emitted as an atom.

See `cpcTaxonomySQL` in `moongoose/fetch/patents_streamer.go` for the
exact BigQuery query.

Notes:

- The whitespace-stripped `sym_key` is only used internally as the JOIN
  key between leaves and ancestors. The emitted `code` keeps its original
  spacing because patents publications retain it too (e.g. `G21B 1/00`,
  not `G21B1/00`); the streamer matches against codes-as-published.
- `ARRAY_TO_STRING(titlePart, ' ')` collapses CPC's multi-segment node
  titles into a single sentence per ancestor before they're joined with
  `> ` separators.
- `NULLIF(..., '')` filters empty fragments so trailing or leading
  separators don't leak into the final description.
