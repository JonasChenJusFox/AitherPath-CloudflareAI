# Week 3: Calendar, Contacts, and Persistent Session State

## Scope

Week 3 extends WorkingHelper with directly testable backend APIs for schedule management, contact lookup, and persistent user context.

Implemented capabilities:

- Query today's Google Calendar events.
- Query Google Calendar events in a date range.
- Create Google Calendar events.
- Search Google Contacts using Google People API.
- Store user preferences.
- Store small Agent session memory entries.
- Refresh Google access tokens through the existing OAuth flow.

## Architecture

```text
Browser with Google OAuth cookies
→ Worker API route
→ Google session resolver
→ Zod validation
→ Calendar / People API service
→ Normalized JSON response
```

Preferences and memory use the existing `ChatAgent` Durable Object SQLite storage:

```text
Authenticated Google email
→ ChatAgent Durable Object name: google:<email>
→ user_preferences table
→ session_memory table
```

This keeps Week 3 aligned with the existing Cloudflare Agents Starter architecture. No D1 or KV binding is required yet.

## Google APIs

Enable these APIs in Google Cloud Console:

- Gmail API
- Google Calendar API
- People API

Required OAuth scopes:

```text
openid
email
profile
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/contacts.readonly
```

Users who authorized the app before Week 3 should click `Switch Gmail` to grant the new Calendar and Contacts scopes.

## API Routes

### `GET /api/calendar/today`

Query parameters:

- `timeZone`: optional IANA time zone, defaults to `UTC`
- `maxResults`: optional, 1 to 20

### `GET /api/calendar/events`

Query parameters:

- `timeMin`: ISO date-time
- `timeMax`: ISO date-time
- `timeZone`: optional IANA time zone, defaults to `UTC`
- `maxResults`: optional, 1 to 50
- `pageToken`: optional

### `POST /api/calendar/events`

Body:

```json
{
  "summary": "Project meeting",
  "description": "Weekly project sync",
  "location": "Online",
  "startDateTime": "2026-07-15T14:00:00-04:00",
  "endDateTime": "2026-07-15T15:00:00-04:00",
  "timeZone": "America/New_York",
  "attendeeEmails": ["person@example.com"],
  "sendUpdates": "all"
}
```

### `GET /api/contacts/search`

Query parameters:

- `q`: required search keyword
- `pageSize`: optional, 1 to 20

The implementation uses `people:searchContacts` with a limited read mask:

```text
names,emailAddresses,phoneNumbers,organizations
```

### `GET /api/preferences`

Returns the current user's persisted preferences.

### `PATCH /api/preferences`

Body:

```json
{
  "timeZone": "America/New_York",
  "defaultMeetingDurationMinutes": 30,
  "defaultCalendarId": "primary"
}
```

### `GET /api/memory`

Returns small safe memory entries for the authenticated user's Agent storage.

### `POST /api/memory`

Body:

```json
{
  "key": "job_search_goal",
  "value": "Frontend roles in New York"
}
```

Memory keys are bounded and must match:

```text
^[a-zA-Z0-9:_-]{1,80}$
```

Values are limited to 2000 characters.

## Security Notes

- Week 3 routes resolve identity from the server-side Google session.
- The API does not trust user IDs from request bodies or query strings.
- Contacts results are normalized and not persisted.
- OAuth tokens are not returned in normal API responses.
- Refresh tokens remain in HttpOnly cookies in the current demo architecture.
- A production version should move refresh tokens into encrypted server-side storage.

## Verification

```bash
npm run check
npm run build
```

`npm run check` runs formatting, linting, TypeScript, and unit tests.
