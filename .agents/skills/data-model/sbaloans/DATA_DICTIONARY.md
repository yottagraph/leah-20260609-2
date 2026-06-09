# Data Dictionary: SBA Loans (FOIA)

## Source Overview

The SBA 7(a) & 504 FOIA dataset is published by the U.S. Small Business Administration, Office of Capital Access. It contains loan-level records for the two main SBA loan guarantee programs:

- **7(a) Loan Program** -- the SBA's primary and most flexible loan program, covering working capital, equipment, real estate, and debt refinancing. Maximum loan amount is $5 million.
- **504 Loan Program** -- provides long-term, fixed-rate financing for major fixed assets (real estate, heavy equipment) through Certified Development Companies (CDCs). Structured as a three-party arrangement: borrower (10%), CDC-backed SBA portion (40%), and a conventional third-party lender (50%).

The data is distributed as CSV files via the CKAN open data platform at `https://data.sba.gov/dataset/7-a-504-foia`. File URLs change with each quarterly update (contain an "as of" date); the CKAN package API is used to discover current resource URLs dynamically.

The dataset is updated quarterly, typically available one month after the quarter ends.

| Program | CSV Files | Approx Size |
|---------|-----------|-------------|
| 7(a) | 4 files by decade: FY1991-1999, FY2000-2009, FY2010-2019, FY2020-Present | ~780MB |
| 504 | 2 files: FY1991-2009, FY2010-Present | ~104MB |

Both programs share a common column subset (borrower info, approval details, NAICS codes, loan status). 7(a) adds bank/lender fields and interest rate details; 504 adds CDC and third-party lender fields.

| Pipeline | `Record.Source` |
|----------|----------------|
| All files | `sbaloans` |

---

## Entity Types

### `financial_instrument`

An SBA-backed loan under the 7(a) or 504 program, identified by its location ID (a unique loan identifier assigned by the SBA).

- Primary key: Composite of program and location ID (e.g., `"7a_317954"`, `"504_188194"`)
- Entity resolver: named entity. Strong ID = `sba_loan_id`. Not mergeable across sources.

### `organization`

A business, bank, CDC, or third-party lender involved in an SBA loan. Three roles:
- **Borrower** -- the small business receiving the loan
- **Bank/Primary Lender** (7(a)) -- the financial institution originating the loan, identified by FDIC certificate number when available
- **CDC** (504) -- the Certified Development Company administering the 504 portion
- **Third-Party Lender** (504) -- the conventional lender providing the remaining portion

- Primary key: Organization name (borrowers), or FDIC certificate number (banks)
- Entity resolver: named entity, mergeable. Banks with an FDIC certificate number use it as a strong ID (property `fdic_certificate_number`), enabling cross-source entity resolution with existing FDIC-sourced bank entities.

### `location`

A geographic location representing the project county and state where the loan-funded activity takes place.

- Primary key: County + state combination (e.g., `"EAST BATON ROUGE, LA"`)
- Entity resolver: named entity, mergeable. Disambiguation via county name + state code.

---

## Properties

### Loan Properties (`financial_instrument`)

#### Identity

* `sba_loan_id`
  * Definition: Composite SBA loan identifier combining program and location ID.
  * Examples: `"7a_317954"`, `"504_188194"`
  * Derivation: Constructed from `program` (normalized) + `"_"` + `locationid` CSV column.

* `program`
  * Definition: SBA loan program name.
  * Examples: `"7a"`, `"504"`
  * Derivation: `program` CSV column, normalized (leading/trailing whitespace trimmed, " 7A" becomes "7a").

#### Financial Terms

* `gross_approval`
  * Definition: Total approved loan amount in dollars.
  * Examples: `"450000"`, `"810000"`
  * Derivation: `grossapproval` CSV column.

* `sba_guaranteed_approval`
  * Definition: SBA-guaranteed portion of the loan amount in dollars. 7(a) only.
  * Examples: `"337500"`
  * Derivation: `sbaguaranteedapproval` CSV column. Empty for 504 loans.

* `initial_interest_rate`
  * Definition: Initial interest rate of the loan as a percentage. 7(a) only.
  * Examples: `"6"`, `"5.5"`
  * Derivation: `initialinterestrate` CSV column.

* `interest_type`
  * Definition: Whether the interest rate is fixed or variable. 7(a) only.
  * Examples: `"Fixed"`, `"Variable"`
  * Derivation: `fixedorvariableinterestind` CSV column, decoded: F=Fixed, V=Variable.

* `term_in_months`
  * Definition: Loan term length in months.
  * Examples: `"120"`, `"240"`, `"300"`
  * Derivation: `terminmonths` CSV column.

* `third_party_dollars`
  * Definition: Third-party lender contribution in dollars. 504 only.
  * Examples: `"1334500"`
  * Derivation: `thirdpartydollars` CSV column.

#### Dates

* `approval_date`
  * Definition: Date the loan was approved.
  * Examples: `"12/5/2020"`, `"10/2/2009"`
  * Derivation: `approvaldate` CSV column, format M/D/YYYY.

* `approval_fiscal_year`
  * Definition: Federal fiscal year of approval (Oct 1 - Sep 30).
  * Examples: `"2021"`, `"2010"`
  * Derivation: `approvalfy` CSV column.

* `first_disbursement_date`
  * Definition: Date of first loan disbursement.
  * Examples: `"1/1/2021"`, `"9/15/2010"`
  * Derivation: `firstdisbursementdate` CSV column.

* `paid_in_full_date`
  * Definition: Date the loan was paid in full.
  * Derivation: `paidinfulldate` CSV column. Empty if loan is not paid off.

* `chargeoff_date`
  * Definition: Date the loan was charged off.
  * Derivation: `chargeoffdate` CSV column. Empty if loan has not been charged off.

#### Processing

* `processing_method`
  * Definition: SBA processing method used for the loan.
  * Examples: `"Preferred Lenders Program"`, `"504 Basic"`
  * Derivation: `processingmethod` CSV column.

* `sub_program`
  * Definition: SBA sub-program designation.
  * Examples: `"Guaranty"`, `"Sec. 504 - Loan Guarantees - Private Sector Financed"`
  * Derivation: `subprogram` CSV column.

#### Industry and Business

* `naics_code`
  * Definition: North American Industry Classification System code for the borrower's business.
  * Examples: `"531390"`, `"721110"`
  * Derivation: `naicscode` CSV column.

* `naics_description`
  * Definition: Description of the NAICS industry classification.
  * Examples: `"Other Activities Related to Real Estate"`, `"Hotels (except Casino Hotels) and Motels"`
  * Derivation: `naicsdescription` CSV column.

* `franchise_name`
  * Definition: Name of the franchise if the borrower is a franchisee.
  * Examples: `"CHOICE HOTELS INTERNATIONAL INC."`
  * Derivation: `franchisename` CSV column. Empty if not a franchise.

* `business_type`
  * Definition: Legal structure of the borrowing business.
  * Examples: `"CORPORATION"`, `"LLC"`, `"PARTNERSHIP"`, `"INDIVIDUAL"`
  * Derivation: `businesstype` CSV column.

* `business_age`
  * Definition: Age category of the borrowing business at time of loan.
  * Examples: `"Existing or more than 2 years old"`, `"New Business or 2 years or less"`, `"Less than 4 years old but at least 3"`
  * Derivation: `businessage` CSV column.

#### Status

* `loan_status`
  * Definition: Current status of the loan.
  * Examples: `"LIQUID"` (active), `"P I F"` (paid in full), `"CHGOFF"` (charged off), `"EXEMPT"`, `"PREPAID IN FULL"`
  * Derivation: `loanstatus` CSV column.

* `gross_chargeoff_amount`
  * Definition: Gross charge-off amount in dollars.
  * Examples: `"0"`, `"125000"`
  * Derivation: `grosschargeoffamount` CSV column.

* `revolver_status`
  * Definition: Whether the loan is a revolving line of credit. 7(a) only.
  * Examples: `"TRUE"`, `"FALSE"`
  * Derivation: `revolverstatus` CSV column.

* `jobs_supported`
  * Definition: Number of jobs supported by the loan.
  * Examples: `"9"`, `"250"`, `"0"`
  * Derivation: `jobssupported` CSV column.

#### Geography

* `sba_district_office`
  * Definition: SBA district office that processed the loan.
  * Examples: `"LOUISIANA DISTRICT OFFICE"`, `"ILLINOIS DISTRICT OFFICE"`
  * Derivation: `sbadistrictoffice` CSV column.

* `congressional_district`
  * Definition: Congressional district of the project.
  * Examples: `"6"`, `"13"`
  * Derivation: `congressionaldistrict` CSV column.

### Organization Properties

* `address`
  * Definition: Physical address of the organization formatted as "street, city, state zip".
  * Examples: `"11851 Wentling Ave, BATON ROUGE, LA 70816"`, `"1981 Marcus Avenue, LAKE SUCCESS, NY 11042"`
  * Derivation: Formatted from borrower address fields (`borrstreet`/`borrcity`/`borrstate`/`borrzip`) for borrowers, bank fields (`bankstreet`/`bankcity`/`bankstate`/`bankzip`) for 7(a) banks, or CDC fields (`cdc_street`/`cdc_city`/`cdc_state`/`cdc_zip`) for 504 CDCs.

* `fdic_certificate_number`
  * Definition: FDIC certificate number identifying a bank. Used as a strong ID for entity resolution with FDIC-sourced bank entities.
  * Examples: `"59345"`
  * Derivation: `bankfdicnumber` CSV column. Only present for 7(a) bank entities.
  * Note: Enables cross-source entity resolution with the FDIC dataset (`fdic` source), which also uses `fdic_certificate_number` as a strong ID property on bank organizations.

* `ncua_number`
  * Definition: NCUA charter number identifying a credit union.
  * Derivation: `bankncuanumber` CSV column. Only present for 7(a) entities where the lender is a credit union.
  * Note: Sparse -- most lenders are banks, not credit unions.

---

## Entity Relationships

```
organization (borrower)       ──[borrower_of]──→ financial_instrument (loan)
organization (bank/CDC)       ──[lender_of]────→ financial_instrument (loan)    attr: lender_role=primary|cdc
organization (third-party)    ──[lender_of]────→ financial_instrument (loan)    attr: lender_role=third_party
financial_instrument (loan)   ──[is_located_at]─→ location (project county/state)
```

---

## Attributes

* `lender_role` (on `lender_of` relationship)
  * Definition: Role of the lending organization in the loan.
  * Values: `"primary"` (7(a) bank), `"cdc"` (504 Certified Development Company), `"third_party"` (504 conventional third-party lender)
  * Derivation: Set based on which organization record is being emitted and the loan program type.

---
