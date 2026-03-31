import type { StaffId } from "./types/staffId";

export type AssignmentStatus = "DRAFT" | "READY" | "SENT" | "CONFIRMED" | "REJECTED";
export type EventAssignmentsStatus = "DRAFT" | "READY_TO_SEND";

export interface Assignment {
  id: number;
  eventId: number;
  roleId: number;
  staffId: StaffId | null;
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
  rightsHolder: string | null;
  facilities: string | null;
  studio: string | null;
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
  /** Detentore diritti (es. SKY/DAZN); in JSON API come `rights_holder`. */
  rightsHolder: string | null;
  facilities: string | null;
  studio: string | null;
  status: string;
  notes: string | null;
  assignmentsStatus: EventAssignmentsStatus;
}

/** Filtri query GET lista eventi (camelCase interno al service) */
export interface EventListFilters {
  q?: string;
  category?: string;
  competitionName?: string;
  competitionCode?: string;
  matchday?: number;
  venueCity?: string;
  status?: string;
  assignmentsStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  onlyDesignable?: boolean;
}

export interface EventListPagination {
  limit: number;
  offset: number;
}

/** Payload creazione evento (campi già normalizzati) */
export interface EventCreatePayload {
  externalMatchId?: number | null;
  category: string;
  competitionName: string;
  competitionCode?: string | null;
  matchday?: number | null;
  homeTeamNameShort?: string | null;
  awayTeamNameShort?: string | null;
  venueName?: string | null;
  venueCity?: string | null;
  venueAddress?: string | null;
  koItaly?: string | null;
  preDurationMinutes?: number;
  standardOnsite?: string | null;
  standardCologno?: string | null;
  location?: string | null;
  showName?: string | null;
  rightsHolder?: string | null;
  facilities?: string | null;
  studio?: string | null;
  status?: string;
  notes?: string | null;
  assignmentsStatus?: EventAssignmentsStatus;
}

/** Payload aggiornamento parziale */
export type EventUpdatePayload = Partial<EventCreatePayload>;

export interface Accreditation {
  id: number;
  eventId: number;
  staffId: StaffId;
  roleCode: string | null;
  areas: string | null;
  plates: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccreditationWithStaff extends Accreditation {
  staffSurname: string;
  staffName: string;
  staffCompany: string | null;
  staffPlaceOfBirth: string | null;
  staffDateOfBirth: string | null;
  staffDefaultRoleCode: string | null;
  staffPlates: string | null;
  staffNotes: string | null;
}

/** Lista tab Accrediti evento (shape API, senza campi staff extra). */
export interface AccreditationListItem {
  id: number;
  eventId: number;
  staffId: StaffId;
  company: string | null;
  surname: string | null;
  name: string | null;
  roleCode: string | null;
  areas: string | null;
  plates: string | null;
  notes: string | null;
}

export interface GetAccreditiResponse {
  eventId: number;
  items: AccreditationListItem[];
}

export interface AccreditationExportStaffRow {
  accreditationId: number;
  company: string | null;
  surname: string;
  name: string;
  placeOfBirth: string | null;
  dateOfBirth: string | null;
  areas: string | null;
  roleCode: string | null;
  plates: string | null;
  notes: string | null;
}

export interface AccreditationExportEventMeta {
  eventId: number;
  koItaly: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  stadiumName: string | null;
  competitionName: string | null;
  ownerCode: string;
}

/** Allineato a `AccreditationAreaMapping` / `AccreditationAreaLegend` in accreditationAreasService. */
export interface GetAccreditiExportMetaResponse {
  event: AccreditationExportEventMeta;
  staff: AccreditationExportStaffRow[];
  areaMappings: { roleCode: string; areas: string }[];
  areaLegends: { areaCode: string; description: string }[];
}
