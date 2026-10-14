# DriveVault: a Google Drive-like file storage backend (MERN)

Upload and organise files in nested folders, share them with other users (viewer / editor),
keep and restore earlier versions, and recover deleted items from the trash.
The focus is the **backend** (Express + MongoDB); the React client is a small demo UI for the main flows.

| Layer | Choice |
|---|---|
| API | Node 18+ / Express 4, zod validation, JWT auth (bcrypt password hashes) |
| Metadata | MongoDB via Mongoose: users, folders, files, versions, audit log |
| File contents | Local disk behind a small storage interface (swap in S3/GCS by implementing 5 methods) |
| UI | React + Vite |
| Docs | OpenAPI 3 at `/api/docs` (Swagger UI) and `/api/openapi.json` |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for schema design, permission model and trade-offs.

## Project layout

```
.                 npm workspaces root (scripts: dev, install:all, test)
├── server/       Express API, models, services, tests
├── client/       React + Vite demo UI
└── docs/         Architecture notes
```

## Run it

### Prerequisites

* Node.js 18+
* A MongoDB instance, either:
  * **Local:** MongoDB Community Server installed and running (default URI `mongodb://127.0.0.1:27017/drive` works as is), or
  * **Cloud:** a free MongoDB Atlas cluster (allow your IP under *Network Access*, then copy the connection string into `MONGODB_URI`).

### Steps

```bash
# 1. install everything (server + client) from the repo root
npm run install:all

# 2. configure the server
cp .env.example server/.env
#    then edit server/.env and set JWT_SECRET (>= 32 random characters), e.g.
#    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#    (set MONGODB_URI as well if you use Atlas)

# 3. start API and UI together
npm run dev
```

* UI: http://localhost:5173 (Vite proxies `/api` to the API)
* API: http://localhost:4000
* Swagger docs: http://localhost:4000/api/docs

You can also start them separately: `npm run dev -w server` and `npm run dev -w client`.

The API refuses to start without a valid `JWT_SECRET`, and exits with an error if it cannot reach MongoDB.

### Environment variables

Read from `server/.env` (see `.env.example`).

| Variable | Default | Meaning |
|---|---|---|
| `JWT_SECRET` | **required** (≥32 chars) | Signs access tokens. Never commit it. |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/drive` | Database |
| `PORT` | `4000` | HTTP port |
| `STORAGE_DIR` | `./storage` | Where file contents are written (relative to `server/`) |
| `DEFAULT_QUOTA_MB` | `100` | Per-user quota; every stored version counts |
| `MAX_FILE_SIZE_MB` | `50` | Per-upload size limit |
| `MAX_VERSIONS_PER_FILE` | `20` | Older versions are pruned and their quota released |
| `JWT_EXPIRES_IN` | `1d` | Token lifetime |
| `BCRYPT_ROUNDS` | `12` | Password hashing cost |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed browser origin |
| `AUTH_RATE_LIMIT_PER_MIN` | `30` | Per-IP limit on `/api/auth/*` |

## Tests

```bash
npm test                       # from the repo root; starts an in-memory MongoDB
                               # (downloads a mongod binary on first run)

# or against a MongoDB you already run:
MONGODB_URI_TEST=mongodb://127.0.0.1:27017/drive_test npm test
```

On Windows PowerShell set the variable first: `$env:MONGODB_URI_TEST="mongodb://127.0.0.1:27017/drive_test"`.

Tests run through the real Express app with supertest and cover: registration/login/token handling;
upload/download round trips; path-traversal names; duplicate names; size limit; quota (including
concurrent uploads); rollback when the database fails mid-upload; folders, pagination, rename, move and
cycle prevention; versions, restore, pruning and `If-Match` concurrency; trash, restore and purge;
**access control** (other users get 404 for private items, 403 when the role is too low, inherited folder shares,
revocation, breadcrumb leakage); public links (cap, expiry, revoke); audit log.
The suite uses the database named in `MONGODB_URI_TEST` and **wipes it**, so don't point it at real data.

## API at a glance

All routes are under `/api`; everything except `/auth/*`, `/public/*` and `/health` needs `Authorization: Bearer <token>`.
Errors always look like `{ "error": { "code": "DUPLICATE_NAME", "message": "...", "details": [...] } }`.
The full, interactive reference is at **`/api/docs`**.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| Folders | `POST /folders`, `GET /folders/root/items`, `GET /folders/:id`, `GET /folders/:id/items?page&limit`, `PATCH /folders/:id` (rename/move), `DELETE /folders/:id` (to trash) |
| Files | `POST /files?folderId=` (multipart `file`), `GET /files/:id`, `GET /files/:id/download?version=`, `PATCH /files/:id` (rename/move), `DELETE /files/:id` (to trash) |
| Versions | `PUT /files/:id/content` (new version; optional `If-Match: <n>`), `GET /files/:id/versions`, `POST /files/:id/versions/:n/restore` |
| Sharing | `GET/POST /files/:id/shares`, `DELETE /files/:id/shares/:userId` (same under `/folders/:id/shares`), `GET /shared-with-me` |
| Public links | `POST/DELETE /files/:id/link` (optional expiry + download cap), `GET /public/:token` |
| Trash | `GET /trash`, `POST /files/:id/restore`, `POST /folders/:id/restore`, `DELETE /trash/files/:id`, `DELETE /trash/folders/:id`, `DELETE /trash` |
| Misc | `GET /audit`, `GET /health` |

Status codes: `400` validation, `401` no/invalid token, `403` visible but role too low, `404` missing **or not visible**,
`409` duplicate name / concurrent change, `412` `If-Match` mismatch, `413` file too large, `507` quota exceeded.

### Example requests

```bash
API=http://localhost:4000/api

# register and keep the token
TOKEN=$(curl -s $API/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","name":"Ada","password":"correct horse"}' | jq -r .token)
AUTH="Authorization: Bearer $TOKEN"

# create a folder, upload into it
FOLDER=$(curl -s $API/folders -H "$AUTH" -H 'Content-Type: application/json' -d '{"name":"Reports"}' | jq -r .id)
FILE=$(curl -s -X POST "$API/files?folderId=$FOLDER" -H "$AUTH" -F file=@./report.pdf | jq -r .id)

# list the folder (page 1, 20 per page), download, rename
curl -s "$API/folders/$FOLDER/items?page=1&limit=20" -H "$AUTH"
curl -s -OJ $API/files/$FILE/download -H "$AUTH"
curl -s -X PATCH $API/files/$FILE -H "$AUTH" -H 'Content-Type: application/json' -d '{"name":"report-final.pdf"}'

# upload a new version only if nobody changed it since version 1
curl -s -X PUT $API/files/$FILE/content -H "$AUTH" -H 'If-Match: 1' -F file=@./report-v2.pdf
curl -s $API/files/$FILE/versions -H "$AUTH"
curl -s -X POST $API/files/$FILE/versions/1/restore -H "$AUTH"     # creates version 3 = copy of v1

# share with another registered user as editor, then revoke
curl -s $API/files/$FILE/shares -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"email":"grace@example.com","role":"editor"}'
curl -s -X DELETE $API/files/$FILE/shares/<userId> -H "$AUTH"

# public link: 24 hours, 5 downloads
curl -s $API/files/$FILE/link -H "$AUTH" -H 'Content-Type: application/json' -d '{"expiresInHours":24,"maxDownloads":5}'

# trash and restore
curl -s -X DELETE $API/files/$FILE -H "$AUTH"
curl -s -X POST $API/files/$FILE/restore -H "$AUTH"
```

## Feature status

**Implemented:** everything in sections 3-5 of the brief: auth; upload/download/list/rename/move/delete; nested folders; pagination;
viewer/editor sharing with revoke and subtree inheritance; version history with restore; trash with restore and permanent delete;
per-user quota; failure rollback; OpenAPI docs; tests; local run instructions.

**Stretch goals implemented:** expiring share links with download limits; audit log; optimistic concurrency (`If-Match`, unique version numbers,
compare-and-set on the file) and version pruning.

**Not implemented / known limitations**
- Resumable/chunked uploads, content-hash deduplication (hashes *are* stored per version, so it's a small step), search, thumbnails, load tests.
- No multi-document transactions (a standalone MongoDB has none). Uploads and deletes use ordered steps with compensation instead; see the architecture notes.
  A hard process crash at the wrong instant can leave an unreferenced blob or a slightly-off `storageUsed`; there is no reconciliation job yet.
- The stored MIME type is whatever the client sent; downloads are always `attachment` + `nosniff`, so it is never rendered inline by the browser.
- Duplicate-name checks are exact and case-sensitive.
- Files uploaded by an editor into a shared folder belong to (and count against the quota of) the folder's owner.
- Items cannot be moved between different owners' trees.
- Sharing looks users up by email, so an authenticated user can tell whether an email is registered.
- No refresh tokens or email verification; access tokens are valid until `JWT_EXPIRES_IN`.
- Rate limiting is applied to auth routes only.