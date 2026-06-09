# Data Dictionary: FIPS Codes (FCC mirror)

## Source Overview

Federal Information Processing Standard (FIPS) codes for U.S. states and
counties — short numeric identifiers issued by the federal government
(Census Bureau / NIST historically) that uniquely tag every U.S. state,
the District of Columbia, and every county-or-equivalent (boroughs,
parishes, independent cities, census areas).

- **Publisher (mirror):** U.S. Federal Communications Commission, Office
  of Engineering and Technology
- **URL:** https://transition.fcc.gov/oet/info/maps/census/fips/fips.txt
- **Format:** Plain-text fixed-column ASCII, ~3,200 lines total
- **Cadence:** Effectively static. The federal codes change only when
  jurisdictions are created, dissolved, or renamed (rare — once every
  several years).
- **Source name:** `fips`

The file contains two sections:

1. A 51-row table of **state-level FIPS codes** (50 states + DC), one
   line per state with a 2-digit code.
2. A 3,140+ row table of **county-level FIPS codes**, one line per county
   (or county-equivalent) with a 5-digit code. The leading 2 digits are
   the parent state's FIPS code; the trailing 3 digits identify the
   county within the state. The county-level table is grouped by state
   and prefaced with a header row of the form `XX000  StateName`.

**Limitations:**
- The FCC mirror is a republication of the older Census-published list;
  it does not include FIPS *places* (cities/towns), MSAs, or U.S.
  territories (Puerto Rico, Guam, U.S. Virgin Islands, etc.).
- A small number of county lines have parenthesized historical
  annotations (`(created after 1990)`, `(1990 Census Area)`,
  `(After 1990, part of Halifax County)`). These are stripped from the
  emitted county name.
- The `XX000` state header rows in the county section are duplicates of
  the state-level table and are skipped during atomization (one record
  per state, not two).

---

## Entity Types

### `location`

Used for both U.S. states (and DC) and U.S. counties (and county-
equivalents like Alaska boroughs, Louisiana parishes, and Virginia
independent cities). The level of geography is distinguished by which
strong-ID property is set (`fips_state` for state-level, `fips_county`
for county-level) and by the `administrative_level` property.

- **Primary key (state-level):** the 2-digit FIPS state code, exposed as
  the `fips_state` strong-ID property and as a property atom.
- **Primary key (county-level):** the 5-digit FIPS county code, exposed
  as the `fips_county` strong-ID property and as a property atom.
- **Entity resolver:** named entity, **MERGEABLE**. State and county FIPS
  codes are stable, official identifiers and merging across sources
  (Census, FRED, sanctions data, etc.) is desired. Disambiguation
  snippets include the formatted name (e.g. `"Autauga County, Alabama"`).
- **Name format:**
  - State-level: `Title-cased state name` (e.g. `"Alabama"`,
    `"District of Columbia"`).
  - County-level: `"{County} County, {State}"` for the common case;
    parishes / boroughs / cities / census areas keep their original
    suffix (e.g. `"East Baton Rouge Parish, Louisiana"`,
    `"Aleutians East Borough, Alaska"`,
    `"Baltimore city, Maryland"`).

---

## Properties

The dataset uses the DataSchema `namespace: fips`. Atom property keys
are `fips::<local_name>` for source-specific properties. Identity
properties also used for resolver strong IDs are `fips_state` and
`fips_county`.

### Common Properties (states and counties)

* `fips::administrative_level`
  * Definition: Granularity of the geographic entity within the U.S.
    federal hierarchy.
  * Examples: `"state"`, `"county"`
  * Derivation: Set to `"state"` for entries from the state-level table,
    `"county"` for entries from the county-level table.

* `fips::official_name`
  * Definition: Verbatim place name as it appears in the FCC mirror,
    upper-cased for states and mixed-case for counties.
  * Examples: `"ALABAMA"`, `"Autauga County"`,
    `"Aleutians East Borough"`, `"East Baton Rouge Parish"`,
    `"Baltimore city"`
  * Derivation: The "place name" column of the source file, with the
    parenthesized historical annotation (when present) stripped.

### State Properties

* `fips_state`
  * Definition: Two-digit Federal Information Processing Standard code
    that uniquely identifies a U.S. state or the District of Columbia.
  * Examples: `"01"` (Alabama), `"06"` (California), `"11"` (DC)
  * Derivation: Verbatim from the state-level table's first column,
    zero-padded to two digits.
  * Note: Also used as the strong ID on the state's `location` entity.

### County Properties

* `fips_county`
  * Definition: Five-digit Federal Information Processing Standard code
    that uniquely identifies a U.S. county or county-equivalent. The
    leading two digits are the parent state's `fips_state` code; the
    trailing three digits identify the county within the state.
  * Examples: `"01001"` (Autauga County, Alabama), `"06037"` (Los
    Angeles County, California), `"22033"` (East Baton Rouge Parish,
    Louisiana)
  * Derivation: Verbatim from the county-level table's first column,
    zero-padded to five digits.
  * Note: Also used as the strong ID on the county's `location` entity.

---

## Entity Relationships Summary

```
location (county) ──[located_in]──→ location (state)
```

- `located_in`: Each county-level `location` is linked to its parent
  state-level `location` via the leading two digits of the county FIPS
  code. Both sides carry strong IDs (`fips_county` and `fips_state`),
  which guarantees resolver merging into a single state node across all
  county-→-state edges and across other datasets that emit the same
  state codes.
