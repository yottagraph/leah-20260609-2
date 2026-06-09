# Data Dictionary: FDIC

## Purpose

This dictionary documents the entity types, properties, and relationships that the FDIC source contributes to the Lovelace knowledge graph.

FDIC ingests data from the Federal Deposit Insurance Corporation's BankFind Suite API (`https://api.fdic.gov/banks/`), which provides public data on all FDIC-insured depository institutions in the United States. The source covers:

- **Institution profiles**: identity, location, charter, and regulatory information for ~4,300 active and ~27,800 total (including inactive) FDIC-insured banks and thrifts
- **Quarterly financial data**: balance sheet and income statement figures from Call Reports (FFIEC 031/041/051), updated quarterly with data back to 1984
- **Bank failures**: all 4,100+ FDIC-insured institution failures since 1934, including resolution details and acquiring institution

Financial figures are reported in thousands of USD as filed in Call Reports. Not all institutions report all fields; smaller banks (FFIEC 051 filers) report a reduced set.

**Source names used on records:**

| Pipeline | `Record.Source` |
|----------|----------------|
| Institution profiles + financials | `fdic` |
| Bank failures | `fdic_failure` |
| Structure-change events (mergers, consolidations, name changes, regulator changes, failures, voluntary closings, etc.) | `fdic_history` |

---

## Entity Types

### `organization`

An FDIC-insured depository institution (commercial bank, savings bank, savings association, or industrial bank).

- Primary key: `fdic_certificate_number` (FDIC Certificate Number, unique identifier assigned to each insured institution)
- Entity resolver: named entity. Strong ID = `fdic_certificate_number`. Disambiguation context includes institution name, city, state, and holding company name. Prior names serve as aliases.
- Sources: `fdic`, `fdic_failure`, `fdic_history`

### `bank_structure_event`

A structure-change transaction recorded by the FDIC against an FDIC-insured (or FDIC-tracked) depository institution. Each row in the FDIC History API at the institution level (`ORG_ROLE_CDE = "FI"`) becomes one `bank_structure_event` entity. This single flavor covers the full breadth of FI-level CHANGECODEs the FDIC tracks: unassisted mergers, consolidations, absorptions, FDIC-assisted resolutions, voluntary closings, new charters, name changes, regulator and chartering-agency changes, class changes, and trust-power grants (among others).

This event-as-entity model lets a single FDIC transaction be queried as a first-class graph object with explicit relationships to every party involved. It is intentionally emitted in parallel with two simpler direct bank-to-bank edges: the existing `acquired_by` edge on failed-bank `organization` entities (sourced from `fdic_failure`) and the new general `succeeded_by` edge on disappearing `organization` entities (sourced from `fdic_history`). Both direct edges and the `bank_structure_event` entity coexist permanently — they are redundant by design so consumers can pick whichever shape fits their query.

- Primary key: `fdic_transaction_number` (FDIC's `TRANSNUM`, a globally unique transaction identifier) for the ~91% of FI-level events that are transaction-backed; the ~9% of events with `TRANSNUM = 0` (~16K of ~185K rows, dominated by ~14K `CC = 1` "Institution Established" plus location changes, cert reassignments, charter changes, etc.) instead use `fdic_history_event_id` (the row's `ID` field, a composite of effective date + CHANGECODE + an internal identifier, unique per row).
- Entity resolver: named entity. Strong ID is `fdic_transaction_number` when `TRANSNUM > 0`, otherwise `fdic_history_event_id`. The two strong-ID properties are mutually exclusive for any given event. Disambiguation context includes the change description, effective date, and the names of the affected institutions.
- Sources: `fdic_history`
- Naming: deterministic, derived from the parties and CHANGECODE_DESC. Examples:
  - `"FDIC TXN 2026008583 — Merger -Without Assistance: Flint Hills Bank → The Bennington State Bank (2026-04-08)"`
  - `"FDIC TXN 2026007976 — Change in Legal Name (FO or BR): ASSOCIATED CREDIT UNION → Openland Credit Union (2026-04-02)"`
  - `"FDIC TXN 2026007610 — Closing - Voluntary: 1st Bank Yuma (2026-03-31)"`

---

## Properties

### Organization Properties

#### Identity and Registration (source: `fdic`)

Data source: FDIC BankFind Suite Institutions API (`https://api.fdic.gov/banks/institutions`).

* `fdic_certificate_number`
  * The FDIC Certificate Number uniquely identifying this insured institution. Also serves as the entity's strong ID for resolution.
  * Examples: `"628"` (JPMorgan Chase Bank, N.A.), `"3850"` (First Community Bank)
  * Derivation: `CERT` field from the Institutions API response.

* `fed_rssd_id`
  * Federal Reserve RSSD ID, a unique identifier assigned by the Federal Reserve to every financial institution, branch, and office.
  * Examples: `"852218"`, `"242"`
  * Derivation: `FED_RSSD` field from the Institutions API response.

* `physical_address`
  * Headquarters street address formatted as a single string.
  * Examples: `"1111 Polaris Pkwy, Columbus, OH 43240"`, `"101 Main St, Xenia, IL 62899"`
  * Derivation: `ADDRESS`, `CITY`, `STALP`, `ZIP` fields concatenated from the Institutions API response.

* `charter_class`
  * FDIC institution charter class code describing the type of charter and regulatory supervision.
  * Examples: `"N"` (national bank, OCC-supervised), `"SM"` (state-chartered, Fed member), `"NM"` (state-chartered, non-Fed-member), `"SB"` (savings bank), `"SA"` (savings association)
  * Derivation: `BKCLASS` field from the Institutions API response.

* `regulatory_agency`
  * The primary federal regulatory agency supervising this institution.
  * Examples: `"OCC"` (Office of the Comptroller of the Currency), `"FED"` (Federal Reserve), `"FDIC"` (Federal Deposit Insurance Corporation)
  * Derivation: `REGAGNT` field from the Institutions API response.

* `established_date`
  * Date the institution was established, formatted as YYYY-MM-DD.
  * Examples: `"1824-01-01"`, `"1934-01-01"`
  * Derivation: `ESTYMD` field from the Institutions API response, reformatted from MM/DD/YYYY.

* `fdic_insurance_date`
  * Date the institution obtained FDIC insurance, formatted as YYYY-MM-DD.
  * Examples: `"1934-01-01"`, `"2005-06-15"`
  * Derivation: `INSDATE` field from the Institutions API response, reformatted from MM/DD/YYYY.

* `active_flag`
  * Whether the institution is currently active (open and operating).
  * Values: `1.0` = active, `0.0` = inactive
  * Derivation: `ACTIVE` field from the Institutions API response, stored as float.

* `holding_company_name`
  * Name of the top-tier bank holding company, if any.
  * Examples: `"JPMORGAN CHASE&CO"`, `"FIRST COMMUNITY BANCSHARES"`
  * Derivation: `NAMEHCR` field from the Institutions API response. Omitted when the institution is not part of a holding company.

* `website`
  * The institution's primary website URL.
  * Examples: `"www.jpmorganchase.com"`, `"www.fcbanking.com"`
  * Derivation: `WEBADDR` field from the Institutions API response. Omitted when blank.

* `fdic_geographic_region`
  * FDIC supervisory region name.
  * Examples: `"Chicago"`, `"Atlanta"`, `"Dallas"`
  * Derivation: `FDICREGN` field from the Institutions API response.

* `institution_category`
  * FDIC specialization group description classifying the institution by size and type.
  * Examples: `"International Specialization"`, `"ALL OTHER UNDER 1 BILLION"`, `"ALL OTHER 1 TO 10 BILLION"`
  * Derivation: `SPECGRPN` field from the Institutions API response.

* `office_count`
  * Total number of offices (branches) operated by the institution, including domestic and foreign.
  * Examples: `5320.0`, `1.0`, `25.0`
  * Derivation: `OFFICES` field from the Institutions API response, stored as float.

* `former_name`
  * A previous legal name of the institution. One property value per prior name entry.
  * Examples: `"Chemical Bank"`, `"The Chase Manhattan Bank"`
  * Derivation: `PRIORNAME1` through `PRIORNAME6` fields from the Institutions API response. Each non-empty prior name produces a separate atom. Prior names also serve as aliases for entity resolution.

#### Financial Data (source: `fdic`)

Data source: FDIC BankFind Suite Financials API (`https://api.fdic.gov/banks/financials`). All dollar amounts are in thousands of USD as reported in Call Reports. Updated quarterly; the `REPDTE` field indicates the report period end date.

* `total_assets`
  * Total assets of the institution as reported in Call Reports.
  * Unit: thousands of USD
  * Examples: `3752662000.0` (JPMorgan Chase, Q4 2025), `56044.0` (First Community Bank)
  * Derivation: `ASSET` field from the Financials API response, stored as float.

* `total_deposits`
  * Total deposits held by the institution.
  * Unit: thousands of USD
  * Examples: `2697842000.0`, `47678.0`
  * Derivation: `DEP` field from the Financials API response, stored as float.

* `total_liabilities`
  * Total liabilities.
  * Unit: thousands of USD
  * Derivation: `LIAB` field from the Financials API response, stored as float.

* `shareholders_equity`
  * Total equity capital.
  * Unit: thousands of USD
  * Derivation: `EQ` field from the Financials API response, stored as float.

* `net_income`
  * Net income (loss) for the reporting period. Negative for losses.
  * Unit: thousands of USD
  * Derivation: `NETINC` field from the Financials API response, stored as float.

* `net_loans_and_leases`
  * Net loans and leases after deducting allowance for loan losses.
  * Unit: thousands of USD
  * Derivation: `LNLSNET` field from the Financials API response, stored as float.

* `insured_deposits`
  * Estimated amount of insured deposits (covered by FDIC insurance, up to $250K per depositor).
  * Unit: thousands of USD
  * Derivation: `DEPINS` field from the Financials API response, stored as float.

* `uninsured_deposits`
  * Estimated amount of deposits exceeding FDIC insurance coverage limits.
  * Unit: thousands of USD
  * Derivation: `DEPUNINS` field from the Financials API response, stored as float.

* `return_on_assets`
  * Return on assets (annualized net income as a percentage of average total assets).
  * Examples: `1.34`, `1.42`
  * Derivation: `ROA` field from the Financials API response, stored as float. Expressed as a percentage.

* `return_on_equity`
  * Return on equity (annualized net income as a percentage of average total equity).
  * Examples: `15.32`, `16.87`
  * Derivation: `ROE` field from the Financials API response, stored as float. Expressed as a percentage.

* `net_interest_margin`
  * Net interest margin (net interest income as a percentage of average earning assets).
  * Examples: `2.96`, `3.91`
  * Derivation: `NIMY` field from the Financials API response, stored as float. Expressed as a percentage.

* `number_of_employees`
  * Total number of full-time equivalent employees.
  * Examples: `226674.0`, `12.0`
  * Derivation: `NUMEMP` field from the Financials API response, stored as float.

* `interest_income`
  * Total interest income for the reporting period.
  * Unit: thousands of USD
  * Derivation: `INTINC` field from the Financials API response, stored as float.

* `interest_expense`
  * Total interest expense for the reporting period.
  * Unit: thousands of USD
  * Derivation: `EINTEXP` field from the Financials API response, stored as float.

#### Failure Information (source: `fdic_failure`)

Data source: FDIC BankFind Suite Failures API (`https://api.fdic.gov/banks/failures`). These properties are set on organization entities for institutions that have failed.

* `failure_date`
  * Date the institution was closed by its chartering authority.
  * Examples: `"2026-01-30"`, `"2025-06-27"`
  * Derivation: `FAILDATE` field from the Failures API response, reformatted from M/D/YYYY to YYYY-MM-DD.

* `failure_resolution_type`
  * Type of resolution action taken by the FDIC.
  * Examples: `"P&A"` (Purchase and Assumption), `"PI"` (Purchase and Assumption — Insured Deposits), `"PA"` (Purchase and Assumption — All Deposits), `"PO"` (Payout)
  * Derivation: `RESTYPE1` field from the Failures API response.

* `failure_estimated_loss`
  * Estimated loss to the Deposit Insurance Fund (DIF) from the failure.
  * Unit: thousands of USD
  * Examples: `23460.0`, `30284.0`
  * Derivation: `COST` field from the Failures API response. Null when the estimate is not yet available.
  * Note: may be updated over time as the FDIC finalizes loss estimates.

* `failure_total_deposits`
  * Total deposits at the time of failure.
  * Unit: thousands of USD
  * Derivation: `QBFDEP` field from the Failures API response, stored as float.

* `failure_total_assets`
  * Total assets at the time of failure.
  * Unit: thousands of USD
  * Derivation: `QBFASSET` field from the Failures API response, stored as float.

* `acquired_by`
  * Link from the failed institution to the acquiring institution (the bank that purchased assets/assumed deposits).
  * Target flavor: `organization`
  * Examples: First Independence Bank acquired Metropolitan Capital B&T
  * Source: `fdic_failure`. Coexists permanently with the more general `succeeded_by` edge (from `fdic_history`) and with the `bank_structure_event` entity model — the parallel representations are emitted intentionally.

* `succeeded_by`
  * Direct link from a depository institution that ceased to exist (via merger, consolidation, absorption, or FDIC resolution) to its successor institution.
  * Domain flavor: `organization` (the disappearing party). Target flavor: `organization` (the surviving/acquiring party).
  * Source: `fdic_history`. Emitted whenever a History API row has a non-zero `OUT_CERT`, an acquirer side (`ACQ_CERT`, falling back to `SUR_CERT`) that is non-zero AND distinct from `OUT_CERT`, AND `ORG_STAT_FLG = "N"` (the outgoing institution actually disappeared). This skips branch-purchase rows (CHANGECODE 712) where both banks survive and live-after-reorg cases (e.g. some CHANGECODE 224 affiliated mergers).
  * Direction: emitted on the disappearing entity, pointing to the successor.
  * Examples: Wachovia Bank of Delaware → Wells Fargo Bank, National Association; Silicon Valley Bank → Deposit Insurance National Bank of Santa Clara; Flint Hills Bank → The Bennington State Bank
  * Coexists permanently with the `bank_structure_event` entity model (which captures richer party metadata via `subject_institution` / `outgoing_institution` / `successor_institution`) and with the failure-specific `acquired_by` edge.
  * Derivation: `BIDNAME` field from the Failures API response. Omitted when no acquirer (payout resolution). The acquiring institution is created as a separate organization entity identified by name.
  * Status: planned to be removed in a follow-up migration once `bank_structure_event` is in use.

### Bank Structure Event Properties (source: `fdic_history`)

Data source: FDIC BankFind Suite History API (`https://api.fdic.gov/banks/history`), filtered to `ORG_ROLE_CDE:FI` (institution-level rows). Branch-level rows (`BR`) are skipped.

#### Identification

* `fdic_transaction_number`
  * The FDIC `TRANSNUM`, globally unique per transaction-backed structure-change. Serves as the entity's strong ID for the ~91% of FI-level events that have a TRANSNUM. **Emitted only when `TRANSNUM > 0`.**
  * Examples: `"2026008583"`, `"2026007976"`, `"2026002845"`
  * Derivation: `TRANSNUM` field from the History API, formatted as a string.

* `fdic_history_event_id`
  * Per-row identifier from the `ID` field of the FDIC History API. Used as the entity's strong ID for the ~9% of FI-level events that have `TRANSNUM = 0` (~16K of ~185K rows). The ID is a composite of effective date, CHANGECODE, and an internal identifier — unique per row — so it disambiguates events that the History API itself does not assign a transaction number to (most CC=1 "Institution Established" rows, all CC=150 cert reassignments, many CC=510 location changes, charter-class changes, etc.). **Emitted only when `TRANSNUM = 0`**; mutually exclusive with `fdic_transaction_number`.
  * Examples: `"1972-09-28T00:00:00_150_14384__"`, `"1970-03-31T00:00:00_150_13853__"`
  * Derivation: `ID` field from the History API, copied verbatim. When the API returns both `TRANSNUM = 0` AND empty `ID` (vanishingly rare in practice), falls back to a composite key of `cc-<code>-eff-<date>-cert-<cert>-out-<out>-sur-<sur>-acq-<acq>` so the event still has a non-colliding strong ID.

#### Event Description

* `event_change_code`
  * Numeric FDIC change-event code identifying the kind of structure change (e.g. `223` = unassisted merger, `211` = whole-institution failure, `510` = legal-name change, `240` = voluntary closing, `110` = new institution).
  * Examples: `"223"`, `"110"`, `"510"`, `"240"`, `"211"`, `"810"`, `"440"`
  * Derivation: `CHANGECODE` field from the History API, stored as a string to preserve leading-zero semantics in display.

* `event_change_description`
  * Human-readable description of the change-event code as published by the FDIC.
  * Examples: `"Merger -Without Assistance"`, `"Failure - Whole Institution"`, `"Closing - Voluntary"`, `"Change in Legal Name (FO or BR)"`, `"New Institution"`, `"Participated in Absorbtion/Consolidation/Merger"`, `"Change in Primary Regulatory Agency"`
  * Derivation: `CHANGECODE_DESC` field from the History API.

* `event_category`
  * Normalized categorical bucket for the structure-change event, derived from `CHANGECODE` so consumers can filter without memorizing numeric codes. Always present on every `bank_structure_event` record.
  * Values: `"merger"`, `"failure"`, `"voluntary_closing"`, `"new_institution"`, `"name_change"`, `"location_change"`, `"charter_change"`, `"other"`.
  * Mapping (rooted in the full FI-level backfill; see `GUIDANCE_LOG.md`):
    * `merger`: unassisted absorptions/consolidations/mergers, affiliated pooling, branch purchases, and partner-side merger rows. CHANGECODEs 221, 222, 223, 224, 225, 712, 810, 811, 812.
    * `failure`: FDIC-assisted resolutions, conservatorships, RTC payoffs, open-bank assistance, and chartering-agency-driven closures. CHANGECODEs 211, 213, 215, 216, 217, 230, 235, 260, 350, 360, 830.
    * `voluntary_closing`: CHANGECODE 240.
    * `new_institution`: newly chartered institutions and administrative cert reassignments. CHANGECODEs 110, 150.
    * `name_change`: CHANGECODE 510.
    * `location_change`: physical-address moves. CHANGECODE 520.
    * `charter_change`: FRS membership, insurance-status, chartering-agency/class/org-type/primary-regulator changes, trust powers granted, and phantom holding-company reorgs. CHANGECODEs 310, 320, 340, 410, 420, 430, 440, 470, 610, 820.
    * `other`: any CHANGECODE not in the above buckets. Currently only CC 1 (History Record Initiation, the pre-history-of-tracking baseline marker). Future-unknown codes also fall here so they surface visibly downstream rather than silently disappearing.
  * Source of truth for the CHANGECODE numeric-to-description mapping: the FDIC History API itself. Every History API row carries the human-readable description inline in `CHANGECODE_DESC` (which we also pass through as `event_change_description`), and the `CHANGECODE` field is documented in the FDIC's official [History API definitions](https://banks.data.fdic.gov/docs/history_properties.yaml) (raw YAML at `https://api.fdic.gov/banks/docs/history_properties.yaml`). The FDIC does not publish a separate code-list document — the canonical descriptions live in the API payloads — so the seven category buckets here are our editorial grouping over those FDIC-published descriptions, empirically validated against the full ~116K-row FI-level backfill (every distinct `(CHANGECODE, CHANGECODE_DESC)` pair observed is covered; see `GUIDANCE_LOG.md` 2026-05-20 entry for the per-code counts).
  * Derivation: `fdic.HistoryEventCategory(CHANGECODE)` in Go.

* `is_fdic_assisted`
  * String-encoded boolean (`"true"` or `"false"`) indicating whether the FDIC (or its predecessor RTC) provided financial assistance, brokered the resolution, or otherwise stepped in to handle the institution involved in the event. Always present on every `bank_structure_event` record.
  * Examples: `"true"`, `"false"`.
  * Mapping (true for the 13 codes below, false for everything else):
    * `211` Failure - Whole Institution
    * `213` Merger - Assisted
    * `215` Failure Multiple Acquirer
    * `216` Bridge Bank Resolution
    * `217` Passthrough Receivorship/Conservatorship Resolution
    * `230` Closing - Failure Payoff
    * `235` Rtc Supervised Payoffs, Liquidations, and Closings
    * `260` Bank Closed by Chartering Agency Pending Sale (always leads to FDIC-brokered resolution)
    * `350` Institution Enters Conservatorship
    * `360` Conservatorship Institution Resolved
    * `811` Participated in FDIC Assisted Merger
    * `812` Rtc Assisted Merger
    * `830` Open Bank Assistance
  * Intentionally orthogonal to `event_category`: 811 and 812 are in the `merger` bucket (they are merger transactions) but are simultaneously FDIC-assisted. All other true-codes overlap with the `failure` bucket. CHANGECODE 240 (voluntary closing) and all charter/name/location/regulator changes are always `"false"`.
  * Source of truth: the FDIC's own [History API definitions](https://banks.data.fdic.gov/docs/history_properties.yaml) for the `CHANGECODE` field, plus the `CHANGECODE_DESC` text returned inline on every row (the words "Assisted" / "Bridge" / "Conservatorship" / "Payoff" / "Receivorship" / "Open Bank Assistance" are FDIC's own labels for these codes). The cutoff between assisted and unassisted follows FDIC's own usage of "FDIC-assisted transaction" in its public failure/resolution literature.
  * Derivation: `fdic.HistoryIsFdicAssisted(CHANGECODE)` in Go.

* `event_charter_class`
  * FDIC institution charter-class code in effect at the time of the event, sourced directly from the History API `CLASS` field. Uses the same code set as the `organization`-level `charter_class` property (`N` = national bank OCC-supervised, `SM` = state-chartered Fed member, `NM` = state-chartered non-member, `SB` = savings bank, `SA` = savings association, etc.).
  * Examples: `"N"`, `"SM"`, `"NM"`, `"SB"`, `"SA"`.
  * Coverage: 100% of FI-level History rows have `CLASS` populated (confirmed against the live API: zero rows return `!_exists_:CLASS`).
  * Critical for charter/regulator-change events: for `CHANGECODE = 430` (Change in Class), `440` (Change in Organization Type), and `470` (Change in Primary Regulatory Agency), this is literally the value the event changed *to*. For all other events it records the institution's class at the time the event happened.
  * Derivation: `CLASS` field from the FDIC History API, passed through unmodified. See the [History API definitions](https://banks.data.fdic.gov/docs/history_properties.yaml).

* `event_effective_date`
  * Date the structure change took effect, formatted YYYY-MM-DD.
  * Examples: `"2026-04-08"`, `"2026-03-31"`, `"2008-12-31"`
  * Derivation: `EFFDATE` field from the History API, parsed from `YYYY-MM-DDTHH:MM:SS`.

* `previous_legal_name`
  * The institution's prior legal name when the event represents a name change. One value per affected entity.
  * Examples: `"ASSOCIATED CREDIT UNION"`, `"Wachovia Bank, National Association"`
  * Derivation: `FRM_INSTNAME` field from the History API, emitted only when it differs from `INSTNAME` (typical for `CHANGECODE = 510`).

* `previous_fdic_certificate_number`
  * The institution's prior FDIC certificate number when the event records a cert reassignment. One value per affected entity.
  * Examples: `"90054"`, `"90465"`, `"90337"` (in the FDIC's data the canonical cases reassign legacy 90000-range temp certs to modern 20000-range stable certs).
  * Coverage: emitted only when `FRM_CERT` is populated and distinct from `CERT`. Canonical case is `CHANGECODE = 150` ("Cert Changed from Old Cert by Administrative Order"); ~280 such rows exist in the full FI-level backfill.
  * Strong-ID alias behavior: the same prior CERT is **also added as an additional `fdic_certificate_number` strong-id on the `subject_institution` organization entity**, so entity resolution merges the bank's old-cert and new-cert identities into a single `organization`. This means a downstream query for either cert number resolves to the same bank, regardless of which cert era the citing source used.
  * Derivation: `FRM_CERT` field from the History API; emitted only when `FRM_CERT != 0 && FRM_CERT != CERT`.

#### Party Relationships (target flavor: `organization`)

For each event we emit a relationship per party that the History API row populates. Most events (mergers, failures) populate `subject_institution` plus `outgoing_institution` and `successor_institution`. Single-party events (name change, regulator change, new institution, voluntary closing) populate only `subject_institution`.

* `subject_institution`
  * The institution this History API row is filed against (the row's primary CERT). For mergers/failures, this is the disappearing party (the same bank also surfaced as `outgoing_institution`); for name/regulator/charter/class changes, voluntary closings, and new institutions, this is the affected institution itself.
  * Target flavor: `organization`
  * Derivation: `CERT` + `INSTNAME` (with `FRM_INSTNAME` recorded as an alias when present and distinct).
  * Strong-IDs on the target organization: always `fdic_certificate_number = CERT`; additionally `fdic_certificate_number = FRM_CERT` when `FRM_CERT` is populated and differs from `CERT` (see `previous_fdic_certificate_number` above). The multi-strong-id form ensures entity resolution collapses old-cert and new-cert identities for the same bank.

* `outgoing_institution`
  * The institution that ceased to exist as a result of the event (its CERT may continue to appear in the History API only as historical reference). Emitted when `OUT_CERT` is populated.
  * Target flavor: `organization`
  * Derivation: `OUT_CERT` + `OUT_INSTNAME` from the History API.

* `successor_institution`
  * The institution that took the outgoing party's deposits and/or assets following a merger, consolidation, absorption, or FDIC-assisted resolution. One edge per event, regardless of how the FDIC split the signal across `ACQ_CERT` and `SUR_CERT`.
  * Target flavor: `organization`
  * Derivation: `ACQ_CERT` + `ACQ_INSTNAME` preferred; falls back to `SUR_CERT` + `SUR_INSTNAME` when only the legal-survivor side is populated (~122 events in the full FI-level backfill). Emitted whenever at least one of those certs is non-zero.
  * Why a single edge instead of separate `surviving_institution` + `acquiring_institution`: the FDIC publishes these as two fields, but empirically they almost always agree. Across the full 116,263-row FI-level backfill:
    * 23,114 events have both `SUR_CERT` and `ACQ_CERT` populated; only **3** of those (0.01%) have different CERTs.
    * 2,988 events have only `ACQ_CERT`.
    * 122 events have only `SUR_CERT`.
    * The 3 divergence cases all share the same INSTITUTION name on both sides (BayBank Middlesex, Gold Bank, University Savings Association) — they're administrative cert renumberings of the same successor entity, not genuinely distinct parties. So a separate edge is not worth the schema noise.
  * Consumers needing the raw distinction can re-derive it from the underlying History API row (`ACQ_CERT` vs `SUR_CERT`).

---

## Entity Relationships

```
organization         ──[acquired_by]────────────→ organization               (failed bank → acquirer, from fdic_failure)
organization         ──[succeeded_by]───────────→ organization               (disappearing bank → successor, from fdic_history; covers all M&A + failures)
bank_structure_event ──[subject_institution]────→ organization               (event → primary affected bank)
bank_structure_event ──[outgoing_institution]───→ organization               (event → disappearing bank, when applicable)
bank_structure_event ──[successor_institution]──→ organization               (event → bank that took the deposits/assets, when applicable; collapses SUR + ACQ)
```

The three lineage representations (`acquired_by`, `succeeded_by`, and `bank_structure_event`) are intentionally redundant. `acquired_by` and `succeeded_by` provide direct bank-to-bank edges for queries that just need lineage; `bank_structure_event` provides the full event entity with change-code, effective date, and party metadata for queries that need transactional context.

---

## Attributes

FDIC records do not use source-specific attributes beyond the standard citation text on atoms.

- **Institution atoms**: citation text follows the pattern `"FDIC BankFind: {field_description} for {institution_name} (CERT: {cert})"`.
- **Financial atoms**: citation text follows the pattern `"FDIC Call Report ({report_date}): {field_description} for {institution_name} (CERT: {cert})"`.
- **Failure atoms**: citation text follows the pattern `"FDIC Failure: {institution_name} failed {failure_date}"`.
- **Bank-structure-event atoms**: citation text follows the pattern `"FDIC History TXN {transnum} ({change_desc}, {effective_date}): {field_description}"`.
