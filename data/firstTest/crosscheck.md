# Cross-check Summary

- Manifest: `C:\visa-entry-bot\data\firstTest\manifest.json`
- Reference: `C:\visa-entry-bot\data\GARUDA 25 FEB 2026 MANIFEST ROFIQ TOUR.xlsx`
- Scanned members: `21`
- Comparable members: `20`
- Skipped members without reference: `1`
- Suspected reference conflicts: `3`
- Total field mismatches: `13`

## Field Stats

| Field | Compared | Mismatched | Accuracy |
| --- | ---: | ---: | ---: |
| firstName | 20 | 5 | 75.0% |
| familyName | 20 | 6 | 70.0% |
| passportNumber | 20 | 0 | 100.0% |
| nationality | 0 | 0 | - |
| dob | 20 | 0 | 100.0% |
| issueDate | 20 | 1 | 95.0% |
| expiryDate | 20 | 1 | 95.0% |
| gender | 20 | 0 | 100.0% |
| placeOfBirth | 20 | 0 | 100.0% |
| issuingOffice | 20 | 0 | 100.0% |

## Skipped Members

- `HALIMAH 2.png` passport=`` status=`ERROR`

## Member Mismatches

### HALIMAH 1.png
- Match by: `passport`
- Reference: `HALIMAH ABDUL RAFIK HASIAN` / `X7028437`
- `firstName`: actual=`HALIMAH` expected=`HALIMAH ABDUL RAFIK`
- `familyName`: actual=`HALIMAH` expected=`HASIAN`
- `issueDate`: actual=`2026-01-21` expected=`1992-05-17`
- `referenceConflict.issueDate`: reference issue/expiry pair looks unusual (-1Y term)
- `referenceConflict.issueDate`: reference issueDate matches DOB

### M HAMDI 1.png
- Match by: `passport`
- Reference: `M HAMDI M LIMA ASTROE` / `X8489774`
- `firstName`: actual=`M` expected=`M HAMDI M LIMA`
- `familyName`: actual=`HAMDI` expected=`ASTROE`

### NURHIDAYAH 1.png
- Match by: `passport`
- Reference: `NURHIDAYAH M ISHAK ASMAPA` / `X8489715`
- `firstName`: actual=`NURHIDAYAH` expected=`NURHIDAYAH M ISHAK`
- `familyName`: actual=`NURHIDAYAH` expected=`ASMAPA`

### RATNA 1.png
- Match by: `passport`
- Reference: `RATNA JELITA DATUK KIRAP` / `C9877086`
- `firstName`: actual=`RATNA` expected=`RATNA JELITA DATUK`
- `familyName`: actual=`JELITA` expected=`KIRAP`

### SAKDILLAH 1.png
- Match by: `passport`
- Reference: `SAKDILLAH ABDUL MUIN` / `C9876981`
- `firstName`: actual=`SAKDILLAH` expected=`SAKDILLAH ABDUL`
- `familyName`: actual=`SAKDILLAH` expected=`MUIN`
- `expiryDate`: actual=`2027-07-11` expected=`2026-07-11`
- `referenceConflict.expiryDate`: reference issue/expiry pair looks unusual (4Y term)

### SUDARWATI 1.png
- Match by: `passport`
- Reference: `SUDARWATI LEGIRUN` / `X8489039`
- `familyName`: actual=`SUDARWATI` expected=`LEGIRUN`
