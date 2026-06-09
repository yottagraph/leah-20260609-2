# Provenance

Provenance lets you trace any property value in the knowledge graph back to the
source document it was extracted from. This is the foundation for citation UIs,
data quality verification, and audit trails.

## When to Use

- Building a citation sidebar or bibliography for displayed data
- Verifying where a specific property value came from
- Debugging data quality issues by inspecting the raw source
- Showing users the evidence behind a fact

## Key Concepts

- **EFID** (Extract File ID): Identifies a FetchMessage — the unit of data
  ingested from a single source fetch. EFIDs are serialized as JSON strings
  in request/response bodies.
- **FetchMessage**: A file containing one or more records extracted from a
  data source (e.g. an SEC filing, a news article, a government database).
- **Record / Atom**: Within a FetchMessage, data is organized as records
  (one per entity or subject), each containing atoms (individual property
  assertions). A provenance trail is the triple `(efid, record_index,
  atom_index)` that pinpoints exactly which assertion produced a value.

## Two-Step Workflow

Provenance resolution is a two-step process:

1. **Match** (`POST /elemental/provenance/match`): Given property value
   quads (entity + property + value + timestamp + EFID), look up their
   coordinates within the FetchMessage. Returns `record_index` and
   `atom_index` for each quad.

2. **Render** (`POST /elemental/provenance/render`): Given trail
   coordinates (EFID + record_index + atom_index), load the FetchMessage
   and extract a human-readable citation with source name, URL, and text
   excerpts.

### Typical Flow

```
getPropertyValues (with include_attributes=true)
  → property values include EFID in attributes
    → POST /elemental/provenance/match (quad → trail coordinates)
      → POST /elemental/provenance/render (trail → citation)
```

Both endpoints accept `application/x-www-form-urlencoded` with a JSON array
in the form field (`quads` or `trails`). Maximum 100 items per request.

## Tips

- Always call match before render — you need the record/atom indices.
- Results are returned in the same order as the input array, so you can
  zip them with the original quads or trails.
- If a quad can't be matched (e.g. the FetchMessage was purged), the
  corresponding result has an `error` field instead of coordinates.
- EFIDs are large integers serialized as strings — pass them as strings
  in JSON, not bare numbers.

<!-- BEGIN GENERATED CONTENT -->

## Endpoints

### Match property values to provenance records

`POST /elemental/provenance/match`

Look up provenance records for one or more property value quads. Each quad identifies a specific property assertion (entity + property + value + timestamp + EFID). Returns the FetchMessage coordinates (EFID, record index, atom index) needed to render the original source citation. Maximum 100 quads per request.

#### Guidance

This is step 1 of the two-step provenance workflow. First call match to get trail coordinates for property values, then call render to get human-readable citations. The quads parameter takes a JSON array inside a form field.

#### Request Body

**Content-Type:** `application/x-www-form-urlencoded`

| Name | Type | Required | Description |
|------|------|----------|-------------|
| quads | string | yes | JSON array of MatchQuad objects identifying property values to look up |

#### Responses

| Status | Description |
|--------|-------------|
| 200 | Provenance match results (one per input quad, same order) (`MatchResp`) |
| 400 | Bad request - invalid parameters or malformed expression (`Error`) |
| 401 | Authentication required or authentication failed (`Error`) |
| 500 | Internal server error (`Error`) |

#### Example

**Request:**

```
POST /elemental/provenance/match
Content-Type: application/x-www-form-urlencoded

quads=[{"nindex":416400910670863867,"pid":8,"value":"Apple","recorded_at":"2026-01-15T10:30:00Z","efid":"1234567890"}]
```

**Response:**

```json
{"op_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479", "follow_up": false, "results": [{"record_index": 3, "atom_index": 0, "efid": "1234567890"}]}
```

---

### Render provenance trails into human-readable citations

`POST /elemental/provenance/render`

Load FetchMessages and extract citation data for one or more provenance trails. Each trail is identified by its EFID, record index, and atom index (typically obtained from a prior /provenance/match call). Returns source name, subject, property, value, URL, and text excerpts. Maximum 100 trails per request.

#### Guidance

This is step 2 of the two-step provenance workflow. Use the EFID, record_index, and atom_index from a prior /provenance/match response. The trails parameter takes a JSON array inside a form field.

#### Request Body

**Content-Type:** `application/x-www-form-urlencoded`

| Name | Type | Required | Description |
|------|------|----------|-------------|
| trails | string | yes | JSON array of RenderTrailReq objects identifying provenance trails to render |

#### Responses

| Status | Description |
|--------|-------------|
| 200 | Rendered citations (one per input trail, same order) (`RenderResp`) |
| 400 | Bad request - invalid parameters or malformed expression (`Error`) |
| 401 | Authentication required or authentication failed (`Error`) |
| 500 | Internal server error (`Error`) |

#### Example

**Request:**

```
POST /elemental/provenance/render
Content-Type: application/x-www-form-urlencoded

trails=[{"efid":"1234567890","record_index":3,"atom_index":0}]
```

**Response:**

```json
{"op_id": "c9bf9e57-1685-4c89-bafb-ff5af830be8a", "follow_up": false, "results": [{"citation": {"source": "SEC EDGAR", "subject": "Apple Inc", "timestamp": "2026-01-15T10:30:00Z", "property": "name", "value": "Apple", "url": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193", "excerpts": [{"text": "Apple Inc. (the 'Company') designs, manufactures and markets smartphones...", "explanation": "Company name from SEC filing header"}]}}]}
```

## Types

### MatchQuad

A single property value quad to look up in the provenance index

| Field | Type | Description |
|-------|------|-------------|
| **nindex** | integer | Entity nindex (numeric entity identifier) |
| **pid** | integer | Property ID |
| **value** | any | Human-readable property value |
| **recorded_at** | string (date-time) | Timestamp when this value was recorded (RFC 3339) |
| **efid** | string | Extract File ID — identifies the FetchMessage that produced this quad. Serialized as a JSON string. |

### MatchResp

Response from POST /elemental/provenance/match

| Field | Type | Description |
|-------|------|-------------|
| **results** | `MatchResult`[] | One entry per input quad, in the same order |

### MatchResult

Provenance lookup outcome for a single quad. Either EFID + coordinates are populated (found), or error is set (not found).

| Field | Type | Description |
|-------|------|-------------|
| record_index | integer | Index of the record within the FetchMessage |
| atom_index | integer | Index of the atom within the record |
| efid | string | Extract File ID. Serialized as a JSON string. Omitted on error. |
| error | string | Error message if the quad could not be matched |

### RenderTrailReq

Identifies a single atom within a FetchMessage to render as a citation

| Field | Type | Description |
|-------|------|-------------|
| **efid** | string | Extract File ID. Serialized as a JSON string. |
| **record_index** | integer | Index of the record within the FetchMessage |
| **atom_index** | integer | Index of the atom within the record |

### RenderResp

Response from POST /elemental/provenance/render

| Field | Type | Description |
|-------|------|-------------|
| **results** | `RenderResult`[] | One entry per input trail, in the same order |

### RenderResult

Render outcome for a single provenance trail. Either citation is populated (found), or error is set.

| Field | Type | Description |
|-------|------|-------------|
| citation | `RenderedCitation` | The rendered citation data. Null/omitted on error. |
| error | string | Error message if the trail could not be rendered |

### RenderedCitation

Human-readable citation data extracted from a FetchMessage atom

| Field | Type | Description |
|-------|------|-------------|
| **source** | string | Name of the data source (e.g. "SEC EDGAR", "OpenCorporates") |
| **subject** | string | The entity or subject the source record describes |
| timestamp | string (date-time) | Timestamp of the source record (RFC 3339). Omitted when unknown. |
| **property** | string | Property name that was extracted |
| **value** | string | The extracted value |
| url | string | URL to the original source document, if available |
| excerpts | `Excerpt`[] | Text excerpts from the source document that support the extracted value |

### Excerpt

A text excerpt from a source document that supports an extracted value

| Field | Type | Description |
|-------|------|-------------|
| **text** | string | The excerpt text |
| explanation | string | Why this excerpt supports the extracted value |
| offset | integer | Character offset of the excerpt within the source document |
| page_number | integer | Page number where the excerpt appears (for paginated documents) |

<!-- END GENERATED CONTENT -->
