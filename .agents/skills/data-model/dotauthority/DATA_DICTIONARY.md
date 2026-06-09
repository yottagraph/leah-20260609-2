# Data Dictionary: DOT Authority

## Source Overview

FMCSA Carrier Authority data from the "Carrier All With History" Socrata dataset (`6eyk-hxee`), published by the Federal Motor Carrier Safety Administration. Contains operating authority records for motor carriers, brokers, and freight forwarders, including docket numbers, authority statuses (common, contract, broker), insurance requirements, and business contact information.

Bulk-refreshed periodically by FMCSA; no per-row timestamps. The streamer performs a single full download per run.

| Pipeline | `Record.Source` |
|----------|----------------|
| Carrier Authority | `dotauthority` |

This is a companion dataset to DOT Census (`dotcensus`), which covers company registration, fleet size, and safety ratings. Authority covers operating authority statuses and insurance/bond requirements. Both sources share the `usdot_number` strong ID, enabling entity merging across datasets.

---

## Entity Types

### `organization`

A motor carrier, broker, or freight forwarder registered with FMCSA.

- Primary key: `usdot_number` (USDOT number assigned by FMCSA)
- Entity resolver: named entity. Strong ID = `usdot_number` when present. Disambiguation via legal name, optional DBA, and business address.
- Entity name: `LEGAL_NAME` from the source row. When `DBA_NAME` differs, it is emitted as the `dotauthority::doing_business_as` string property on this subject, not as a separate entity.

### `person`

A named individual registered as a motor carrier (for example a sole proprietor).

- Record subject when `LEGAL_NAME` matches person-like name heuristics; otherwise the subject uses the `organization` flavor.
- Entity resolver: named entity. When a USDOT number is present it is still attached as a strong ID for merging with census data.

### `location`

The business location of a carrier, derived from city, state, and country fields.

- Entity resolver: named entity. No strong ID.
- Entity name: formatted as "City, State" or "City, State, Country".

---

## Properties

FMCSA-specific fields use the DataSchema `namespace: dotauthority` (matching dataset `name` in `schema.yaml`). Fetch atoms use the qualified property key `dotauthority::<local_name>` (for example `dotauthority::doing_business_as`).

### Organization: Identity and Registration

* `usdot_number`
  * Definition: USDOT number uniquely identifying the registered motor carrier, broker, or shipper.
  * Examples: `1234567`, `3456789`
  * Derivation: `dot_number` field from the Socrata API. Carriers with DOT number `00000000` or empty are treated as not having a DOT number.

* `dotauthority::docket_number`
  * Definition: FMCSA docket number (MC/FF/MX number) for the carrier's operating authority.
  * Examples: `MC012892`, `MC599911`
  * Derivation: `docket_number` field from the Socrata API.

* `dotauthority::doing_business_as`
  * Definition: Trade name or "doing business as" (DBA) name from FMCSA when it differs from the legal name.
  * Examples: `ACME EXPRESS`, `SMITH TRUCKING`
  * Derivation: `dba_name` when non-empty and not equal to `legal_name` (case-sensitive string comparison as in the streamer).

### Organization: Business Contact

* `address`
  * Definition: Formatted business street address of the carrier.
  * Examples: `1200 SEABOARD DR, HIALEAH, FL 33010`
  * Derivation: Composed from `bus_street_po`, `bus_city`, `bus_state_code`, `bus_zip_code`, and `bus_ctry_code` fields, formatted as "Street, City, State Zip".

* `dotauthority::phone_number`
  * Definition: Primary business phone number of the carrier.
  * Examples: `5551234567`
  * Derivation: `bus_telno` field from the Socrata API.

### Organization: Authority Status

* `dotauthority::common_authority_status`
  * Definition: Status of the carrier's common carrier authority.
  * Examples: `A (Active)`, `I (Inactive)`, `N (None)`
  * Derivation: `common_stat` field. Single-letter code expanded to include the human-readable label.

* `dotauthority::contract_authority_status`
  * Definition: Status of the carrier's contract carrier authority.
  * Examples: `A (Active)`, `I (Inactive)`, `N (None)`
  * Derivation: `contract_stat` field. Same code expansion as common authority.

* `dotauthority::broker_authority_status`
  * Definition: Status of the carrier's broker authority.
  * Examples: `A (Active)`, `I (Inactive)`, `N (None)`
  * Derivation: `broker_stat` field. Same code expansion as common authority.

* `dotauthority::authority_type`
  * Definition: Authority type flags indicating which categories the carrier is authorized for.
  * Examples: `Property`, `Passenger`, `Household Goods`, `Property; Passenger`
  * Derivation: Composed from five checkbox fields (`property_chk`, `passenger_chk`, `hhg_chk`, `private_auth_chk`, `enterprise_chk`). Values with `Y` are included, joined with `; `.

### Organization: Insurance and Bonding

* `dotauthority::min_coverage_amount`
  * Definition: Minimum insurance coverage amount required, in thousands of dollars.
  * Examples: `00750`, `05000`
  * Derivation: `min_cov_amount` field. Values of `00000` are suppressed.

* `dotauthority::cargo_insurance_required`
  * Definition: Whether cargo insurance is required for this carrier.
  * Examples: `1.0` (yes), `0.0` (no)
  * Derivation: `cargo_req` field. `Y` → 1.0, `N` → 0.0. Other values are not emitted.
  * Note: Stored as float per KG boolean convention.

* `dotauthority::bond_required`
  * Definition: Whether a surety bond is required for this carrier.
  * Examples: `1.0` (yes), `0.0` (no)
  * Derivation: `bond_req` field. `Y` → 1.0, `N` → 0.0. Other values are not emitted.
  * Note: Stored as float per KG boolean convention.

* `dotauthority::bipd_insurance_on_file`
  * Definition: Bodily injury / property damage insurance filing amount on file.
  * Examples: `01000`, `05000`
  * Derivation: `bipd_file` field. Values of `00000` are suppressed.

---

## Entity Relationships Summary

```
organization ──[is_located_at]──→ location
person       ──[is_located_at]──→ location
```

The `is_located_at` relationship is created when both city and state are present. The target is a location entity named "City, State" (or "City, State, Country" if the country code is present).

---

## Source Fields Not Mapped

The following Socrata fields are present in the API response but not currently mapped to KG properties:

- `common_app_pend`, `contract_app_pend`, `broker_app_pend` -- application pending flags
- `common_rev_pend`, `contract_rev_pend`, `broker_rev_pend` -- revocation pending flags
- `cargo_file` -- cargo insurance filing amount
- `bond_file` -- bond filing amount

These were omitted as lower-priority. They could be added as future enhancements if needed for analysis.
