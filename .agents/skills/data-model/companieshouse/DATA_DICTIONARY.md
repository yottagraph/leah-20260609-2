# Data Dictionary: Companies House Accounts

## Source Overview

UK Companies House Accounts Bulk Data Product — daily ZIP files containing iXBRL (.html) and XBRL (.xml) annual accounts filings submitted by UK-registered companies.

- Data source: `https://download.companieshouse.gov.uk/en_accountsdata.html`
- Publisher: Companies House (UK government registrar)
- Cadence: daily bulk ZIPs, each containing filings processed that day
- Coverage: all companies filing annual accounts with Companies House (primarily small and micro companies using iXBRL templates; large companies with bespoke filings may have sparse financial data)

Financial figures are extracted from iXBRL/XBRL taxonomies (UK GAAP, FRS 102, IFRS). Not all companies report all fields — micro accounts may only include balance sheet totals, while full accounts include profit/loss and employee data. All monetary values are in GBP (£).

| Pipeline | `Record.Source` |
|----------|----------------|
| Accounts filings | `companieshouse` |

---

## Entity Types

### `organization`

A UK-registered company that has filed annual accounts with Companies House.

- Primary key: `companies_house_number` (8-character alphanumeric, e.g. `"00000006"`, `"SC123456"`)
- Entity resolver: named entity, mergeable. Strong ID = `companies_house_number`. Disambiguation via company name and registered address.

### `companieshouse::accounts_filing`

An annual accounts filing document submitted to Companies House, identified by the combination of company number and balance sheet date.

- Primary key: `filing_id` (format: `"{company_number}-{YYYY-MM-DD}"`)
- Entity resolver: named entity, not mergeable. Strong ID = `filing_id`.

---

## Properties

### Organization Properties

#### Identity

* `companies_house_number`
  * Definition: Companies House registered company number uniquely identifying a UK company.
  * Examples: `"00000006"`, `"12345678"`, `"SC123456"`
  * Derivation: extracted from the `UKCompaniesHouseRegisteredNumber` or `EntityRegistrationNumber` XBRL concept in the filing, or parsed from the bulk data filename pattern `Prod{NNN}_{NNN}_{CCCCCCCC}_{YYYYMMDD}` where `CCCCCCCC` is the company number.

* `registered_address`
  * Definition: registered office address of the company as reported in the accounts filing.
  * Examples: `"10 Downing Street, London, SW1A 2AA"`
  * Derivation: composed from XBRL address concepts `AddressLine1`, `AddressLine2`, `AddressLine3`, `PrincipalLocation-CityOrTown`, `CountyRegion`, and `PostalCodeZip` (from the `bus:` namespace). Empty components are omitted; the result is a comma-separated string.

### Accounts Filing Properties

#### Filing Metadata

* `filing_id`
  * Definition: unique identifier for the accounts filing, composed of the company number and balance sheet date.
  * Examples: `"12345678-2024-12-31"`, `"SC123456-2025-03-31"`
  * Derivation: constructed as `"{company_number}-{balance_sheet_date}"`. The balance sheet date is extracted from the bulk data filename.

* `balance_sheet_date`
  * Definition: balance sheet date of the filed accounts, as YYYY-MM-DD.
  * Examples: `"2025-03-31"`, `"2024-12-31"`
  * Derivation: extracted from the bulk data filename pattern `Prod{NNN}_{NNN}_{CCCCCCCC}_{YYYYMMDD}`.

#### Balance Sheet

* `total_assets`
  * Definition: total assets reported on the balance sheet.
  * Examples: `1500000.0` (£1,500,000)
  * Derivation: XBRL concept `TotalAssets`. Unit: GBP.

* `total_liabilities`
  * Definition: total liabilities reported on the balance sheet.
  * Examples: `800000.0` (£800,000)
  * Derivation: XBRL concept `TotalLiabilities`. Unit: GBP.

* `net_assets`
  * Definition: net assets or liabilities, equal to total assets minus total liabilities.
  * Examples: `700000.0` (£700,000)
  * Derivation: XBRL concepts `NetAssetsLiabilities`, `NetAssets`, or `TotalAssetsLessCurrentLiabilities` (first available). Unit: GBP.

* `fixed_assets`
  * Definition: total fixed (non-current) assets including tangible, intangible, and investment assets.
  * Examples: `350000.0` (£350,000)
  * Derivation: XBRL concepts `FixedAssets`, `TotalFixedAssets`, `NonCurrentAssets`, or `TotalNonCurrentAssets` (first available). Unit: GBP.

* `current_assets`
  * Definition: total current assets including cash, debtors, and stock.
  * Examples: `250000.0` (£250,000)
  * Derivation: XBRL concepts `CurrentAssets` or `TotalCurrentAssets` (first available). Unit: GBP.

* `shareholders_equity`
  * Definition: total stockholders' or shareholders' equity.
  * Examples: `500000.0` (£500,000)
  * Derivation: XBRL concepts `ShareholderFunds`, `TotalShareholdersFunds`, `ShareholdersFunds`, or `Equity` (first available). Unit: GBP.

* `creditors_due_within_one_year`
  * Definition: total creditors falling due within one year (current liabilities).
  * Examples: `120000.0` (£120,000)
  * Derivation: XBRL concepts `CreditorsDueWithinOneYear` or `CurrentLiabilities` (first available). Unit: GBP.

* `creditors_due_after_one_year`
  * Definition: total creditors falling due after more than one year (non-current liabilities).
  * Examples: `200000.0` (£200,000)
  * Derivation: XBRL concepts `CreditorsDueAfterOneYear` or `NonCurrentLiabilities` (first available). Unit: GBP.

* `called_up_share_capital`
  * Definition: called up share capital of the company.
  * Examples: `100.0` (£100)
  * Derivation: XBRL concepts `CalledUpShareCapital` or `CalledUpShareCapitalNotPaid` (first available). Unit: GBP.

#### Profit and Loss

* `revenue`
  * Definition: total revenue or turnover for the reporting period.
  * Examples: `2000000.0` (£2,000,000)
  * Derivation: XBRL concepts `TurnoverRevenue`, `Turnover`, `TurnoverGrossOperatingRevenue`, or `Revenue` (first available). Unit: GBP.
  * Note: many small company filings do not include a profit and loss account, so this field is frequently absent.

* `net_income`
  * Definition: net income or loss for the reporting period.
  * Examples: `150000.0` (£150,000), `-50000.0` (£-50,000 loss)
  * Derivation: XBRL concepts `ProfitLoss`, `ProfitLossOnOrdinaryActivitiesBeforeTax`, `ProfitLossForPeriod`, or `ProfitLossForFinancialYear` (first available). Unit: GBP.
  * Note: frequently absent for micro and abbreviated accounts.

#### Workforce

* `average_number_of_employees`
  * Definition: average number of employees during the reporting period (headcount average, not FTE).
  * Examples: `42.0`, `3.0`, `1250.0`
  * Derivation: XBRL concepts `AverageNumberEmployeesDuringPeriod` or `EmployeesTotal` (first available).
  * Note: only disclosed in filings that include employee information per FRS 102 / Companies Act 2006 requirements. Small companies are often exempt.

---

## Entity Relationships Summary

```
organization ──[companieshouse::filed]──→ companieshouse::accounts_filing
```

The `filed` relationship links a company to each of its annual accounts filings. One organization may have multiple `filed` edges (one per annual filing). The relationship is namespaced to `companieshouse` to distinguish it from the SEC `filed` relationship at the storage layer.
