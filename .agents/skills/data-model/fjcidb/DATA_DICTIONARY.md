# Data Dictionary: FJC IDB (Federal Judicial Center — Civil Cases)

Last updated: 2026-05-20

## Source Overview

The **Federal Judicial Center Integrated Database (IDB)** provides administrative statistics on civil cases filed in U.S. district courts. Lovelace ingests the **civil SAS extract** published on the FJC site (annual FY files such as `cv26.sas7bdat`), not PACER dockets. Each SAS row is one civil case with coded fields for court location, docket number, party labels, nature of suit, and disposition.

The streamer uses a **diffing** pipeline: it materializes the SAS file (HTTP download or local path), parses rows in chunks, stores a normalized JSON snapshot per case under the raw store (`fjcidb/download/{case-id}.json`), and republishes atom batches only when a row’s JSON changes.

| Item | Value |
|------|--------|
| Stream source constant | `fjcidb-source` |
| `Record.Source` | `fjcidb` |
| Default dataset URL | FJC FY civil SAS (see FJC civil cases landing page) |
| Poll cadence | Configurable (`pollTimeMin`); typical dev runs use a large interval or one-shot via fetcheval |

**Data quality notes**

- Party fields **PLT** and **DEF** are short text labels (often truncated). They are not full party rosters; numeric values mean “count of plaintiffs/defendants” rather than a name.
- Person vs organization for textual parties uses **regex heuristics** on the label (see `party_regex.go`), not LLM classification in the default ingest path.
- Code values (district, disposition, etc.) follow the FJC codebook; this dictionary documents KG mapping, not codebook semantics.

---

## Entity Types

### `legal_case`

One civil case in the IDB extract, identified by district, office, docket, and filing year.

- **Subject name:** Human-readable label including `fjcidb_case_id`.
- **Strong id:** `fjcidb_case_id` on the case subject.
- **Resolver:** `NOT_MERGEABLE` — passive administrative case node.
- **Timestamp:** Atomization time (microseconds) for the ingest pass.

### `person`

An individual named on the plaintiff or defendant side when the IDB field is **textual** (not digits-only) and classified as a person by regex rules.

- **Subject name:** Normalized party display (trailing `, ET AL` removed from the raw field).
- **Property:** `name` (normalized party label from PLT/DEF).
- **Resolver:** `MERGEABLE` named entity; lawsuit-context snippet on the record (who sues whom; NOS phrase included).
- **Examples:** `SHANKS`, `BECERRA`, `BIDEN` (with or without `, ET AL`).

### `organization`

An institution or collective named on the plaintiff or defendant side when the field is textual and classified as organization (regex), or when classification is ambiguous and defaults to organization.

- **Subject name:** Same normalization as person parties.
- **Property:** `name` (normalized party label from PLT/DEF).
- **Resolver:** `MERGEABLE` named entity; same lawsuit snippet pattern as person parties.
- **Examples:** `DEPARTMENT OF DEFENSE`, `CUMMINS INC.`, `INTERNATIONAL UNION OF , ET AL`.

### `nature_of_suit`

A federal civil **nature of suit (NOS)** code from the U.S. Courts classification, linked from the case’s **NOS** field.

- **Subject name:** Short title when known, e.g. `Employment`; otherwise `Nature of suit {code} (federal civil)`.
- **Strong id:** `nos_code`.
- **Resolver:** `NOT_MERGEABLE`.
- **Reference:** U.S. Courts civil NOS code descriptions PDF (titles/descriptions embedded in ingest).

---

## Properties

### Legal case

* `fjcidb_case_id`
  * Definition: Stable case identifier for this IDB row.
  * Examples: `3-1-12345-2025`, `90-1-2303817-2023`
  * Derivation: `{DISTRICT}-{OFFICE}-{DOCKET}-{year}` where year comes from `FILEDATE`, or from `FDATEUSE` when `FILEDATE` is absent. Row omitted if year cannot be determined.

* `district_code`
  * Definition: FJC district court code (`DISTRICT`).
  * Examples: `3`, `90`
  * Derivation: SAS `DISTRICT`.

* `office_code`
  * Definition: FJC office within the district (`OFFICE`).
  * Examples: `1`
  * Derivation: SAS `OFFICE`.

* `case_docket_number`
  * Definition: Court docket number (`DOCKET`).
  * Examples: `12345`, `2303817`
  * Derivation: SAS `DOCKET`.

* `case_filing_date`
  * Definition: Filing date as stored in the extract.
  * Derivation: SAS `FILEDATE`.

* `termination_date`
  * Definition: Termination date when present.
  * Derivation: SAS `TERMDATE`.

* `origin_code`, `jurisdiction_code`, `disposition_code`, `class_action_code`, `procedural_progress_code`
  * Definition: FJC codebook fields for procedural status.
  * Derivation: SAS `ORIGIN`, `JURIS`, `DISP`, `CLASSACT`, `PROCPROG` when non-empty.

### Person and organization (shared)

* `name`
  * Definition: Normalized party label from PLT or DEF.
  * Examples: `SHANKS`, `INTERNATIONAL UNION OF`
  * Derivation: Trim and remove trailing `, ET AL` from the raw IDB field; matches the record subject name.

### Nature of suit

* `nos_code`
  * Definition: Numeric NOS code from the case row.
  * Examples: `110`, `442`
  * Derivation: SAS `NOS`.

* `nos_title`
  * Definition: Short title from the U.S. Courts NOS codebook.
  * Examples: `Insurance`, `Employment`
  * Derivation: Lookup table when code is known; omitted if unknown.

* `nos_description`
  * Definition: Long description from the same codebook.
  * Derivation: Lookup table when code is known; omitted if unknown.

---

## Entity Relationships

```
legal_case  ──[has_nature_of_suit]──→  nature_of_suit

person       ──[is_plaintiff_in]────→  legal_case
organization ──[is_plaintiff_in]────→  legal_case

person       ──[is_defendant_in]────→  legal_case
organization ──[is_defendant_in]────→  legal_case
```

- **`is_plaintiff_in` / `is_defendant_in`:** Emitted on the **party** record; target atom points at the case entity (with case strong id on the target for graph linkage). Only for non-empty, non-numeric, non-`SEALED` PLT/DEF values.
- **`has_nature_of_suit`:** Emitted on the **case** record when `NOS` is present; target is the `nature_of_suit` entity for that code.

---

## Records Per Case

Typical atomization for one row with textual PLT and DEF, and a NOS code:

1. One `legal_case` record (case properties + `has_nature_of_suit` target).
2. One `nature_of_suit` record (when NOS present).
3. Up to two party records (`person` or `organization` per side).

Rows with only numeric PLT/DEF produce a case record with count properties only (no party entities). `SEALED` parties produce no party entities.

---

## Party labeling (person vs organization)

Textual PLT/DEF labels are classified before flavor assignment:

1. **Skip** — empty, all digits, or withheld (`SEALED`).
2. **Organization** — label matches org indicators (legal suffixes, government words, `OF`/`AND`/`THE`, commas, truncated org stems) or has **three or more** name tokens after normalization.
3. **Person** — one or two tokens that look like personal name parts (letters, hyphen, apostrophe).
4. **Default** — organization.

Consumers should treat regex labels as heuristic, especially on truncated government and corporate strings.

---

## Citations

Citation text on atoms and entities: `Federal Judicial Center Integrated Database, civil SAS extract` with link to the FJC IDB research page. NOS entities additionally cite the U.S. Courts NOS descriptions document.

---

## Validation

- **Unit fixture:** `testdata/sample_fjcidb_case.pb.txt` (SHANKS vs International Union, NOS 442) — regenerate via `./run_legal_test.sh` at repo root.
- **recordeval:** Same script runs schema validation on `testdata/*.pb.txt`.
