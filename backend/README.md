# Rangreel API (Backend)

Node.js + Express REST API for Rangreel. Uses MongoDB (Mongoose), JWT + httpOnly cookies, and role-based access.

## Requirements

- **Node.js** 18.x or newer (20 LTS recommended). Older Node versions are not supported by current `mongoose` / `express` dependencies.
- **MongoDB** running locally or a reachable `MONGODB_URI`.

## Setup

1. Install dependencies:

   ```bash
   cd backend
   npm install
   ```

2. Copy or edit `backend/.env` (see [Environment variables](#environment-variables)). Ensure `JWT_SECRET` is a long random string in production.

3. Start MongoDB (if local):

   ```bash
   # example: system service or
   mongod --dbpath /path/to/data
   ```

4. Seed default roles and the super admin user:

   ```bash
   npm run seed
   ```

5. Start the server:

   ```bash
   # development (auto-restart)
   npm run dev

   # production
   npm start
   ```

The API listens on `http://localhost:5000` by default (or `PORT` from `.env`).

## Environment variables

| Variable | Description |
| -------- | ----------- |
| `PORT` | HTTP port (default `5000` if unset in code fallback) |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret for signing JWTs |
| `JWT_EXPIRES_IN` | JWT expiry (e.g. `7d`) |
| `ADMIN_EMAIL` | Email for seeded super admin |
| `ADMIN_PASSWORD` | Initial password for seeded super admin |
| `CLIENT_URL` | Allowed CORS origin (e.g. `http://localhost:3000`) |
| `NODE_ENV` | Set to `production` for secure cookies (`secure: true` on auth cookie) |

## CORS and frontend

- CORS is configured with `credentials: true` and `origin: process.env.CLIENT_URL`.
- From the browser at `http://localhost:3000`, you can verify credentials mode:

  ```js
  fetch("http://localhost:5000/api/health", { credentials: "include" })
    .then((r) => r.json())
    .then(console.log);
  ```

- Expect response headers to include `Access-Control-Allow-Origin: http://localhost:3000` (matching `CLIENT_URL`) and **`Access-Control-Allow-Credentials: true`**.

## API endpoints

Base URL: `http://localhost:5000` (adjust host/port as needed).

### Health

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `GET` | `/api/health` | No | Liveness check: `{ status: "ok" }` |

### Auth (`/api/auth`)

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `POST` | `/api/auth/login` | No | Body: `{ email, password }`. Sets `rangreel_token` cookie; returns token and user. Validates email/password (`422` with `errors` array on failure). |
| `POST` | `/api/auth/logout` | No | Clears `rangreel_token` cookie. |
| `POST` | `/api/auth/change-password` | Yes | Body: `{ currentPassword, newPassword }`. Reissues JWT and cookie. |

### User (`/api/user`)

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `GET` | `/api/user/me` | Yes | Current user with populated `role`. |

### Admin (`/api/admin`)

All routes require a valid JWT and **`roleType: "admin"`**.

#### Roles

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/admin/roles` | List roles. |
| `POST` | `/api/admin/roles` | Create role (slug derived from `name`). |
| `PUT` | `/api/admin/roles/:id` | Update role (slug / `body.isSystem` changes blocked). |
| `DELETE` | `/api/admin/roles/:id` | Delete role (blocked if system role or users assigned). |

#### Managers

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/admin/managers` | List users with `roleType: manager`. |
| `POST` | `/api/admin/managers` | Body: `{ name, email, phone?, password }`. Validates name, email, password (`422` + `errors`). |
| `PUT` | `/api/admin/managers/:id` | Update manager. |
| `PUT` | `/api/admin/managers/:id/reset-password` | Body: `{ newPassword }`. |

#### Users (staff with `roleType: user`)

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/admin/users` | List users. Query: `?role=<roleSlug>`, `?search=<name>`. |
| `POST` | `/api/admin/users` | Body: `{ name, email, phone?, password, roleId }`. Validates name, email, password (`422` + `errors`). |
| `PUT` | `/api/admin/users/:id` | Update user. |
| `PUT` | `/api/admin/users/:id/reset-password` | Body: `{ newPassword }`. |

### Response shapes

- **Success (most admin routes):** `{ success: true, data: ... }`
- **Validation failure:** `{ success: false, errors: [ ... ] }` with HTTP **422** (login, create manager, create user)
- **Other errors:** `{ success: false, error: "..." }` (auth middleware uses `error` as well)
- **Unknown route:** `{ success: false, error: "Route not found" }` **404**
- **Unhandled server error:** `{ success: false, error: "<message>" }` **500**

## Seed script

Populates seven default roles and creates the super admin if missing (idempotent).

```bash
cd backend
npm run seed
```

Uses `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`. Safe to run multiple times.

## Testing

- **Postman:** Login with `POST /api/auth/login` and `{ "email", "password" }`. Use returned `Bearer` token or cookies for protected routes.
- **Non-admin JWT** against `/api/admin/*` should return **403** `{ success: false, error: "Forbidden" }`.
