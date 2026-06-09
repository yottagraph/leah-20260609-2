# Data Dictionary: BLS CEW (QCEW)

## Purpose

This dictionary documents the entity types, properties, and attributes
that the BLS Quarterly Census of Employment and Wages (QCEW) source
contributes to the Lovelace knowledge graph. It is the contract between
the source and downstream consumers (ingest, query server, UI).

QCEW is a quarterly count of employment and wages reported by employers,
covering more than 95 % of US jobs. It is published by the U.S. Bureau
of Labor Statistics for every state, MSA, and county, broken out by
ownership (federal/state/local/private) and by industry (NAICS), at the
sector / 3-digit / 4-digit / 5-digit / 6-digit detail levels. The
Lovelace QCEW source ingests the published quarterly data slices —
specifically the by-area CSV slices for the United States as a whole
plus all 50 states and DC — and emits one record per area × ownership ×
industry × quarter combination.

**Pipeline:** Download → Extract → Atomize.
- Download fetches the per-area CSV slice for each (area, year, quarter)
  from `https://data.bls.gov/cew/data/api/{year}/{quarter}/area/{area_fips}.csv`.
- Extract is a pass-through (the raw CSV is the structured input).
- Atomize parses each CSV row into KG records.

**Cadence:** BLS publishes each quarter's QCEW release roughly 5–7
months after the close of the quarter (Q1 in late Aug/Sep, Q2 in late
Nov/Dec, Q3 in early Mar of the next year, Q4 in early Jun). The
streamer polls weekly; new quarters are detected and atomized when they
appear.

**Disclosure suppression.** Rows with `disclosure_code == "N"` are
withheld by BLS to protect employer confidentiality (typically when an
industry has very few establishments in an area). All numeric values on
those rows are zero. The atomizer drops "N"-disclosed rows entirely so
the KG never contains zero-valued QCEW observations that would be
mistaken for real data.

**Series identity.** A QCEW "series" is uniquely identified by the
4-tuple (area_fips, own_code, industry_code, agglvl_code). The atomizer
constructs a synthetic series id of the form
`{area_fips}.{own_code}.{industry_code}.{agglvl_code}` and emits this
as the `cew_series_id` strong id on a `cew_series` entity. `size_code`
is always `0` for the quarterly area slices ingested today (size-class
slices are an annual-only artifact and are out of scope for v1).

**Source name:** `blscew-source`

---

## Entity Types

### `cew_series`

A single QCEW time series — the unique combination of geographic area,
ownership, industry, and aggregation level — that carries quarterly
employment, wages, and establishment metrics over time.

- Primary key: `cew_series_id` (synthetic id, see above) used as the
  strong id for resolution.
- Entity resolver: named entity, NOT_MERGEABLE. The strong id is
  `cew_series_id`. The disambiguation snippet includes area title,
  ownership title, industry title, and aggregation level title.
- Source: `blscew-source`
- Examples produced: `US000.0.10.10` (US national, total ownership, all
  industries), `06000.5.31-33.55` (California, private ownership,
  Manufacturing supersector), `06037.0.5111.74` (Los Angeles County,
  total ownership, NAICS 5111 Newspaper / Periodical Publishers).

### `location`

A US geographic area (national, state, MSA, or county) for which BLS
publishes QCEW data, identified by its FIPS-based `area_fips` code.

- Primary key: `area_fips` strong id.
- Entity resolver: named entity, NOT_MERGEABLE. Strong id is
  `area_fips`. Snippet includes the area title and the area type
  (national / statewide / MSA / county).
- Source: `blscew-source`
- Examples produced: `US000` (U.S. TOTAL), `06000` (California -- Statewide),
  `06037` (Los Angeles County, California), `C1018` (Albany-Schenectady-Troy,
  NY MSA).

### `industry`

An economic activity category from the North American Industry
Classification System (NAICS), or a BLS-defined supersector that rolls
up multiple NAICS sectors.

- Primary key: `naics_code` strong id (the BLS QCEW `industry_code`,
  which can be a NAICS sector / 3-digit / 4-digit / 5-digit / 6-digit
  code, a 2-digit BLS supersector aggregate (e.g. `31-33` for
  Manufacturing), or the special aggregate `10` meaning "Total, all
  industries").
- Entity resolver: named entity, NOT_MERGEABLE. Strong id is
  `naics_code`. Snippet includes the industry title.
- Source: `blscew-source`
- Examples produced: `10` (Total, all industries), `31-33`
  (Manufacturing), `5111` (Newspaper, Periodical, Book, and Directory
  Publishers), `541` (Professional, Scientific, and Technical Services).

---

## Properties

### Identity & Metadata Properties (cew_series)

These atoms appear once per series, timestamped at the first quarter
the series is observed in the current run.

* `cew_series_id`
  * Definition: synthetic identifier for a QCEW series, built by
    joining the area, ownership, industry, and aggregation-level codes
    with dots.
  * Examples: `"US000.0.10.10"`, `"06000.5.31-33.55"`,
    `"06037.0.5111.74"`
  * Derivation: built by the atomizer from the QCEW `area_fips`,
    `own_code`, `industry_code`, and `agglvl_code` fields of each CSV
    row.

* `name`
  * Definition: human-readable label for the series, combining area,
    ownership, and industry titles.
  * Examples: `"U.S. TOTAL · Total Covered · Total, all industries"`,
    `"California · Private · Manufacturing"`
  * Derivation: built from the `area_title`, `own_title`, and
    `industry_title` fields on the CSV row.

* `area_fips`
  * Definition: BLS-assigned 5-character area identifier (FIPS-based).
    Acts as strong id on the `location` entity that the series points
    to.
  * Examples: `"US000"`, `"06000"`, `"06037"`, `"C1018"`
  * Derivation: `area_fips` field of the CSV row.

* `area_title`
  * Definition: human-readable title for the geographic area.
  * Examples: `"U.S. TOTAL"`, `"California -- Statewide"`,
    `"Los Angeles County, California"`,
    `"Albany-Schenectady-Troy, NY MSA"`
  * Derivation: `area_title` field of the CSV row.

* `ownership_code`
  * Definition: BLS one-character code identifying the ownership
    sector covered by the series.
  * Examples: `"0"` (Total Covered), `"1"` (Federal Government),
    `"2"` (State Government), `"3"` (Local Government),
    `"5"` (Private)
  * Derivation: `own_code` field of the CSV row.

* `ownership_title`
  * Definition: human-readable label for the ownership sector.
  * Examples: `"Total Covered"`, `"Federal Government"`,
    `"State Government"`, `"Local Government"`, `"Private"`
  * Derivation: `own_title` field of the CSV row.

* `naics_code`
  * Definition: industry code used by BLS — NAICS at varying levels of
    aggregation, plus BLS supersector aggregates and the special
    "Total, all industries" code `10`. Acts as strong id on the
    `industry` entity that the series points to.
  * Examples: `"10"`, `"31-33"`, `"5111"`, `"541211"`
  * Derivation: `industry_code` field of the CSV row.

* `naics_description`
  * Definition: human-readable name of the industry / supersector.
  * Examples: `"Total, all industries"`, `"Manufacturing"`,
    `"Newspaper, periodical, book and directory publishers"`
  * Derivation: `industry_title` field of the CSV row.

* `aggregation_level_code`
  * Definition: BLS two-character code describing the geographic and
    industry aggregation level the series represents (e.g. national
    total, statewide ownership × supersector, county × 6-digit NAICS).
  * Examples: `"10"` (national, by ownership × total), `"55"`
    (statewide, by ownership × supersector),
    `"74"` (county, by ownership × 5-digit NAICS),
    `"78"` (county, by ownership × 6-digit NAICS)
  * Derivation: `agglvl_code` field of the CSV row.

* `aggregation_level_title`
  * Definition: human-readable description of the aggregation level.
  * Examples: `"National, by ownership sector"`,
    `"Statewide, by ownership sector and supersector"`,
    `"County, by ownership sector and 6-digit NAICS"`
  * Derivation: `agglvl_title` field of the CSV row.

* `area_type`
  * Definition: classification of the area as one of `national`,
    `statewide`, `msa`, or `county` derived from the leading characters
    of `area_fips` and the trailing zeros pattern.
  * Examples: `"national"`, `"statewide"`, `"county"`, `"msa"`
  * Derivation: heuristic on `area_fips`: `US000` → national; FIPS
    starting with `C` → MSA; 5-digit ending in `000` → statewide; any
    other 5-digit code → county.

* `naics_level`
  * Definition: granularity of the NAICS code on this row, where
    higher values are more specific. Stored as a float to keep with
    the schema's float-for-numeric convention.
  * Examples: `2.0` (sector or supersector), `3.0` (subsector),
    `4.0` (industry group), `5.0` (NAICS industry), `6.0` (national
    industry).
  * Derivation: length of the `industry_code` string, with the special
    case `10` (Total) and any 2-character supersector code mapped to
    `2.0`.

* `publisher`
  * Definition: organization that publishes the data (always BLS).
  * Examples: `"U.S. Bureau of Labor Statistics"`
  * Derivation: hard-coded constant; QCEW is exclusively a BLS product.

### Quarterly Observation Properties (cew_series)

These atoms appear on the per-quarter observation records, timestamped
at the last day of the quarter (e.g. 2024-03-31 for Q1 2024).

* `establishment_count`
  * Definition: count of establishments (physical locations of
    employers) covered by the series in the quarter.
  * Examples: `11907855` (US total Q1 2024), `61375` (US Federal
    Government total Q1 2024)
  * Derivation: `qtrly_estabs` field of the CSV row.

* `monthly_employment_m1`, `monthly_employment_m2`, `monthly_employment_m3`
  * Definition: number of employees on payrolls covered in the first /
    second / third month of the quarter (BLS uses the pay period
    including the 12th of the month).
  * Examples (US Q1 2024 total): `152393725`, `153129544`, `153848430`
  * Derivation: `month1_emplvl`, `month2_emplvl`, `month3_emplvl`
    fields of the CSV row.

* `employment_level`
  * Definition: representative quarterly employment level for the
    series, taken as the third-month employment (final month of the
    quarter), aligned to the way QCEW publications report "QCEW
    employment".
  * Examples: `153848430` (US Q1 2024 total)
  * Derivation: `month3_emplvl` field of the CSV row.

* `total_quarterly_wages`
  * Definition: total wages paid (in current US dollars) to all covered
    workers during the quarter.
  * Examples: `3037790324790` (US Q1 2024 total = $3.04 trillion)
  * Derivation: `total_qtrly_wages` field of the CSV row.

* `taxable_quarterly_wages`
  * Definition: portion of total quarterly wages subject to UI tax
    contributions (in current US dollars). Always 0 for federal
    government employment, which is not subject to UI tax.
  * Examples: `1151875077520` (US Q1 2024 total)
  * Derivation: `taxable_qtrly_wages` field of the CSV row.

* `quarterly_contributions`
  * Definition: total UI tax contributions (in current US dollars)
    associated with this employment in the quarter.
  * Examples: `19555346530` (US Q1 2024 total)
  * Derivation: `qtrly_contributions` field of the CSV row.

* `avg_weekly_wage`
  * Definition: average weekly wage (in current US dollars) per
    employee covered in the quarter, computed by BLS as
    `total_qtrly_wages / (avg_emplvl × 13)`.
  * Examples: `1526` (US Q1 2024 total = $1,526/week)
  * Derivation: `avg_wkly_wage` field of the CSV row.

### Year-over-Year Change Properties (cew_series)

BLS pre-computes over-the-year (OTY) absolute and percent changes for
each quarterly metric, comparing the current quarter to the same quarter
of the prior year. The atomizer emits the percent-change variants as
their own atoms so downstream consumers can directly query
"Employment growth YoY" without recomputing it from observation history.

* `employment_yoy_pct_chg`
  * Definition: year-over-year percent change in the canonical
    `employment_level` (= third-month / end-of-quarter snapshot).
  * Examples: `1.5` (US total Q1 2024 vs Q1 2023 = +1.5 %)
  * Derivation: `oty_month3_emplvl_pct_chg` field of the CSV row. We
    intentionally do *not* also emit `monthly_employment_m3_yoy_pct_chg`
    -- it would duplicate this number under a redundant property name.

* `monthly_employment_m1_yoy_pct_chg`, `monthly_employment_m2_yoy_pct_chg`
  * Definition: year-over-year percent change in mid-quarter monthly
    employment (the M1 and M2 snapshots that have no canonical alias;
    the M3 snapshot is exposed as `employment_yoy_pct_chg` above).
  * Examples (US Q1 2024 total): `1.4`, `1.4`
  * Derivation: `oty_month1_emplvl_pct_chg`, `oty_month2_emplvl_pct_chg`,
    `oty_month3_emplvl_pct_chg` fields of the CSV row.

* `establishments_yoy_pct_chg`
  * Definition: year-over-year percent change in the count of
    establishments.
  * Examples: `1.2` (US Q1 2024 total = +1.2 %)
  * Derivation: `oty_qtrly_estabs_pct_chg` field of the CSV row.

* `total_quarterly_wages_yoy_pct_chg`
  * Definition: year-over-year percent change in total quarterly
    wages.
  * Examples: `5.7` (US Q1 2024 total = +5.7 %)
  * Derivation: `oty_total_qtrly_wages_pct_chg` field of the CSV row.

* `avg_weekly_wage_yoy_pct_chg`
  * Definition: year-over-year percent change in the average weekly
    wage.
  * Examples: `4.2` (US Q1 2024 total = +4.2 %)
  * Derivation: `oty_avg_wkly_wage_pct_chg` field of the CSV row.

* `taxable_quarterly_wages_yoy_pct_chg`
  * Definition: year-over-year percent change in taxable quarterly
    wages.
  * Examples: `3.3`
  * Derivation: `oty_taxable_qtrly_wages_pct_chg` field of the CSV row.

* `quarterly_contributions_yoy_pct_chg`
  * Definition: year-over-year percent change in UI contributions.
  * Examples: `4.3`
  * Derivation: `oty_qtrly_contributions_pct_chg` field of the CSV row.

### Location Properties (location)

* `area_fips`
  * Definition: BLS-assigned area identifier (FIPS-based) used as the
    location's strong id.
  * Examples: `"US000"`, `"06000"`, `"06037"`, `"C1018"`
  * Derivation: `area_fips` field of the CSV row.

* `name`
  * Definition: human-readable name of the geographic area.
  * Examples: `"U.S. TOTAL"`, `"California -- Statewide"`,
    `"Los Angeles County, California"`
  * Derivation: `area_title` field of the CSV row.

* `area_type`
  * Definition: classification of the area as `national`, `statewide`,
    `msa`, or `county`.
  * Examples: `"national"`, `"statewide"`, `"county"`, `"msa"`
  * Derivation: heuristic on `area_fips`; see the `cew_series` entry of
    the same name above.

### Industry Properties (industry)

* `naics_code`
  * Definition: industry code used by BLS (NAICS at sector / 3-digit /
    4-digit / 5-digit / 6-digit detail, plus BLS supersector aggregates
    and `10` = Total, all industries). Strong id for `industry`.
  * Examples: `"10"`, `"31-33"`, `"5111"`, `"541211"`
  * Derivation: `industry_code` field of the CSV row.

* `naics_description`
  * Definition: human-readable industry name.
  * Examples: `"Total, all industries"`, `"Manufacturing"`,
    `"Newspaper, periodical, book and directory publishers"`
  * Derivation: `industry_title` field of the CSV row.

* `naics_level`
  * Definition: granularity of the NAICS code (see the `cew_series`
    entry of the same name above for derivation).
  * Examples: `2.0`, `3.0`, `4.0`, `5.0`, `6.0`

---

## Entity Relationships Summary

The QCEW source emits two relationship types — both pointing from the
real-world contextual entity (a US area or an industry) to the
`cew_series` it appears in. This mirrors the FRED source's
`appears_in_fred_series` pattern.

```
location  ──[appears_in_cew_series]──→ cew_series
industry  ──[appears_in_cew_series]──→ cew_series
```

* `appears_in_cew_series`
  * Definition: the subject (a US geographic area or an industry)
    appears as the area / industry dimension of a QCEW time series.
  * Domain flavors: `location`, `industry`
  * Target flavor: `cew_series`
  * Derivation: emitted once per series per quarter on the location and
    industry context records.

---

## Attributes

None. All quarterly metrics are timestamped scalar atoms; there are no
per-atom attributes (unit / frequency / etc.) on this source — those are
carried as atoms on the `cew_series` metadata record.
