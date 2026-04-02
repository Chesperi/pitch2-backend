import type { StaffId } from "./types/staffId";

export type AssignmentStatus = "DRAFT" | "READY" | "SENT" | "CONFIRMED" | "REJECTED";

export interface Assignment {
  id: number;
  eventId: string;
  roleCode: string;
  /** Allineato a `roles.location`; coppia univoca con `roleCode`. */
  roleLocation: string;
  staffId: number | null;
  status: AssignmentStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssignmentWithJoins extends Assignment {
  eventCategory: string;
  eventCompetitionName: string;
  eventMatchDay: number | null;
  eventHomeTeamNameShort: string | null;
  eventAwayTeamNameShort: string | null;
  /** Combinazione `date` + `ko_italy_time` per compatibilità UI. */
  eventKoItaly: string | null;
  eventStatus: string;
  staffSurname: string | null;
  staffName: string | null;
  staffEmail: string | null;
  staffPhone: string | null;
  staffCompany: string | null;
  staffFee: string | null;
  staffPlates: string | null;
  roleDescription: string | null;
}

export interface AssignmentEventSummary {
  id: string;
  category: string;
  competitionName: string;
  matchday: number | null;
  homeTeamNameShort: string | null;
  awayTeamNameShort: string | null;
  koItaly: string | null;
  preDurationMinutes: number;
  standardOnsite: string | null;
  standardCologno: string | null;
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
  roleCode: string;
  roleLocation: string;
  quantity: number;
  notes: string | null;
  facilities: string | null;
  studio: string | null;
}

/** Tabella `standard_cost` (Supabase / Postgres). */
export interface StandardCost {
  id: number;
  service: string;
  provider: string;
  costExclusive: number | null;
  costCoExclusive: number | null;
  extra: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StandardRequirementWithRole extends StandardRequirement {
  roleDescription: string | null;
}

/** Schema `events` Supabase (Excel). `id` è TEXT. */
export interface Event {
  id: string;
  category: string;
  date: string | null;
  status: string | null;
  competitionName: string;
  matchday: number | null;
  day: string | null;
  koItalyTime: string | null;
  preDurationMinutes: number;
  homeTeamNameShort: string | null;
  awayTeamNameShort: string | null;
  rightsHolder: string | null;
  standardOnsite: string | null;
  standardCologno: string | null;
  facilities: string | null;
  studio: string | null;
  showName: string | null;
  client: string | null;
  formatName: string | null;
  episode: number | null;
  nameEpisode: string | null;
  startTime: string | null;
  notes: string | null;
}

export interface EventListFilters {
  q?: string;
  category?: string;
  competitionName?: string;
  matchday?: number;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  onlyDesignable?: boolean;
}

export interface EventListPagination {
  limit: number;
  offset: number;
}

export interface EventCreatePayload {
  id?: string;
  category: string;
  date?: string | null;
  status?: string | null;
  competitionName: string;
  matchday?: number | null;
  day?: string | null;
  koItalyTime?: string | null;
  preDurationMinutes?: number;
  homeTeamNameShort?: string | null;
  awayTeamNameShort?: string | null;
  rightsHolder?: string | null;
  standardOnsite?: string | null;
  standardCologno?: string | null;
  facilities?: string | null;
  studio?: string | null;
  showName?: string | null;
  client?: string | null;
  formatName?: string | null;
  episode?: number | null;
  nameEpisode?: string | null;
  startTime?: string | null;
  notes?: string | null;
}

export type EventUpdatePayload = Partial<EventCreatePayload>;

export interface Accreditation {
  id: number;
  eventId: string;
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

export interface AccreditationListItem {
  id: number;
  eventId: string;
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
  eventId: string;
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
  eventId: string;
  koItaly: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  stadiumName: string | null;
  competitionName: string | null;
  ownerCode: string;
}

export interface GetAccreditiExportMetaResponse {
  event: AccreditationExportEventMeta;
  staff: AccreditationExportStaffRow[];
  areaMappings: { roleCode: string; areas: string }[];
  areaLegends: { areaCode: string; description: string }[];
}
