// Typed content models for the public site. These mirror the planned web_* tables so the future private CMS and
// database views can replace the sample source without changing components. Money, personal data and private Hub
// records are deliberately absent: the public site never holds them.

export interface SiteSettings {
  name: string;
  tagline: string;
  email: string;
  address: string;
  serviceDay: string;
  serviceTime: string;
  venue: string;
  socials: { label: string; href: string }[];
  /** Destination for every Foundation School enrolment button. Empty or invalid hides the button. */
  foundationEnrollUrl: string;
  /** True while the content is sample data. Shown as a visible banner so nothing is mistaken for approved copy. */
  isSample: boolean;
}

export interface NavItem {
  label: string;
  path: string;
}

export interface Ministry {
  title: string;
  text: string;
}

export interface Leader {
  name: string;
  role: string;
}

export interface Opportunity {
  title: string;
  text: string;
}

export interface Belief {
  title: string;
  text: string;
}

export interface AboutContent {
  mission: string;
  vision: string;
  beliefs: Belief[];
  ministries: Ministry[];
  leaders: Leader[];
  opportunities: Opportunity[];
}

export type EventKind = 'gathering' | 'study' | 'outreach' | 'prayer' | 'social' | 'training';

export interface PublicEvent {
  slug: string;
  title: string;
  /** ISO calendar date, YYYY-MM-DD, interpreted in the site's time zone. */
  date: string;
  /** 24-hour HH:MM. */
  start: string;
  end: string;
  venue: string;
  location: string;
  summary: string;
  body: string;
  /** Optional registration link. Must be https; validated before rendering. */
  registrationUrl: string;
  kind: EventKind;
}

export interface BlogPost {
  slug: string;
  title: string;
  category: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  readMinutes: number;
  author: string;
  excerpt: string;
  tags: string[];
  paragraphs: string[];
}

export type RhapsodyKind = 'Monthly' | 'Daily';

export interface RhapsodyEdition {
  slug: string;
  title: string;
  kind: RhapsodyKind;
  /** ISO date for the edition's period start, YYYY-MM-DD. */
  period: string;
  blurb: string;
  /** Public path to the PDF. Only editions with an authorizer are listed in production. */
  pdfPath: string;
  authorizedBy: string;
}

export interface FoundationFaq {
  question: string;
  answer: string;
}

export interface FoundationSchoolContent {
  headline: string;
  intro: string;
  whatItIs: string;
  whoItIsFor: string;
  learn: { title: string; text: string }[];
  journey: { step: string; title: string; text: string }[];
  benefits: string[];
  enrolSteps: string[];
  faqs: FoundationFaq[];
}

export interface WelcomePoint {
  title: string;
  text: string;
}

export interface VisitInfo {
  heading: string;
  text: string;
}

export interface NewHereContent {
  welcomePoints: WelcomePoint[];
  expectations: VisitInfo[];
  faqs: FoundationFaq[];
}

export interface HomeContent {
  eyebrow: string;
  headingLead: string;
  headingAccent: string;
  headingTail: string;
  body: string;
}

/** The full content set the site renders. A CMS will produce exactly this shape. */
export interface SiteContent {
  settings: SiteSettings;
  nav: NavItem[];
  home: HomeContent;
  about: AboutContent;
  events: PublicEvent[];
  posts: BlogPost[];
  rhapsody: RhapsodyEdition[];
  foundationSchool: FoundationSchoolContent;
  newHere: NewHereContent;
}
