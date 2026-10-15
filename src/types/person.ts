// ─── Person Identity Types ────────────────────────────────────────────────────
// ONE HUMAN = ONE PERSON RECORD: a Person's id never changes across ministry
// relationship changes. Contact and Member are relationships, not identities.

export interface Person {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
}

// The active ministry relationship for a person (if they are a member).
export interface MembershipRelationship {
  id: string;
  personId: string;
  joinedAt: string;
  role: 'member' | 'cell_leader' | 'admin' | 'coordinator';
  status: 'active' | 'pending' | 'inactive' | 'rejected';
  cellId: string | null;
}

// The contact outreach relationship for a person (always present for contacts).
export interface ContactRelationship {
  id: string;
  personId: string;
  cellId: string | null;
  tag: string | null;
  followUpStatus: string | null;
  followUpAssignee: string | null;
  dateContacted: string;
  notes: string | null;
  loggedBy: string;
  archived: boolean;
  // Legacy bridge fields — present on rows created before Branch 1 migration.
  // Do not write isMember / memberId on new code; consult memberships table instead.
  isMember: boolean;
  memberId: string | null;
}

// Audit trail entry for membership status changes.
export interface MembershipTransition {
  id: string;
  personId: string;
  fromType: string | null;
  toType: string;
  transitionedAt: string;
  performedBy: string | null;
  notes: string | null;
}

// Denormalised read model combining person + membership + contact for UI lists.
export interface PersonSummary {
  person: Person;
  membership: MembershipRelationship | null;
  contact: ContactRelationship | null;
  // Derived: true if person has an active membership row
  isMember: boolean;
  // Derived: true if person has a contact row (not archived)
  isContact: boolean;
}

// Input type for creating a new person record.
export interface CreatePersonInput {
  fullName: string;
  email?: string | null;
  phone?: string | null;
}

// Input type for establishing membership from a contact.
export interface EstablishMembershipInput {
  personId: string;
  role?: 'member' | 'cell_leader' | 'admin' | 'coordinator';
  status?: 'active' | 'pending';
  cellId?: string | null;
  performedBy: string;
  notes?: string;
}

export interface MergePeopleInput {
  targetPersonId: string;
  sourcePersonId: string;
  notes?: string | null;
}
