# MUL Nexus – Fall 2026 Stable Release

Date: 22 June 2026

## Release Status

Stable production release after live verification.

## Confirmed Working

- WhatsApp main menu working.
- Fee Structure option updated for Fall 2026.
- Fee Structure PDF delivery working through WhatsApp option 2.
- Program offering list updated according to Fall 2026 Excel list.
- Obvious spelling/capitalization issues corrected for student-facing program names.
- Programs available in index.js but not matching the Fall 2026 Excel offering list removed.
- Dashboard running and current known minor behavior accepted: 24 Hours Agent Chat Requests and Agent Request Insights may show small timing/source-based differences, while 30 Days reconciliation matches.
- Callback panel filter logic added on frontend without backend/database change.

## Files Involved

- index.js
- public/admin.js
- public/admin.html
- public/admin.css
- public/Fee Structure Fall 2026.pdf

## Notes

- No dashboard query logic change was applied for the Agent Chat Requests mismatch after deciding to leave the current behavior as-is.
- Excel Fall 2026 offering list remains the source of truth for program offerings.
- Existing working logic should not be refactored or changed without discussion.
