# LifeHub — Personal Life Management Dashboard

A full-stack personal dashboard to manage tasks, expenses, health records, and reminders — all in one place.

---

## Folder Structure

```
lifehub/
├── schema.sql                      ← PostgreSQL database schema
│
├── backend/
│   ├── server.js                   ← Express app entry point
│   ├── package.json
│   ├── .env.example                ← Copy to .env and fill in your values
│   │
│   ├── config/
│   │   ├── db.js                   ← PostgreSQL connection pool
│   │   ├── rateLimitStore.js       ← PostgreSQL-backed rate-limit store (no Redis)
│   │   └── mailer.js               ← Email verification helper (logs to console in dev)
│   │
│   ├── middleware/
│   │   ├── auth.js                 ← JWT authentication middleware
│   │   └── validateId.js           ← Integer :id param guard
│   │
│   ├── controllers/
│   │   ├── authController.js       ← register / verifyEmail / login / logout
│   │   ├── tasksController.js
│   │   ├── expensesController.js
│   │   ├── healthController.js
│   │   ├── remindersController.js
│   │   └── dashboardController.js
│   │
│   └── routes/
│       ├── auth.js
│       ├── tasks.js
│       ├── expenses.js
│       ├── health.js
│       ├── reminders.js
│       └── dashboard.js
│
└── frontend/
    ├── index.html
    ├── css/style.css
    ├── js/
    │   ├── app.js
    │   ├── auth.js
    │   ├── dashboard.js
    │   ├── tasks.js
    │   ├── expenses.js
    │   ├── health.js
    │   └── reminders.js
    └── pages/
        ├── login.html
        ├── tasks.html
        ├── expenses.html
        ├── health.html
        └── reminders.html
```

---

## Prerequisites

- **Node.js** v18 or later
- **PostgreSQL** v13 or later
- npm

---

## Setup Instructions

### 1. Create the PostgreSQL database

```bash
psql -U postgres
CREATE DATABASE lifehub;
\q
```

### 2. Run the schema

```bash
psql -U postgres -d lifehub -f schema.sql
```

### 3. Configure environment variables

```bash
cd backend
cp .env.example .env
```

Open `.env` and fill in your values. At minimum:

```
PORT=5000
NODE_ENV=development
JWT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
DB_HOST=localhost
DB_PORT=5432
DB_NAME=lifehub
DB_USER=postgres
DB_PASSWORD=yourpassword
APP_BASE_URL=http://localhost:5000
```

### 4. Install backend dependencies

```bash
cd backend
npm install
```

To also install the optional nodemailer package for production email:

```bash
npm install nodemailer
```

### 5. Start the server

```bash
# Production
npm start

# Development (auto-restarts on file changes)
npm run dev
```

The server starts at **http://localhost:5000**

---

## API Endpoints

### Auth — `/api/auth`

| Method | Path | Description | Auth required |
|--------|------|-------------|---------------|
| POST | `/api/auth/register` | Register new user (sends verification email) | No |
| GET  | `/api/auth/verify-email?token=<hex>` | Verify email address | No |
| POST | `/api/auth/resend-verification` | Resend verification email | No |
| POST | `/api/auth/login` | Login (requires verified email) | No |
| GET  | `/api/auth/me` | Get current user | Yes |
| POST | `/api/auth/logout` | Logout + revoke token | Yes |

### Tasks, Expenses, Health, Reminders, Dashboard

Same as before — see original README sections.

---

## Email Verification Flow

1. User registers → a verification token is created in `email_verify_tokens` (24 h expiry)
2. **Dev mode** (no SMTP configured): token is printed to the server console and returned as `devVerifyToken` in the registration response
3. **Production** (SMTP configured): an email is sent with a verification link
4. User clicks the link → `GET /api/auth/verify-email?token=<hex>` → account marked `verified = TRUE`
5. User can now log in — unverified accounts receive `403 EMAIL_NOT_VERIFIED`
6. The login page shows a "Resend verification email" button when this error occurs

To enable production email, set these env vars (any SMTP provider works):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=LifeHub <you@gmail.com>
APP_BASE_URL=https://yourdomain.com
```

---

## Production Fixes (v1.3.0)

All five pre-production issues fixed with **zero new required dependencies** — same stack throughout.

| # | Issue | Fix |
|---|-------|-----|
| 1 | Frontend used `localStorage` for JWT | Already fixed in previous refactor — `app.js` uses httpOnly cookie via `credentials: 'include'` |
| 2 | Rate limiter used in-memory store (reset on restart) | New `PgRateLimitStore` in `config/rateLimitStore.js` — counters persist in `rate_limit_hits` table |
| 3 | No HTTPS redirect | `trust proxy` + `x-forwarded-proto` redirect in `server.js`; HSTS header added via Helmet |
| 4 | No email verification | `email_verify_tokens` table + `verifyEmail` / `resendVerification` controller functions; works without SMTP in dev |
| 5 | `cleanup_expired_tokens()` never scheduled | `setInterval` in `server.js` calls `cleanup_expired_rows()` every hour; clears revoked tokens, rate-limit hits, and expired verify tokens |

---

## Health Alert Thresholds

| Metric | Alert Condition |
|--------|----------------|
| Heart Rate | > 100 bpm or < 50 bpm |
| Systolic BP | > 140 mmHg |
| Diastolic BP | > 90 mmHg |
| Blood Sugar | > 140 mg/dL |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, CSS3, Vanilla JS |
| Backend | Node.js + Express.js |
| Database | PostgreSQL |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| DB Driver | node-postgres (pg) |
| Email (optional) | nodemailer (optional dep — console fallback in dev) |
