/**
 * Wire types for the Hamtrax CLI HTTP API. These mirror the shapes returned
 * by `cloudFunctionsNonClient/src/cli/router.ts` and its handlers — the CLI
 * is the only consumer of this contract today, so anything here is part of
 * the public surface. Bump `API_VERSION` if you have to break a field name.
 */

export type Tier = 'basic' | 'elevated';
export type Plan = 'free' | 'paid';

/** Standard error envelope for every non-2xx response. Plan §2h. */
export interface ApiErrorEnvelope {
  error: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

/** GET /v1/whoami response. */
export interface WhoamiResponse {
  callsign: string;
  plan: Plan;
  tier: Tier;
  nativeQsoCount: number;
}

/** Folder document — server returns whatever it stored, we capture the
 * fields the CLI displays. Anything else is preserved on `--json` output via
 * an index signature. */
export interface FolderItem {
  id: string;
  userId?: string;
  name?: string;
  autoFolderType?: 'activation' | 'category' | 'monthly' | string;
  autoFolderKey?: string;
  locationReference?: string;
  callsign?: string;
  startTime?: string | null;
  endTime?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  path?: string[];
  [key: string]: unknown;
}

/** Paginated list envelope — `cursor` is opaque, present only when more
 * pages exist. */
export interface PaginatedList<T> {
  items: T[];
  cursor?: string;
}

/** QSO contact item. */
export interface ContactItem {
  id: string;
  userId?: string;
  folderId?: string;
  callsign?: string;
  frequency?: number;
  mode?: string;
  timeOn?: string;
  rstSent?: string;
  rstReceived?: string;
  notes?: string;
  name?: string;
  mySig?: string;
  mySigInfo?: string;
  imported?: boolean;
  [key: string]: unknown;
}

/** POST /v1/activations response. */
export interface CreateActivationResponse {
  id: string;
  name: string;
  autoFolderKey: string;
  created: boolean;
}

/** POST /v1/contacts request body. */
export interface CreateContactRequest {
  folderId: string;
  callsign: string;
  frequency: number;
  mode: string;
  timeOn: string;
  rstSent?: string;
  rstReceived?: string;
  notes?: string;
  name?: string;
}

/** POST /v1/contacts response. */
export interface CreateContactResponse {
  id: string;
}

/** DELETE /v1/contacts/:id response. */
export interface DeleteContactResponse {
  success: true;
}

/** POST /v1/activations request body. */
export interface CreateActivationRequest {
  callsign: string;
  locationReference: string;
  programId?: string;
  locationName?: string;
  startTime?: string;
}

/** Server error codes from plan §2h. */
export type ServerErrorCode =
  | 'unauthorized'
  | 'key_revoked'
  | 'tier_insufficient'
  | 'rate_limited'
  | 'qso_cap_reached'
  | 'not_found'
  | 'validation_error'
  | 'internal';
