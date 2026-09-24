// @ts-nocheck


// REQBODY TEMPLATE
// const leadsSchemaZod = z.object({
//     created: z.string(),
//     createdTime: z.string().optional(),
//     source: z.string(),                      //Missing from Service
//     campaign: z.string().optional(),         //Missing from Service
//     country: z.string(),
//     showroom: z.string().optional(),         //Missing from Service
//     fullName: z.string(),
//     vehicleName: z.string().optional(),
//     email: z.string(),
//     areaPhoneNumber: z.string(),
//     enquiry: z.string().optional(),
//     sns: z.string().optional(),
//     prefDate: z.string().optional(),
//     prefTime: z.string().optional(),
//     contactEmail: z.string().optional(),
//     currentCar: z.string().optional(),       //Missing from Service
//     purchase: z.string().optional()          //Missing from Service
// }).strict();

// const serviceSchemaZod = z.object({
//     created: z.string(),
//     createdTime: z.string().optional(),
//     country: z.string(),
//     serviceCenter: z.string(),
//     fullName: z.string(),
//     email: z.string(),
//     areaPhoneNumber: z.string(),
//     vehicleName: z.string().optional(),
//     enquiry: z.string().optional(),
//     sns: z.string().optional(),
//     prefDate: z.string().optional(),
//     prefTime: z.string().optional(),
//     contactEmail: z.string().optional(),
// }).strict();

import { getSecret } from 'wix-secrets-backend';

// ─── Name parsing helper ──────────────────────────────────────────────────────

function parseName(fullName) {
    const prefixMatch = fullName.match(/^(Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.)\s*/i);
    const prefix = prefixMatch ? prefixMatch[1] : "";
    const nameOnly = fullName.replace(/^(Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.)\s*/i, "").trim();
    const parts = nameOnly.split(" ");
    const firstName = parts[0] || "";
    const lastName = parts.slice(1).join(" ") || nameOnly;
    return { prefix, firstName, lastName };
}

// ─── Date/time parsing helpers ────────────────────────────────────────────────
// prefDate arrives as "2026-06-25 10:04 AM" — MYNM expects "YYYY-MM-DD"
function parseDate(prefDate) {
    if (!prefDate) return "";
    return prefDate.split(" ")[0];
}

// prefTime arrives as "16:30 ~ 17:00" or Arabic like "الصباح" — MYNM expects "HH:mm:ss"
function parseTime(prefTime) {
    if (!prefTime) return "";
    const match = prefTime.match(/(\d{1,2}:\d{2})/);
    return match ? match[1] + ":00" : "";
}

// The `sns` field carries the form's "Pref Comms" multi-select — a "/"-separated list of
// the channels the customer agreed to be contacted on ("Phone", "Email / Phone / SMS",
// "SMS", …), or empty when they picked none. Wallan's Zoho keeps one flag per channel.
function parseOptIns(sns) {
    const value = sns || "";
    return {
        email: /email/i.test(value),
        phone: /phone/i.test(value),
        sms: /sms/i.test(value),
    };
}

// MYNM rejects bare Saudi mobiles missing the leading 0 (e.g. "546011563", common on
// Snapchat leads) — their validator wants 05XXXXXXXX / 01XXXXXXXX; +966 and spaced
// formats are accepted as-is (verified against UAT 2026-07-16).
function normalizeKSAPhone(phone) {
    if (!phone) return "";
    const digits = String(phone).replace(/\D/g, "");
    if (/^5\d{8}$/.test(digits) || /^1\d{8}$/.test(digits)) return "0" + digits;
    return phone;
}

// ─── MYNM (My Naghi Motors) — Saudi Arabia (Riyadh, Jeddah, Dammam) ──────────
// Endpoint: Keyloop intake API. hdms.mynaghi.com:4443 confirmed as UAT (2026-07-14) —
// get prod URL from Waqar (MYNM) before go-live.
// Auth: x-api-key header. Secret name: mynm_api_key.

async function sendToMYNMCRM(reqBody) {
    const { prefix, firstName, lastName } = parseName(reqBody.fullName);

    const payload = {
        brand: "GENESIS",
        leadType: "Sales",
        firstName,
        lastName,
        mobilePhone: normalizeKSAPhone(reqBody.areaPhoneNumber),
        email: reqBody.email || "",
        title: prefix,
        // MYNM's API enforces campaign as mandatory (400 on empty) even though their doc
        // lists it as recommended — verified against UAT 2026-07-16. Website leads carry
        // no campaign, so default to "Website".
        campaign: reqBody.campaign || "Website",
        formName: reqBody.source || "",
        branch: reqBody.showroom || "",
        vehicleModel: reqBody.vehicleName || "",
        purchaseHorizon: reqBody.purchase || "",
        hasConsent: true,
        notes: reqBody.enquiry || "",
    };

    const secret = await getSecret("mynm_api_key");
    const res = await fetch("https://hdms.mynaghi.com:4443/api/intake", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": secret,
        },
        body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    console.log("MYNM Sales CRM response:", res.status, data);
}

async function sendToMYNMAftersalesCRM(reqBody) {
    const { prefix, firstName, lastName } = parseName(reqBody.fullName);

    const payload = {
        brand: "GENESIS",
        leadType: "Aftersales",
        firstName,
        lastName,
        mobilePhone: normalizeKSAPhone(reqBody.areaPhoneNumber),
        email: reqBody.email || "",
        title: prefix,
        // campaign + formName are mandatory on MYNM's side for Aftersales too (verified
        // against UAT 2026-07-16); the service form has neither, so send constants.
        campaign: "Website",
        formName: "Book a Service",
        // MYNM requires vin or plateNumber for Aftersales (undocumented, 400 without it).
        // The website service form collects neither — "N/A" placeholder agreed with MYNM
        // 2026-07-16; their service desk collects the real plate on appointment confirmation.
        plateNumber: "N/A",
        branch: reqBody.serviceCenter || "",
        vehicleModel: reqBody.vehicleName || "",
        hasConsent: true,
        notes: reqBody.enquiry || "",
        date: parseDate(reqBody.prefDate),
        time: parseTime(reqBody.prefTime),
    };

    const secret = await getSecret("mynm_api_key");
    const res = await fetch("https://hdms.mynaghi.com:4443/api/intake", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": secret,
        },
        body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    console.log("MYNM Aftersales CRM response:", res.status, data);
}

// ─── Wallan (Zoho) — shared OAuth ─────────────────────────────────────────────
// One refresh token serves both Zoho CRM (sales leads) and Zoho Desk (service /
// contact-us tickets). Scopes actually granted to it (verified live 2026-08-11):
//   ZohoCRM.modules.leads.READ/CREATE/UPDATE
//   Desk.tickets.READ/CREATE/UPDATE/WRITE  Desk.search.READ
// Note there is NO Desk.contacts.* and no Desk basic/settings scope — so we can't
// create contacts on their own, nor read /organizations or /departments (both come
// back 403 SCOPE_MISMATCH). Ticket creation works around this by inlining the contact.
// Secrets: wallan_zoho_client_id, wallan_zoho_client_secret, wallan_zoho_refresh_token

// Zoho rate-limits refresh grants (~10 per 10 min) and an access token is valid for an
// hour, so cache it rather than minting one per lead — a burst would otherwise throttle.
// Best-effort: Wix may recycle the backend instance, which merely costs a refetch.
let wallanToken = { value: null, expiresAt: 0 };

async function getWallanToken() {
    if (wallanToken.value && Date.now() < wallanToken.expiresAt) return wallanToken.value;

    const clientId = await getSecret("wallan_zoho_client_id");
    const clientSecret = await getSecret("wallan_zoho_client_secret");
    const refreshToken = await getSecret("wallan_zoho_refresh_token");

    const url = `https://accounts.zoho.com/oauth/v2/token?client_id=${clientId}&client_secret=${clientSecret}&refresh_token=${refreshToken}&grant_type=refresh_token`;
    const res = await fetch(url, { method: "POST" });
    const data = await res.json();
    if (!data.access_token) {
        throw new Error("Wallan Zoho token fetch failed: " + JSON.stringify(data));
    }
    // Renew 5 min early so an in-flight request never races the expiry.
    const ttl = (Number(data.expires_in) || 3600) * 1000;
    wallanToken = { value: data.access_token, expiresAt: Date.now() + ttl - 5 * 60 * 1000 };
    return wallanToken.value;
}

// ─── Wallan (Zoho CRM) — UAE ──────────────────────────────────────────────────

const WALLAN_SOURCE_MAP = {
    "Request a Quote":   { subType: "Request For Quote", source: "Corporate Website", subSource: "Corporate Website" },
    "Book a Test Drive": { subType: "Test Drive",        source: "Corporate Website", subSource: "Corporate Website" },
    "Contact Us":        { subType: "General enquiry",   source: "Corporate Website", subSource: "Corporate Website" },
    "Offline Event":     { subType: "General enquiry",   source: "Corporate Website", subSource: "Corporate Website" },
    "IG":                { subType: "General enquiry",   source: "Social Media",      subSource: "Instagram" },
    "Social":            { subType: "General enquiry",   source: "Social Media",      subSource: "Instagram" },
    "FB":                { subType: "General enquiry",   source: "Social Media",      subSource: "Facebook" },
    "LinkedIn":          { subType: "General enquiry",   source: "Social Media",      subSource: "LinkedIn" },
    "TikTok":            { subType: "General enquiry",   source: "Social Media",      subSource: "TikTok" },
    // Snapchat not in Wallan's Lead_Enquiry_Sub_Source picklist; Snapchat leads aren't
    // flowing from our side anyway — leaving as "None" (decided 2026-07-14)
    "Snapchat":          { subType: "General enquiry",   source: "Social Media",      subSource: "None" },
};

async function sendToWallanCRM(reqBody) {
    const mapped = WALLAN_SOURCE_MAP[reqBody.source] || {
        subType: "General enquiry",
        source: "Corporate Website",
        subSource: "Corporate Website",
    };

    const { prefix, firstName, lastName } = parseName(reqBody.fullName);
    const salutation = prefix.replace(".", ""); // Zoho picklist has no trailing dot
    const optIn = parseOptIns(reqBody.sns);

    const payload = {
        data: [{
            // "Standard" Leads layout of the Zoho org our refresh token is bound to (org prefix
            // 6174926). Wallan's V8 API doc says 6643351000000091055, but that id belongs to a
            // different org and Zoho rejects it with INVALID_DATA (verified 2026-07-14).
            Layout: { id: "6174926000000091055" },
            Salutation: salutation,
            First_Name: firstName,
            Last_Name: lastName,
            Phone: reqBody.areaPhoneNumber,
            Mobile: reqBody.areaPhoneNumber,
            Email: reqBody.email || "",
            Brand: "GENESIS",
            Make: "GENESIS",
            Model: reqBody.vehicleName || "",
            Enquiry_Type: "Sales Lead",
            Enquiry_Sub_Type: mapped.subType,
            Lead_Enquiry_Source: mapped.source,
            Lead_Enquiry_Sub_Source: mapped.subSource,
            Lead_Origin: "Website",
            Lead_Status: "Not Qualified",
            Preferred_Language: "English",
            // Wallan feed their auto-dialer off this flag and asked for it on every record
            // (email 2026-08-12) — most of their own inbound leads carry it true.
            Auto_Calling: true,
            // Consent per channel, from the form's "Pref Comms" selection (2026-08-12).
            // Note Zoho's own casing here: Phone_Optin, but Email_OptIn / SMS_OptIn.
            Email_OptIn: optIn.email,
            Phone_Optin: optIn.phone,
            SMS_OptIn: optIn.sms,
            // Branch_Name is a lookup to their Branch module and can only be set by record
            // id — we hold no scope to read that module, and Wallan haven't sent the id
            // list yet. Their other integrations write the plain-text Branch field, so do
            // the same until we have the ids (asked 2026-08-13).
            Branch: reqBody.showroom || "",
            Description: reqBody.enquiry || "",
            // Campaign is a picklist in Wallan's Zoho, but they confirmed by email
            // (2026-08-11) to send our free-text campaign name across as-is.
            Campaign: reqBody.campaign || "",
        }],
    };

    const token = await getWallanToken();
    const res = await fetch("https://www.zohoapis.com/crm/v5/Leads", {
        method: "POST",
        headers: {
            "Authorization": `Zoho-oauthtoken ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    console.log("Wallan Zoho CRM response:", res.status, JSON.stringify(data));
}

// ─── Wallan (Zoho Desk) — UAE service bookings + contact-us ───────────────────
// Wallan asked (email 2026-08-11) for "contact us" and "book a service appointment"
// enquiries to go to Zoho Desk as tickets rather than to CRM Leads. Sales enquiries
// (quote, test drive, social) stay on the CRM Leads path above.
//
// Two corrections to Wallan's "Genesis API Documentation Desk - V8" doc, both verified
// live 2026-08-11 — the doc was written against their SANDBOX portal
// (wallantradingco1774943580848), not production (wallantradingco):
//   1. The doc's orgId 919554510 returns 403 OAUTH_ORG_MISMATCH for our token. We can't
//      look up the right one (/organizations needs a scope we don't have), but omitting
//      the orgId header entirely makes Desk resolve the token's own org — which is the
//      correct production portal. So we deliberately send NO orgId header.
//   2. The doc's department/layout ids (1321189…) are sandbox ids. Production keeps the
//      same id suffix under a different org prefix (969016…) — confirmed by reading back
//      real Genesis tickets, whose layoutDetails.layoutName is "Genesis CS Department".
const WALLAN_DESK_URL = "https://desk.zoho.com/api/v1/tickets";
const WALLAN_DESK_DEPARTMENT = "969016000000712178"; // "Genesis Workspace"
const WALLAN_DESK_LAYOUT = "969016000000723611";     // "Genesis CS Department"

// Field values below mirror what Wallan's existing Genesis integration writes into this
// same department (read back from live tickets 2026-08-11), so their agents' views and
// reports treat our tickets identically.
const WALLAN_DESK_KIND = {
    service: { label: "Service Booking", enquiryType: "Service Enquiry", subType: "Service bookings", section: "Service" },
    contact: { label: "Contact Us",      enquiryType: "Contact Us",      subType: "General enquiry",  section: "CRM" },
};

// Wallan's Genesis tickets carry the unmapped detail as a "- Key: value" list in the
// description — same shape here so nothing the form collects is silently dropped.
function buildDeskDescription(reqBody) {
    const lines = [
        ["Country", reqBody.country],
        ["Showroom", reqBody.showroom || reqBody.serviceCenter],
        ["Vehicle", reqBody.vehicleName],
        ["Preferred date", reqBody.prefDate],
        ["Preferred time", reqBody.prefTime],
        ["Preferred contact email", reqBody.contactEmail],
        ["Current car", reqBody.currentCar],
        ["Purchase plan", reqBody.purchase],
        ["Campaign", reqBody.campaign],
        ["Enquiry", reqBody.enquiry],
    ];
    return lines
        .filter(([, value]) => value)
        .map(([key, value]) => `- ${key}: ${value}`)
        .join("\n");
}

async function sendToWallanDesk(reqBody, kindKey) {
    const kind = WALLAN_DESK_KIND[kindKey];
    // In practice this resolves to Corporate Website both ways — a Contact Us lead carries
    // that source, and service bookings carry no source field at all — but reuse the CRM
    // map so a future source routed here picks up the same labels.
    const mapped = WALLAN_SOURCE_MAP[reqBody.source] || {
        source: "Corporate Website",
        subSource: "Corporate Website",
    };

    const { firstName, lastName } = parseName(reqBody.fullName);
    const phone = reqBody.areaPhoneNumber || "";
    const optIn = parseOptIns(reqBody.sns);

    const cf = {
        cf_enquiry_type: kind.enquiryType,
        cf_enquiry_sub_type: kind.subType,
        cf_section: kind.section,
        cf_ticket_source: mapped.source,
        cf_ticket_sub_source: mapped.subSource,
        cf_source: mapped.source,
        cf_make: "Genesis",
        cf_model: reqBody.vehicleName,
        // cf_city is a picklist of Saudi cities only; Wallan's own integration puts the
        // free-text location in "City txt" (cf_city_1) instead, so do the same.
        cf_city_1: reqBody.country,
        cf_branch_name: reqBody.serviceCenter || reqBody.showroom,
        cf_preferred_language: "English",
        // Free text per Wallan's email (2026-08-11), same as the CRM Leads path.
        cf_campaign: reqBody.campaign,
        // Service appointment date is a Date field ("YYYY-MM-DD"). The matching time field
        // is a DateTime, which our "16:30 ~ 17:00" ranges (and Arabic ones like "المساء")
        // don't fit — Wallan's own tickets park that raw range in cf_contact_time.
        cf_service_appointment_date: parseDate(reqBody.prefDate),
        cf_contact_time: reqBody.prefTime,
        // Same three requests as the CRM path (email 2026-08-12). Desk's field names differ
        // from the CRM's — and note cf_phone_opt_in is spelled unlike its two neighbours.
        cf_auto_calling: true,
        cf_email_optin: optIn.email,
        cf_phone_opt_in: optIn.phone,
        cf_sms_optin: optIn.sms,
    };
    // Zoho rejects an empty string on typed custom fields, so drop the ones we have no
    // value for — but only the empty ones: a false boolean is a real answer ("customer did
    // not opt in to SMS") and must still be written.
    for (const key of Object.keys(cf)) {
        if (cf[key] === undefined || cf[key] === null || cf[key] === "") delete cf[key];
    }

    const payload = {
        // Wallan's own Genesis tickets use "<Kind>#<Source>#<phone>##" as the subject and
        // their agents scan on it, so match the format rather than writing prose.
        subject: `${kind.label}#${mapped.source}#${phone}##`,
        departmentId: WALLAN_DESK_DEPARTMENT,
        layoutId: WALLAN_DESK_LAYOUT,
        // We hold no Desk.contacts scope, but ticket creation may carry the contact inline:
        // Desk creates it, or silently reuses the existing contact when the email matches.
        // Only these four keys are accepted here — the inline object takes a narrower field
        // set than POST /contacts, and anything extra (e.g. "mobile") is a hard 422
        // UNPROCESSABLE_ENTITY rather than being ignored (verified live 2026-08-11).
        contact: {
            firstName,
            lastName,
            email: reqBody.email || "",
            phone,
        },
        email: reqBody.email || "",
        phone,
        status: "New",
        description: buildDeskDescription(reqBody),
        cf,
    };

    const token = await getWallanToken();
    const res = await fetch(WALLAN_DESK_URL, {
        method: "POST",
        headers: {
            "Authorization": `Zoho-oauthtoken ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    console.log(`Wallan Zoho Desk (${kind.label}) response:`, res.status, JSON.stringify(data));
}

// ─── CRM routers ──────────────────────────────────────────────────────────────

export function handleLeadCRM(reqBody) {
    const country = reqBody.country;
    switch (country) {
        case "Riyadh":
        case "Jeddah":
        case "Dammam":
            // MYNM disabled until go-live: endpoint is still UAT, prod URL pending from Waqar.
            // sendToMYNMCRM(reqBody).catch(err => console.error("MYNM Sales CRM error:", err));
            console.log("MYNM CRM not yet live — skipping:", country);
            break;
        case "UAE":
            // Wallan splits inbound by enquiry type: "Contact Us" is a support enquiry and
            // belongs in Zoho Desk, everything else (quote, test drive, social) is a sales
            // lead for Zoho CRM. Requested by email 2026-08-11.
            if (reqBody.source === "Contact Us") {
                sendToWallanDesk(reqBody, "contact").catch(err => console.error("Wallan Desk (Contact Us) error:", err));
            } else {
                sendToWallanCRM(reqBody).catch(err => console.error("Wallan CRM error:", err));
            }
            break;
        case "Egypt":
            // sendToEgyptCRM(reqBody);
            break;
        default:
            console.log("No CRM configured for country:", country);
            break;
    }
}

export function handleServiceCRM(reqBody) {
    const country = reqBody.country;
    switch (country) {
        case "Riyadh":
        case "Jeddah":
        case "Dammam":
            // MYNM disabled until go-live: endpoint is still UAT, prod URL pending from Waqar.
            // sendToMYNMAftersalesCRM(reqBody).catch(err => console.error("MYNM Aftersales CRM error:", err));
            console.log("MYNM Aftersales CRM not yet live — skipping:", country);
            break;
        case "UAE":
            sendToWallanDesk(reqBody, "service").catch(err => console.error("Wallan Desk (Service) error:", err));
            break;
        default:
            console.log("No service CRM configured for country:", country);
            break;
    }
}

// ─── Egypt CRM (stubbed — kept for reference) ─────────────────────────────────

// async function sendToEgyptCRM(reqBody) {
//     const fullNameNoPre = reqBody.fullName.replace("Mr.","").replace("Ms.", "").replace("Mrs.", "");
//     const firstName = fullNameNoPre.split(" ")[0];
//     const lastName = fullNameNoPre.split(" ")[1] || "";

//     const egFormat = {
//         "phone" : reqBody.areaPhoneNumber,
//         "first_name" : firstName,
//         "last_name" : lastName,
//         "car" : reqBody.vehicleName,
//         "brand" : "71",
//         "email" : reqBody.email,
//         "medium" : "Genesis Website | Book a Service",
//         "campaign": reqBody.campaign || "",
//         "targeting" : "[Note from Dev] not sure what data to put here",
//         "comment" : reqBody.enquiry || "",
//     }

//     const secret = await getSecret("egypt_token")
//     fetch("https://gb-pcbe.ghabbour.com/api/v1/create-lead-genesis/", {
//         method: "POST",
//         headers: {
//             "Content-Type": "application/json",
//             "Authorization": secret
//         },
//         body: JSON.stringify(egFormat),
//     })
// };
