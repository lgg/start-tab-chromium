import { exportBackup, importBackup, type BackupBundle } from "./backup.js";

const GOOGLE_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events";
const GOOGLE_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_BACKUP_FILE_NAME = "start-tab-backup.json";

export interface GoogleCalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
}

interface CalendarEventPayload {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

interface CalendarEventsResponse {
  items?: CalendarEventPayload[];
}

interface DriveFile {
  id: string;
  name: string;
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
  const token = await getToken(interactive);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(url, {
    ...init,
    headers,
  });
  if (!response.ok) throw new Error(`Google API request failed: ${response.status}`);
  return (await response.json()) as T;
}

export async function listCalendarEvents(calendarId = "primary", maxResults = 8): Promise<GoogleCalendarEvent[]> {
  const url = new URL(GOOGLE_CALENDAR_EVENTS_URL.replace("{calendarId}", encodeURIComponent(calendarId)));
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", new Date().toISOString());
  url.searchParams.set("maxResults", String(maxResults));

  const payload = await googleFetch<CalendarEventsResponse>(url.toString());
  return (payload.items ?? []).map((event) => ({
    id: event.id ?? crypto.randomUUID(),
    title: event.summary ?? "Untitled event",
    start: event.start?.dateTime ?? event.start?.date ?? "",
    end: event.end?.dateTime ?? event.end?.date ?? "",
  }));
}

async function findDriveBackupFile(): Promise<DriveFile | null> {
  const url = new URL(GOOGLE_DRIVE_FILES_URL);
  url.searchParams.set("spaces", "appDataFolder");
  url.searchParams.set("fields", "files(id,name)");
  url.searchParams.set("q", `name='${DRIVE_BACKUP_FILE_NAME}' and trashed=false`);
  const payload = await googleFetch<DriveListResponse>(url.toString());
  return payload.files?.[0] ?? null;
}

export async function uploadDriveBackup(): Promise<void> {
  const bundle = await exportBackup();
  const existing = await findDriveBackupFile();
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
  const boundary = "start-tab-boundary";
  await googleFetch<unknown>(`${GOOGLE_DRIVE_UPLOAD_URL}?uploadType=multipart`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(metadata),
      `--${boundary}`,
      "Content-Type: application/json",
      "",
      body,
      `--${boundary}--`,
    ].join("\r\n"),
  }, true);
}

export async function restoreDriveBackup(): Promise<void> {
  const existing = await findDriveBackupFile();
  if (!existing) throw new Error("No Start Tab backup found in Google Drive app data");
  const bundle = await googleFetch<BackupBundle>(`${GOOGLE_DRIVE_FILES_URL}/${existing.id}?alt=media`, {}, true);
  await importBackup(bundle);
}
