# Round 50 manual QA

1. Run `npm test` from a clean checkout and confirm locale validation runs before the historical regression chain.
2. Temporarily remove one Russian locale key and confirm `node scripts/report-locale-parity.mjs` exits non-zero while still writing `locale-parity-report.json` with the missing key.
3. Temporarily change a translated `{host}` placeholder to `{hostname}` and confirm validation fails with a placeholder mismatch.
4. Temporarily set one locale `message` to a non-string or blank string and confirm validation fails with a schema error.
5. Restore the catalogs, run the locale validator again, and confirm English/Russian counts match with no duplicate/missing/extra/schema/placeholder errors.
6. Run `npm run build`, `npm run build:blocker-only`, `npm run build:google`, then `npm run clean`; confirm the generated build directories and `locale-parity-report.json` are removed without affecting source files.
