# Data Dictionary: FAA Aircraft Registry

## Source Overview

The FAA Releasable Aircraft Database is published by the Federal Aviation Administration, Civil Aviation Registry, Aircraft Registration Branch (AFS-750). It contains registration records for all U.S. civil aircraft, plus reference tables, deregistered aircraft, dealer certificates, document indices, and reserved N-numbers.

The database is distributed as a single ZIP archive (~60MB) refreshed daily at 11:30 PM Central Time. It contains 7 comma-delimited `.txt` files. Field definitions are documented in [ardata.pdf](https://registry.faa.gov/database/ardata.pdf).

Download URL: `https://registry.faa.gov/database/ReleasableAircraft.zip`

The implementation joins ACFTREF.txt and ENGINE.txt as in-memory lookup tables into MASTER.txt rows, producing denormalized aircraft registration records. DEREG.txt uses a similar structure and is processed alongside MASTER.txt. DEALER.txt, DOCINDEX.txt, and RESERVED.txt are processed as separate entity types.

| File | Record Count (approx) | Entity Type |
|------|----------------------|-------------|
| MASTER.txt | ~300,000+ | `aircraft` |
| ACFTREF.txt | ~few thousand | Lookup table (joined into `aircraft`) |
| ENGINE.txt | ~few thousand | Lookup table (joined into `aircraft`) |
| DEREG.txt | ~300,000+ | `aircraft` (deregistered) |
| DEALER.txt | ~few thousand | `organization` (aircraft dealers) |
| DOCINDEX.txt | ~millions | `document` (aircraft document index) |
| RESERVED.txt | ~tens of thousands | `aircraft` (reserved N-numbers) |

| Pipeline | `Record.Source` |
|----------|----------------|
| All files | `faaregistry` |

---

## Entity Types

### `aircraft`

A U.S. civil aircraft identified by its FAA registration N-number. Includes active registrations (MASTER.txt), deregistered aircraft (DEREG.txt), and reserved N-numbers (RESERVED.txt).

- Primary key: N-Number (e.g., `"12345"` for N12345)
- Entity resolver: named entity. Strong ID = `n_number`. Mode S hex code as secondary identifier. Disambiguation via manufacturer, model, serial number, registrant name.

### `organization`

An aircraft dealer or manufacturer holding an FAA Dealer's Aircraft Registration Certificate.

- Primary key: Certificate number (e.g., `"24-0001"`)
- Entity resolver: named entity. Strong ID = `dealer_certificate_number`. Disambiguation via name, address.

### `document`

A document recorded with the FAA Aircraft Registry, indexed by collateral identification (usually the N-number).

- Primary key: Document ID (12-character unique identifier)
- Entity resolver: named entity. Strong ID = `faa_document_id`. Not mergeable.

### `location`

A geographic location derived from the registrant's address (city + state).

- Primary key: city + state combination
- Entity resolver: named entity. Disambiguation via city name, state code.

---

## Properties

### Aircraft Properties (from MASTER.txt + ACFTREF.txt + ENGINE.txt joins)

#### Identity and Registration

* `n_number`
  * Definition: FAA registration number assigned to the aircraft (without the "N" prefix).
  * Examples: `"12345"`, `"789AB"`, `"5NJ"`
  * Derivation: `N-NUMBER` field from MASTER.txt, positions 1-5.

* `serial_number`
  * Definition: Complete aircraft serial number assigned by the manufacturer.
  * Examples: `"28-7990244"`, `"172S10245"`
  * Derivation: `SERIAL NUMBER` field from MASTER.txt, positions 7-36.

* `mode_s_code_hex`
  * Definition: Aircraft Mode S transponder code in hexadecimal format (ICAO 24-bit address).
  * Examples: `"A12345"`, `"ABCDEF"`
  * Derivation: `MODE S CODE HEX` field from MASTER.txt, positions 602-611.
  * Note: This corresponds to the `icaoAddress` property in the KG aircraft flavor schema.

* `mode_s_code`
  * Definition: Aircraft Mode S transponder code in octal format.
  * Examples: `"50712345"`
  * Derivation: `MODE S CODE` field from MASTER.txt, positions 257-264.

* `unique_id`
  * Definition: FAA-assigned unique identification number for the registration record.
  * Examples: `"01234567"`
  * Derivation: `UNIQUE ID` field from MASTER.txt, positions 541-548.

#### Aircraft Details (joined from ACFTREF.txt)

* `manufacturer_name`
  * Definition: Name of the aircraft manufacturer.
  * Examples: `"CESSNA"`, `"BOEING"`, `"PIPER"`, `"BEECH"`
  * Derivation: Joined from ACFTREF.txt `AIRCRAFT MANUFACTURER NAME` (positions 9-38) via `AIRCRAFT MFR MODEL CODE` foreign key.

* `model_name`
  * Definition: Aircraft model and series name.
  * Examples: `"172S"`, `"737-800"`, `"PA-28-181"`
  * Derivation: Joined from ACFTREF.txt `MODEL NAME` (positions 40-59) via `AIRCRAFT MFR MODEL CODE` foreign key.

* `aircraft_type`
  * Definition: Type of aircraft.
  * Examples: `"Fixed wing single engine"`, `"Rotorcraft"`, `"Balloon"`
  * Derivation: `TYPE AIRCRAFT` field from MASTER.txt (position 249), decoded: 1=Glider, 2=Balloon, 3=Blimp/Dirigible, 4=Fixed wing single engine, 5=Fixed wing multi engine, 6=Rotorcraft, 7=Weight-shift-control, 8=Powered Parachute, 9=Gyroplane, H=Hybrid Lift, O=Other.

* `engine_type`
  * Definition: Type of engine installed.
  * Examples: `"Reciprocating"`, `"Turbo-fan"`, `"Electric"`
  * Derivation: `TYPE ENGINE` field from MASTER.txt (positions 251-252), decoded: 0=None, 1=Reciprocating, 2=Turbo-prop, 3=Turbo-shaft, 4=Turbo-jet, 5=Turbo-fan, 6=Ramjet, 7=2 Cycle, 8=4 Cycle, 9=Unknown, 10=Electric, 11=Rotary.

* `year_manufactured`
  * Definition: Year the aircraft was manufactured.
  * Examples: `"1978"`, `"2023"`
  * Derivation: `YEAR MFR` field from MASTER.txt, positions 52-55.

* `number_of_engines`
  * Definition: Number of engines on the aircraft.
  * Examples: `"1"`, `"2"`, `"4"`
  * Derivation: Joined from ACFTREF.txt `NUMBER OF ENGINES` (positions 70-71).

* `number_of_seats`
  * Definition: Maximum number of seats in the aircraft.
  * Examples: `"4"`, `"189"`, `"12"`
  * Derivation: Joined from ACFTREF.txt `NUMBER OF SEATS` (positions 73-75).

* `aircraft_weight_class`
  * Definition: Maximum gross takeoff weight class.
  * Examples: `"Up to 12,499 lbs"`, `"12,500 - 19,999 lbs"`, `"20,000 and over"`, `"UAV up to 55 lbs"`
  * Derivation: Joined from ACFTREF.txt `AIRCRAFT WEIGHT` (positions 77-83), decoded: 1=Up to 12,499, 2=12,500-19,999, 3=20,000 and over, 4=UAV up to 55.

* `cruising_speed`
  * Definition: Average cruising speed in miles per hour.
  * Examples: `"124"`, `"530"`
  * Derivation: Joined from ACFTREF.txt `AIRCRAFT CRUISING SPEED` (positions 85-88).
  * Note: Not present on all records.

* `aircraft_category`
  * Definition: Land/sea/amphibian classification.
  * Examples: `"Land"`, `"Sea"`, `"Amphibian"`
  * Derivation: Joined from ACFTREF.txt `AIRCRAFT CATEGORY CODE` (position 66), decoded: 1=Land, 2=Sea, 3=Amphibian.

* `builder_certification`
  * Definition: Builder certification classification.
  * Examples: `"Type Certificated"`, `"Not Type Certificated"`, `"Light Sport"`
  * Derivation: Joined from ACFTREF.txt `BUILDER CERTIFICATION CODE` (position 68), decoded: 0=Type Certificated, 1=Not Type Certificated, 2=Light Sport.

* `type_certificate_data_sheet`
  * Definition: FAA Type Certificate Data Sheet reference.
  * Derivation: Joined from ACFTREF.txt `TC DATA SHEET` (positions 90-105).

* `type_certificate_holder`
  * Definition: Name of the Type Certificate holder.
  * Derivation: Joined from ACFTREF.txt `TC DATA HOLDER` (positions 107-157).

#### Engine Details (joined from ENGINE.txt)

* `engine_manufacturer`
  * Definition: Name of the engine manufacturer.
  * Examples: `"LYCOMING"`, `"CONT MOTOR"`, `"P&W"`
  * Derivation: Joined from ENGINE.txt `ENGINE MANUFACTURER NAME` (positions 7-16) via `ENGINE MFR MODEL CODE` foreign key.

* `engine_model`
  * Definition: Engine model name.
  * Examples: `"O-320-D2J"`, `"IO-540"`
  * Derivation: Joined from ENGINE.txt `ENGINE MODEL NAME` (positions 18-30).

* `engine_horsepower`
  * Definition: Engine horsepower (for reciprocating, turbo-prop, turbo-shaft, 2-cycle, 4-cycle engines). Unit: HP.
  * Examples: `"180"`, `"310"`
  * Derivation: Joined from ENGINE.txt `ENGINE HORSEPOWER` (positions 35-39).
  * Note: Only populated for engine types 1, 2, 3, 7, 8.

* `engine_thrust`
  * Definition: Engine thrust (for turbo-jet, turbo-fan, ramjet engines). Unit: pounds of thrust.
  * Examples: `"27300"`, `"56000"`
  * Derivation: Joined from ENGINE.txt `POUNDS OF THRUST` (positions 41-46).
  * Note: Only populated for engine types 4, 5, 6.

#### Registration Status

* `registration_status`
  * Definition: Current status of the aircraft registration.
  * Examples: `"Valid Registration"`, `"Registration Expired"`, `"Sale Reported"`, `"Administratively Canceled"`
  * Derivation: `STATUS CODE` field from MASTER.txt (positions 254-255), decoded to human-readable text. Codes include V=Valid, R=Pending, E=Revoked by enforcement, M=Manufacturer, etc.

* `registrant_type`
  * Definition: Type of entity that owns the aircraft.
  * Examples: `"Individual"`, `"Corporation"`, `"LLC"`, `"Government"`
  * Derivation: `TYPE REGISTRANT` field from MASTER.txt (position 57), decoded: 1=Individual, 2=Partnership, 3=Corporation, 4=Co-Owned, 5=Government, 7=LLC, 8=Non Citizen Corporation, 9=Non Citizen Co-Owned.

* `fractional_ownership`
  * Definition: Whether the registration has fractional ownership.
  * Examples: `"true"`, `"false"`
  * Derivation: `FRACTIONAL OWNERSHIP` field from MASTER.txt (position 266), `Y` = true, blank = false.

#### Certification

* `airworthiness_class`
  * Definition: Airworthiness certificate classification.
  * Examples: `"Standard"`, `"Experimental"`, `"Restricted"`, `"Light Sport"`
  * Derivation: `CERTIFICATION A - AIRWORTHINESS CLASSIFICATION CODE` from MASTER.txt (position 238), decoded: 1=Standard, 2=Limited, 3=Restricted, 4=Experimental, 5=Provisional, 6=Multiple, 7=Primary, 8=Special Flight Permit, 9=Light Sport.

* `approved_operations`
  * Definition: Approved operations for the airworthiness certificate.
  * Examples: `"Normal"`, `"Utility"`, `"Agriculture and Pest Control"`, `"Amateur Built"`
  * Derivation: `CERTIFICATION B - APPROVED OPERATION CODES` from MASTER.txt (positions 239-247), decoded based on airworthiness class.

#### Registrant Information

* `registrant_name`
  * Definition: Name of the registered owner as it appears on the Application for Registration.
  * Examples: `"SMITH JOHN"`, `"DELTA AIR LINES INC"`, `"UNITED STATES GOVERNMENT"`
  * Derivation: `REGISTRANT'S NAME` field from MASTER.txt, positions 59-108.

* `registrant_address`
  * Definition: Formatted street address of the registrant.
  * Derivation: Concatenation of `STREET1` (positions 110-142) and `STREET2` (positions 144-176) from MASTER.txt.

* `registrant_city`
  * Definition: City of the registrant.
  * Examples: `"ATLANTA"`, `"WICHITA"`, `"SEATTLE"`
  * Derivation: `REGISTRANT'S CITY` field from MASTER.txt, positions 178-195.

* `registrant_state`
  * Definition: Two-letter state code of the registrant.
  * Examples: `"GA"`, `"KS"`, `"WA"`
  * Derivation: `REGISTRANT'S STATE` field from MASTER.txt, positions 197-198.

* `registrant_zip_code`
  * Definition: Postal ZIP code of the registrant.
  * Examples: `"30320"`, `"67201-1234"`
  * Derivation: `REGISTRANT'S ZIP CODE` field from MASTER.txt, positions 200-209.

* `registrant_region`
  * Definition: FAA region of the registrant.
  * Examples: `"Eastern"`, `"Western-Pacific"`, `"Great Lakes"`
  * Derivation: `REGISTRANT'S REGION` field from MASTER.txt (position 211), decoded: 1=Eastern, 2=Southwestern, 3=Central, 4=Western-Pacific, 5=Alaskan, 7=Southern, 8=European, C=Great Lakes, E=New England, S=Northwest Mountain.

#### Dates

* `last_activity_date`
  * Definition: Date of last registration activity.
  * Examples: `"2024/03/15"`
  * Derivation: `LAST ACTIVITY DATE` from MASTER.txt (positions 220-227), format YYYY/MM/DD.

* `certificate_issue_date`
  * Definition: Date the registration certificate was issued.
  * Examples: `"2023/06/01"`
  * Derivation: `CERTIFICATE ISSUE DATE` from MASTER.txt (positions 229-236), format YYYY/MM/DD.

* `airworthiness_date`
  * Definition: Date of airworthiness certification.
  * Examples: `"2001/09/14"`
  * Derivation: `AIRWORTHINESS DATE` from MASTER.txt (positions 268-275).

* `expiration_date`
  * Definition: Certificate of Registration expiration date.
  * Examples: `"2027/03/31"`
  * Derivation: `EXPIRATION DATE` from MASTER.txt (positions 532-539), format YYYY/MM/DD.

#### Co-Owners

* `other_owner_name`
  * Definition: Co-owner or partnership name (up to 5 additional names).
  * Derivation: `OTHER NAME 1` through `OTHER NAME 5` from MASTER.txt (positions 277-530).
  * Note: Stored as multiple atoms when multiple co-owners exist.

#### Kit Aircraft

* `kit_manufacturer`
  * Definition: Kit manufacturer name (for kit-built aircraft).
  * Derivation: `KIT MFR` from MASTER.txt (positions 550-579).

* `kit_model`
  * Definition: Kit model name.
  * Derivation: `KIT MODEL` from MASTER.txt (positions 581-600).

### Aircraft Properties (from DEREG.txt -- additional fields)

Deregistered aircraft share all properties above where available, plus:

* `cancel_date`
  * Definition: Date the registration was canceled.
  * Examples: `"2023/01/15"`
  * Derivation: `CANCEL DATE` from DEREG.txt (positions 240-247).

* `export_country`
  * Definition: Country the aircraft was exported to upon deregistration.
  * Examples: `"CANADA"`, `"BRAZIL"`
  * Derivation: `EXPORT COUNTRY` from DEREG.txt (positions 260-277).

### Organization Properties (from DEALER.txt)

#### Identity

* `dealer_certificate_number`
  * Definition: FAA dealer certificate number.
  * Examples: `"24-0001"`, `"23-1234"`
  * Derivation: `CERTIFICATE NUMBER` from DEALER.txt (positions 1-7), format YY-NNNN.

* `dealer_ownership_type`
  * Definition: Ownership type of the dealer.
  * Examples: `"Individual"`, `"Corporation"`, `"LLC"`
  * Derivation: `OWNERSHIP` from DEALER.txt (position 9), decoded: 1=Individual, 2=Partnership, 3=Corporation, 4=Co-Ownership, 7=LLC, 8=Non Citizen Corporation.

* `dealer_certificate_issue_date`
  * Definition: Date the dealer certificate was issued.
  * Derivation: `CERTIFICATE ISSUE DATE` from DEALER.txt (positions 11-18), format YYYYMMDD.

* `dealer_expiration_date`
  * Definition: Dealer certificate expiration date.
  * Derivation: `EXPIRATION DATE` from DEALER.txt (positions 20-27), format YYYYMMDD.

* `dealer_expired`
  * Definition: Whether the dealer certificate has expired.
  * Examples: `"true"`, `"false"`
  * Derivation: `EXPIRATION FLAG` from DEALER.txt (position 29), `*` = true.

#### Address

* `dealer_address`
  * Definition: Mailing address of the dealer.
  * Derivation: Concatenation of DEALER.txt address fields (STREET1, STREET2, CITY, STATE, ZIP CODE).

### Document Properties (from DOCINDEX.txt)

* `faa_document_id`
  * Definition: Unique document identifier assigned by the FAA.
  * Examples: `"000123456789"`
  * Derivation: `DOCUMENT ID` from DOCINDEX.txt (positions 92-103).

* `collateral_type`
  * Definition: Type of collateral the document pertains to.
  * Examples: `"Aircraft"`, `"Engine"`, `"Propeller"`, `"Spare Parts"`
  * Derivation: `TYPE COLLATERAL` from DOCINDEX.txt (position 1), decoded: 1=Aircraft, 2=Engine, 3=Propeller, 4=Spare Parts, 5=Document, 9=Unidentified.

* `collateral_identifier`
  * Definition: Collateral identification -- typically an N-number for aircraft, or make/model/serial for engines and propellers.
  * Derivation: `COLLATERAL` from DOCINDEX.txt (positions 3-39).

* `document_receipt_date`
  * Definition: Date the document was filed for recordation with the Aircraft Registry.
  * Derivation: `DOCUMENT RECEIPT DATE` from DOCINDEX.txt (positions 105-112), format YYYYMMDD.

* `document_type`
  * Definition: Type of document being indexed.
  * Examples: `"BOS"` (Evidence of Ownership), `"S/A"` (Security Conveyance/Lien), `"REL"` (Lien Release)
  * Derivation: `DOC TYPE` from DOCINDEX.txt (positions 165-167).

### Aircraft Properties (from RESERVED.txt)

Reserved N-numbers produce minimal `aircraft` records:

* `reservation_type`
  * Definition: Type of N-number reservation.
  * Examples: `"Fee paid"`, `"Reserved to manufacturer"`, `"N-Number change in process"`
  * Derivation: `TYPE RESERVATION` from RESERVED.txt (positions 168-169), decoded.

* `reservation_date`
  * Definition: Date the N-number was reserved.
  * Derivation: `RESERVE DATE` from RESERVED.txt (positions 159-166), format YYYYMMDD.

* `reservation_expiration_date`
  * Definition: Date the reservation expiration notice was sent.
  * Derivation: `EXPIRATION NOTICE DATE` from RESERVED.txt (positions 171-178), format YYYYMMDD.

---

## Entity Relationships

```
aircraft      ──[is_located_at]──────→ location        (registrant city/state)
aircraft      ──[has_document]───────→ document         (via N-number in DOCINDEX collateral)
organization  ──[is_located_at]──────→ location         (dealer address)
```

---
