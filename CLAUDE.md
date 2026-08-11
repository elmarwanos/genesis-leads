# Genesis Leads Portal

Wix Velo site (Git Integration + Wix CLI) that serves as the leads portal for Genesis Middle East distributors. Local dev: `wix dev` (Local Editor). Code pushed to `main` deploys to the live Wix site.

## Architecture

Leads flow: **Website forms / Social media agencies → `post_sendLead` / `post_sendBookService` HTTP functions → Wix collections (`AllLeads`, `BookaService`) → notification emails + distributor CRM fan-out.**

### Key files

- `src/backend/http-functions.js` — Public API endpoints. Auth via `api-key` header checked against the `api-key` Wix secret.
  - `post_sendLead`: normalizes country names (many aliases incl. Arabic), converts Arabic showroom names to English, parses `Social` formName format (`Genesis_<COUNTRY>_<MODEL>_<CAMPAIGN>_<IG|FB>_...`), validates with zod (`.strict()`), inserts to `AllLeads`, fires emails + `handleLeadCRM`.
  - `post_sendBookService`: same pattern → `BookaService` + `handleServiceCRM`.
  - Meta (Facebook) webhook endpoints exist at the bottom but lead data is only logged, not stored.
- `src/backend/distributorCRM.js` — Per-country CRM fan-out (fire-and-forget, called via `setTimeout(..., 0)` so failures never block the 201 response). Routing is by `reqBody.country`:
  - **Riyadh / Jeddah / Dammam → MYNM** (My Naghi Motors, KSA). Keyloop intake API `https://hdms.mynaghi.com:4443/api/intake`, `x-api-key` auth, secret `mynm_api_key`. Sales + Aftersales variants.
  - **UAE → Wallan**, split across two Zoho products by enquiry type (their request, email 2026-08-11):
    - *Sales* (Request a Quote, Book a Test Drive, social, anything unmapped) → Zoho **CRM** v5 Leads. Layout id `6174926000000091055` is hardcoded (org's "Standard" Leads layout — the id in Wallan's V8 doc, `6643351...`, is from a *different* Zoho org and gets rejected with INVALID_DATA; verified live 2026-07-14).
    - *Contact Us* and *Book a Service* → Zoho **Desk** tickets (`sendToWallanDesk`), `POST https://desk.zoho.com/api/v1/tickets`, department `969016000000712178` ("Genesis Workspace") / layout `969016000000723611` ("Genesis CS Department").
    - Both share one OAuth2 refresh token (secrets `wallan_zoho_client_id`, `wallan_zoho_client_secret`, `wallan_zoho_refresh_token`); the access token is cached in-module (~55 min) since Zoho throttles refresh grants.
  - **Egypt** — stubbed out (commented code at bottom of file).
- `src/public/helper-functions.js` — dashboard chart data aggregation; source values counted: Request a Quote, Book a Test Drive, Contact Us, Offline Event, IG, FB, LinkedIn, Snapchat, TikTok.
- `src/pages/*.js` — Wix page code (admin dashboards, login).
- `distro_crms/` — **gitignored** reference folder: distributor API docs, Postman collections, keys, email threads. MYNM api key lives in `distro_crms/MYNM/mynm-api-key.txt`. Wallan Zoho credentials are in `distro_crms/Wallan/output.md` (converted from their V8 docx).

## Wix secrets (Secrets Manager on the live site)

| Secret | Used for | On live site? |
|---|---|---|
| `api-key` | Inbound auth on both endpoints | ✅ confirmed 2026-07-14 |
| `meta-token` | Meta webhook verification | ✅ confirmed 2026-07-14 |
| `page_access_token` | Meta Graph API lead fetch | ✅ confirmed 2026-07-14 |
| `egypt_token` | Egypt CRM (stub, unused) | ✅ (legacy) |
| `uae_token` | ⚠️ legacy — referenced nowhere in code | ✅ (legacy) |
| `mynm_api_key` | MYNM intake API (`x-api-key`) | ❌ not yet added — value in `distro_crms/MYNM/mynm-api-key.txt` |
| `wallan_zoho_client_id` / `wallan_zoho_client_secret` / `wallan_zoho_refresh_token` | Wallan Zoho OAuth | ❌ not yet added — values in `distro_crms/Wallan/output.md` |

## Data shape notes

- `source` on a lead can be: `Request a Quote`, `Book a Test Drive`, `Contact Us`, `Offline Event`, `Social` (raw, gets rewritten), `IG`, `FB`, `LinkedIn`, `Snapchat`, `TikTok`.
- `country` for KSA is the *city* (Riyadh/Jeddah/Dammam), not "Saudi Arabia".
- `prefDate` arrives like `"2026-06-25 10:04 AM"`; `prefTime` like `"16:30 ~ 17:00"` or Arabic (`"الصباح"`). Parsers in distributorCRM.js convert to MYNM's `YYYY-MM-DD` / `HH:mm:ss`.
- Wallan Zoho fields are picklists — values must match exactly (see field table in `distro_crms/Wallan/output.md`).

## Open items (as of 2026-07-14)

- **Payment gate:** do NOT push the distro-CRM changes to `main` (= live site) until the client has paid for the integration work.
- `hdms.mynaghi.com:4443` confirmed as **UAT** — get the prod URL from Waqar (MYNM) before go-live.
- **MYNM UAT is IP-allow-listed** — office IP whitelisted by Waqar; Marwan's machine still blocked (TLS reset). Office runs go through the kit in `distro_crms/mynm-office-test-kit.zip` (employee runs it, sends back `results.json`).
- **MYNM office runs 1+2 (2026-07-16) — real API contract differs from their docs:** `campaign` is mandatory (400 on empty; docs say "recommended"), Aftersales also requires `formName`, bare Saudi mobiles missing the leading 0 are rejected (`05XXXXXXXX`/`01XXXXXXXX`; `+966…` and spaced formats accepted), and 202 responses return `{leadId, status:"Received"}` not the documented `{trackingId, message}`. Fixes in `distributorCRM.js`: `campaign` defaults to `"Website"`, Aftersales sends `formName:"Book a Service"` + `campaign:"Website"`, `normalizeKSAPhone()` prefixes the missing 0.
- **MYNM VERIFIED end-to-end (office run 3, 2026-07-16): all 8 tests pass** (Sales T1–T5, Aftersales T6, negatives N1–N2) with 202 + leadId. Aftersales sends `plateNumber: "N/A"` (form collects no plate; MYNM service desk gets the real one on confirmation — decided 2026-07-16). Canonical evidence: `distro_crms/in-office-results-3.json` (= `integration-tests/results.json`); final report `… - MYNM (2026-07-16).docx` — shareable.
- **Wallan verified end-to-end (2026-07-14):** OAuth + lead insert succeed against production Zoho. Test records created (flagged TEST in Description): ids `6174926000173277295`, `6174926000173304145`, `6174926000173278180` — Wallan to delete. Evidence: two per-distributor reports in `distro_crms/` (`… - Wallan (2026-07-14).docx` shareable now; `… - MYNM (2026-07-14).docx` is INTERIM until UAT access works — regenerate with `build_report.py mynm` after re-running the MYNM tests, see `distro_crms/integration-tests/README.md`).
- ~~**Zoho token caching**~~ — done 2026-08-11: `getWallanToken()` caches the access token in module scope until 5 min before expiry, shared by the CRM and Desk paths.
- **Wallan Zoho Desk (UAE Contact Us + Book a Service) — implemented 2026-08-11**, pending a live test run. Three corrections to their "Genesis API Documentation Desk - V8" doc, all verified live:
  - The doc describes their **sandbox** portal (`wallantradingco1774943580848`). Its `orgId` 919554510 returns 403 OAUTH_ORG_MISMATCH for our token; production is `wallantradingco` (id prefix `969016`). We **omit the `orgId` header entirely** so Desk resolves the token's own org — `/organizations` is not readable (see scopes below).
  - The doc's department/layout ids (`1321189…`) are sandbox ids; production keeps the same suffix under the `969016…` prefix.
  - `contactId` is documented as mandatory, but we hold **no `Desk.contacts.*` scope**. Worked around by inlining a `contact` object on ticket create — Zoho creates the contact, or reuses the existing one when the email matches.
  - Token scopes actually granted: `ZohoCRM.modules.leads.READ/CREATE/UPDATE`, `Desk.tickets.READ/CREATE/UPDATE/WRITE`, `Desk.search.READ`. No contacts/settings scope, so `/organizations` and `/departments` 403.
  - Field values mirror Wallan's own existing Genesis integration (read back from live tickets): subject `"<Kind>#<Source>#<phone>##"`, detail as a `- Key: value` list in `description`, free-text location in `cf_city_1` ("City txt") since `cf_city` is a Saudi-only picklist.
- **Campaign resolved 2026-08-11:** Wallan confirmed by email to send the free-text campaign name across as-is, for both CRM and Desk. The old picklist TODO is closed.
- **Wallan sales = approved to go live** (their email 2026-08-11), with **24 hours' notice to them before the go-live date**.
- Add the missing distro secrets to the live Secrets Manager: `mynm_api_key` + the three `wallan_zoho_*` (see table above).
- **Zoho `Campaign` picklist issue (flagged, work on later):** we send free-text campaign parsed from social formNames, but Zoho `Campaign` is a picklist (Summer Campaign, Ramadan Campaign, …) — may be rejected/dropped. TODO comment in `sendToWallanCRM`.
- Snapchat sub-source: decided 2026-07-14 to leave as `"None"` (not in Wallan's CRM picklist; Snapchat leads not flowing from our side anyway). Desk's picklist *does* have Snapchat, but it's unreachable — a lead's `source` is either a form type or a social network, and only "Contact Us"/service bookings route to Desk.
- Egypt CRM (Ghabbour) integration is stubbed/disabled (`egypt_token` secret already exists on live site).

## Conventions

- Plain JS with `// @ts-nocheck`, 4-space indent.
- CRM sends must never throw into the request handler — always `.catch()` and log.
- Test with the Postman collections in `distro_crms/MYNM/`; never send test leads to distributor CRMs without flagging it (they create real records in external systems).
