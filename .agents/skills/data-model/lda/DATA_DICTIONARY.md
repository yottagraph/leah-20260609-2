# Data Dictionary: LDA (Lobbying Disclosure Act)

Last updated: 2026-05-04

## Source Overview

Lobbying Disclosure Act filings (registrations, quarterly activity, etc.) from the **unified LDA.gov REST API**. The streamer polls `GET /api/v1/filings/`, stores raw JSON pages, and emits v2 `FetchMessage` records.

| Item | Value |
|------|--------|
| Pipeline / stream | Configured in `streams.yaml` (see deployment) |
| `Record.Source` | `lda` |

Anonymous access is rate-limited; optional API token improves throughput.

---

## Entity Types

### `lda_filing`

One disclosure identified by API `filing_uuid`.

- **Subject name:** `filing_uuid` (stable, unique per disclosure).
- **Strong id:** `lda_filing_uuid` on the filing subject.
- **Resolver:** `NOT_MERGEABLE` passive filing entity.
- **Timestamp:** Parsed from `dt_posted` only (no wall-clock fallback). If `dt_posted` is missing or invalid, the filing is not atomized.

### `organization`

Either the **registrant** (lobbying firm) or **client** on a filing.

- **Subject name:** API `name` (legal / display name).
- **Strong ids:** `lda_registrant_id` (registrant rows) or `lda_client_internal_id` (client rows).
- **Role:** Property `lda_party_role` = `registrant` or `client` on the organization **record** (not on the filing).
- **Resolver:** Named-entity info is `MERGEABLE` (resolver / recordeval ER search) while retaining LDA **strong ids**; flavor-level resolver info remains `NOT_MERGEABLE` per passive schema.
- **Snippets:** Formatted **address** only when present (no LDA filing UUID prefix).

### `location`

Geographic label derived from registrant or client address fields for `is_located_at` edges.

- **Name:** Typically `City, State` or `City, State, Country`; when city is absent, `State, Country` or state-only per atomizer rules.
- **Resolver:** `MERGEABLE` named entity (no strong id), for soft clustering with other sources.

---

## Properties

### Filing

| Property | Description |
|----------|-------------|
| `lda_filing_uuid` | API `filing_uuid`. |
| `lda_filing_type` | Machine code (`filing_type`), e.g. `RR`, `Q1`. |
| `lda_filing_type_display` | Human label (`filing_type_display`). |
| `lda_filing_year` | Reporting year (float in schema). |
| `lda_filing_period_display` | Period label, e.g. quarter. |
| `lda_income` | Income string when present. |
| `lda_expenses` | Expenses string when present. |
| `lda_dt_posted` | Raw ISO `dt_posted` from API. |
| `lda_filing_document_url` | Public document URL. |
| `lda_posted_by_name` | Poster name when present. |
| `lda_lobbying_causes` | Repeated **once per** `lobbying_activities[]` row (`CODE (Display)`). Same pattern as patent **`cpc_code`**: narrative text is quad attribute **`lda_lobbying_cause_description`** on that atom (API `description` field). **Only on filing**; omitted if activities array is empty. |

### Organization

| Property | Description |
|----------|-------------|
| `lda_party_role` | `registrant` or `client`. |
| `lda_registrant_id` | Registrant API id as string. |
| `lda_client_internal_id` | Client row id (`client.id`) as string. |
| `address` | Single-line formatted address (street/city/state/zip + country). |

---

## Entity Relationships

```
lda_filing  ──[lda_registrant]──→  organization (registrant)
lda_filing  ──[lda_client]──────→  organization (client)

organization  ──[is_located_at]──→  location
```

- **`lda_registrant` / `lda_client`:** Target atoms on the **`lda_filing`** record point at the same organization identities emitted as separate **organization** records for that page (strong ids + properties).
- **`is_located_at`:** On each **organization** record when the atomizer can derive a location name from city/state/country rules.

---

## Records Per Filing

For a typical filing with registrant and client, atomization yields **up to three** records: one filing, one registrant organization, one client organization. Either org may be omitted if required API fields are missing.

---

## Citations

Primary citation text is the filing `url` when present; otherwise a synthetic label referencing `filing_uuid`.

---
