# Data Dictionary: Patent Parents

## Source Overview

The Patent Parents source aggregates US patent grant counts per assignee from the Google Patents Public Datasets BigQuery table (`patents-public-data.patents.publications`), identifies new assignees via diffing, and uses Vertex AI (Gemini) to assign corporate parent entities to each new patent-holding company.

The pipeline produces `subsidiary_of` relationship records linking child organizations (patent assignees) to their parent companies. No standalone organization records are emitted — only relationships.

| Stage | Description |
|-------|-------------|
| BigQuery aggregation | Counts US patents per assignee in a configurable `grant_date` window |
| Diffing | SHA-256 diff against download store; identifies new (unseen) assignees |
| LLM parent assignment | Vertex AI maps each new assignee to its corporate parent in batches of 100 |
| Atomization | Emits `subsidiary_of` relationships; skips self-referential (child == parent) rows |

| Pipeline | `Record.Source` |
|----------|----------------|
| All records | `patentparents` |

---

## Data Source

- **Table**: `patents-public-data.patents.publications` (Google BigQuery public dataset)
- **Fields used**: `assignee` (REPEATED STRING), `publication_number`, `country_code`, `grant_date`
- **Aggregation**: `COUNT(publication_number)` grouped by `UNNEST(assignee)`, filtered to `country_code = 'US'`
- **Assignee metadata available**: name and country_code only (no addresses, no corporate IDs)

---

## Entity Types

### `organization`

A company, institution, or entity that holds US patent grants as an assignee.

- Entity resolver: named entity, MERGEABLE. No strong IDs (assignee names are not globally unique identifiers).
- Appears as both subject (child company) and target (parent company) in `patentparents::subsidiary_of` relationships.
- Resolver snippet includes patent count and grant date range (e.g., "Nokia Technologies Oy — 1095 US patents granted between 01/01/2025 and 04/01/2025").

---

## Relationships

### `patentparents::subsidiary_of`

Links a patent-holding organization (child/subject) to its corporate parent (target).

- **Domain flavor**: `organization` (the patent assignee)
- **Target flavor**: `organization` (the parent company)
- **Derivation**: Vertex AI LLM analysis of patent assignee names. The LLM is prompted to assign a parent entity to each company; it may return the same name (self-referential) which is filtered out.
- **Citation**: `"{child} is a subsidiary of {parent}"`
- **Mergeability**: not_mergeable

---

## Properties

### `patentparents::total_patents`

- **Type**: float
- **Definition**: Total number of US patent grants assigned to this organization in the scanned `grant_date` window.
- **Derivation**: `COUNT(publication_number)` from the BigQuery aggregation query.
- **Emitted on**: the child (assignee) organization in each `patentparents::subsidiary_of` record, when assignee data is available.

### `patentparents::grant_date_from`

- **Type**: string (YYYY-MM-DD)
- **Definition**: Start of the `grant_date` window used in the BigQuery aggregation.
- **Emitted on**: the child (assignee) organization in each `patentparents::subsidiary_of` record, when assignee data is available.

### `patentparents::grant_date_to`

- **Type**: string (YYYY-MM-DD)
- **Definition**: End of the `grant_date` window used in the BigQuery aggregation.
- **Emitted on**: the child (assignee) organization in each `patentparents::subsidiary_of` record, when assignee data is available.

---

## Configuration

| Arg | Type | Default | Description |
|-----|------|---------|-------------|
| `projectId` | string | (required) | GCP project for BigQuery and Vertex AI |
| `initialGrantDateMin` | int | (required) | YYYYMMDD lower bound for the grant_date window |
| `maxRows` | int | 0 | Max assignee rows from BigQuery (0 = unlimited); top N by patent count |
| `pollTimeMin` | int | 1440 | Poll interval in minutes |
| `batchSize` | int | 100 | Records per published FetchMessage |
| `llmModel` | string | `gemini-2.5-flash` | Vertex AI model for parent assignment |
| `vertexLocation` | string | `us-central1` | Vertex AI region |

---

## Pipeline Flow

```
BigQuery (patents-public-data.patents.publications)
  │  SELECT assignee, COUNT(publication_number) ... GROUP BY assignee
  ▼
DiffingStreamer
  │  WriteIfChanged → download/{sanitized_name}.json
  │  scanKnownKeys → detect new vs existing assignees
  ▼
New Companies List
  │  Companies not previously in the download store
  ▼
Vertex AI (batches of 100)
  │  Prompt: "assign parent entities to these companies"
  │  Response: JSON array of {company, parent}
  ▼
AtomizeParentAssignment
  │  Skip self-referential (child == parent)
  │  Emit: child org → subsidiary_of → parent org
  ▼
Published FetchMessage (.binpb.zst)
```
