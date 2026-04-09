# Rangreel (Phase 1)

Rangreel is a role-based content operations platform with a Node.js API backend and a Next.js frontend.  
Phase 1 delivers authentication, role management, admin operations, and role-specific dashboards.

## Architecture (ASCII)

```text
┌──────────────────────────────┐
│      Next.js 14 Frontend     │
│  - App Router                │
│  - Middleware (JWT cookie)   │
│  - DashboardShell + pages    │
└──────────────┬───────────────┘
               │ HTTP (credentials: include)
               ▼
┌──────────────────────────────┐
│      Express API Backend     │
│  - Auth (JWT + cookie)       │
│  - Admin/User/Role endpoints │
│  - Validation + guards       │
└──────────────┬───────────────┘
               │ Mongoose
               ▼
┌──────────────────────────────┐
│          MongoDB             │
└──────────────────────────────┘
```

## Repo Structure

```text
rangreel-project/
├── backend/
│   ├── scripts/seed.js
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── models/
│   │   └── routes/
│   └── server.js
├── frontend/
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── middleware.js
└── README.md
```

## Backend Setup

```bash
cd backend
npm install
```

Configure `backend/.env`:

```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/rangreel
JWT_SECRET=your_super_secret_jwt_key
JWT_EXPIRES_IN=7d
ADMIN_EMAIL=admin@rangreel.com
ADMIN_PASSWORD=Admin@123!
CLIENT_URL=http://localhost:3000
```

Seed and run:

```bash
npm run seed
npm run dev
```

## Frontend Setup

```bash
cd frontend
npm install
```

Configure `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api
NEXT_PUBLIC_APP_NAME=Rangreel
JWT_SECRET=your_super_secret_jwt_key
```

Run:

```bash
npm run dev
```

## Phase 1 Features

- JWT auth with cookie + role-based guards
- Admin CRUD flows (roles, managers, users)
- Forced password change flow
- Reusable dashboard shell (desktop + mobile)
- Role dashboards: manager, strategist, videographer, editor, designer, posting
- Global loading/empty/confirm UI patterns
- 404 page + route middleware protection

## Login Test Matrix

| Email | Role | Initial mustChangePass | Expected Redirect |
|---|---|---:|---|
| `admin@rangreel.com` | `admin` | false | `/admin` |
| `manager1@rangreel.com` | `manager` | false | `/manager` |
| `strategist1@rangreel.com` | `user` (strategist role) | false | `/strategist` |
| `videographer1@rangreel.com` | `user` (videographer role) | false | `/videographer` |
| `editor1@rangreel.com` | `user` (editor role) | false | `/editor` |
| `designer1@rangreel.com` | `user` (designer role) | false | `/designer` |
| `posting1@rangreel.com` | `user` (posting role) | false | `/posting` |

Additional mandatory flow: **new manager/user with `mustChangePass=true` must redirect to `/change-password` first**, then to their role dashboard after successful password update.
