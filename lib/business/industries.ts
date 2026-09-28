/**
 * What a business starts with, by industry.
 *
 * A new business should be answerable the moment it is created — that is the
 * whole demo — and "answerable" needs more than a name: a way to talk, a list
 * of things the agent may do without asking, the words its pipeline uses, and
 * what to find out from someone who rings for the first time. None of that is
 * worth making an owner type in on day one, so each industry carries sensible
 * defaults and the Tuning screen is where they are changed afterwards.
 *
 * Stage *keys* are shared across industries (see `leadStageEnum`); only the
 * words differ. That is what lets a report count "got to a site visit" and
 * "booked an appointment" as the same step.
 */

export type LeadStage = "new" | "contacted" | "qualified" | "proposal" | "won" | "lost";

export const LEAD_STAGES: LeadStage[] = ["new", "contacted", "qualified", "proposal", "won", "lost"];

/** The stages still in play, for "open pipeline" counts. */
export const OPEN_STAGES: LeadStage[] = ["new", "contacted", "qualified", "proposal"];

export type AuthorityDefault = {
  action: string;
  label: string;
  /** Rupees. Null means unlimited (when not blocked). */
  ceilingRupees: number | null;
  blocked?: boolean;
  escalateTo?: "manager" | "owner" | "human";
};

export type Industry = {
  key: string;
  label: string;
  /** Who calls: "patients", "buyers", "customers" — used in copy. */
  callers: string;
  stages: Record<LeadStage, string>;
  /** What the agent should find out from someone it does not know. */
  leadQuestions: string[];
  /** One line on what the business does, used when nothing else is known. */
  describe: (name: string) => string;
  authority: AuthorityDefault[];
  never: string[];
  /** A few example lines for the starter document, in "Topic: text" form. */
  starter: string[];
};

const COMMON_NEVER = [
  "Ask for or accept card numbers, CVV, OTPs or UPI PINs — send a secure payment link instead",
  "Claim to be a human if asked directly",
  "Promise a price, date or availability that is not in the business's documents",
];

const COMMON_STAGES: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Quoted",
  won: "Won",
  lost: "Lost",
};

export const INDUSTRIES: Industry[] = [
  {
    key: "general",
    label: "General business",
    callers: "customers",
    stages: COMMON_STAGES,
    leadQuestions: [
      "their name",
      "what they are looking for",
      "how soon they need it",
      "the best number or email to reach them",
    ],
    describe: (name) => `${name} is a business that serves customers in India.`,
    authority: [
      { action: "book_callback", label: "Book a callback", ceilingRupees: null },
      { action: "send_payment_link", label: "Send a payment link", ceilingRupees: null },
      { action: "goodwill_credit", label: "Goodwill credit", ceilingRupees: 500, escalateTo: "manager" },
      { action: "refund", label: "Refund", ceilingRupees: null, blocked: true, escalateTo: "manager" },
    ],
    never: COMMON_NEVER,
    starter: [
      "Callbacks: If the caller needs something the assistant cannot answer, the assistant takes their name and number and a member of the team calls them back within one working day.",
    ],
  },
  {
    key: "clinic",
    label: "Clinic / healthcare",
    callers: "patients",
    stages: {
      new: "New enquiry",
      contacted: "Contacted",
      qualified: "Appointment booked",
      proposal: "Visited",
      won: "Became a patient",
      lost: "Lost",
    },
    leadQuestions: [
      "the patient's name",
      "what they want to be seen for, in their words",
      "a preferred day and time",
      "a phone number to confirm on",
    ],
    describe: (name) => `${name} is a clinic that sees patients by appointment.`,
    authority: [
      { action: "book_appointment", label: "Book an appointment", ceilingRupees: null },
      { action: "reschedule_appointment", label: "Reschedule an appointment", ceilingRupees: null },
      { action: "cancel_appointment", label: "Cancel an appointment", ceilingRupees: null },
      { action: "waive_fee", label: "Waive a consultation fee", ceilingRupees: null, blocked: true, escalateTo: "manager" },
      { action: "refund", label: "Refund", ceilingRupees: null, blocked: true, escalateTo: "manager" },
    ],
    never: [
      ...COMMON_NEVER,
      "Give a diagnosis, medical advice or a medicine dose — offer an appointment or, in an emergency, tell them to call 108",
    ],
    starter: [
      "Emergencies: For a medical emergency the caller should dial 108 or go to the nearest emergency department. The clinic does not handle emergencies by phone.",
      "Appointments: Appointments can be booked, moved or cancelled by phone. Please arrive ten minutes early with any previous prescriptions and reports.",
    ],
  },
  {
    key: "real_estate",
    label: "Real estate",
    callers: "buyers",
    stages: {
      new: "New enquiry",
      contacted: "Contacted",
      qualified: "Site visit fixed",
      proposal: "Negotiating",
      won: "Booked",
      lost: "Lost",
    },
    leadQuestions: [
      "their name",
      "what they want (e.g. 2BHK, plot, office) and in which area",
      "their budget",
      "whether they want to buy or rent, and how soon",
      "a good time for a site visit",
    ],
    describe: (name) => `${name} sells and rents residential and commercial property.`,
    authority: [
      { action: "schedule_site_visit", label: "Schedule a site visit", ceilingRupees: null },
      { action: "share_brochure", label: "Share a brochure", ceilingRupees: null },
      { action: "price_discount", label: "Offer a price discount", ceilingRupees: null, blocked: true, escalateTo: "manager" },
      { action: "hold_unit", label: "Hold a unit", ceilingRupees: null, blocked: true, escalateTo: "manager" },
    ],
    never: [...COMMON_NEVER, "Quote a final price or promise a discount — a sales manager does that"],
    starter: [
      "Site visits: Site visits run every day from 10am to 6pm and are free. A relationship manager meets the buyer at the site.",
      "Pricing: Prices vary by unit, floor and facing. The relationship manager shares the current price sheet at or before the site visit.",
    ],
  },
  {
    key: "retail",
    label: "Retail / e-commerce",
    callers: "customers",
    stages: COMMON_STAGES,
    leadQuestions: [
      "their name",
      "which product they are interested in",
      "quantity and delivery location",
      "a phone number or email",
    ],
    describe: (name) => `${name} sells products online and in store.`,
    authority: [
      { action: "reschedule_delivery", label: "Reschedule a delivery", ceilingRupees: null },
      { action: "send_payment_link", label: "Send a payment link", ceilingRupees: null },
      { action: "goodwill_credit", label: "Goodwill credit", ceilingRupees: 500, escalateTo: "manager" },
      { action: "partial_refund", label: "Partial refund", ceilingRupees: 2000, escalateTo: "manager" },
      { action: "full_refund", label: "Full refund", ceilingRupees: null, blocked: true, escalateTo: "manager" },
    ],
    never: COMMON_NEVER,
    starter: [
      "Returns: Unused items can be returned within 7 days of delivery in their original packaging. Refunds reach the original payment method in 5–7 working days.",
      "Delivery: Orders are dispatched within 2 working days. Deliveries can be rescheduled by phone.",
    ],
  },
  {
    key: "education",
    label: "Education / coaching",
    callers: "students and parents",
    stages: {
      new: "New enquiry",
      contacted: "Contacted",
      qualified: "Counselling booked",
      proposal: "Demo attended",
      won: "Enrolled",
      lost: "Lost",
    },
    leadQuestions: [
      "the student's name and class or level",
      "which course or subject they want",
      "whether they prefer online or in-person",
      "a phone number for the counsellor to call",
    ],
    describe: (name) => `${name} runs courses and coaching for students.`,
    authority: [
      { action: "book_counselling", label: "Book a counselling session", ceilingRupees: null },
      { action: "book_demo_class", label: "Book a free demo class", ceilingRupees: null },
      { action: "fee_discount", label: "Offer a fee discount", ceilingRupees: null, blocked: true, escalateTo: "manager" },
    ],
    never: [...COMMON_NEVER, "Promise results, ranks or admissions"],
    starter: [
      "Demo classes: New students can attend one free demo class before enrolling.",
      "Counselling: A counsellor calls back to explain batches, timings and fees and to answer questions.",
    ],
  },
  {
    key: "home_services",
    label: "Home services / repairs",
    callers: "customers",
    stages: {
      new: "New request",
      contacted: "Contacted",
      qualified: "Visit booked",
      proposal: "Quote sent",
      won: "Job done",
      lost: "Lost",
    },
    leadQuestions: [
      "their name",
      "what needs fixing or doing",
      "their area / address",
      "a preferred day and time for the visit",
    ],
    describe: (name) => `${name} sends technicians to homes for repairs, installation and servicing.`,
    authority: [
      { action: "book_visit", label: "Book a technician visit", ceilingRupees: null },
      { action: "reschedule_visit", label: "Reschedule a visit", ceilingRupees: null },
      { action: "waive_visit_charge", label: "Waive the visit charge", ceilingRupees: 300, escalateTo: "manager" },
      { action: "refund", label: "Refund", ceilingRupees: null, blocked: true, escalateTo: "manager" },
    ],
    never: COMMON_NEVER,
    starter: [
      "Visits: A technician visit can be booked for the same or next day. The visit charge is adjusted against the final bill if the work is done.",
    ],
  },
  {
    key: "restaurant",
    label: "Restaurant / café",
    callers: "guests",
    stages: {
      new: "New enquiry",
      contacted: "Contacted",
      qualified: "Reservation made",
      proposal: "Event quoted",
      won: "Visited",
      lost: "Lost",
    },
    leadQuestions: [
      "their name",
      "date, time and number of guests",
      "any occasion or dietary needs",
      "a phone number to confirm on",
    ],
    describe: (name) => `${name} is a restaurant that takes table reservations and event bookings.`,
    authority: [
      { action: "make_reservation", label: "Make a reservation", ceilingRupees: null },
      { action: "cancel_reservation", label: "Cancel a reservation", ceilingRupees: null },
      { action: "goodwill_credit", label: "Goodwill credit", ceilingRupees: 500, escalateTo: "manager" },
    ],
    never: [...COMMON_NEVER, "Confirm a large-group or private event booking — the manager confirms those"],
    starter: [
      "Reservations: Tables can be reserved by phone. Reservations are held for 15 minutes past the booked time.",
    ],
  },
];

export const industryFor = (key: string | null | undefined): Industry =>
  INDUSTRIES.find((i) => i.key === key) ?? INDUSTRIES[0];

export const stageLabel = (industryKey: string | null | undefined, stage: LeadStage) =>
  industryFor(industryKey).stages[stage];

/**
 * The persona a new business's agent starts with.
 *
 * Short on purpose. The rules that matter — ceilings, never-rules, when to hand
 * over — are enforced in code and appended by the prompt builders; the persona
 * is only who the agent is and how it sounds.
 */
export function defaultPersona(opts: {
  agentName: string;
  businessName: string;
  industry: Industry;
  about?: string;
}) {
  const { agentName, businessName, industry, about } = opts;
  return [
    `You are ${agentName}, answering the phone for ${businessName}. ${about?.trim() || industry.describe(businessName)}`,
    `Be warm, brief and practical. Use the caller's name once you know it. All amounts are in rupees.`,
    `When someone new calls, find out ${industry.leadQuestions.join(", ")} — naturally, one question at a time, not as a form.`,
    `If you cannot answer something from the business's information, say so and offer a callback from the team.`,
  ].join("\n");
}
