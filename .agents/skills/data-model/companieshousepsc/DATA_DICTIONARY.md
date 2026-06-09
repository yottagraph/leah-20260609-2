# Data Dictionary: Companies House PSC

## Source Overview

UK Companies House People with Significant Control (PSC) Snapshot — a daily bulk download containing the full register of persons and entities with significant control over UK-registered companies.

- Data source: `https://download.companieshouse.gov.uk/en_pscdata.html`
- Publisher: Companies House (UK government registrar)
- Cadence: daily full snapshot, updated before 10am GMT
- Format: newline-delimited JSON (JSONL) inside ZIP archives; available as a single large file or ~32 smaller part files
- Coverage: all PSC records held by Companies House, including active and ceased entries; approximately 11 million records across ~8 million companies
- Limitations: "super-secure" PSC entries (protected persons) are redacted and skipped. Address data is a service address, not necessarily a residential address. Date of birth is limited to month and year.

| Pipeline | `Record.Source` |
|----------|----------------|
| PSC snapshot | `companieshousepsc` |

---

## Entity Types

### `organization`

A UK-registered company that has one or more persons with significant control, or a corporate entity that itself has significant control over another company.

- Primary key: `companies_house_number` (8-character alphanumeric, e.g. `"09145694"`, `"SC123456"`) for controlled companies; `registration_number` for corporate PSC entities.
- Entity resolver: named entity, mergeable. Strong ID = `companies_house_number` or `registration_number`. Controlled companies merge with the same company from the `companieshouse` accounts dataset.

### `person`

An individual person with significant control over a UK company.

- Primary key: none (resolved by name). Persons are mergeable entities identified by name and contextual snippets (address).
- Entity resolver: named entity, mergeable. No strong ID — relies on name-based resolution.

---

## Properties

### Organization Properties (controlled company)

#### Identity

* `companies_house_number`
  * Definition: Companies House registered company number uniquely identifying a UK company.
  * Examples: `"09145694"`, `"00001234"`, `"SC123456"`
  * Derivation: `company_number` field from the top-level JSON record.

### Organization Properties (corporate PSC)

#### Identity

* `registration_number`
  * Definition: registration number of a corporate entity PSC as provided in their identification details.
  * Examples: `"98765432"`, `"HRB 12345"`
  * Derivation: `data.identification.registration_number` field from the JSON record. Only present for corporate-entity PSCs that provide identification.

### Person Properties (individual PSC)

#### Identity and Background

* `nationality`
  * Definition: nationality of an individual person with significant control.
  * Examples: `"British"`, `"American"`, `"German"`
  * Derivation: `data.nationality` field from the JSON record. Only present for individual PSCs.

* `country_of_residence`
  * Definition: country of residence of an individual person with significant control.
  * Examples: `"England"`, `"Scotland"`, `"United States"`
  * Derivation: `data.country_of_residence` field from the JSON record. Only present for individual PSCs.

---

## Entity Relationships Summary

```
person/organization (PSC) ──[controls]──→ organization (company)
```

The `controls` relationship links a person or corporate entity directly to the company they have significant control over. One PSC may control multiple companies (multiple `controls` edges from the same entity). One company may be controlled by multiple PSCs (multiple `controls` edges from different entities pointing to the same company).

---

## Attributes (on the `controls` relationship)

* `natures_of_control`
  * Definition: semicolon-separated list describing the nature of significant control, such as share ownership bands, voting rights, or the right to appoint/remove directors.
  * Examples: `"ownership of shares 50 to 75 percent"`, `"ownership of shares 75 to 100 percent; right to appoint and remove directors"`
  * Derivation: `data.natures_of_control` array from the JSON record. Each entry has hyphens replaced with spaces; multiple entries are joined with `"; "`.

* `notified_on`
  * Definition: date on which Companies House was notified of this person with significant control, as YYYY-MM-DD.
  * Examples: `"2016-04-06"`, `"2023-01-15"`
  * Derivation: `data.notified_on` field from the JSON record. The PSC regime started on 2016-04-06, so most entries are notified on or after that date.

* `ceased_on`
  * Definition: date on which this person ceased to have significant control, as YYYY-MM-DD. Absent for active PSCs.
  * Examples: `"2024-06-01"`, `"2023-12-31"`
  * Derivation: `data.ceased_on` field from the JSON record. Only present for ceased PSCs.
