# IAPD Data Dictionary

## 1. Purpose / Source Overview

The IAPD dataset publishes the SEC's Investment Adviser Public Disclosure
data — the canonical federal+state registry of investment advisory firms
in the United States. It is sourced from two daily-refreshed XML
compilation feeds:

- `IA_FIRM_SEC_Feed_*.xml.gz` — SEC-registered Investment Advisers (RIAs)
  and Exempt Reporting Advisers (ERAs). ~23K firms.
- `IA_FIRM_STATE_Feed_*.xml.gz` — State-registered Investment Advisers
  (IAs). ~22K firms.

Each `<Firm>` element corresponds to a single advisory firm's most recent
**Form ADV Part 1A** filing on file with the SEC's IARD system. Part 1A
captures firm identity, contact info, regulatory status, ownership form,
employees, clients, assets under management (AUM), services offered, and
disciplinary Y/N flags. The bulk feed does **not** include Form ADV
Part 1B (state-specific addenda), Form ADV Part 2 (firm brochure PDFs),
or Form ADV Part 3 (CRS Form). Those would require per-firm PDF fetches
and are deferred to a future iteration.

Cadence: nightly. Volume: ~45K firm records per snapshot. Each daily
snapshot is a full re-publish — there is no incremental "diffs only"
feed.

Two `Record.Source` values are emitted, so downstream consumers can
distinguish the firms by their regulatory domicile:

| Record.Source | Coverage |
|---|---|
| `iapd_sec` | SEC-registered RIAs + ERAs (`IA_FIRM_SEC_Feed_*.xml.gz`) |
| `iapd_state` | State-registered IAs (`IA_FIRM_STATE_Feed_*.xml.gz`) |

The two streams share entity types, properties, and the strong-id
scheme, so a firm that transitions between SEC-registered and
state-registered status will resolve to the same `organization` entity
over time.

## 2. Entity Types

### `organization`

A registered investment adviser firm — i.e. an entity registered with
the SEC and/or one or more state securities regulators to provide
investment advice. The bulk feed represents only the firm; the
individual investment-adviser representatives are not in this feed.

- **Strong-ID properties:** `crd_number`, `sec_file_number`,
  `company_cik`, `lei`.
  - `crd_number` is the primary strong-ID — FINRA-assigned, present on
    every firm in both feeds, stable across registration-status
    changes. Property name is intentionally unprefixed (not
    `organization_crd_number`) so it matches the same-named strong-ID
    on `edgar`'s `organization` flavor — an IAPD firm and an EDGAR
    registrant with the same CRD resolve to the same entity.
  - `sec_file_number` (`801-…` / `802-…`) is a secondary strong-ID
    emitted only for firms in the SEC feed where `Info@SECNb` is
    non-empty.
  - `company_cik` and `lei` are declared strong-ID slots but **not
    populated** from the bulk Part 1A XML — neither field is in that
    feed. The slots exist so downstream cross-walks (Form ADV
    Schedule R, third-party CRD↔LEI / CRD↔CIK mappings) can populate
    them without a breaking schema change. Adding a strong-ID property
    after the schema is in production is a breaking change; adding
    *values* into an existing slot is not.

### `location`

A named geographic place where the firm has a main office or mailing
address. Resolved by name (`City, ST` for US; `City, Country` for
non-US).

## 3. Properties

### Identity and Registration (Organization)

* `crd_number` *(primary strong-ID)*
  * Definition: FINRA-assigned firm CRD (Central Registration
    Depository) number. The canonical unique identifier for both
    SEC-registered and state-registered investment advisers; stable
    across registration status changes.
  * Examples: `283882`, `312360`, `324069`
  * Derivation: `Info@FirmCrdNb` attribute on each `<Firm>` element of
    the daily IAPD XML feed; identical attribute name on SEC and state
    feeds. Firms with empty `Info@FirmCrdNb` are skipped by the
    streamer (they would have no usable strong-ID).
  * Cross-source: matches `edgar.organization.crd_number` —
    purposefully unprefixed.

* `sec_file_number` *(secondary strong-ID, SEC feed only)*
  * Definition: SEC-issued file number for the firm. Prefix encodes the
    registration kind: `801-XXXXXX` for SEC-registered RIAs, `802-XXXXXX`
    for Exempt Reporting Advisers (ERAs).
  * Examples: `801-135399`, `802-120553`
  * Derivation: `Info@SECNb` attribute on `<Firm>` in the SEC feed.
    Not present on state-feed firms; emitted as a strong-ID only when
    non-empty.
  * Cross-source: matches `edgar.organization.sec_file_number` for
    firms that also file via EDGAR.

* `company_cik` *(strong-ID slot — not populated by IAPD)*
  * Definition: SEC Central Index Key — EDGAR's per-filer numeric ID.
  * Examples: `1234567`
  * Derivation: not present in the bulk Part 1A XML. Slot exists so
    Form ADV Schedule R or third-party CRD↔CIK cross-walks can populate
    it without a breaking schema change. Property name matches
    `edgar.organization.company_cik` so cross-source ER works the
    moment values appear.

* `lei` *(strong-ID slot — not populated by IAPD)*
  * Definition: Legal Entity Identifier — 20-character ISO 17442 code.
  * Examples: `549300LQQAVPLATTSU38`
  * Derivation: not present in the bulk Part 1A XML. Slot exists so
    per-firm IAPD detail (Schedule R) or third-party CRD↔LEI
    cross-walks can populate it without a breaking schema change.
    Property name matches `gleif.organization.lei` and
    `edgar.organization.lei`.

* `primary_business_name`
  * Definition: Primary name under which the firm conducts advisory
    business. May differ from legal name when the firm operates under a
    trade name / DBA.
  * Examples: `RABENOLD ADVISORS, INC.`, `MK CAPITAL`
  * Derivation: `Info@BusNm` attribute on `<Firm>`.

* `legal_name`
  * Definition: Firm's full legal name as registered with the SEC and/or
    state regulators.
  * Examples: `RABENOLD ADVISORS, INC.`, `MK CAPITAL COMPANY`
  * Derivation: `Info@LegalNm` attribute on `<Firm>`. Also passed as an
    alias on the entity for entity resolution.

* `is_umbrella_registration`
  * Definition: String-encoded boolean (`"true"`/`"false"`) indicating
    whether this filing represents an umbrella registration covering
    multiple filing-adviser/relying-adviser entities under a single
    Form ADV.
  * Examples: `true`, `false`
  * Derivation: `Info@UmbrRgstn` attribute on `<Firm>` (`Y`/`N`),
    normalized to `true`/`false`.

* `sec_region_code`
  * Definition: SEC supervisory regional office code that has
    jurisdiction over this firm (SEC-registered firms only).
  * Examples: `NYRO`, `CHRO`, `LARO`
  * Derivation: `Info@SECRgnCD` attribute. Omitted on state-feed firms
    (where the SEC has no supervisory role).

* `firm_registration_type`
  * Definition: Firm's registration disposition with the SEC at the time
    of the most recent filing. One of `Registered` (full SEC-registered
    RIA), `ERA` (Exempt Reporting Adviser — files but is not fully
    registered), or other values the SEC may emit.
  * Examples: `Registered`, `ERA`
  * Derivation: `Rgstn@FirmType` attribute on `<Firm>` (SEC feed). State
    feed instead carries a `<StateRgstn>` block; the equivalent on the
    state feed is derivable from the presence of `<StateRgstn>` plus
    individual regulator codes.

* `registration_status`
  * Definition: Status of the firm's registration with its primary
    regulator. For SEC-registered firms this is `Rgstn@St` (e.g.
    `APPROVED`); for state-registered firms this is derived from the
    first `<Rgltr>` element under `<StateRgstn>`.
  * Examples: `APPROVED`, `ACTIVE`, `PENDING`, `TERMINATED`
  * Derivation: `Rgstn@St` (SEC feed) or `StateRgstn/Rgltrs/Rgltr@St`
    (state feed, first element).

* `registration_date`
  * Definition: Date the firm was approved/registered by its primary
    regulator, formatted YYYY-MM-DD.
  * Examples: `2026-02-24`, `2021-02-16`
  * Derivation: `Rgstn@Dt` (SEC) or first `Rgltr@Dt` under
    `StateRgstn/Rgltrs` (state).

* `notice_filed_state_count`
  * Definition: Number of US states where the firm has made notice
    filings (SEC-registered firms). Notice filings are required of
    SEC-registered firms in states where they have a place of business
    or sufficient clients. Emitted as a float for numeric queryability.
  * Examples: `0`, `1`, `50`
  * Derivation: count of `<States>` elements under `<NoticeFiled>`
    (SEC feed only).

* `state_registration_count`
  * Definition: Number of US state and territorial securities regulators
    with which the firm is registered (state-registered firms). Emitted
    as a float.
  * Examples: `1`, `5`, `30`
  * Derivation: count of `<Rgltr>` elements under `<StateRgstn>/<Rgltrs>`
    (state feed only).

* `latest_filing_date`
  * Definition: Date of the most recent Form ADV filing represented in
    this snapshot, YYYY-MM-DD.
  * Examples: `2026-03-04`, `2025-08-01`
  * Derivation: `Filing@Dt` attribute on `<Firm>`. Also used as the
    record-level `Timestamp` because it bounds the freshness of the
    Form ADV data.

* `form_adv_version`
  * Definition: Version label of the Form ADV form template used for
    this filing.
  * Examples: `10/2021`
  * Derivation: `Filing@FormVrsn` attribute on `<Firm>`.

### Address (Organization)

* `physical_address`
  * Definition: Firm's main office street address, formatted
    `"Street1, Street2, City, ST ZIP, Country"`.
  * Examples: `5930 MAIN STREET, SUITE 400, WILLIAMSVILLE, NY 14221,
    United States`
  * Derivation: assembled from `MainAddr@Strt1`, `MainAddr@Strt2`,
    `MainAddr@City`, `MainAddr@State`, `MainAddr@PostlCd`,
    `MainAddr@Cntry` on `<Firm>`.

* `mailing_address`
  * Definition: Firm's mailing address when distinct from the main
    office address.
  * Examples: `PO BOX 1234, ALBANY, NY 12201, United States`
  * Derivation: same assembly applied to `<MailingAddr>`. Omitted when
    the element is empty (the common case).

* `main_phone_number`
  * Definition: Main-office phone number as published by the firm. Not
    normalized; the SEC publishes whatever the firm entered.
  * Examples: `716-568-8790`, `6033037688`
  * Derivation: `MainAddr@PhNb`.

* `main_fax_number`
  * Definition: Main-office fax number, if any.
  * Examples: `716-568-8791`
  * Derivation: `MainAddr@FaxNb`. Often missing.

### Web Presence (Organization)

* `website`
  * Definition: Firm's website URL. The bulk feed allows multiple web
    addresses per firm; we emit one `website` atom per `<WebAddr>`
    element (i.e., the property can be multi-valued for a single firm).
  * Examples: `http://www.rabenoldadvisors.com`,
    `https://www.mkcapital.com/`
  * Derivation: each `<WebAddr>` inside
    `Part1A/Item1/WebAddrs` on `<Firm>`.

### Organization Form (Organization)

* `organization_form`
  * Definition: Legal organization form of the firm (Item 3A of Form
    ADV).
  * Examples: `Corporation`, `Limited Partnership`, `Limited Liability
    Company`, `Sole Proprietorship`
  * Derivation: `Item3A@OrgFormNm` under `Part1A` on `<Firm>`.

* `fiscal_year_end_month`
  * Definition: Month in which the firm's fiscal year ends (Item 3B of
    Form ADV).
  * Examples: `DECEMBER`, `JUNE`
  * Derivation: `Item3B@Q3B`.

* `state_of_formation`
  * Definition: US state or country in which the firm was organized
    (Item 3C of Form ADV). Stored as the 2-letter US state code when
    inside the US; otherwise the country name.
  * Examples: `NY`, `DE`, `IL`
  * Derivation: `Item3C@StateCD` (US) or `Item3C@CntryNm` (non-US).

* `country_of_formation`
  * Definition: Country in which the firm was organized.
  * Examples: `United States`, `Cayman Islands`
  * Derivation: `Item3C@CntryNm`.

### Employees and Clients (Organization)

* `total_employees`
  * Definition: Total number of employees worldwide as of the firm's
    most recent fiscal year-end (Item 5A). Float for numeric
    queryability.
  * Examples: `4`, `150`, `12000`
  * Derivation: `Item5A@TtlEmp`.

* `employees_providing_investment_advice`
  * Definition: Number of employees who perform investment advisory
    functions including research (Item 5B(1)).
  * Examples: `1`, `30`
  * Derivation: `Item5B@Q5B1`.

* `client_count_band`
  * Definition: Approximate band for total number of advisory clients
    (Item 5H). The SEC publishes this as a coarse band string rather
    than an exact count for privacy.
  * Examples: `0`, `1-10`, `11-25`, `26-100`, `101-250`, `251-500`,
    `51-100`, `More than 500`
  * Derivation: `Item5H@Q5H`.

### Assets Under Management (Organization)

* `assets_under_management`
  * Definition: Total regulatory assets under management (RAUM)
    reported on Form ADV, in USD. Sum of discretionary and
    non-discretionary RAUM. Item 5F(2)(c).
  * Examples: `35557038`, `15000000000`
  * Derivation: `Item5F@Q5F2C` (already in USD; passed through as a
    float).

* `discretionary_assets_under_management`
  * Definition: Regulatory AUM where the firm has discretionary
    authority, in USD. Item 5F(2)(a).
  * Examples: `35557038`, `0`
  * Derivation: `Item5F@Q5F2A`.

* `non_discretionary_assets_under_management`
  * Definition: Regulatory AUM where the firm advises without
    discretionary authority, in USD. Item 5F(2)(b).
  * Examples: `0`, `8000000`
  * Derivation: `Item5F@Q5F2B`.

* `non_us_assets_under_management`
  * Definition: Portion of RAUM attributable to non-US clients, in USD.
    Item 5F(3).
  * Examples: `0`, `1200000`
  * Derivation: `Item5F@Q5F3`.

* `discretionary_account_count`
  * Definition: Number of discretionary advisory accounts. Item 5F(2)(d).
  * Examples: `117`, `5000`
  * Derivation: `Item5F@Q5F2D`.

* `non_discretionary_account_count`
  * Definition: Number of non-discretionary advisory accounts. Item
    5F(2)(e).
  * Examples: `0`, `12`
  * Derivation: `Item5F@Q5F2E`.

* `total_account_count`
  * Definition: Total number of advisory accounts. Item 5F(2)(f).
  * Examples: `117`, `5012`
  * Derivation: `Item5F@Q5F2F`.

### Advisory Services Offered (Organization)

Each service is emitted as a string atom with value `"true"` only when
the firm answered `Y` on the relevant Item 5G subfield. Absent atoms
mean the firm answered `N` or left the field blank — they are
intentionally not emitted as `"false"` to keep the atom count down at
production scale (~45K firms × ~10 services would add ~450K atoms with
no semantic gain).

* `provides_financial_planning_services`
  * Definition: Firm provides financial planning services (Item 5G(1)).
  * Examples: `true`
  * Derivation: `Item5G@Q5G1=="Y"` — emitted only when true.

* `provides_individual_portfolio_management`
  * Definition: Firm manages portfolios for individuals (Item 5G(2)).
  * Examples: `true`
  * Derivation: `Item5G@Q5G2=="Y"`.

* `provides_institutional_portfolio_management`
  * Definition: Firm manages portfolios for institutions (Item 5G(5)).
  * Examples: `true`
  * Derivation: `Item5G@Q5G5=="Y"`.

* `provides_pooled_vehicle_portfolio_management`
  * Definition: Firm manages portfolios for pooled investment vehicles
    (Item 5G(3) and 5G(4) — covers both registered and unregistered
    pooled vehicles).
  * Examples: `true`
  * Derivation: `Item5G@Q5G3=="Y" || Item5G@Q5G4=="Y"`.

* `provides_pension_consulting_services`
  * Definition: Firm provides pension consulting services (Item 5G(8)).
  * Examples: `true`
  * Derivation: `Item5G@Q5G8=="Y"`.

* `provides_selection_of_other_advisers`
  * Definition: Firm selects other advisers on behalf of clients
    (including via wrap programs). Item 5G(9).
  * Examples: `true`
  * Derivation: `Item5G@Q5G9=="Y"`.

* `provides_market_timing_services`
  * Definition: Firm offers market-timing services. Item 5G(10).
  * Examples: `true`
  * Derivation: `Item5G@Q5G10=="Y"`.

* `provides_security_ratings_services`
  * Definition: Firm provides securities ratings or pricing services.
    Item 5G(11).
  * Examples: `true`
  * Derivation: `Item5G@Q5G11=="Y"`.

* `provides_other_advisory_services`
  * Definition: Firm provides other advisory services not listed
    elsewhere on Item 5G; the free-form description (if any) lives in
    `other_advisory_services_description`.
  * Examples: `true`
  * Derivation: `Item5G@Q5G12=="Y"`.

* `other_advisory_services_description`
  * Definition: Free-text description of the "other" advisory services
    the firm offers, when `provides_other_advisory_services` is true.
  * Examples: `Investment research and securities analysis`
  * Derivation: `Item5G@Q5G12Oth`. Omitted when blank.

### Wrap Fee Programs (Organization)

* `is_wrap_fee_program_sponsor`
  * Definition: String-encoded boolean indicating whether the firm
    sponsors a wrap fee program (Item 5I(1)).
  * Examples: `true`, `false`
  * Derivation: `Item5I@Q5I1`, normalized from `Y`/`N`.

* `wrap_fee_sponsor_assets`
  * Definition: Total assets in wrap fee programs the firm sponsors,
    in USD. Item 5I(2)(a).
  * Examples: `12500000000`
  * Derivation: `Item5I@Q5I2A`. Omitted when 0 or missing.

* `wrap_fee_portfolio_assets`
  * Definition: Total assets in wrap fee programs the firm acts as a
    portfolio manager for, in USD. Item 5I(2)(b).
  * Examples: `8000000`
  * Derivation: `Item5I@Q5I2B`.

### Disciplinary Disclosures (Organization)

Item 11 of Form ADV asks the firm to disclose criminal, regulatory,
civil, and bankruptcy history. The bulk XML feed exposes only the
Yes/No flags from Items 11A–H — the full DRP (Disclosure Reporting
Page) detail lives in the per-firm PDF brochures and is out of scope
for v0. We emit ONLY a single rollup flag (`has_disciplinary_disclosure`)
plus the individual flags that are most operationally useful
(criminal, regulatory action). The rest can be added incrementally
later.

* `has_disciplinary_disclosure`
  * Definition: String-encoded boolean indicating that the firm or any
    of its advisory affiliates has answered "Yes" to at least one
    question in Item 11 (criminal, regulatory, civil, or bankruptcy).
    A rollup; `false` means clean across all Item 11 subquestions.
  * Examples: `true`, `false`
  * Derivation: `Item11@Q11`, normalized from `Y`/`N`.

* `has_criminal_disclosure`
  * Definition: String-encoded boolean rollup of Item 11A: any criminal
    conviction or pending charge against the firm or an advisory
    affiliate.
  * Examples: `true`, `false`
  * Derivation: `Item11A@Q11A1=="Y" || Item11A@Q11A2=="Y"`,
    normalized.

* `has_regulatory_action_disclosure`
  * Definition: String-encoded boolean rollup of Item 11B–E: any
    regulatory action by the SEC, CFTC, other federal regulator, state
    regulator, foreign regulator, or self-regulatory organization
    against the firm or an advisory affiliate.
  * Examples: `true`, `false`
  * Derivation: logical-OR across all `Item11B..E@Q*` flags,
    normalized.

## 4. Entity Relationships Summary

```
organization ──[is_located_at]──→ location   (main office)
organization ──[is_located_at]──→ location   (mailing address, when distinct)
```

There are no inter-firm relationships in the bulk Form ADV feed —
ownership and control-person disclosures (Schedule A/B/C, Item 7) are
present at the Y/N flag level but the underlying detail rows are not in
the daily XML. Future iterations could add `controlled_by` /
`affiliated_with` relationships when those schedules are wired in.

## 5. Attributes

None. All atoms carry standard citations; no source-specific
attributes are emitted.
