// The merchant-underwriting response, as a Word document.
//
//   npx vite-node --config vitest.config.ts scripts/underwriting-response.ts
//
// Writes docs/underwriting/HumanCrush-Underwriting-Response.docx: one section
// per item on the acquiring bank's checklist, the policies reproduced word for
// word from src/lib/legal-docs.ts (which is what the site publishes), two
// flowcharts drawn here, and the advertising creative from marketing/.
//
// Regenerate it whenever a policy changes, so the copy on file with the bank is
// the copy on the site.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { LEGAL_DOCS } from "../src/lib/legal-docs";
import { SUPPORT_EMAIL } from "../src/lib/support-contact";
import { CREDIT_PACKS, SUBSCRIPTION_TIERS } from "../src/lib/credit-packs";

const OUT_DIR = "docs/underwriting";
const OUT = join(OUT_DIR, "HumanCrush-Underwriting-Response.docx");
const SITE_URL = "https://www.humancrush.com";
const TODAY = new Date().toLocaleDateString("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

// ── Building blocks ─────────────────────────────────────────────────────────

const FONT = "Calibri";

const h1 = (t: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
    children: [new TextRun({ text: t, font: FONT })],
  });
const h2 = (t: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text: t, font: FONT })],
  });
const h3 = (t: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: t, font: FONT })],
  });

function p(
  text: string,
  opts: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {},
) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({
        text,
        font: FONT,
        size: opts.size ?? 22,
        bold: opts.bold,
        italics: opts.italics,
        color: opts.color,
      }),
    ],
  });
}

// "Label: rest" with the label in bold.
function lp(label: string, text: string) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({ text: `${label} `, font: FONT, size: 22, bold: true }),
      new TextRun({ text, font: FONT, size: 22 }),
    ],
  });
}

const bullet = (text: string) =>
  new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, font: FONT, size: 22 })],
  });

const ul = (items: string[]) => items.map(bullet);

function note(text: string) {
  return new Paragraph({
    spacing: { after: 160 },
    shading: { type: ShadingType.CLEAR, fill: "FFF4E5" },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: "F59E0B", space: 4 } },
    children: [new TextRun({ text, font: FONT, size: 20, italics: true })],
  });
}

const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

function cell(text: string, opts: { bold?: boolean; fill?: string } = {}) {
  return new TableCell({
    shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [
      new Paragraph({ children: [new TextRun({ text, font: FONT, size: 20, bold: opts.bold })] }),
    ],
  });
}

function table(header: string[], rows: string[][]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: header.map((h) => cell(h, { bold: true, fill: "F1EAF6" })),
      }),
      ...rows.map((r) => new TableRow({ children: r.map((c) => cell(c)) })),
    ],
  });
}

async function image(
  buf: Buffer,
  type: "png" | "jpg",
  width: number,
  height: number | "auto",
  caption?: string,
) {
  if (height === "auto") {
    const meta = await sharp(buf).metadata();
    height = Math.round((width * (meta.height ?? 1)) / (meta.width ?? 1));
  }
  const out: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: caption ? 40 : 160 },
      children: [new ImageRun({ type, data: buf, transformation: { width, height } })],
    }),
  ];
  if (caption) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [
          new TextRun({ text: caption, font: FONT, size: 18, italics: true, color: "666666" }),
        ],
      }),
    );
  }
  return out;
}

// A vertical flowchart, drawn as SVG and rasterised. Each step is a box; a
// step may name a branch that goes to a side box.
async function flowchart(
  steps: { text: string; side?: string; sideLabel?: string }[],
  widthPx = 1400,
): Promise<Buffer> {
  const boxW = 720;
  const lineH = 30;
  const gap = 70;
  const sideW = 430;
  const left = 60;
  const sideX = left + boxW + 90;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const wrap = (s: string, max: number) => {
    const words = s.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > max) {
        lines.push(cur.trim());
        cur = w;
      } else cur = `${cur} ${w}`;
    }
    if (cur.trim()) lines.push(cur.trim());
    return lines;
  };
  const textBlock = (x: number, cy: number, w: number, lines: string[], size = 24, fill = "#111") =>
    lines
      .map(
        (l, i) =>
          `<text x="${x + w / 2}" y="${cy + i * lineH - ((lines.length - 1) * lineH) / 2}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" fill="${fill}" text-anchor="middle" dominant-baseline="middle">${esc(l)}</text>`,
      )
      .join("");

  // Each box is as tall as its text needs. A fixed height put four-line
  // labels through the bottom edge of the box.
  const laid = steps.map((s) => {
    const lines = wrap(s.text, 52);
    return { ...s, lines, h: Math.max(110, lines.length * lineH + 44) };
  });
  const hasSide = laid.some((s) => s.side);
  let y = 20;
  let svg = "";
  laid.forEach((s, i) => {
    svg += `<rect x="${left}" y="${y}" width="${boxW}" height="${s.h}" rx="16" fill="#F7F2FA" stroke="#7C3AED" stroke-width="3"/>`;
    svg += textBlock(left, y + s.h / 2, boxW, s.lines);
    if (i < laid.length - 1) {
      const ax = left + boxW / 2;
      svg += `<line x1="${ax}" y1="${y + s.h}" x2="${ax}" y2="${y + s.h + gap - 14}" stroke="#7C3AED" stroke-width="4"/>`;
      svg += `<polygon points="${ax - 12},${y + s.h + gap - 16} ${ax + 12},${y + s.h + gap - 16} ${ax},${y + s.h + gap}" fill="#7C3AED"/>`;
    }
    if (s.side) {
      const sl = wrap(s.side, 30);
      const sh = Math.max(s.h, sl.length * lineH + 44);
      const cy = y + s.h / 2;
      const sy = cy - sh / 2;
      svg += `<rect x="${sideX}" y="${sy}" width="${sideW}" height="${sh}" rx="16" fill="#FFF1F2" stroke="#E11D48" stroke-width="3"/>`;
      svg += textBlock(sideX, cy, sideW, sl, 22, "#7F1D1D");
      svg += `<line x1="${left + boxW}" y1="${cy}" x2="${sideX - 14}" y2="${cy}" stroke="#E11D48" stroke-width="4"/>`;
      svg += `<polygon points="${sideX - 16},${cy - 12} ${sideX - 16},${cy + 12} ${sideX},${cy}" fill="#E11D48"/>`;
      if (s.sideLabel)
        svg += `<text x="${left + boxW + 45}" y="${cy - 16}" font-family="Segoe UI, Arial, sans-serif" font-size="20" fill="#E11D48" text-anchor="middle">${esc(s.sideLabel)}</text>`;
    }
    y += s.h + gap;
  });
  const height = y - gap + 20;
  const totalW = hasSide ? sideX + sideW + 40 : left + boxW + 60;
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${height}" viewBox="0 0 ${totalW} ${height}"><rect width="100%" height="100%" fill="white"/>${svg}</svg>`;
  return sharp(Buffer.from(doc)).resize({ width: widthPx }).png().toBuffer();
}

// ── The document ────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const children: (Paragraph | Table)[] = [];
  const add = (...items: (Paragraph | Table | (Paragraph | Table)[])[]) => {
    for (const it of items) Array.isArray(it) ? children.push(...it) : children.push(it);
  };

  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const policyUrl = (slug: string) => `${SITE_URL}/legal/${slug}`;

  // Cover
  add(
    new Paragraph({
      spacing: { before: 2400, after: 200 },
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "HumanCrush.com", font: FONT, size: 64, bold: true, color: "7C3AED" }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: "Merchant Underwriting Response", font: FONT, size: 40 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 800 },
      children: [
        new TextRun({
          text: `Prepared for Payroc — ${TODAY}`,
          font: FONT,
          size: 24,
          color: "666666",
        }),
      ],
    }),
    p("Website: " + SITE_URL, { size: 22 }),
    p("Merchant contact: " + SUPPORT_EMAIL, { size: 22 }),
    p("Legal entity: ______________________________ (as on the application forms)", { size: 22 }),
    p(
      "This document answers each of the nineteen items in the bank's request, in the order asked. Where an item asks for a policy, the policy is reproduced in full in Appendix A and is published on the site at the address given. Where an item asks for something only the merchant can supply (credentials, financial statements), the section says what will be provided and how.",
      { size: 22 },
    ),
    pageBreak(),
  );

  // The one fact that answers half the list
  add(
    h1("What the service is"),
    p(
      "HumanCrush.com is an adults-only entertainment service in which users chat with fictional AI companions and request AI-generated pictures, voice notes and short video clips of them. Every companion is a computer-generated character. There are no performers, models, creators or content partners; no photograph, video or recording of any real person is used or hosted; users cannot upload images or files; and users cannot see, find or contact one another. The only interaction on the service is between one user and one fictional character.",
    ),
    p(
      "Several items on the bank's list — performer age verification, content-partner agreements, third-party content review, crawling for uploaded material — are written for sites that host content made by or about real people. They do not apply here, and each section below says so and describes the control that exists in its place. The controls that do apply — an automated content screen on every request, a complete log of every generation, staff review and removal tooling, published policies, a law-enforcement process and a payment flow in which card data never touches our servers — are all in place as of the date above.",
    ),
  );

  // 1
  add(
    h1("1. Account credentials for all websites"),
    p(
      "The merchant operates one website, www.humancrush.com (humancrush.com redirects to it). There are no other sites, mirrors or white-labels.",
    ),
    p(
      "A reviewer account with a full credit balance, plus a read-only view of the administration console, is provided to the bank in a separate secure message rather than in this document. The account is created from the console (Admin → Users → Create user) and can be revoked at any time.",
    ),
    note(
      "Merchant action: create the reviewer account and send the credentials separately, referencing this document.",
    ),
  );

  // 2
  add(
    h1("2. Copy of the merchant's policies and procedures"),
    p(
      "The following policies are published on the site, linked from every page's footer and menu, accepted at sign-up, and reproduced in full in Appendix A:",
    ),
    table(
      ["Policy", "Published at"],
      LEGAL_DOCS.map((d) => [d.title, policyUrl(d.slug)]),
    ),
    h3("Internal procedures"),
    ...ul([
      "Content screening: every chat message and generation request passes an automated screen before any AI model is called (section 8 has the flow).",
      "Media review: staff review generated pictures and clips, with the account and the prompt, in the administration console's Media review tool, and remove content with one action; each removal is written to an audit log with the reason.",
      "Support and complaints: every message to support opens a ticket, alerts the operator by email and push notification, and is answered from the console; urgent reports (minors, non-consent, trafficking) are handled within 24 hours.",
      "Law-enforcement requests: the process, verification steps and response times in the Law Enforcement Policy; every request is logged.",
      "Billing: refunds and cancellations per the Billing policy; failed generations are refunded automatically; every credit movement is a ledger row.",
      "Affiliates: applications are reviewed and approved individually; traffic is monitored; commission is reversed on refund or chargeback; violations of the marketing policy end the relationship.",
      "Access control: administrative access is limited to named accounts with an admin role; settings changes, credit adjustments, suspensions and content removals are written to an audit log.",
    ]),
  );

  // 3
  add(
    h1("3. Policies and controls against human trafficking"),
    p(
      "The service cannot be used to promote or facilitate human trafficking, and the reason is structural rather than a matter of moderation: there are no real people on it. The full statement is the Anti-Human-Trafficking Statement in Appendix A. The controls, in brief:",
    ),
    ...ul([
      "No performers, models or creators, and no way to become one. There is nobody to traffic.",
      "No user-to-user contact of any kind, and no profiles of real people.",
      "No uploads: all imagery is generated by our own pipeline from text.",
      "Requests for real-world contact, escort or prostitution services, paid sex or trafficking are refused automatically by the content screen and the companions are instructed never to suggest or arrange any.",
      "Advertising that implies real people, meetings, 'girls near you' or paid services is prohibited and ends an affiliate relationship.",
      "Generation requests are logged and reviewable; indications of exploitation or a person at risk are escalated and reported to law enforcement.",
    ]),
  );

  // 4
  add(
    h1("4. Most recent report of marketing traffic from other URLs"),
    p(
      "Traffic reaches the site from three sources: direct and search; the merchant's own social creative (the fully-clothed, non-explicit set in section 17); and the affiliate programme, in which every affiliate has a unique referral code carried in the link, recorded on landing and attributed on sign-up, with commissions reversed on refund or chargeback.",
    ),
    p(
      "Referrer-level reporting is provided by Vercel Web Analytics, which is installed on the site and reports page views and referring domains without cookies or cross-site profiles. The current export (top referrers and landing pages, last 30 days) is attached as Attachment 4; affiliate-level attribution is available from the administration console's Affiliates tab on request.",
    ),
    note(
      "Merchant action: enable Web Analytics for the project in the Vercel dashboard if not already on, export Top Referrers for the last 30 days, and attach as Attachment 4.",
    ),
  );

  // 5
  add(
    h1(
      "5. Company and third-party content provider documents; signed agreements and age verification in a depository",
    ),
    p(
      "Not applicable: the service has no third-party content providers and no performers. No content on the site was created by, features, or is licensed from any third party; every image and clip is generated by the merchant's own pipeline from a text description of a fictional character.",
    ),
    p(
      "The depository that does exist is the generation log. For every picture and clip the service has ever produced it holds the account that requested it, the time, the exact prompt sent to the model, the model and provider used, and the output file, and it is reviewable by staff in the administration console (section 15). The AI-Generated Content Statement in Appendix A sets out why performer age-verification records (18 U.S.C. § 2257) do not arise.",
    ),
  );

  // 6
  add(
    h1("6. Content Partners — New Content Account Decisioning"),
    p(
      "Not applicable in the sense intended, because there are no content partners. The equivalent decision — which characters appear on the public roster — is made only by staff, as follows:",
    ),
    ...ul([
      "Only staff can add a companion to the public roster, from the administration console. Users cannot publish characters to other users: a companion created by a user is visible to that user alone (enforced at the database level, not only in the interface).",
      "Every companion has a stated age, validated on creation to be between 18 and 60; the models are told the character is an adult in every prompt.",
      "The character description is passed through the same automated screen as user requests before any portrait is generated, so a character cannot be described with any minor, non-consent or prohibited attribute.",
      "Portraits are generated by the merchant's pipeline; no photograph is uploaded or used.",
      "A new companion is reviewed by staff before its status is set to active and it appears on the site; it can be set inactive at any time.",
    ]),
  );

  // 7
  add(
    h1("7. New User / Model Decisioning"),
    h3("New users"),
    ...ul([
      "An 18+ gate is shown before any page of the site is usable; the visitor must affirm they are an adult or is sent away.",
      "Sign-up requires an email address, a password, and a separate affirmation that the user is 18 or over (21 where required) and accepts the Terms and Privacy Policy, with both linked.",
      "The email address must be confirmed by link before the account is usable.",
      "New accounts receive 25 free credits; no card is taken at sign-up, so no charge can occur before a deliberate purchase.",
      "Rate limits apply per account (chat messages and media requests per window); accounts that trip the content screen repeatedly, attempt fraud or chargebacks, or are the subject of a report can be suspended from the console, which blocks every paid action.",
      "One account per person; sharing, selling or transferring accounts is prohibited by the Terms.",
    ]),
    h3("Models"),
    p(
      "There are no human models. Section 6 describes how fictional companions are approved. User-created companions follow the same rules — adult age validated, description screened, portrait generated — and remain private to their creator.",
    ),
  );

  // 8 — flowchart
  const contentFlow = await flowchart([
    {
      text: "Request arrives: a chat message, or a picture / voice / video request (staff character creation follows the same path)",
    },
    {
      text: "Automated content screen, before any model is called: minors (terms, spellings and any stated age under 18), non-consent, incest, animals, real people, solicitation / trafficking",
      side: "REFUSED: short in-character refusal shown; request logged with reason; repeated attempts → account suspended; apparent CSAM → reported (NCMEC)",
      sideLabel: "blocked",
    },
    {
      text: "Prompt assembled: companion asserted as an adult, likeness carried from the fictional portrait, negative conditioning excludes minors and non-consent, objects only if the user named them",
    },
    {
      text: "Rendered on the merchant's own private GPU endpoints (RunPod); text by an uncensored model via OpenRouter / xAI; voice by OpenAI TTS",
    },
    {
      text: "Stored with its job record: account, time, exact prompt, provider, output file. Credits charged only on success; a failed render is refunded automatically",
    },
    { text: "Delivered in the user's private chat. No public posting, no sharing between users" },
    {
      text: "Staff review in the admin Media review tool (account + prompt + output); one-action removal with audit log; complaints and law-enforcement requests handled per policy",
    },
  ]);
  add(
    h1("8. Compliance and content upload flowchart"),
    p(
      "There is no upload: content is generated, and every piece follows one path. The same path applies to company-created content (companions and their portraits, made by staff from the console) and to user-requested content (pictures, voice notes and clips requested in chat).",
    ),
    ...(await image(
      contentFlow,
      "png",
      600,
      Math.round((600 * 1450) / 1400),
      "Figure 1 — The path every piece of content takes",
    )),
  );

  // 9
  add(
    h1("9. Policy for banned words linking to the site"),
    p(
      "The Affiliate & Marketing Policy (Appendix A, published at " +
        policyUrl("affiliate-terms") +
        ") lists the words and phrases that may not appear in any advertisement, post, link text, landing page or domain leading to the site, grouped as: anything implying minors; non-consent, coercion or violence; family/incest; anything implying real people, real contact or paid sex; animals; and deceptive claims. The same terms in a request on the site are refused by the content screen.",
    ),
    p(
      "Enforcement: every affiliate is identified and every referral carries their code; traffic arriving with prohibited terms in the referrer or landing parameters, or from placements that break the policy, is not paid and the affiliate is removed; commissions are reversed on refund or chargeback; anyone can report an advertisement under the Complaints policy.",
    ),
  );

  // 10
  add(
    h1("10. Law Enforcement Policy and Process"),
    p(
      "Published at " +
        policyUrl("law-enforcement") +
        " and reproduced in Appendix A. In summary: a dedicated contact address monitored daily with the operator alerted by email and push notification; identity verification of the requesting agency; non-content data on valid subpoena, content on court order or warrant, emergency disclosures where the law allows; 10-business-day response, 24 hours for emergencies and child-safety matters; 90-day renewable preservation; a log of every request; and proactive reporting of apparent CSAM to NCMEC and of credible trafficking or threat-to-life indications to law enforcement.",
    ),
    p(
      "What can be produced: account records (email, display name, sign-up date, IP and device data), payment records and the full credit ledger, every conversation, every generation request with its exact prompt and output, every refused request with the reason, and support records.",
    ),
  );

  // 11
  add(
    h1("11. Prohibited Content Policy"),
    p(
      "Published at " +
        policyUrl("prohibited-content") +
        " and reproduced in Appendix A. Absolutely prohibited: minors or anyone presented as under 18 or child-like; non-consent; incest; bestiality; real people; real-world contact, solicitation or trafficking; sexualised violence; anything illegal where the user is. Enforced by the automated screen on every request, adult-only conditioning of every model prompt, complete logging, staff review and removal, suspension, and reporting where the law requires.",
    ),
  );

  // 12
  add(
    h1("12. Significant third-party, business and supplier relationships"),
    table(
      ["Provider", "Role", "What they receive"],
      [
        [
          "Vercel",
          "Web hosting, serverless functions, page analytics",
          "Application code and traffic; no card data",
        ],
        [
          "Supabase",
          "Database, authentication, file storage",
          "Account, conversation, ledger and generated-media data",
        ],
        [
          "RunPod",
          "Private GPU endpoints that render pictures and clips",
          "The generation prompt and the fictional companion's portrait; no user identity",
        ],
        [
          "OpenRouter / xAI",
          "Text models for chat replies and prompt writing",
          "Conversation text; no user identity",
        ],
        ["OpenAI", "Text-to-speech for voice notes", "The line to be spoken; no user identity"],
        [
          "Authorize.Net (via Payroc)",
          "Card processing, recurring billing (ARB), webhooks",
          "Payment data, tokenised in the customer's browser; the merchant never holds a full card number",
        ],
        [
          "Resend",
          "Transactional email (support, notifications)",
          "Email address and message content",
        ],
        ["Google Fonts", "Web fonts", "Nothing personal"],
        [
          "Affiliates",
          "Individuals promoting the site under the Affiliate & Marketing Policy for a revenue share",
          "A referral code; no customer data",
        ],
      ],
    ),
    p(
      "There are no content partners, no performers or creators, no resellers, no white-label or licensing arrangements, and no other significant business relationships.",
      { size: 22 },
    ),
  );

  // 13
  add(
    h1("13. Age verification tools"),
    h3("Users"),
    ...ul([
      "Site-wide 18+ gate before any page is usable, remembered per browser.",
      "Affirmative 18+ (21 where required) declaration at sign-up, linked to the Terms, and email confirmation before the account works.",
      "No content is unlocked without a purchase by payment card, which in the served markets is itself an adult instrument.",
      "The merchant will integrate a third-party age-verification provider (ID document or database check) if required by the acquirer or by the law of a jurisdiction served.",
    ]),
    h3("Performers"),
    p(
      "Not applicable: no human being is depicted. Every companion is an AI-generated fictional adult; its age is validated on creation to be 18 or over, the prompts describe an adult, and content involving anyone under 18 is refused before generation. See the AI-Generated Content Statement in Appendix A.",
    ),
  );

  // 14
  add(
    h1("14. Website crawling tools"),
    p(
      "Crawling tools exist to find prohibited third-party content on sites that accept it. This site accepts none: users cannot upload, post or publish, and the only public content is the staff-curated companion roster and the merchant's own pages. Accordingly:",
    ),
    ...ul([
      "Public pages are fixed and staff-controlled; a change to the site is a code deployment, reviewed and versioned.",
      "Generated content is never public: each picture or clip is delivered only into the private chat of the account that requested it.",
      "In place of crawling, the generation log is reviewed in the Media review tool (section 15), and inbound marketing traffic is reviewed for prohibited terms under the Affiliate & Marketing Policy.",
      "The merchant reviews the public pages at each release and on any report.",
    ]),
  );

  // 15
  add(
    h1("15. Image and video verification tools"),
    p(
      "Every image and clip is made by the merchant's pipeline, so verification happens at the source and afterwards:",
    ),
    ...ul([
      "Before generation: the automated screen refuses every prohibited category, including every way of writing an age under 18; the companion is asserted as an adult in every prompt; the model's negative conditioning excludes minors and non-consent; objects and other people appear only when the request names them.",
      "At generation: the job record stores the account, time, exact prompt, provider and output, so provenance of any file is established.",
      "After generation: the administration console's Media review tool lists every generated picture and clip newest first, with the account and prompt, and removes any item — file, chat message and all — in one action with an audit-log entry and reason.",
      "Reporting: anyone can report content; urgent categories are reviewed within 24 hours; apparent CSAM is reported to NCMEC and the records preserved.",
    ]),
  );

  // 16
  add(
    h1("16. PCI compliance"),
    ...ul([
      "Card data is captured by Authorize.Net's Accept.js in the customer's browser and exchanged for a one-time payment token there. The merchant's servers receive only the token, the last four digits and the transaction outcome; no full card number, expiry or security code is ever transmitted to, processed by or stored on the merchant's systems.",
      "Recurring subscriptions are created as Authorize.Net ARB subscriptions from that token; renewal charges, refunds and chargebacks are reconciled by signed webhook, verified against the Authorize.Net signature key.",
      "The applicable self-assessment questionnaire is SAQ A-EP (merchant page collects the data via processor-provided JavaScript; no card data touches the merchant's environment). The questionnaire and attestation are completed and attached as Attachment 16.",
      "All pages and APIs are served over TLS; hosting and database providers hold SOC 2 attestations; administrative access is restricted to named accounts with an admin role and is logged.",
    ]),
    note(
      "Merchant action: complete SAQ A-EP and the Attestation of Compliance through the acquirer's PCI portal and attach as Attachment 16.",
    ),
  );

  // 17 — advertisements
  add(
    h1("17. Advertisements, marketing materials and sales practices"),
    h3("Sales practices"),
    ...ul([
      "Sign-up is free and takes no card; 25 free credits let a customer try the service before buying anything.",
      "Prices are shown in full before payment; there are no hidden fees, no free trials that convert, and no negative-option billing other than a clearly labelled monthly subscription whose price, credits and renewal date are shown before purchase and on the account page.",
      "Subscriptions cancel in one click from the account page; the customer keeps the credits already granted.",
      "Refunds per the Billing policy: unused packs within 14 days, unspent renewals within 7 days, failed generations automatically, duplicate charges always.",
      "Charges carry a neutral statement descriptor.",
      "All advertising follows the Affiliate & Marketing Policy: truthful description of a fictional AI service, 18+ marker, adult-appropriate placements only, and none of the banned words in section 9.",
    ]),
    h3("Prices"),
    table(
      ["Item", "Price", "Credits"],
      [
        ...CREDIT_PACKS.map((x) => [
          `${x.name} pack (one-time)`,
          money(x.priceCents),
          String(x.credits),
        ]),
        ...SUBSCRIPTION_TIERS.map((t) => [
          `${t.name} subscription (monthly)`,
          money(t.priceCents),
          `${t.monthlyCredits} / month`,
        ]),
      ],
    ),
    p(
      "A text message costs 1 credit, a voice note 3, a picture 8 and a video clip 15. Prices are managed from the administration console and the charge is always what the page displayed.",
      { size: 22 },
    ),
    h3("Creative — mainstream networks (Facebook, Instagram, TikTok)"),
    p(
      "Deliberately tame by design: fully clothed, no lingerie, no suggestive posing, no explicit copy.",
      { size: 22 },
    ),
  );
  for (const [file, cap] of [
    ["marketing/build-her-feed-1200x630.jpg", '"Make your own AI companion" — 1200×630 feed'],
    ["marketing/texts-first-feed-1200x630.jpg", '"She texts you first." — 1200×630 feed'],
    ["marketing/your-rules-feed-1200x630.jpg", '"Your companion. Your rules." — 1200×630 feed'],
  ] as const) {
    if (existsSync(file)) add(...(await image(readFileSync(file), "jpg", 520, 273, cap)));
  }
  add(
    h3("Creative — adult ad networks"),
    p("Suggestive but non-explicit; 18+ placements only.", { size: 22 }),
  );
  for (const [file, cap, w, h] of [
    [
      "marketing/adult/sends-anything-300x250.jpg",
      '"She\'ll send you anything" — 300×250',
      300,
      250,
    ],
    ["marketing/adult/texts-back-300x250.jpg", '"She always texts back" — 300×250', 300, 250],
  ] as const) {
    if (existsSync(file)) add(...(await image(readFileSync(file), "jpg", w, h, cap)));
  }
  add(
    p(
      "The complete creative set (all sizes, and the 8-second social reels) is attached as Attachment 17.",
      { size: 22 },
    ),
  );

  // 18
  add(
    h1("18. Financial statements and/or tax returns"),
    p(
      "CPA-prepared financial statements (income statement and balance sheet) for the most recent years available, and/or tax returns with supporting schedules, are provided by the merchant's accountant directly to the bank as Attachment 18. They are not included in this document.",
    ),
    note(
      "Merchant action: send the financial statements / tax returns with supporting schedules to the bank, referencing this document.",
    ),
  );

  // 19 — executive summary
  const txFlow = await flowchart([
    {
      text: "Customer chooses a credit pack (one-time) or a subscription (monthly) on the pricing page; price and credits shown in full",
    },
    {
      text: "Card entered in Authorize.Net's Accept.js form in the browser and exchanged for a one-time token; no card data reaches the merchant",
    },
    {
      text: "Merchant server sends the token to Authorize.Net: a single charge for a pack, or an ARB subscription for a monthly plan",
    },
    {
      text: "On approval, credits are granted immediately and a ledger row records the transaction, amount and balance; the customer can use the service at once",
    },
    {
      text: "Renewals, refunds and chargebacks arrive by signed webhook and are reconciled to the ledger; affiliate commission is reversed on refund or chargeback",
    },
    {
      text: "Credits are spent per feature; a failed generation is refunded to the balance automatically; cancellation is one click and stops the next renewal",
    },
  ]);
  add(
    h1("19. Executive summary"),
    h3("Transaction flow"),
    ...(await image(txFlow, "png", 420, "auto", "Figure 2 — The money")),
    h3("Risk assessment and exposure"),
    ...ul([
      "Product risk: adult content, digital, delivered instantly. There is no physical shipment, no delayed fulfilment and no third-party content, so the classic causes of 'goods not received' and content-legality disputes do not arise. The content that is generated is fictional, adult-only by construction, screened before generation, logged and reviewable.",
      "Chargeback risk: the main exposure is a customer disputing a charge for a service they used, or a forgotten subscription renewal. Mitigants: free credits before any purchase, prices shown in full, a neutral descriptor, one-click cancellation with credits retained, generous and fast refunds (most disputes are resolved by refund the same day), renewal dates on the account page, and closure of accounts that dispute used services.",
      "Fraud risk: card testing and stolen cards. Mitigants: no card at sign-up, email confirmation, per-account rate limits on every paid action, Authorize.Net's fraud tools on every transaction, immediate suspension from the console, a full ledger for every credit movement, and affiliate commission that is reversed rather than paid on any refunded or disputed sale.",
      "Regulatory and reputational risk: the risks specific to adult sites — minors, non-consent, real people, trafficking — are addressed structurally (no real people, no uploads, no user contact) and operationally (automated screen, logging, review tooling, published policies, law-enforcement process, proactive reporting).",
      "Average ticket: " +
        money(CREDIT_PACKS[0].priceCents) +
        " to " +
        money(SUBSCRIPTION_TIERS[SUBSCRIPTION_TIERS.length - 1].priceCents) +
        "; a low-ticket, high-frequency profile.",
    ]),
    h3("Financial and credit analysis"),
    p(
      "Projected monthly volume, average ticket, refund and chargeback ratios, and the financial statements in Attachment 18 are provided by the merchant. The service's cost base is variable (GPU and model usage per generation, paid only on success) with modest fixed hosting costs, so gross margin scales with volume and there is no inventory or fulfilment exposure.",
    ),
    note(
      "Merchant action: fill in projected monthly volume, average ticket and expected refund/chargeback ratios here or on the application form.",
    ),
    h3("Approval justification"),
    ...ul([
      "A fully digital, instantly fulfilled service with no third-party content and no real persons, which removes the categories of dispute and legal exposure that make adult merchants high-risk.",
      "Published, enforced policies covering every item the bank has asked about, with a law-enforcement process and proactive reporting.",
      "Automated screening on every request, complete logging, and staff review and removal tooling in place and demonstrable on the reviewer account.",
      "A payment flow in which the merchant never holds card data, with recurring billing, refunds and chargebacks reconciled by signed webhook to a full ledger.",
      "Clear pricing, free trial credits without a card, one-click cancellation and a fast refund policy — the practices that keep chargeback ratios low.",
    ]),
    h3("Loss-prevention strategy and mitigants"),
    ...ul([
      "Refund first: support answers billing complaints with a refund where the policy allows, before a dispute can be raised.",
      "Descriptor, receipts and renewal reminders: the charge is recognisable, and the account page shows the next renewal date.",
      "Velocity and suspension: rate limits per account; suspension blocks all paid actions instantly; suspended and disputing accounts cannot repurchase.",
      "Ledger and audit log: every credit movement, refund, suspension, settings change and content removal is recorded with who did it.",
      "Affiliate exposure: commission is paid on settled revenue only and reversed on any refund or chargeback, so affiliates carry the risk of the traffic they send.",
      "Monitoring: refund and chargeback ratios are reviewed monthly; any rise triggers a review of the traffic source and the affiliate involved.",
    ]),
    pageBreak(),
  );

  // Appendix A — the policies, verbatim
  add(
    h1("Appendix A — Published policies"),
    p(
      "Reproduced from the site as of " +
        TODAY +
        ". Each is published at the address shown and linked from every page.",
      { italics: true, size: 20 },
    ),
  );
  for (const d of LEGAL_DOCS) {
    add(
      h2(d.title),
      p(`${policyUrl(d.slug)} · Last updated ${d.updated}`, { size: 18, color: "666666" }),
      p(d.summary, { italics: true }),
    );
    for (const b of d.blocks) {
      if (b.h) add(h3(b.h));
      if (b.p) add(...b.p.map((t) => p(t)));
      if (b.ul) add(...ul(b.ul));
    }
  }

  // Attachments checklist
  add(
    pageBreak(),
    h1("Attachments supplied separately"),
    table(
      ["#", "Attachment", "Supplied by"],
      [
        ["1", "Reviewer account credentials (separate secure message)", "Merchant"],
        ["4", "Vercel Web Analytics export — top referrers, last 30 days", "Merchant"],
        ["16", "PCI SAQ A-EP and Attestation of Compliance", "Merchant"],
        ["17", "Complete creative set (marketing/ folder, all sizes and reels)", "Merchant"],
        [
          "18",
          "CPA-prepared financial statements and/or tax returns with schedules",
          "Merchant's accountant",
        ],
      ],
    ),
  );

  const doc = new Document({
    creator: "HumanCrush",
    title: "HumanCrush.com — Merchant Underwriting Response",
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 32, bold: true, color: "3B0764", font: FONT },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 27, bold: true, color: "5B21B6", font: FONT },
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 23, bold: true, color: "222222", font: FONT },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: "bullet",
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
        children,
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  writeFileSync(OUT, buf);
  console.log(`Wrote ${OUT} (${Math.round(buf.byteLength / 1024)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
