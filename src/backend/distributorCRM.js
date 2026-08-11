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

// ─── Wallan (Zoho CRM) — UAE ──────────────────────────────────────────────────
// Uses OAuth2 refresh token flow — fresh access token fetched before every call.
// Secrets: wallan_zoho_client_id, wallan_zoho_client_secret, wallan_zoho_refresh_token

async function getWallanToken() {
    const clientId = await getSecret("wallan_zoho_client_id");
    const clientSecret = await getSecret("wallan_zoho_client_secret");
    const refreshToken = await getSecret("wallan_zoho_refresh_token");

    const url = `https://accounts.zoho.com/oauth/v2/token?client_id=${clientId}&client_secret=${clientSecret}&refresh_token=${refreshToken}&grant_type=refresh_token`;
    const res = await fetch(url, { method: "POST" });
    const data = await res.json();
    if (!data.access_token) {
        throw new Error("Wallan Zoho token fetch failed: " + JSON.stringify(data));
    }
    return data.access_token;
}

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
            Description: reqBody.enquiry || "",
            // TODO: Campaign is a Zoho picklist (Summer Campaign, Ramadan Campaign, …) but we
            // pass free text parsed from the social formName — Zoho may reject/drop it. Map or drop before go-live.
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

// ─── CRM routers ──────────────────────────────────────────────────────────────

export function handleLeadCRM(reqBody) {
    const country = reqBody.country;
    switch (country) {
        case "Riyadh":
        case "Jeddah":
        case "Dammam":
            sendToMYNMCRM(reqBody).catch(err => console.error("MYNM Sales CRM error:", err));
            break;
        case "UAE":
            sendToWallanCRM(reqBody).catch(err => console.error("Wallan CRM error:", err));
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
            sendToMYNMAftersalesCRM(reqBody).catch(err => console.error("MYNM Aftersales CRM error:", err));
            break;
        case "UAE":
            // Wallan Zoho Desk (Book a Service) — API docs still pending from Innocean
            console.log("Wallan Zoho Desk not yet implemented — awaiting API docs");
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
