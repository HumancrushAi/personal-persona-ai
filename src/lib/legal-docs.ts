// The site's published policies, as data.
//
// One source for two readers: the /legal pages render these, and the
// underwriting response (scripts/underwriting-response.ts) reproduces them as
// appendices — so what the bank is sent is, word for word, what the site says.
// A policy that exists only in a PDF drifts from the one on the site within a
// month; this cannot.
//
// Plain prose, no markup. `ul` is a bullet list, `p` paragraphs, `h` a heading
// inside the document. Keep sentences short: these are read by customers, by
// underwriters and, when it matters most, by police.

import { SUPPORT_EMAIL } from "./support-contact";

export type LegalBlock = { h?: string; p?: string[]; ul?: string[] };
export type LegalDoc = {
  slug: string;
  title: string;
  summary: string;
  updated: string;
  blocks: LegalBlock[];
};

const SITE = "HumanCrush.com";
const UPDATED = "18 September 2026";

// Words and phrases no advertisement, affiliate link, social post or landing
// page for the site may contain. Enforced on affiliates by the Affiliate &
// Marketing Policy; the same terms in a chat request are refused by the
// content screen (src/lib/safety.ts).
export const BANNED_MARKETING_TERMS: { group: string; terms: string[] }[] = [
  {
    group: "Anything implying minors",
    terms: [
      "teen",
      "teens",
      "teenage",
      "young girl",
      "young boy",
      "schoolgirl",
      "school girl",
      "student",
      "barely legal",
      "jailbait",
      "loli",
      "lolita",
      "shota",
      "underage",
      "child",
      "kid",
      "little girl",
      "little boy",
      "daughter",
      "stepdaughter",
      "stepsister",
      "petite" /* when paired with youth cues */,
      "innocent" /* when paired with youth cues */,
    ],
  },
  {
    group: "Non-consent, coercion or violence",
    terms: [
      "rape",
      "forced",
      "drugged",
      "unconscious",
      "sleeping",
      "blackmail",
      "kidnap",
      "abuse",
      "hurt",
      "torture",
      "snuff",
      "revenge",
    ],
  },
  {
    group: "Family / incest",
    terms: ["incest", "mom", "mother", "dad", "father", "sister", "brother", "family"],
  },
  {
    group: "Implying real people, real contact or paid sex",
    terms: [
      "real girls",
      "real women",
      "real models",
      "cam girls",
      "live girls",
      "meet",
      "hookup",
      "hook up",
      "dating",
      "date tonight",
      "escort",
      "escorts",
      "call girl",
      "sex work",
      "in your area",
      "near you",
      "local",
      "phone number",
      "whatsapp",
    ],
  },
  {
    group: "Animals",
    terms: ["bestiality", "zoo", "animal", "dog", "horse"],
  },
  {
    group: "Deceptive claims",
    terms: [
      "free forever",
      "unlimited free",
      "no charge",
      "guaranteed",
      "risk free",
      "cure",
      "celebrity names",
      "names of real people",
    ],
  },
];

export const LEGAL_DOCS: LegalDoc[] = [
  {
    slug: "terms",
    title: "Terms of Service",
    summary: "The agreement between you and HumanCrush.com when you use the service.",
    updated: UPDATED,
    blocks: [
      {
        p: [
          `These Terms of Service ("Terms") govern your use of ${SITE} (the "Service"), operated by Next Level Rec. ("HumanCrush", "we", "us"). By creating an account or using the Service you agree to these Terms, our Privacy Policy and our Prohibited Content Policy. If you do not agree, do not use the Service.`,
        ],
      },
      {
        h: "1. Adults only",
        p: [
          "The Service is for adults. You must be at least 18 years old, or the age of majority where you live if that is higher (21 in some jurisdictions), to use it. You confirm this when you enter the site and again when you create an account. We may ask for proof of age at any time and may suspend an account until it is provided.",
        ],
      },
      {
        h: "2. What the Service is",
        p: [
          "The Service lets you chat with fictional AI companions and request AI-generated pictures, voice notes and short video clips of them. Every companion is a computer-generated character. No companion is, depicts or is based on a real person. Nothing on the Service is a real photograph or recording of a human being.",
          "The Service is entertainment. It does not offer, arrange or facilitate contact with any real person, any meeting, any dating, escort or sexual service, or anything outside the Service.",
        ],
      },
      {
        h: "3. Your account",
        ul: [
          "One account per person. You are responsible for everything done with it and for keeping your password private.",
          "Your email address must be real and confirmed; we use it to reach you about your account, your purchases and support.",
          "You may not share, sell or transfer an account, or use the Service on behalf of anyone under 18.",
        ],
      },
      {
        h: "4. Credits, subscriptions and payment",
        p: [
          "Features are paid for with credits. Credits can be bought in one-time packs or granted monthly by a subscription. Prices are shown before you pay. Subscriptions renew monthly until cancelled; you can cancel any time from your account page and keep the credits already granted. Our Billing, Refunds & Cancellation policy sets out refunds.",
          "Payments are processed by our payment processor. We never see or store your full card number.",
        ],
      },
      {
        h: "5. Acceptable use",
        p: [
          "Our Prohibited Content Policy is part of these Terms. In short: no content involving minors or anyone who looks like a minor, no non-consent, no incest, no animals, no real people, no requests for real-world contact or paid sex, and nothing illegal where you are. Requests that break these rules are refused automatically, logged, and may result in suspension without refund.",
        ],
        ul: [
          "Do not attempt to bypass the content screen, the age gate or any technical limit.",
          "Do not scrape, reverse-engineer, resell or redistribute the Service or its output.",
          "Do not use generated content to harass, defame, impersonate or deceive anyone, or present it as a real person.",
          "Do not use the Service to advertise, solicit or arrange anything with any other person.",
        ],
      },
      {
        h: "6. Generated content",
        p: [
          "Pictures, clips and text the Service generates for you are yours to keep for personal, non-commercial use. They are fictional and AI-generated and must be described as such if you share them. We keep a record of every generation request and its result for safety, fraud prevention and legal compliance, and we remove content that breaks our policies.",
        ],
      },
      {
        h: "7. Suspension and termination",
        p: [
          "We may suspend or close an account that breaks these Terms, attempts fraud or chargebacks, or is used in a way that puts other users, the Service or the public at risk. We may also close accounts on request of law enforcement. Credits on a terminated account are forfeited where the termination is for a breach.",
        ],
      },
      {
        h: "8. Disclaimers and liability",
        p: [
          "The Service is provided as is. AI output can be wrong, odd or unexpected. To the fullest extent the law allows, we are not liable for indirect or consequential loss arising from use of the Service, and our total liability for any claim is limited to the amount you paid us in the three months before the claim.",
        ],
      },
      {
        h: "9. Changes and contact",
        p: [
          `We may update these Terms; the date at the top shows the current version and material changes are announced on the site. Questions go to ${SUPPORT_EMAIL}.`,
        ],
      },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    summary: "What we collect, why, who sees it and how long we keep it.",
    updated: UPDATED,
    blocks: [
      {
        h: "What we collect",
        ul: [
          "Account data: email address, a display name you choose, your age confirmation and the date you joined.",
          "Usage data: your conversations with companions, the companions you create, the pictures and clips generated for you, and your credit balance and purchase history.",
          "Technical data: IP address, browser and device type, and the pages you visit, used for security, fraud prevention and to see which marketing brings people to the site.",
          "Payment data: handled by our payment processor. Card details are entered into the processor's own secure form and tokenised in your browser; we receive a token, the last four digits and the outcome, never the full card number.",
          "Support data: what you send us when you contact support, and our replies.",
        ],
      },
      {
        h: "Why we use it",
        ul: [
          "To run the Service: your conversations are sent to the AI models that generate replies and media, and stored so your companions remember you.",
          "To bill you and to prevent fraud and chargebacks.",
          "To keep the Service lawful: generation requests are screened and logged, and we retain records needed to respond to lawful requests.",
          "To contact you about your account, purchases, support tickets and, if you opt in, notifications from your companions.",
        ],
      },
      {
        h: "Who sees it",
        p: [
          "Our staff, on a need-to-know basis. Our infrastructure and service providers, each bound by contract to process data only for us: hosting (Vercel), database and file storage (Supabase), AI model providers that generate text, voice and images (they receive the text of the request and, for images, the companion's fictional portrait; never your name or email), our payment processor (Authorize.Net) and our email provider. We do not sell personal data. We disclose data to authorities only as described in our Law Enforcement Policy.",
        ],
      },
      {
        h: "How long we keep it",
        p: [
          "Account and conversation data for as long as your account exists, and up to 90 days after you close it. Generation logs, purchase and ledger records for at least 24 months, because payment rules and the law require it. You can delete your account and its conversations from the account page or by emailing support.",
        ],
      },
      {
        h: "Your rights",
        p: [
          `You can ask for a copy of your data, correct it, or have it deleted, subject to records we are required to keep. Email ${SUPPORT_EMAIL}. You can turn notifications off at any time in your browser or on the account page.`,
        ],
      },
      {
        h: "Cookies and storage",
        p: [
          "We use your browser's local storage for your session, your age confirmation, your language choice and, if you arrived through an affiliate link, the referral code, so the affiliate is credited if you sign up. We use privacy-respecting page analytics that do not build cross-site profiles.",
        ],
      },
    ],
  },
  {
    slug: "prohibited-content",
    title: "Prohibited Content Policy",
    summary:
      "What can never be requested, generated or shown on the Service, and how that is enforced.",
    updated: UPDATED,
    blocks: [
      {
        p: [
          "Every companion is an adult, fictional, computer-generated character. Within that, adult content between consenting adults is what the Service is for. The following is prohibited without exception, is refused by the content screen before any generation runs, and results in suspension:",
        ],
      },
      {
        h: "Absolutely prohibited",
        ul: [
          "Minors: any content that depicts, describes, suggests or role-plays a person under 18, or a character presented as under 18 or as child-like (age play, school settings, 'teen', 'loli', diapers, and any stated age under 18). Companions cannot be created with an age below 18.",
          "Non-consent: rape, coercion, drugging, unconscious or incapacitated persons, and any scenario presented as unwilling.",
          "Incest and family scenarios.",
          "Bestiality and any sexual content involving animals.",
          "Real people: content depicting, named after or intended to resemble any real person — public figures included. Users cannot upload photographs; every companion image is generated from a text description.",
          "Real-world contact, solicitation or trafficking: requests to meet, to pay or be paid for sex, escort or prostitution services, or anything that promotes or facilitates human trafficking or sexual exploitation.",
          "Violence, gore, torture, self-harm and death presented as sexual.",
          "Content that is illegal where the user is, or that infringes anyone's rights.",
        ],
      },
      {
        h: "How it is enforced",
        ul: [
          "Every chat message and every picture or video request is screened by an automated filter before it reaches an AI model. The filter blocks a list of prohibited terms and phrasings (including every way of writing an age under 18) and the categories above. A blocked request is refused with a short message and is not generated.",
          "Every generation request and its output are logged with the account, the time and the exact prompt used, and are reviewable by staff in the admin console's Media review tool, where content can be removed with one action.",
          "Companions are described to the image and text models as adults in every prompt, and the models' negative conditioning excludes minors and non-consent.",
          "Repeated blocked requests, or any single attempt at content involving minors, results in suspension. We report apparent child sexual abuse material to the relevant authorities (in the United States, NCMEC's CyberTipline) as required by law.",
          "Anyone can report content to us — see Complaints & Reporting.",
        ],
      },
      {
        h: "Banned words",
        p: [
          "The list of terms that the content screen refuses in requests, and that may not appear in any advertising or link to the site, is published in the Affiliate & Marketing Policy. It is maintained by staff and updated as new evasions appear.",
        ],
      },
    ],
  },
  {
    slug: "anti-trafficking",
    title: "Anti-Human-Trafficking Statement",
    summary:
      "The controls that ensure the Service cannot be used to promote or facilitate trafficking.",
    updated: UPDATED,
    blocks: [
      {
        p: [
          `${SITE} has zero tolerance for human trafficking, sexual exploitation and the commercial sexual exploitation of anyone. The design of the Service makes it unusable for those purposes, and the following controls keep it so:`,
        ],
      },
      {
        ul: [
          "No real people. Every companion is an AI-generated fictional character. There are no performers, models, creators or content partners, and no way for anyone to appear on the Service. There is nothing and no one to traffic.",
          "No user-to-user contact. Users cannot message, see, find or contact each other. The only conversations are between a user and a fictional AI character.",
          "No uploads. Users cannot upload photographs, videos or files. All imagery is generated by our own pipeline from text, so no third party's image can be published here.",
          "No contact information, no meetings. The content screen refuses requests for meetings, escort or prostitution services, paid sex, phone numbers and real-world contact, and the companions are instructed never to arrange or suggest any. Advertising that implies real people, meetings, 'girls near you' or paid services is prohibited under the Affiliate & Marketing Policy and ends the affiliate relationship.",
          "Monitoring and reporting. Generation requests are logged and reviewable. Any indication of trafficking, exploitation or a person at risk is escalated to the operator and reported to law enforcement under our Law Enforcement Policy.",
          "Staff. Everyone with access to the admin console is identified, access is logged, and this policy is part of onboarding.",
        ],
      },
      {
        p: [
          `Reports: ${SUPPORT_EMAIL}, or the support form on the site. Reports of a person at risk are treated as urgent.`,
        ],
      },
    ],
  },
  {
    slug: "law-enforcement",
    title: "Law Enforcement & Legal Requests Policy",
    summary: "How police, courts and regulators can reach us, what we can provide, and how fast.",
    updated: UPDATED,
    blocks: [
      {
        h: "Contact",
        p: [
          `Requests from law enforcement, courts and regulators go to ${SUPPORT_EMAIL} with the subject line "LAW ENFORCEMENT REQUEST". The mailbox is monitored daily; the operator is notified immediately by email and by push notification for every message with that subject. Emergency requests (an imminent risk to life or of serious harm) should say EMERGENCY in the subject and will be acted on as soon as they are read, ahead of formal process where the law allows.`,
        ],
      },
      {
        h: "What we hold",
        ul: [
          "Account records: email address, display name, sign-up date, IP addresses and device information from sign-in and payment events.",
          "Payment records: transaction identifiers, amounts, dates, last four card digits, subscription identifiers and the ledger of every credit granted, spent or refunded.",
          "Content records: every conversation, every generation request (the exact prompt), every generated image or clip and when it was made, and every request the content screen refused, with the reason.",
          "Support records: tickets and our replies.",
          "Retention: content and account records for the life of the account plus 90 days; payment and ledger records for at least 24 months; blocked-request logs for at least 12 months. We preserve records beyond these periods on receipt of a preservation request.",
        ],
      },
      {
        h: "Process",
        ul: [
          "We verify that a request comes from a genuine agency, using an official email domain and a call-back number, before disclosing anything.",
          "Non-content account information is provided in response to a valid subpoena or equivalent lawful request. Content of conversations and generated media is provided in response to a court order or warrant, or where an emergency exception applies.",
          "We respond within 10 business days, and within 24 hours where the request is marked emergency or concerns minors.",
          "Preservation requests are honoured for 90 days and renewable.",
          "We notify the account holder of a request unless the law prohibits it or the request concerns child safety, an emergency or an ongoing investigation and the agency asks us not to.",
          "We keep a log of every request received, the agency, what was provided and when.",
        ],
      },
      {
        h: "Proactive reporting",
        p: [
          "We report apparent child sexual abuse material to NCMEC's CyberTipline (in the United States) or the equivalent national body, and preserve the related records, whether or not a request has been received. We report credible indications of human trafficking or an imminent threat to life to the relevant law enforcement agency.",
        ],
      },
    ],
  },
  {
    slug: "complaints",
    title: "Complaints, Reporting & Content Removal",
    summary: "How to report content or an account, and what happens when you do.",
    updated: UPDATED,
    blocks: [
      {
        h: "How to report",
        p: [
          `Anyone — a user or not — can report content, a companion, an account, an advertisement or an affiliate by emailing ${SUPPORT_EMAIL} or using the support form on the site. Include the link or a description and, if you have it, the time. Reports about minors, non-consent, trafficking or a person at risk should say URGENT in the subject.`,
        ],
      },
      {
        h: "What happens",
        ul: [
          "Every report opens a ticket, visible to staff in the admin console and emailed to the operator, with a push notification for urgent ones.",
          "Reports of prohibited content are reviewed within 24 hours; the content is removed on sight if it breaks the Prohibited Content Policy, and the account that generated it is suspended. Where the law requires, the matter is reported to the authorities.",
          "Other reports are answered within 5 business days.",
          "The reporter is told the outcome by email unless they asked not to be, or the matter is with law enforcement.",
        ],
      },
      {
        h: "Claiming a likeness",
        p: [
          "Companions are generated from text and are not based on any real person. If you believe a companion resembles you and you want it removed, tell us and we will remove it; we do not require proof of identity beyond what is needed to prevent abuse of the process, and we act within 5 business days.",
        ],
      },
      {
        h: "Appeals",
        p: [
          "An account holder whose content was removed or account suspended may reply to the notice within 14 days with their reasons. A different member of staff reviews the appeal and answers within 10 business days. Decisions concerning minors, non-consent or trafficking are not appealable.",
        ],
      },
    ],
  },
  {
    slug: "billing",
    title: "Billing, Refunds & Cancellation",
    summary: "What you are charged, when, how to cancel and when we refund.",
    updated: UPDATED,
    blocks: [
      {
        h: "What you pay for",
        ul: [
          "Credit packs: a one-time charge for a fixed number of credits, shown before you pay. Credits do not expire while your account is open.",
          "Subscriptions: a monthly charge that grants a fixed number of credits each month. The price, the credits and the renewal date are shown before you subscribe and on your account page.",
          "New accounts receive free credits on sign-up so the Service can be tried before anything is bought. No card is needed to sign up.",
        ],
      },
      {
        h: "How you are charged",
        p: [
          "Card details are entered into our payment processor's secure form and tokenised in your browser; we never see the full card number. Charges appear on your statement under a neutral descriptor. Subscriptions renew automatically every month on the same date until cancelled.",
        ],
      },
      {
        h: "Cancelling",
        p: [
          "Cancel any time from your account page in one click, or by emailing support. Cancellation stops the next renewal; you keep the credits already granted and access continues until they are used. There are no cancellation fees and no minimum term.",
        ],
      },
      {
        h: "Refunds",
        ul: [
          "Unused credit packs bought in the last 14 days are refunded in full on request.",
          "A subscription renewal is refunded in full if requested within 7 days and no credits from that renewal have been spent; otherwise it is refunded pro rata for the unused credits.",
          "A failed generation (a picture, voice note or clip that never arrived) is refunded to your balance automatically, and the refund is shown in your history.",
          "Duplicate or mistaken charges are refunded in full.",
          "Refunds go back to the original payment method within 5–10 business days. Requests go to support with the email address on the account and the date of the charge.",
        ],
      },
      {
        h: "Disputes",
        p: [
          `Before disputing a charge with your bank, contact ${SUPPORT_EMAIL}: most issues are resolved with a refund the same day. Accounts that dispute charges for services actually used may be closed.`,
        ],
      },
    ],
  },
  {
    slug: "affiliate-terms",
    title: "Affiliate & Marketing Policy",
    summary:
      "The rules for anyone who advertises or links to the site, and the words that may never appear in that advertising.",
    updated: UPDATED,
    blocks: [
      {
        p: [
          `These rules apply to affiliates in our referral programme and to anyone advertising, posting or linking to ${SITE}. They also describe our own advertising. Breaking them ends the affiliate relationship and forfeits unpaid commission.`,
        ],
      },
      {
        h: "What advertising must say and do",
        ul: [
          "Describe the Service truthfully: fictional AI companions, adults only, chat and AI-generated media. Never imply real people, real photographs, live performers, meetings, dating, hook-ups or any sexual service.",
          "Carry an adults-only marker (18+) wherever the platform allows, and run only on platforms and placements that accept adult-themed advertising and do not reach minors.",
          "Use only creative we supply or that we have approved in writing. Off-platform creative for mainstream networks is fully clothed and non-explicit by design.",
          "Disclose the affiliate relationship where the platform or the law requires (for example #ad).",
          "Never send unsolicited messages, use pop-unders, forced redirects, cookie stuffing, brand bidding on our name, or misrepresent an offer, price or free trial.",
        ],
      },
      {
        h: "Banned words and phrases",
        p: [
          "None of the following may appear in any advertisement, post, link text, landing page or domain that leads to the site. The same terms in a request on the site are refused by the content screen.",
        ],
        ul: BANNED_MARKETING_TERMS.map((g) => `${g.group}: ${g.terms.join(", ")}`),
      },
      {
        h: "Enforcement",
        ul: [
          "Every affiliate is identified by email and a unique referral code; every referred sign-up and every commission is recorded against that code.",
          "Traffic sources are reviewed. Traffic that arrives with prohibited terms in the referrer or landing parameters, or from placements that break these rules, is not paid and the affiliate is removed.",
          "Commission is reversed when the underlying payment is refunded or charged back.",
          "Anyone can report an advertisement under our Complaints policy.",
        ],
      },
    ],
  },
  {
    slug: "ai-content",
    title: "AI-Generated Content Statement",
    summary:
      "Every companion is fictional and computer-generated. What that means and why no performer records exist.",
    updated: UPDATED,
    blocks: [
      {
        p: [
          `All companions on ${SITE}, and all pictures, voice notes and video clips of them, are generated by artificial-intelligence models from text descriptions. No companion is a real person or is based on a real person. No photograph, video or recording of any human being is used to create or is contained in any companion, and users cannot upload images.`,
          "Because no actual human being is depicted, the record-keeping requirements that apply to depictions of real performers (in the United States, 18 U.S.C. § 2257) do not apply to this content. We nonetheless keep, for every generated image and clip, the account that requested it, the time, the exact prompt, the model used and the output, so that the provenance of any piece of content can be established.",
          "Every companion is defined as an adult: the age given to the models is 18 or over and is validated on creation, the prompts describe an adult, and content involving anyone under 18 is refused before generation. See the Prohibited Content Policy.",
          "Generated content may not be presented as a real person or as a real photograph, and may not be used to impersonate, harass or deceive.",
        ],
      },
    ],
  },
];

export function legalDoc(slug: string): LegalDoc | undefined {
  return LEGAL_DOCS.find((d) => d.slug === slug);
}
