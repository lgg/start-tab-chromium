import { exportBackup, importBackup, type BackupBundle } from "./backup.js";

const GOOGLE_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events";
const GOOGLE_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_BACKUP_FILE_NAME = "start-tab-backup.json";
const DEFAULT_CALENDAR_ID = "primary";
const MIN_CALENDAR_RESULTS = 1;
const MAX_CALENDAR_RESULTS = 25;
const CALENDAR_QUERY_PAGE_SIZE = 100;
const MAX_CALENDAR_QUERY_PAGES = 20;

export interface GoogleCalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}

interface CalendarEventPayload {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

interface CalendarEventsResponse {
  items?: CalendarEventPayload[];
  nextPageToken?: string;
}

interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
}

interface DriveListResponse {
  files?: DriveFile[];
}

type AuthTokenResponse = string | { token?: string };

function googleConfigReady(): boolean {
  const manifest = chrome.runtime.getManifest() as { oauth2?: { client_id?: string } };
  const clientId = manifest.oauth2?.client_id;
  return Boolean(clientId && !clientId.includes("REPLACE") && !clientId.includes("TODO"));
}

export function isGoogleIntegrationConfigured(): boolean {
  return googleConfigReady();
}

async function getToken(interactive: boolean): Promise<string> {
  if (!googleConfigReady()) {
    throw new Error("Google OAuth client_id is not configured in manifest.json");
  }
  const response = await chrome.identity.getAuthToken({ interactive }) as AuthTokenResponse;
  if (typeof response === "string") return response;
  if (response.token) return response.token;
  throw new Error("Unable to get Google OAuth token");
}

async function googleFetch<T>(url: string, init: RequestInit = {}, interactive = false): Promise<T> {
  const requestWithToken = async (token: string): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, {
      ...init,
      headers,
    });
  };

  const token = await getToken(interactive);
  let response = await requestWithToken(token);

  if (response.status === 401 || response.status === 403) {
    await chrome.identity.removeCachedAuthToken({ token });
    response = await requestWithToken(await getToken(interactive));
  }

  if (!response.ok) throw new Error(`Google API request failed: ${response.status}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function normalizedCalendarId(calendarId: string): string {
  const trimmed = calendarId.trim();
  return trimmed || DEFAULT_CALENDAR_ID;
}

function normalizedCalendarMaxResults(maxResults: number): number {
  if (!Number.isFinite(maxResults)) return 8;
  return Math.min(MAX_CALENDAR_RESULTS, Math.max(MIN_CALENDAR_RESULTS, Math.round(maxResults)));
}

function calendarEvent(payload: CalendarEventPayload): GoogleCalendarEvent {
  return {
    id: payload.id ?? crypto.randomUUID(),
    title: payload.summary ?? "Untitled event",
    start: payload.start?.dateTime ?? payload.start?.date ?? "",
    end: payload.end?.dateTime ?? payload.end?.date ?? "",
    allDay: Boolean(payload.start?.date && !payload.start.dateTime),
  };
}

/**
 * Query Google before applying the configured display limit. Google Calendar's
 * `q` can also match descriptions and locations, so title matching remains a
 * final client-side condition and additional result pages are read as needed.
 */
export async function listCalendarEvents(
  calendarId = DEFAULT_CALENDAR_ID,
  maxResults = 8,
  query = "",
): Promise<GoogleCalendarEvent[]> {
  const limit = normalizedCalendarMaxResults(maxResults);
  const normalizedQuery = query.trim();
  const titleQuery = normalizedQuery.toLocaleLowerCase();
  const events: GoogleCalendarEvent[] = [];
  const timeMin = new Date().toISOString();
  const seenPageTokens = new Set<string>();
  let pageToken = "";
  let pagesRead = 0;

  while (events.length < limit && pagesRead < MAX_CALENDAR_QUERY_PAGES) {
    const url = new URL(GOOGLE_CALENDAR_EVENTS_URL.replace("{calendarId}", encodeURIComponent(normalizedCalendarId(calendarId))));
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("maxResults", String(normalizedQuery ? CALENDAR_QUERY_PAGE_SIZE : limit));
    if (normalizedQuery) url.searchParams.set("q", normalizedQuery);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const payload = await googleFetch<CalendarEventsResponse>(url.toString());
    for (const candidate of payload.items ?? []) {
      const event = calendarEvent(candidate);
      if (!titleQuery || event.title.toLocaleLowerCase().includes(titleQuery)) events.push(event);
      if (events.length >= limit) break;
    }
    pagesRead += 1;

    const nextPageToken = typeof payload.nextPageToken === "string" ? payload.nextPageToken : "";
    if (!normalizedQuery || !nextPageToken || seenPageTokens.has(nextPageToken)) break;
    seenPageTokens.add(nextPageToken);
    pageToken = nextPageToken;
  }

  return events.slice(0, limit);
}

export function driveBackupListUrl(): string {
  const url = new URL(GOOGLE_DRIVE_FILES_URL);
  url.searchParams.set("spaces", "appDataFolder");
  url.searchParams.set("fields", "files(id,name,modifiedTime)");
  url.searchParams.set("q", `name='${DRIVE_BACKUP_FILE_NAME}' and trashed=false`);
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("pageSize", "1");
  return url.toString();
}

async function findDriveBackupFile(interactive = false): Promise<DriveFile | null> {
  const payload = await googleFetch<DriveListResponse>(driveBackupListUrl(), {}, interactive);
  return payload.files?.[0] ?? null;
}

function driveMultipartBoundary(content: string): string {
  let boundary: string;
  do {
    boundary = `start-tab-${crypto.randomUUID().replaceAll("-", "")}`;
  } while (content.includes(boundary));
  return boundary;
}

export async function uploadDriveBackup(): Promise<void> {
  const bundle = await exportBackup();
  const existing = await findDriveBackupFile(true);
  const body = JSON.stringify(bundle, null, 2);

  if (existing) {
    await googleFetch<unknown>(`${GOOGLE_DRIVE_UPLOAD_URL}/${existing.id}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    }, true);
    return;
  }

  const metadata = {
    name: DRIVE_BACKUP_FILE_NAME,
    parents: ["appDataFolder"],
  };
  const metadataJson = JSON.stringify(metadata);
  const boundary = driveMultipartBoundary(`${metadataJson}\n${body}`);
  await googleFetch<unknown>(`${GOOGLE_DRIVE_UPLOAD_URL}?uploadType=multipart`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      metadataJson,
      `--${boundary}`,
      "Content-Type: application/json",
      "",
      body,
      `--${boundary}--`,
    ].join("\r\n"),
  }, true);
}

export async function restoreDriveBackup(): Promise<void> {
  const existing = await findDriveBackupFile(true);
  if (!existing) throw new Error("No Start Tab backup found in Google Drive app data");
  const bundle = await googleFetch<BackupBundle>(`${GOOGLE_DRIVE_FILES_URL}/${existing.id}?alt=media`, {}, true);
  await importBackup(bundle);
}
