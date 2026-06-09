# Data Dictionary: USAspending.gov

Last updated: 2026-05-20 (revised after Deep Research dictionary review rounds 1 and 2)

> **Operational runbooks** (you'll be sent here from log/alert messages):
>
> - `PaginationTruncated` metric / "paginated query truncated upstream"
>   error log → runbook is the doc comment on
>   `recordPaginationTruncation` in
>   `moongoose/fetch/usaspending_streamer.go`. It decodes the
>   `(mode, cell, reason)` attributes and lists per-mode mitigations.
> - "Reconnaissance: bulk-subaward path correction" (2026-05-23, Late PM)
>   entry in `GUIDANCE_LOG.md` covers why backfill_subawards uses
>   per-month slicing today and the A9.5d project to migrate it to the
>   asynchronous bulk-download endpoint.

## Purpose / Source Overview

USAspending.gov is the official open-data portal for federal government
spending, published by the U.S. Treasury's Bureau of the Fiscal Service.
It exposes every federal contract, grant, loan, direct payment, and
subaward awarded since FY2008, with daily updates pulled from FPDS
(procurement) and FABS (financial assistance) source systems.

v0 scope ingests three award categories plus their transactions and
subawards:

- **Contracts** (procurement) — types `A` (BPA Call), `B` (Purchase
  Order), `C` (Delivery Order), `D` (Definitive Contract).
- **IDVs** (indefinite-delivery vehicles, parent contracts under which
  child contracts are placed) — types `IDV_A` (GWAC), `IDV_B` (IDC),
  `IDV_B_A` / `IDV_B_B` / `IDV_B_C` (IDC sub-types), `IDV_C` (FSS),
  `IDV_D` (BOA), `IDV_E` (BPA).
- **Grants** (assistance) — types `02` (Block Grant), `03` (Formula
  Grant), `04` (Project Grant), `05` (Cooperative Agreement), `F001`
  (Grant, modern FABS code), `F002` (Cooperative Agreement, modern FABS
  code).
- **Transactions** — every modification (FPDS modification or FABS
  action) of an in-scope award, emitted as a sub-record linked to its
  parent.
- **Subawards** — sub-recipient relationships under in-scope prime
  contracts and grants (FFATA / FSRS reporting). v0 ingests subawards
  via the **bulk CSV archives** rather than `/api/v2/subawards/`,
  because the API list response omits the sub-recipient UEI and DUNS;
  the bulk subaward archives include them.

Recipients are identified by **UEI** (Unique Entity Identifier; the
12-character alphanumeric SAM.gov identifier that replaced DUNS in
April 2022). Federal agencies are identified by **CGAC toptier code**
(3-digit) and **subtier code** (4-character alphanumeric). Subordinate
classifications use **NAICS** (industry, contracts only), **PSC**
(product/service code, contracts only), and **assistance listings**
(formerly CFDA, grants only) — each a distinct entity flavor.

### Ingestion pipeline (v0)

A hybrid pipeline is required because of API rate limits, pagination
ceilings, and the subaward UEI gap:

| Phase | Source | Cadence | Purpose |
|-------|--------|---------|---------|
| Initial backfill — awards (FY2008 → present) | Bulk Award CSV archives at `https://files.usaspending.gov/award_data_archive/` — per (agency × FY × type) ZIPs listed by `/api/v2/bulk_download/list_monthly_files/` | One-time on cold start, then never repeated for that snapshot | Full historical seed for prime contracts, IDVs, and grants. Carries the same fields as the API `/api/v2/awards/{id}/` detail. |
| Initial backfill — subawards (FY2008 → present) | **Today:** `/api/v2/search/spending_by_award/` with `subawards=true`, partitioned (FY × group × calendar-month) to stay under the API's 100k-row hard cap. **Planned (A9.5d):** asynchronous `/api/v2/bulk_download/awards/` jobs with `sub_award_types=[procurement,grant]`, which return per-cell ZIPs (`All_Contracts_Subawards_*.csv` / `All_Assistance_Subawards_*.csv`) with no row cap and the full `subawardee_uei`/`subawardee_duns` fidelity. See `GUIDANCE_LOG.md` round-1 finding and the A9.5d entry. | One-time | Full historical subaward seed. **NOTE:** earlier revisions of this document claimed static monthly `Contracts_Subawards.csv` / `Assistance_Subawards.csv` files exist at `files.usaspending.gov` — they do not; reconnaissance against the live API and the USAspending UI's "Award Data Archive" download list confirms only an asynchronous job-creation endpoint provides bulk subaward CSVs. |
| Daily delta (subaward) | Same search-API path as backfill, restricted to a `lookbackDays` window. Daily volumes (~hundreds–low-thousands of subawards) stay well under the 100k cap without month slicing. Planned A9.5d migration will switch this to a daily bulk_download job too. | Daily | Subaward UEI fidelity gap exists today on this path (the search API list response omits `subawardee_uei` / `subawardee_duns`) and will be closed by A9.5d. |
| Daily delta (awards + transactions) | `/api/v2/search/spending_by_award/` filtered on `last_modified_date >= now - 30d`, then `/api/v2/awards/{generated_unique_award_id}/` for full detail and `/api/v2/transactions/?award_id=…` for modification history. | Daily | Incremental updates and corrections (~10k-30k records per day). |
| Reference data | `/api/v2/references/toptier_agencies/`, `/api/v2/references/naics/`, `/api/v2/references/assistance_listing/`, `/api/v2/references/filter_tree/psc/` | Weekly | Agency, NAICS, PSC, and assistance-listing reference catalogs. |

The API enforces two limits that make API-only backfill infeasible: a
~200 req/min rate ceiling, and a hard 10,000-record pagination wall on
search endpoints. The bulk-CSV-first strategy avoids both.

Anonymous API access is permitted with no key required, subject to the
rate limits above. Bulk CSV downloads are anonymous as well.

**Source names used on records:**

| Pipeline | `Record.Source` |
|----------|----------------|
| Reference data (agency lists, NAICS/PSC/assistance-listing catalogs) | `usaspending` |
| Contract awards + their transactions | `usaspending_contract` |
| IDV awards + their transactions | `usaspending_idv` |
| Grant awards + their transactions | `usaspending_grant` |
| Subawards under prime contracts or grants | `usaspending_subaward` |

### Future scope (deferred, not in v0)

- Award categories: Loans (`07`, `08`, `F003`, `F004`), Direct Payments
  (`06`, `10`, `F006`, `F007`), Other Financial Assistance (`09`, `11`,
  `F005`, `F008`, `F009`, `F010`).
- Federal Account / Treasury Account Symbol (TAS) data — File C funding
  linkage, including `total_account_obligation`,
  `total_account_outlay`, and per-TAS breakdowns from
  `/api/v2/awards/funding`.
- Disaster / DEFC-tagged spending (COVID DEFC `M`/`N`/`O`/`P`/`Q`/`R`,
  IIJA, IRA) via `account_obligations_by_defc` /
  `account_outlays_by_defc`.
- SAM.gov vendor registration + exclusions (separate Tier-1 source,
  same UEI strong ID).
- Federally Negotiated Indirect Cost Rates published per OMB
  Memorandum M-21-03 (when USAspending begins surfacing them in API
  responses).
- PDF contract attachments via FPDS.
- IDV → child contract hierarchy via `/api/v2/idvs/awards/`.
- Cross-source resolution to EDGAR via UEI → CIK lookup (via SAM.gov
  registration files) and to GLEIF via UEI → LEI lookup.

---

## Entity Types

### `organization`

Either a **recipient** (the company, university, state agency, or
non-profit that receives the award), a **federal agency** (the awarding
or funding entity at toptier or subtier level), or a **sub-recipient**
(the entity receiving a subaward under a prime).

- **Primary key (recipient or sub-recipient):** `uei` (12-character
  alphanumeric, the current authoritative federal vendor identifier).
- **Primary key (agency):**
  `usaspending_toptier_agency_code` (CGAC 3-digit) for toptier
  agencies; `usaspending_subtier_agency_code` (4-char alphanumeric)
  for subtier agencies.
- **Entity resolver:** named entity, not mergeable at the flavor level
  (passive). Strong IDs (`uei`, `duns`,
  `usaspending_toptier_agency_code`, `usaspending_subtier_agency_code`)
  drive deterministic merging within this dataset and cross-source
  resolution to other datasets that publish the same identifiers (e.g.,
  EDGAR's CIK + UEI bridge, GLEIF's LEI, SAM.gov's UEI + exclusions
  list, future).
- **Sources:** `usaspending`, `usaspending_contract`,
  `usaspending_idv`, `usaspending_grant`, `usaspending_subaward`.

### `usaspending::contract`

A federal procurement contract award (type code `A`/`B`/`C`/`D`),
representing the canonical rolled-up state of an award across all its
modifications.

- **Primary key:** `generated_unique_award_id` (e.g.,
  `CONT_AWD_HT940216C0001_9700_-NONE-_-NONE-`).
- **Entity resolver:** passive, not mergeable. Strong IDs are
  `generated_unique_award_id` (primary, structured string) and
  `usaspending_internal_id` (secondary, integer database key for
  alias-tolerant routing). Disambiguation context: PIID, awarding
  agency, recipient name.
- **Sources:** `usaspending_contract`.

### `usaspending::idv`

An Indefinite-Delivery Vehicle — a parent procurement contract
(GWAC/IDC/FSS/BOA/BPA) under which individual delivery orders or task
orders are placed. Same shape as contracts but with `category=idv` and
a distinct flavor for queryability.

- **Primary key:** `generated_unique_award_id` (e.g.,
  `CONT_IDV_NNJ16GX08B_8000`).
- **Entity resolver:** passive, not mergeable. Strong IDs:
  `generated_unique_award_id`, `usaspending_internal_id`.
- **Sources:** `usaspending_idv`.

### `usaspending::grant`

A federal financial assistance award classified as a grant: block
grant, formula grant, project grant, or cooperative agreement
(award-type codes `02`, `03`, `04`, `05`, `F001`, `F002`).

- **Primary key:** `generated_unique_award_id` (e.g.,
  `ASST_NON_2505CA5MAP_075`).
- **Entity resolver:** passive, not mergeable. Strong IDs:
  `generated_unique_award_id`, `usaspending_internal_id`.
  Disambiguation context: FAIN, awarding agency, recipient name,
  assistance listing number.
- **Sources:** `usaspending_grant`.

### `usaspending::transaction`

A single FPDS or FABS modification applied to an in-scope award. Each
transaction has its own dollar amount, action date, modification
number, and description. The canonical award entity aggregates all
transactions into rolled-up totals; transaction sub-records preserve
modification history.

- **Primary key:** `transaction_unique_id` (e.g.,
  `CONT_TX_9700_-NONE-_HT940216C0001_P00713_-NONE-_0`).
- **Entity resolver:** passive, not mergeable. Strong ID =
  `transaction_unique_id`.
- **Sources:** `usaspending_contract`, `usaspending_idv`,
  `usaspending_grant` (transaction sub-records share the source of
  their parent award).

### `usaspending::subaward`

A subaward (subcontract under a prime contract, or subgrant under a
prime grant), reported by the prime recipient under FFATA/FSRS
requirements. Captures the one-remove flow of federal dollars from the
prime recipient to its sub-recipient.

- **Primary key:** `usaspending_subaward_id` (canonical primary key
  from the FSRS database; globally unique). Subject name:
  `subaward_{usaspending_subaward_id}` (e.g., `subaward_797093`).
- **Entity resolver:** passive, not mergeable. Strong ID =
  `usaspending_subaward_id`.
- **Sources:** `usaspending_subaward`. **Today** the input is
  `/api/v2/search/spending_by_award/` with `subawards=true`; this
  endpoint omits `subawardee_uei` / `subawardee_duns` from its list
  response, so sub-recipient strong-IDs are partial. **Planned
  (A9.5d):** migrate to bulk subaward CSVs obtained via the
  asynchronous `/api/v2/bulk_download/awards/` job endpoint
  (`All_Contracts_Subawards_*.csv` / `All_Assistance_Subawards_*.csv`),
  which DO carry `subawardee_uei` / `subawardee_duns`. The
  `/api/v2/subawards/` endpoint is informational only and not used for
  ingestion.

### `industry`

A NAICS-coded industrial classification. NAICS describes the
industrial capacity of the vendor or recipient.

- **Primary key:** `naics_code` (6-digit numeric string).
- **Entity resolver:** passive, not mergeable. Strong ID =
  `naics_code`.
- **Sources:** `usaspending`, `usaspending_contract`,
  `usaspending_idv`.

### `product_service`

A PSC-coded product or service classification. PSC describes the
specific product or service the federal government purchased; it is
federal-procurement-specific and orthogonal to NAICS.

- **Primary key:** `psc_code` (4-character alphanumeric).
- **Entity resolver:** passive, not mergeable. Strong ID = `psc_code`.
- **Sources:** `usaspending`, `usaspending_contract`,
  `usaspending_idv`.

### `federal_program`

A statutory federal assistance program identified by an Assistance
Listing number (formerly CFDA). Authorized by Congress and used to
classify grants and other financial assistance.

- **Primary key:** `assistance_listing_number` (e.g., `93.778`).
- **Entity resolver:** passive, not mergeable. Strong ID =
  `assistance_listing_number`.
- **Sources:** `usaspending`, `usaspending_grant`.

### `location`

A geographic place — typically a US city + state, or a foreign country.
Created for both the recipient's headquarters address and the place of
performance of an award.

- **Primary key:** named entity (no strong ID). Subject name is built
  by concatenating populated tokens of `[city, state, country]` in
  order, skipping any token that is null or empty. Examples:
  `"LOUISVILLE, KY, USA"`, `"CA, USA"` (city missing),
  `"USA"` (city and state missing). If all three are null, no location
  entity is emitted.
- **Entity resolver:** mergeable named entity (no strong ID), enabling
  soft clustering with locations from other datasets (LDA, FDIC, EDGAR).
- **Sources:** `usaspending_contract`, `usaspending_idv`,
  `usaspending_grant`, `usaspending_subaward`.

### `person`

A senior executive of a recipient organization. USAspending publishes
the top-5 compensated officers of recipients that meet FFATA
executive-compensation reporting thresholds (companies receiving more
than $25M in federal awards in the prior fiscal year with >80%
revenue from federal contracts/grants).

- **Primary key:** named entity (no strong ID); subject name = officer
  full name. Officers with null `name` are skipped at atomization
  time (the API frequently emits placeholder null entries to pad the
  officer array to length 5).
- **Entity resolver:** mergeable named entity, no strong ID
  (USAspending does not provide a person ID).
- **Sources:** `usaspending_contract`, `usaspending_idv`,
  `usaspending_grant`.

---

## Properties

### Organization Properties

Data sources: USAspending Award Detail endpoint
(`/api/v2/awards/{award_id}/`) `recipient` and `awarding_agency` /
`funding_agency` sub-objects; Bulk Subaward CSV columns
(`subawardee_*`); References Agency endpoints
(`/api/v2/references/toptier_agencies/`,
`/api/v2/agency/{toptier_code}/`).

#### Recipient and Sub-Recipient Identity

* `uei`
  * 12-character Unique Entity Identifier assigned by SAM.gov, the
    federal vendor's canonical identifier since April 2022. Strong ID
    for cross-source resolution. Same property name and namespace for
    both prime recipients and sub-recipients.
  * Examples: `"ZE6ZM6NKSV43"` (Humana Government Business),
    `"FYHNA5WC8XD7"` (Lockheed Martin Corp), `"JE73CDQUAPA7"` (CA Dept
    of Health Care Services).
  * Derivation: `recipient.recipient_uei` from award detail for prime
    recipients; `subawardee_uei` column from the bulk Subaward CSV for
    sub-recipients.

* `duns`
  * 9-digit Dun & Bradstreet DUNS number, the legacy federal vendor
    identifier sunset in April 2022. Retained as a secondary strong ID
    for historical merging of pre-2022 records that were never
    cross-walked to a UEI.
  * Examples: `"123456789"`.
  * Derivation: `recipient.recipient_unique_id` from award detail or
    `subawardee_duns` column from bulk Subaward CSV. Null for awards
    or subawards signed after April 2022.

* `parent_recipient_uei`
  * UEI of the recipient's parent corporate entity (ultimate parent in
    the SAM.gov hierarchy). Used to construct the `is_subsidiary_of`
    relationship. **Caveat:** this field reflects the parent-child
    relationship as recorded in SAM.gov at the time the award action
    was reported; SAM.gov hierarchy data lags real-world M&A activity
    by months to years, so `parent_recipient_uei` should be treated as
    a historical / point-in-time signal rather than a current truth.
  * Examples: `"ZE6ZM6NKSV43"` (parent of itself for top-level orgs),
    `"H8KJK8BFQXY6"` (corporate parent).
  * Derivation: `recipient.parent_recipient_uei` from award detail.

* `business_categories`
  * Repeated property; one atom per category the recipient is
    classified as for federal procurement / assistance purposes.
  * Examples: `"Corporate Entity Not Tax Exempt"`,
    `"U.S.-Owned Business"`, `"Small Business"`,
    `"Minority Owned Business"`, `"Government"`,
    `"U.S. Regional/State Government"`.
  * Derivation: each element of `recipient.business_categories` array
    from award detail; for sub-recipients, the `subawardee_business_types`
    column from the bulk Subaward CSV (semicolon-delimited list).

* `physical_address`
  * Recipient headquarters street address formatted as a single
    string.
  * Examples: `"500 W MAIN STREET, LOUISVILLE, KY 40202"`.
  * Derivation: concatenation of `recipient.location.address_line1`,
    `city_name`, `state_code`, `zip5` from award detail. For
    sub-recipients, concatenation of corresponding `subawardee_*`
    columns from the bulk Subaward CSV. Omitted when the underlying
    address line is null.

#### Federal Agency Identity (source: `usaspending`)

* `usaspending_toptier_agency_code`
  * CGAC (Common Government-wide Accounting Code) 3-digit numeric
    identifier of a toptier federal agency (cabinet-level department
    or independent agency). Strong ID.
  * Examples: `"097"` (DOD), `"075"` (HHS), `"070"` (DHS), `"080"`
    (NASA).
  * Derivation: `code` from any of these JSON paths:
    `awarding_agency.toptier_agency` or `funding_agency.toptier_agency`
    in award detail (the pipeline must traverse both to instantiate
    both awarding-side and funding-side toptier organizations), or
    each entry of `/api/v2/references/toptier_agencies/` for the
    reference catalog refresh. The `toptier_agency` object does not
    appear at the JSON root of award detail; it is always nested
    under `awarding_agency` or `funding_agency`.

* `usaspending_subtier_agency_code`
  * 4-character alphanumeric identifier of a subtier agency
    (sub-component of a toptier agency). Strong ID.
  * Examples: `"97DH"` (Defense Health Agency under DOD), `"7530"`
    (CMS under HHS).
  * Derivation: `subtier_agency.code` from award detail.

* `usaspending_agency_abbreviation`
  * Common abbreviation for the agency.
  * Examples: `"DOD"`, `"DHA"`, `"HHS"`, `"CMS"`, `"NASA"`.
  * Derivation: `toptier_agency.abbreviation` or
    `subtier_agency.abbreviation` from award detail.

* `usaspending_agency_slug`
  * URL-safe slug for the agency, suitable for deep-linking back to
    USAspending.gov agency pages.
  * Examples: `"department-of-defense"`,
    `"department-of-health-and-human-services"`.
  * Derivation: `toptier_agency.slug` from award detail.

* `agency_role`
  * Distinguishes federal-agency `organization` records from recipient
    `organization` records.
  * Values: `"federal_agency_toptier"`, `"federal_agency_subtier"`.
  * Derivation: synthesized at atomization time from whether the
    record represents a toptier or subtier agency.

#### Executive Compensation (sources: `usaspending_contract`, `usaspending_idv`, `usaspending_grant`)

* `recipient_top_officer_compensation`
  * Reported annual compensation in USD for a top-5 compensated
    executive of the recipient (FFATA executive-compensation reporting).
    Atom is dual-homed: the value lives on the `organization` record,
    with a `person` sub-record carrying the officer name and the same
    amount.
  * Examples: `1409718.0`, `607266.0`.
  * Derivation: `executive_details.officers[].amount` from award
    detail. Officer entries where both `name` and `amount` are null
    are skipped (the API pads the officers array to length 5 with
    null entries for recipients that report fewer than 5 officers).
    Null for recipients that do not meet FFATA thresholds at all.

### Contract / IDV Award Properties

Data source: USAspending Award Detail endpoint
(`/api/v2/awards/{award_id}/`) for contracts (`category=contract`)
and IDVs (`category=idv`), plus the corresponding columns in the bulk
Award CSV archives during initial backfill.

#### Identifiers

* `generated_unique_award_id`
  * Canonical USAspending award identifier (primary strong ID); a
    structured string combining category, PIID/FAIN, and agency.
  * Examples: `"CONT_AWD_HT940216C0001_9700_-NONE-_-NONE-"`,
    `"CONT_IDV_NNJ16GX08B_8000"`, `"ASST_NON_2505CA5MAP_075"`.
  * Derivation: `generated_unique_award_id` from award detail.
  * Note: USAspending occasionally rewrites these structured IDs
    (e.g., the July 2025 change that swapped subtier for toptier codes
    in some grant IDs). The resolver uses both this property and
    `usaspending_internal_id` as strong IDs to absorb such aliasing
    without splitting entities.

* `usaspending_internal_id`
  * Stringified integer database key from USAspending's internal
    schema. Stable across `generated_unique_award_id` rewrites, and
    accepted as `award_id` by detail endpoints that use either form.
    Treated as a secondary strong ID for alias-tolerant routing.
  * Examples: `"307885715"`, `"236536428"`.
  * Derivation: `id` from award detail or `internal_id` from search
    results.

* `piid`
  * Procurement Instrument Identifier — the official FPDS contract
    number, unique within an agency.
  * Examples: `"HT940216C0001"`, `"NNJ16GX08B"`, `"DENA0003525"`.
  * Derivation: `piid` from award detail.

* `parent_award_piid`
  * PIID of the IDV under which this contract was awarded
    (delivery/task orders only). Carried as a searchable property
    only; **not** used as the topological anchor for the `child_of`
    edge to the parent IDV, because the IDV's strong ID is its
    `generated_unique_award_id`, not its PIID. Pointing the edge at
    the PIID would result in a dangling reference.
  * Examples: `"HHM402-15-D-0021"`.
  * Derivation: `parent_award.piid` from award detail. Null for
    standalone contracts.

* `parent_award_unique_id`
  * `generated_unique_award_id` of the parent IDV under which this
    contract was awarded (delivery/task orders only). This is the
    field used to construct the `child_of` edge pointing from a
    contract to its parent IDV.
  * Examples: `"CONT_IDV_HHM40215D0021_9700"`.
  * Derivation: `parent_award.generated_unique_award_id` from award
    detail (verify the exact field name at streamer-implementation
    time using a real delivery-order sample; `parent_award.award_id`
    mapped to `usaspending_internal_id` is the documented fallback if
    the string ID is unavailable). Null for standalone contracts.

* `award_type_code`
  * Single-character (or short) award-type code.
  * Values for contracts: `"A"`, `"B"`, `"C"`, `"D"`. Values for IDVs:
    `"IDV_A"` through `"IDV_E"` (plus `"IDV_B_A"`, `"IDV_B_B"`,
    `"IDV_B_C"`).
  * Derivation: `type` from award detail.

* `award_type_description`
  * Human-readable award-type label.
  * Examples: `"DEFINITIVE CONTRACT"`, `"PURCHASE ORDER"`,
    `"GWAC Government Wide Acquisition Contract"`.
  * Derivation: `type_description` from award detail.

* `award_description`
  * Free-text description of the contract scope of work.
  * Examples: `"MANAGEMENT AND OPERATION OF THE OAK RIDGE NATIONAL
    LABORATORY"`, `"IGF::OT::IGF"`.
  * Derivation: `description` from award detail.

#### Financials

* `total_obligation`
  * Aggregate federal obligation in USD across all transactions to
    date. May decrease over time when transactions deobligate funds.
  * Examples: `51269205263.03`, `42111665692.01`, `-2500000.0`
    (rare but valid: net deobligation across modifications).
  * Derivation: `total_obligation` from award detail.

* `base_and_all_options`
  * Total potential contract value including all unexercised options,
    in USD. Represents the ceiling of the award. Always `0.0` for many
    IDV types (e.g., BPAs and BOAs) which are unfunded parent vehicles
    whose value lives on their child delivery orders.
  * Examples: `56620536577.19`, `0.0`.
  * Derivation: `base_and_all_options` from award detail.

* `base_exercised_options`
  * Total contract value of the base period plus options exercised to
    date, in USD.
  * Examples: `52641654181.19`.
  * Derivation: `base_exercised_options` from award detail.

* `total_outlay`
  * Cumulative outlays (cash payments) made against the award, in USD.
  * Examples: `100066943940.16`.
  * Derivation: `total_outlay` from award detail. Null when not yet
    reported by the awarding agency.

#### Performance Period

* `award_start_date`
  * Period-of-performance start date in YYYY-MM-DD format.
  * Examples: `"2016-08-01"`, `"1999-10-15"`.
  * Derivation: `period_of_performance.start_date` from award detail.

* `award_end_date`
  * Period-of-performance current end date in YYYY-MM-DD format
    (reflects exercised options).
  * Examples: `"2025-12-31"`, `"2030-03-31"`.
  * Derivation: `period_of_performance.end_date` from award detail.

* `award_potential_end_date`
  * Period-of-performance potential end date including all options.
  * Examples: `"2030-03-31"`.
  * Derivation: `period_of_performance.potential_end_date` from award
    detail.

* `award_last_modified_date`
  * Date the award record was most recently updated in USAspending,
    used as the streamer's incremental cursor.
  * Examples: `"2026-02-10"`.
  * Derivation: `period_of_performance.last_modified_date` from award
    detail.

* `award_date_signed`
  * Date the contract was originally signed.
  * Examples: `"2016-07-29"`.
  * Derivation: `date_signed` from award detail.

#### Classification

* `naics_code`
  * 6-digit NAICS industry code assigned to the contract. Strong ID
    for `industry` flavor; also stored as a property on the award.
  * Examples: `"524114"`, `"561210"`, `"541512"`.
  * Derivation: `latest_transaction_contract_data.naics` or
    `naics_hierarchy.base_code.code` from award detail.

* `psc_code`
  * 4-character Product/Service Code assigned to the contract. Strong
    ID for `product_service` flavor; also stored as a property on the
    award.
  * Examples: `"Q201"`, `"M181"`, `"1555"`.
  * Derivation:
    `latest_transaction_contract_data.product_or_service_code` or
    `psc_hierarchy.base_code.code` from award detail.

#### Procurement Procedure (sources: `usaspending_contract`, `usaspending_idv`)

These properties characterize the procedural and regulatory environment
under which a contract was awarded. They live on the contract / IDV
entity and are derived from `latest_transaction_contract_data` in the
award detail response.

* `solicitation_identifier`
  * Identifier of the original solicitation (Request for Proposal /
    Request for Quote) that led to this award. Enables lifecycle
    tracking from RFP to execution.
  * Examples: `"HT940215R0002"`.
  * Derivation:
    `latest_transaction_contract_data.solicitation_identifier`.

* `offers_received_count`
  * Number of offers received in response to the solicitation. Key
    competition metric.
  * Examples: `4`, `1`.
  * Derivation:
    `latest_transaction_contract_data.number_of_offers_received`
    (parsed from string to integer).

* `extent_competed_description`
  * Description of the level of competition.
  * Examples: `"FULL AND OPEN COMPETITION"`, `"NOT COMPETED"`,
    `"FOLLOW ON TO COMPETED ACTION"`.
  * Derivation:
    `latest_transaction_contract_data.extent_competed_description`.

* `type_set_aside_description`
  * Small-business set-aside designation, if any.
  * Examples: `"NO SET ASIDE USED."`, `"SMALL BUSINESS SET ASIDE -
    TOTAL"`, `"8A COMPETED"`.
  * Derivation:
    `latest_transaction_contract_data.type_set_aside_description`.

* `type_of_contract_pricing_description`
  * Pricing structure of the contract.
  * Examples: `"COST PLUS FIXED FEE"`, `"FIRM FIXED PRICE"`,
    `"TIME AND MATERIALS"`.
  * Derivation:
    `latest_transaction_contract_data.type_of_contract_pricing_description`.

* `commercial_item_acquisition_type`
  * Whether the government used FAR Part 12 commercial-item
    procedures (vs. standard procurement). Key metric for defense
    acquisition research.
  * Examples: `"COMMERCIAL PRODUCTS/SERVICES PROCEDURES NOT USED"`,
    `"COMMERCIAL PRODUCTS/SERVICES PROCEDURES USED"`.
  * Derivation:
    `latest_transaction_contract_data.commercial_item_acquisition_description`.

* `labor_standards_apply`
  * Whether Service Contract Act or Davis-Bacon Act labor standards
    apply to the contract.
  * Values: `"YES"`, `"NO"`, occasionally null.
  * Derivation:
    `latest_transaction_contract_data.labor_standards_description`.

* `entity_ownership_type`
  * Whether the prime contractor is US-owned or foreign-owned.
  * Examples: `"U.S. OWNED BUSINESS"`, `"FOREIGN-OWNED BUSINESS NOT
    INCORPORATED IN THE U.S."`.
  * Derivation:
    `latest_transaction_contract_data.domestic_or_foreign_entity_description`.

* `subcontracting_plan_type`
  * Whether the prime contractor maintains an individual or commercial
    subcontracting plan, or none.
  * Examples: `"INDIVIDUAL SUBCONTRACT PLAN"`, `"COMMERCIAL
    SUBCONTRACT PLAN"`, `"PLAN NOT REQUIRED"`.
  * Derivation:
    `latest_transaction_contract_data.subcontracting_plan_description`.

* `is_multi_year_contract`
  * Whether the contract is a statutorily defined multi-year
    procurement (vs. annual with options).
  * Values: `"YES"`, `"NO"`.
  * Derivation:
    `latest_transaction_contract_data.multi_year_contract_description`.

#### Subaward Rollups

* `subaward_count`
  * Total number of subawards reported under this prime contract.
  * Examples: `145`, `0`.
  * Derivation: `subaward_count` from award detail.

* `total_subaward_amount`
  * Aggregate dollar value of subawards reported under this prime
    contract, in USD.
  * Examples: `1079551766.05`.
  * Derivation: `total_subaward_amount` from award detail.

### Grant Award Properties

Data source: USAspending Award Detail endpoint
(`/api/v2/awards/{award_id}/`) for grants (`category=grant`), plus the
corresponding columns in the bulk Award CSV archives during initial
backfill.

Grants share these common award properties with contracts/IDVs:
`generated_unique_award_id`, `usaspending_internal_id`,
`award_type_code`, `award_type_description`, `award_description`,
`total_obligation`, `total_outlay`, `award_start_date`,
`award_end_date`, `award_last_modified_date`, `award_date_signed`,
`subaward_count`, `total_subaward_amount`.

Grant-specific properties:

* `fain`
  * Federal Award Identification Number — the canonical grant ID.
  * Examples: `"2505CA5MAP"`, `"R01HL123456"`.
  * Derivation: `fain` from award detail.

* `assistance_listing_number`
  * Assistance Listing number (formerly CFDA number), identifying the
    federal program the grant funds. Strong ID for `federal_program`
    flavor; also stored as a property on the grant.
  * Examples: `"93.778"` (Medicaid), `"84.027"` (Special Education),
    `"81.087"` (Renewable Energy R&D).
  * Derivation: `cfda_info[0].cfda_number` from award detail.

* `total_funding`
  * Total funding amount including federal and non-federal share, in
    USD. Equals `total_obligation + non_federal_funding`.
  * Examples: `100096643196.0`.
  * Derivation: `total_funding` from award detail.

* `non_federal_funding`
  * Required non-federal cost-share contribution to the grant, in USD.
  * Examples: `0.0`, `25000000.0`.
  * Derivation: `non_federal_funding` from award detail.

* `funding_opportunity_number`
  * Reference to the funding opportunity (Notice of Funding
    Opportunity / NOFO) under which the grant was awarded. Often
    `"NOT APPLICABLE"` for entitlement programs.
  * Examples: `"HHS-2024-CMS-NHSN-001"`, `"NOT APPLICABLE"`.
  * Derivation: `funding_opportunity.number` from award detail.

### Transaction Properties

Data source: USAspending Transactions endpoint
(`/api/v2/transactions/?award_id={award_id}`), enumerated per parent
award (the endpoint accepts both the string `generated_unique_award_id`
and the integer `internal_id` as `award_id`).

* `transaction_unique_id`
  * Canonical USAspending transaction identifier (strong ID).
  * Examples: `"CONT_TX_9700_-NONE-_HT940216C0001_P00713_-NONE-_0"`.
  * Derivation: `id` from transactions list response.

* `transaction_action_date`
  * Date the modification action was effective, in YYYY-MM-DD.
  * Examples: `"2026-02-10"`, `"2025-12-30"`.
  * Derivation: `action_date` from transactions list.

* `transaction_action_type`
  * Single-character code identifying the action type.
  * Values: `"A"` (additional work / new contract), `"B"`
    (supplemental), `"C"` (funding only action), `"D"` (change
    order), etc.
  * Derivation: `action_type` from transactions list.

* `transaction_action_type_description`
  * Human-readable action-type label.
  * Examples: `"CHANGE ORDER"`, `"FUNDING ONLY ACTION"`, `"DEFINITIVE
    CONTRACT"`.
  * Derivation: `action_type_description` from transactions list.

* `transaction_modification_number`
  * Modification number assigned to this transaction (FPDS uses
    sequential strings like `P00001`, `P00002`).
  * Examples: `"P00713"`, `"M01"`, `"0"` (base award).
  * Derivation: `modification_number` from transactions list.

* `transaction_description`
  * Free-text description of the modification.
  * Examples: `"MANAGED CARE SUPPORT SERVICES - EAST REGION"`,
    `"OPTION YEAR 3"`.
  * Derivation: `description` from transactions list.

* `transaction_federal_action_obligation`
  * Dollar change to the federal obligation effected by this
    transaction, in USD. Positive (additional funding), negative
    (deobligation due to descoping or closeout), or zero
    (administrative modification with no funding impact).
  * Examples: `80000000.0`, `-2500000.0`, `0.0`.
  * Derivation: `federal_action_obligation` from transactions list.

### Subaward Properties

> **Implementation status (2026-05-23):** the property derivations
> below are the planned A9.5d shape sourced from bulk subaward CSVs
> (`All_Contracts_Subawards_*.csv` / `All_Assistance_Subawards_*.csv`)
> obtained via the asynchronous `/api/v2/bulk_download/awards/` job
> endpoint. **Today's implementation** sources these properties from
> `/api/v2/search/spending_by_award/?subawards=true` — which omits
> `subawardee_uei` and `subawardee_duns` from its list response, so
> sub-recipient strong-IDs are partial until A9.5d ships. See
> `GUIDANCE_LOG.md` "Reconnaissance: bulk-subaward path correction"
> (2026-05-23) for the migration plan.
>
> An earlier revision of this document claimed static monthly
> `Contracts_Subawards.csv` files exist at `files.usaspending.gov`.
> They do not — the USAspending "Award Data Archive" download page
> offers Contracts and Financial Assistance archive types only.
> Subaward CSVs are generated on demand via the async job endpoint.

Data source (planned, A9.5d): bulk subaward CSVs produced by
`POST /api/v2/bulk_download/awards/` with
`sub_award_types=[procurement, grant]`. CSV column names below are
verified against a real 2026-05-23 download. The
`/api/v2/subawards/?award_id=...` REST endpoint provides a small
subset of these fields but omits `subawardee_uei` / `subawardee_duns`,
so it is not used for ingestion.

* `usaspending_subaward_id`
  * Internal numeric ID of the subaward record from the SAM Subaward
    Reporting System (the successor to FSRS); globally unique.
    Strong ID.
  * Examples: `"797093"`, `"775895"`.
  * Derivation: stringified `subaward_sam_report_id` column from the
    bulk Subaward CSV. (The USAspending API exposes this same field
    as `internal_id`; the column name `id` belongs to the REST API
    response, not the bulk CSV. Verify the exact column header at
    streamer-implementation time against a real CSV download.)

* `prime_award_unique_key`
  * `generated_unique_award_id` of the prime award under which this
    subaward was reported. The field used to construct the
    `[under_prime]` edge from a subaward to its prime contract or
    prime grant.
  * Examples: `"CONT_AWD_HT940216C0001_9700_-NONE-_-NONE-"`,
    `"ASST_NON_2505CA5MAP_075"`.
  * Derivation: `prime_award_unique_key` column from the bulk
    Subaward CSV. (Documented in
    `usaspending_api/download/v2/download_column_historical_lookups.py`
    in the upstream usaspending-api repo as the FFATA prime-link
    column.)

* `subaward_number`
  * Sub-recipient-assigned subaward number; not globally unique across
    primes.
  * Examples: `"WPS-16-C-0001"`, `"5028514"`.
  * Derivation: `subaward_number` column from bulk Subaward CSV.

* `subaward_action_date`
  * Date of the subaward action in YYYY-MM-DD.
  * Examples: `"2016-08-02"`, `"2022-12-29"`.
  * Derivation: `subaward_action_date` column from bulk Subaward CSV.

* `subaward_amount`
  * Dollar value of the subaward, in USD.
  * Examples: `486548157.0`, `120800889.2`.
  * Derivation: `subaward_amount` column from bulk Subaward CSV.

* `subaward_description`
  * Free-text description of the subaward scope.
  * Examples: `"FISCAL INTERMEDIARY SERVICES FOR TRICARE 2017 EAST
    REGION."`.
  * Derivation: `subaward_description` column from bulk Subaward CSV.

### Industry / Product Service / Federal Program Properties

Data source: derived during atomization from contract / IDV / grant
award detail; classification reference data from
`/api/v2/references/naics/`, `/api/v2/references/filter_tree/psc/`,
and `/api/v2/references/assistance_listing/`.

#### NAICS

* `naics_code`
  * 6-digit NAICS industry code. Strong ID for `industry` flavor.
  * Examples: `"524114"`, `"561210"`, `"541512"`.
  * Derivation: same as award `naics_code` property; the value becomes
    the strong ID of an `industry` entity.

* `naics_description`
  * Human-readable NAICS title.
  * Examples: `"DIRECT HEALTH AND MEDICAL INSURANCE CARRIERS"`,
    `"FACILITIES SUPPORT SERVICES"`.
  * Derivation: `latest_transaction_contract_data.naics_description`
    or `naics_hierarchy.base_code.description` from award detail.

#### PSC

* `psc_code`
  * 4-character PSC code. Strong ID for `product_service` flavor.
  * Examples: `"Q201"`, `"M181"`, `"1555"`.
  * Derivation: same as award `psc_code` property.

* `psc_description`
  * Human-readable PSC label.
  * Examples: `"MEDICAL- MANAGED HEALTHCARE"`, `"OPER OF GOVT R&D
    GOCO FACILITIES"`.
  * Derivation: `psc_hierarchy.base_code.description` from award
    detail.

#### Assistance Listing (Federal Program)

* `assistance_listing_number`
  * Assistance Listing (CFDA) number. Strong ID for `federal_program`
    flavor.
  * Examples: `"93.778"`, `"84.027"`.
  * Derivation: same as grant `assistance_listing_number` property.

* `assistance_listing_title`
  * Human-readable assistance program title.
  * Examples: `"Grants to States for Medicaid"`.
  * Derivation: `cfda_info[0].cfda_title` from grant award detail.

* `assistance_listing_applicant_eligibility`
  * Description of which entities are legally eligible to apply for
    this assistance program (e.g., state/local governments,
    non-profits, individuals).
  * Examples: `"State and local welfare agencies must operate under
    an HHS-approved Medicaid State Plan..."`.
  * Derivation: `cfda_info[0].applicant_eligibility` from grant award
    detail.

* `assistance_listing_beneficiary_eligibility`
  * Description of the ultimate end-users of the program funds.
  * Examples: `"Low-income persons who are over age 65, blind or
    disabled, members of families with dependent children..."`.
  * Derivation: `cfda_info[0].beneficiary_eligibility` from grant
    award detail.

* `assistance_listing_objectives`
  * Description of the programmatic goals of the assistance program.
  * Examples: `"To provide financial assistance to States for
    payments of medical assistance on behalf of cash assistance
    recipients..."`.
  * Derivation: `cfda_info[0].cfda_objectives` from grant award
    detail.

### Location Properties

Data source: `recipient.location` and `place_of_performance`
sub-objects of award detail; corresponding `*_location_*` columns of
the bulk Subaward CSV.

* `location_country_code`
  * ISO 3166-1 alpha-3 country code.
  * Examples: `"USA"`, `"GBR"`, `"DEU"`.
  * Derivation: `location_country_code` from recipient or
    place_of_performance.

* `location_state_code`
  * Two-character US state code; null for non-US locations.
  * Examples: `"KY"`, `"CA"`, `"VA"`.
  * Derivation: `state_code` from recipient or place_of_performance.

* `location_congressional_district`
  * US congressional district code (state + 2-digit district number
    is canonical; this field stores just the 2-digit district).
  * Examples: `"03"`, `"01"`, `"AL"` (at-large).
  * Derivation: `congressional_code` from recipient or
    place_of_performance.

### Person Properties

Data source: `executive_details.officers` from award detail.

* `recipient_top_officer_compensation`
  * (See Organization Properties above — atom is dual-homed on the
    `person` sub-record and the `organization` record.)

---

## Entity Relationships Summary

```
usaspending::contract  ──[awarded_to]──────────→  organization   (recipient by UEI)
usaspending::contract  ──[awarded_by]──────────→  organization   (awarding subtier agency)
usaspending::contract  ──[funded_by]───────────→  organization   (funding subtier agency)
usaspending::contract  ──[performed_at]────────→  location       (place of performance)
usaspending::contract  ──[in_industry]─────────→  industry       (NAICS)
usaspending::contract  ──[procured_product]────→  product_service(PSC)
usaspending::contract  ──[child_of]────────────→  usaspending::idv   (delivery/task orders)

usaspending::idv       ──[awarded_to]──────────→  organization
usaspending::idv       ──[awarded_by]──────────→  organization
usaspending::idv       ──[funded_by]───────────→  organization
usaspending::idv       ──[performed_at]────────→  location
usaspending::idv       ──[in_industry]─────────→  industry
usaspending::idv       ──[procured_product]────→  product_service

usaspending::grant     ──[awarded_to]──────────→  organization   (recipient by UEI)
usaspending::grant     ──[awarded_by]──────────→  organization   (awarding subtier agency)
usaspending::grant     ──[funded_by]───────────→  organization   (funding subtier agency)
usaspending::grant     ──[performed_at]────────→  location
usaspending::grant     ──[funded_program]──────→  federal_program(assistance listing)

usaspending::transaction ──[is_modification_of]→  usaspending::contract | ::idv | ::grant

usaspending::subaward  ──[awarded_to]──────────→  organization   (sub-recipient by UEI from bulk CSV)
usaspending::subaward  ──[under_prime]─────────→  usaspending::contract | ::grant
usaspending::subaward  ──[subcontracted_from]──→  organization   (prime recipient, redundant edge for graph traversal)

organization (subtier agency)  ──[child_of]────→  organization   (toptier agency)
organization (recipient)       ──[is_subsidiary_of]→ organization (parent recipient by UEI)
organization                    ──[is_located_at]→   location
person                          ──[employed_by]──→   organization   (FFATA top-5 officers)
```

**Note on agency layering:** `awarded_by` and `funded_by` point at the
**subtier** agency directly. The corresponding **toptier** agency is
reachable via one hop along the subtier's `child_of` edge. This avoids
duplicating awarded-by edges at both layers while preserving full
traceability.

---

## Citations

Primary citation for each award atom is a public URL on
USAspending.gov:

- Award canonical URL:
  `https://www.usaspending.gov/award/{generated_unique_award_id}/`
  (the integer `usaspending_internal_id` is an equally valid path:
  `/award/{usaspending_internal_id}/`, used as a fallback when the
  string ID has been rewritten).
- Recipient profile URL:
  `https://www.usaspending.gov/recipient/{recipient_hash}/all`
  (the `-C` / `-P` / `-R` suffix on `recipient_hash` denotes Child /
  Parent / general Recipient levels respectively).
- Agency profile URL:
  `https://www.usaspending.gov/agency/{agency_slug}`.

Transaction atoms cite the same URL as their parent award. Subaward
atoms cite the parent award URL plus the subaward internal id.

---

## Cadence, Backfill, and Volume Notes

### Cadence

| Phase | Frequency | Mechanism |
|-------|-----------|-----------|
| Initial backfill — prime awards (FY2008 → onboarding date) | Once on cold start | Pre-built Bulk Award CSV archives from `files.usaspending.gov/award_data_archive/`. **The prime Award archives are not monolithic**: USAspending publishes per-Agency × per-Fiscal-Year ZIPs under the "Award Data Archive" path (enumerated via `/api/v2/bulk_download/list_monthly_files/`), so the streamer iterates the (toptier-agency × FY2008..present) matrix (~hundreds of ZIPs) to cover the full historical seed. |
| Initial backfill — subawards (FY2008 → onboarding date) | Once on cold start | **Today:** `/api/v2/search/spending_by_award/?subawards=true`, partitioned (FY × group × calendar-month) to stay under the API's 100k-row hard cap. **Planned (A9.5d):** asynchronous bulk-download jobs against `/api/v2/bulk_download/awards/` with `sub_award_types`, which return `All_Contracts_Subawards_*.csv` / `All_Assistance_Subawards_*.csv` ZIPs with no row cap and full `subawardee_uei`/`subawardee_duns` fidelity. There is no static pre-built subaward archive at `files.usaspending.gov` — bulk subaward CSVs are job-generated on demand. |
| Daily incremental — prime awards | Daily | API `spending_by_award` filtered on `last_modified_date >= now - 30d`, then per-award detail and transactions enumeration |
| Daily subaward delta | Daily | **Today:** same search API path (no UEI fidelity in list response). **Planned (A9.5d):** daily bulk-download job restricted to the lookback window. |
| Reference catalogs (toptier agencies, NAICS, PSC, assistance listings) | Weekly | API reference endpoints |

USAspending refreshes nightly from FPDS (next-day) and FABS (weekly to
bi-weekly). The 30-day lookback window on the daily delta absorbs late
corrections and FABS lag.

### Hard Limits

- **API rate limit:** ~1,000 requests per 5 minutes per IP address
  (~200 req/min sustained).
- **Search pagination ceiling:** 10,000 records per single query on
  `spending_by_award` and related search endpoints. The daily delta
  enumeration must slice queries by `last_modified_date` (and, if
  needed, agency or award category) to stay under this wall.
- **Earliest search date:** API queries are limited to `2007-10-01`
  and later (FY2008). Earlier data (back to FY2001) is only available
  via bulk download.

### Volume Estimates (v0 scope, FY2008 → present)

- Contracts: ~30M prime award records, ~120M transactions.
- IDVs: ~200K prime award records.
- Grants: ~3M prime award records, ~15M transactions.
- Subawards: ~5M total under in-scope primes.

These volumes confirm that bulk-CSV backfill is required: even at the
maximum sustained API throughput (~12,000 req/hr), per-record API
backfill of 170M records would take ~590 contiguous days. The bulk
archives provide the same data in ZIPped CSV form, downloadable in
hours rather than years.

---

## Acknowledged Minor Gaps and Deferred Items

These items were flagged in the Deep Research dictionary review
(round 1) and either documented as caveats above or explicitly
deferred:

- **Account-level financials** (`total_account_obligation`,
  `total_account_outlay`, per-DEFC breakdowns): deferred to the
  Federal Account / TAS future-scope item. Higher-resolution auditing
  is not required for v0 KG querying.
- **Funding Opportunity (NOFO) entity:** kept as a string property
  on grants (`funding_opportunity_number`) rather than promoting to a
  standalone entity. NOFO data is sparse and frequently
  `"NOT APPLICABLE"`; promotion can revisit if downstream consumers
  need cross-grant correlation by NOFO.
- **`generated_unique_award_id` aliasing:** documented as a caveat on
  the property itself; resolver carries both the string ID and
  `usaspending_internal_id` as strong IDs so historical rewrites do
  not split entities.
- **Zero-dollar IDVs and negative-obligation transactions:** documented
  inline in the relevant property descriptions.
- **`parent_recipient_uei` lag:** documented as a caveat; treated as
  point-in-time rather than current truth.
- **Indirect Cost Rates (OMB M-21-03):** captured in the future-scope
  list; USAspending has not yet surfaced these in API responses.
- **Cross-source resolution to EDGAR (CIK), GLEIF (LEI):** captured in
  the future-scope list; v0 publishes UEI as the strong ID so any
  future crosswalk has a clean merge target.
