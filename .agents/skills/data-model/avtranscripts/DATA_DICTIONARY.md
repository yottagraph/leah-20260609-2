# Data Dictionary: Alpha Vantage Earnings Transcripts

## Source Overview

The Alpha Vantage Earnings Call Transcript API provides full-text transcripts of quarterly earnings calls for US-listed companies. Transcripts include speaker-attributed segments with speaker names and titles (CEO, CFO, analysts, etc.).

- API function: `EARNINGS_CALL_TRANSCRIPT`
- Parameters: `symbol` (ticker), `quarter` (YYYYQn format, e.g., `2024Q1`)
- Coverage: Major US-listed companies on NYSE, NASDAQ, and AMEX
- Update frequency: Transcripts appear shortly after the earnings call; once published they are immutable

| Pipeline | `Record.Source` |
|----------|----------------|
| All transcripts | `avtranscripts` |

---

## Entity Types

### `organization`

A company whose quarterly earnings call transcript is available via Alpha Vantage.

- Primary key: Company name (from the NASDAQ screener symbol list)
- Entity resolver: named entity, mergeable. No strong IDs — relies on name matching for cross-source resolution with stocks, EDGAR, and other sources.

### `earnings_call`

A quarterly earnings call event, uniquely identified by ticker and fiscal quarter.

- Primary key: `earnings_call_id` = `TICKER-YYYYQn` (e.g., `AAPL-2024Q1`)
- Entity resolver: named entity, mergeable. Strong ID = `earnings_call_id`.

---

## Properties

### Earnings Call Properties (`earnings_call`)

#### Identity

* `earnings_call_id`
  * Definition: Unique identifier combining ticker symbol and fiscal quarter.
  * Examples: `"AAPL-2024Q1"`, `"IBM-2023Q4"`, `"MSFT-2024Q2"`
  * Derivation: Constructed as `{ticker}-{quarter}` from the API response fields.

* `ticker_symbol`
  * Definition: Stock ticker symbol of the company that held the earnings call.
  * Examples: `"AAPL"`, `"IBM"`, `"MSFT"`
  * Derivation: `symbol` field from the API response JSON.

* `fiscal_quarter`
  * Definition: Fiscal quarter identifier in YYYYQn format.
  * Examples: `"2024Q1"`, `"2023Q4"`, `"2024Q2"`
  * Derivation: `quarter` field from the API response JSON.

* `fiscal_year`
  * Definition: Fiscal year extracted from the quarter identifier.
  * Examples: `2024`, `2023`
  * Derivation: First 4 characters of the `quarter` field, parsed as integer.

#### Content

* `transcript_text`
  * Definition: Full text of the earnings call transcript, concatenating all speaker segments with speaker attribution.
  * Format: `"Speaker (Title): Content\n\nSpeaker (Title): Content\n\n..."`
  * Derivation: All entries in the `transcript` array are concatenated with speaker name, title (if present), and content.
  * Note: Can be very long (10,000-50,000+ characters for a typical earnings call).

* `speaker_count`
  * Definition: Number of unique speakers in the transcript.
  * Examples: `5`, `12`, `20`
  * Derivation: Count of distinct `speaker` values in the `transcript` array (empty speakers excluded).

---

## Entity Relationships

```
organization (company) ──[earnings_call_transcript]──→ earnings_call (quarterly call)
```

The `earnings_call_transcript` relationship links a company to its quarterly earnings call transcript. One organization can have multiple earnings call entities (one per quarter).

---

## API Response Format

```json
{
  "symbol": "IBM",
  "quarter": "2024Q1",
  "transcript": [
    {
      "speaker": "Arvind Krishna",
      "title": "Chairman and CEO",
      "content": "Thank you, and good afternoon, everyone..."
    },
    {
      "speaker": "James Kavanaugh",
      "title": "Senior Vice President and CFO",
      "content": "Thank you, Arvind. In the first quarter..."
    },
    {
      "speaker": "Analyst Name",
      "title": "Bank/Firm",
      "content": "Can you elaborate on..."
    }
  ]
}
```

---

## Notes

- Not all symbols have transcripts available. The API returns an error/empty response for symbols without transcript coverage. The streamer handles this gracefully and marks the symbol/quarter as attempted.
- Transcript segments typically include: opening remarks by management, prepared financial commentary by CFO, and Q&A with sell-side analysts.
- The `title` field for analysts usually contains their firm name rather than a corporate title.

---
