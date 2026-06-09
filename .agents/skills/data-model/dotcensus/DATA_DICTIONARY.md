# Data Dictionary: DOT Census

## Source Overview

The FMCSA Company Census File is a daily snapshot of all motor carriers, brokers, shippers, and hazmat carriers registered with the Federal Motor Carrier Safety Administration (FMCSA), part of the U.S. Department of Transportation.

- **Publisher:** FMCSA / U.S. Department of Transportation
- **URL:** https://data.transportation.gov/Trucking-and-Motorcoaches/Company-Census-File/az4n-8mr2
- **Format:** CSV (~500K+ rows)
- **Cadence:** Updated daily from a 24-hour-old FMCSA database snapshot
- **Source name:** `dotcensus`

Each row represents one registered entity identified by a unique USDOT number. The file contains identity, physical location, fleet composition, carrier operation type, and safety ratings.

**Limitations:** The census reflects registration data, not real-time operational status. Fleet sizes and driver counts are self-reported by carriers during MCS-150 filings and may be stale. Safety ratings are assigned only after compliance reviews and are absent for most carriers.

---

## Entity Types

### `organization`

A motor carrier, broker, shipper, or other entity registered with FMCSA.

- Primary key: `usdot_number` (USDOT Number, unique per registrant)
- Entity resolver: named entity, MERGEABLE. Strong ID = `usdot_number`. Disambiguation snippet includes DBA (when present) and physical address when available.
- Name: `LEGAL_NAME`. When `DBA_NAME` differs, it is emitted as the `dotcensus::doing_business_as` string property on this subject, not as a separate entity.

### `person`

Used as the record subject when `LEGAL_NAME` matches person-like name heuristics (sole proprietorships). Same USDOT strong ID and census properties as organization subjects.

### `location`

The physical location (city + state) of a registered carrier.

- Primary key: none (resolved by name)
- Entity resolver: named entity, MERGEABLE. Disambiguation snippet includes the formatted location name.
- Name format: `"{city}, {state}"` or `"{city}, {state}, {country}"` when country is present.

---

## Properties

FMCSA-specific fields use the DataSchema `namespace: dotcensus` (matching dataset `name` in `schema.yaml`). Fetch atoms use the qualified property key `dotcensus::<local_name>` (for example `dotcensus::doing_business_as`).

### Organization Properties

#### Identity and Registration

* `usdot_number`
  * Definition: USDOT number assigned by FMCSA, unique per registered entity.
  * Examples: `"12345"`, `"99999"`
  * Derivation: `DOT_NUMBER` column. Emitted as both a strong ID for entity resolution and as a property atom on every record.

* `dotcensus::doing_business_as`
  * Definition: Trade name or "doing business as" (DBA) from FMCSA when it differs from the legal name.
  * Examples: `"Acme Transport"`, `"G & G TRANSPORTATION CO"`
  * Derivation: `DBA_NAME` when non-empty and not equal to `LEGAL_NAME`.

* `address`
  * Definition: Physical street address of the carrier.
  * Examples: `"21154 HWY EAST, SILOAM SPRINGS, AR 72761"`, `"100 Main St, Dallas, TX 75201"`
  * Derivation: Concatenation of `PHY_STREET`, `PHY_CITY`, `PHY_STATE`, and `PHY_ZIP` columns.

* `dotcensus::phone_number`
  * Definition: Primary phone number on file with FMCSA.
  * Examples: `"5551234567"`
  * Derivation: `PHONE` column.

* `dotcensus::business_org_type`
  * Definition: Business organization type of the registrant.
  * Examples: `"Individual"`, `"Partnership"`, `"Corporation"`
  * Derivation: `BUSINESS_ORG_ID` column decoded from numeric codes (1=Individual, 2=Partnership, 3=Corporation).

* `dotcensus::entity_type`
  * Definition: FMCSA entity type indicating the registrant's role in freight transportation.
  * Examples: `"Carrier"`, `"Carrier; Broker"`, `"Carrier; Shipper"`
  * Derivation: `CARSHIP` column. Semicolon-delimited code list decoded from single-letter codes (C=Carrier, B=Broker, S=Shipper, T=Cargo Tank, R=Registrant).

* `dotcensus::operating_authority`
  * Definition: Operating authority classification describing the carrier's authorization type.
  * Examples: `"AUTHORIZED FOR HIRE"`, `"PRIVATE PROPERTY"`, `"EXEMPT FOR HIRE"`
  * Derivation: `CLASSDEF` column, passed through as-is.

#### Carrier Status and Operations

* `dotcensus::carrier_status`
  * Definition: FMCSA carrier registration status.
  * Examples: `"A (Active)"`, `"I (Inactive)"`, `"N (Not Authorized)"`
  * Derivation: `STATUS_CODE` column decoded from single-letter codes.

* `dotcensus::carrier_operation_type`
  * Definition: Type of carrier operation based on registration.
  * Examples: `"A (Interstate)"`, `"B (Intrastate Hazmat)"`, `"C (Intrastate Non-Hazmat)"`
  * Derivation: `CARRIER_OPERATION` column decoded from single-letter codes.
  * Note: The B/C distinction reflects the carrier's registration type, not actual hazmat activity. A carrier registered as C (non-hazmat) can still transport hazmat (see `dotcensus::hazmat_indicator`).

* `dotcensus::hazmat_indicator`
  * Definition: Whether the carrier transports hazardous materials.
  * Examples: `1.0` (yes), `0.0` (no)
  * Derivation: `HM_Ind` column. `"Y"` → 1.0, `"N"` → 0.0. Omitted when blank.

#### Fleet Composition

* `dotcensus::total_drivers`
  * Definition: Total number of drivers reported by the carrier.
  * Examples: `10.0`, `250.0`
  * Derivation: `TOTAL_DRIVERS` column, parsed as float. Omitted when zero or blank.

* `dotcensus::total_power_units`
  * Definition: Total number of power units (trucks, tractors) operated by the carrier.
  * Examples: `5.0`, `1200.0`
  * Derivation: `POWER_UNITS` column, parsed as float. Omitted when zero or blank.

* `dotcensus::total_bus_units`
  * Definition: Total number of bus units operated by the carrier.
  * Examples: `2.0`, `50.0`
  * Derivation: `BUS_UNITS` column, parsed as float. Omitted when zero or blank.

* `dotcensus::fleet_size_category`
  * Definition: Fleet size category assigned by FMCSA based on total power units.
  * Examples: `"A (1-6 power units)"`, `"D (20-100 power units)"`, `"F (1000+ power units)"`
  * Derivation: `FLEETSIZE` column decoded from single-letter codes. Omitted when `"0"` (none reported).

#### Safety

* `dotcensus::safety_rating`
  * Definition: FMCSA safety rating assigned during a compliance review.
  * Examples: `"Satisfactory"`, `"Conditional"`, `"Unsatisfactory"`
  * Derivation: `SAFETY_RATING` column decoded from single-letter codes (S, C, U).
  * Note: Most carriers have no safety rating — it is only assigned after a compliance review.

* `dotcensus::safety_rating_date`
  * Definition: Date the safety rating was assigned.
  * Examples: `"2024-01-01"`
  * Derivation: `SAFETY_RATING_DATE` column parsed from `YYYYMMDD` format, output as `YYYY-MM-DD`.

#### Filing Dates

* `dotcensus::last_mcs150_filing_date`
  * Definition: Date the carrier last filed or updated their MCS-150 Motor Carrier Identification Report.
  * Examples: `"2024-01-01"`
  * Derivation: `MCS150_DATE` column parsed from `YYYYMMDD HHMM` format, output as `YYYY-MM-DD`.

### Timestamp Derivation

Record timestamps are derived in priority order: `ADD_DATE` (carrier registration date), then `MCS150_DATE` (last MCS-150 filing). Rows where neither date parses successfully are dropped.

---

## Entity Relationships Summary

```
organization  ──[is_located_at]──────→ location
person        ──[is_located_at]──────→ location
```

- `is_located_at`: Links the carrier to its physical location. Only produced when both `PHY_CITY` and `PHY_STATE` are present.
