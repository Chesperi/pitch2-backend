export type AssignmentStatus = "DRAFT" | "READY" | "SENT" | "CONFIRMED" | "REJECTED";
export type EventAssignmentsStatus = "DRAFT" | "READY_TO_SEND";

export interface Assignment {
  id: number;
  eventId: number;
  roleId: number;
  staffId: number | null;
  status: AssignmentStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssignmentWithJoins extends Assignment {
  eventExternalMatchId: string | null;
  eventCategory: string;
  eventCompetitionName: string;
  eventCompetitionCode: string | null;
  eventMatchDay: number | null;
  eventHomeTeamNameShort: string | null;
  eventAwayTeamNameShort: string | null;
  eventVenueName: string | null;
  eventVenueCity: string | null;
  eventKoItaly: string | null;
  eventStatus: string;
  staffSurname: string | null;
  staffName: string | null;
  staffEmail: string | null;
  staffPhone: string | null;
  staffCompany: string | null;
  staffFee: number | null;
  staffPlates: string | null;
  roleCode: string;
  roleName: string;
  roleLocation: string;
}

export interface AssignmentEventSummary {
  id: number;
  externalMatchId: string | null;
  category: string;
  competitionName: string;
  competitionCode: string | null;
  matchday: number | null;
  homeTeamNameShort: string | null;
  awayTeamNameShort: string | null;
  venueName: string | null;
  venueCity: string | null;
  venueAddress: string | null;
  koItaly: string | null;
  preDurationMinutes: number;
  standardOnsite: string | null;
  standardCologno: string | null;
  areaProduzione: string | null;
  showName: string | null;
  status: string;
}

export interface AssignmentWithEvent {
  assignment: Assignment;
  event: AssignmentEventSummary;
}

export interface StandardRequirement {
  id: number;
  standardOnsite: string;
  standardCologno: string;
  site: string;
  areaProduzione: string;
  roleId: number;
  quantity: number;
  notes: string | null;
}

export interface StandardRequirementWithRole extends StandardRequirement {
  roleCode: string;
  roleName: string;
  roleLocation: string;
}

export interface Event {
  id: number;
  externalMatchId: string | null;
  category: string;
  competitionName: string;
  competitionCode: string | null;
  matchDay: string | null;
  homeTeamNameShort: string | null;
  awayTeamNameShort: string | null;
  venueName: string | null;
  venueCity: string | null;
  venueAddress: string | null;
  koItaly: string | null;
  preDurationMinutes: number;
  standardOnsite: string | null;
  standardCologno: string | null;
  areaProduzione: string | null; // mappa colonna SQL 'location'
  showName: string | null;
  status: string;
  notes: string | null;
  assignmentsStatus: EventAssignmentsStatus;
}
