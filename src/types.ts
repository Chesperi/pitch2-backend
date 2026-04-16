import type { StaffId } from "./types/staffId";

export type AssignmentStatus = "DRAFT" | "READY" | "SENT" | "CONFIRMED" | "REJECTED";
export type EventAssignmentsStatus = "DRAFT" | "READY_TO_SEND" | "SENT" | "CONFIRMED";

export interface Assignment {
  id: number;
  eventId: string;
  roleCode: string;
  /** Allineato a `roles.location`; coppia univoca con `roleCode`. */
  roleLocation: string;
  staffId: number | null;
  generatedFromComboId?: number | null;
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
  coverageType: "FREELANCE" | "PROVIDER" | "EITHER";
  /** Presente se la riga appartiene a un pacchetto `standard_combos`. */
  standardComboId?: number | null;
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

/** Riga in `standard_combos` (pacchetto standard). */
export interface StandardCombo {
  id: number;
  standardOnsite: string;
  standardCologno: string;
  facilities: string | null;
  studio: string | null;
  notes: string | null;
  createdAt: string;
}

export interface StandardComboWithRequirements extends StandardCombo {
  requirements: StandardRequirementWithRole[];
}

/** Schema `events` Supabase (Excel). `id` è TEXT. */
export interface Event {
  id: string;
  category: string;
  date: string | null;
  status: string | null;
  standardComboId?: number | null;
  competitionName: string;
  matchday: number | null;
  day: string | null;
  koItalyTime: string | null;
  venueName: string | null;
  venueAddress: string | null;
  venueCity: string | null;
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
  isTopMatch: boolean;
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
  assignmentsStatus?: EventAssignmentsStatus | string;
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
  standardComboId?: number | null;
  competitionName: string;
  matchday?: number | null;
  day?: string | null;
  koItalyTime?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  venueCity?: string | null;
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
  isTopMatch?: boolean;
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
  logoUrl: string | null;
}

export interface GetAccreditiExportMetaResponse {
  event: AccreditationExportEventMeta;
  staff: AccreditationExportStaffRow[];
  areaMappings: { roleCode: string; areas: string }[];
  areaLegends: { areaCode: string; description: string }[];
}

export interface EventRule {
  id: number;
  competition_name: string | null;
  day_of_week: number | null; // 0=domenica, 1=lunedì ... 6=sabato
  ko_time_from: string | null; // "HH:MM"
  ko_time_to: string | null;
  standard_onsite: string | null;
  standard_cologno: string | null;
  facilities: string | null;
  studio: string | null;
  show_name: string | null;
  pre_duration_minutes: number | null;
  priority: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEventRulePayload {
  competition_name?: string;
  day_of_week?: number;
  ko_time_from?: string;
  ko_time_to?: string;
  standard_onsite?: string;
  standard_cologno?: string;
  facilities?: string;
  studio?: string;
  show_name?: string;
  pre_duration_minutes?: number;
  priority?: number;
  notes?: string;
}

export type UpdateEventRulePayload = Partial<CreateEventRulePayload>;

// Risultato apply-rules su un evento
export interface AppliedRuleFields {
  standard_onsite?: string;
  standard_cologno?: string;
  facilities?: string;
  studio?: string;
  show_name?: string;
  pre_duration_minutes?: number;
  standard_combo_id?: number;
  is_top_match?: boolean;
  rights_holder?: string;
}

// Import da football-data.org
export interface FootballDataMatch {
  id: number;
  utcDate: string;
  homeTeam: { name: string; shortName: string };
  awayTeam: { name: string; shortName: string };
  matchday: number;
  venue: string | null;
  competition: { name: string; code: string };
}

export interface ImportPreviewItem {
  external_match_id: string;
  competition_name: string;
  competition_code: string;
  matchday: number;
  home_team: string;
  away_team: string;
  ko_utc: string;
  ko_italy: string; // ISO locale Italia
  venue: string | null;
  already_exists: boolean;
  suggested_fields: AppliedRuleFields; // campi pre-compilati dalle regole
  /** Da PDF Serie A: licenziatario (DAZN / SKY/DAZN). */
  rights_holder?: string | null;
}

export interface LookupValue {
  id: number;
  category: string;
  value: string;
  sort_order: number;
  created_at: string;
}

export interface CreateLookupValuePayload {
  category: string;
  value: string;
  sort_order?: number;
}

export type UpdateLookupValuePayload = Partial<CreateLookupValuePayload>;
