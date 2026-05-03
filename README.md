LifeHub
Personal Life Management Dashboard
Tasks  •  Expenses  •  Health  •  Reminders  •  Analytics

Overview
LifeHub is a self-hosted, full-stack personal dashboard that consolidates your daily life into one secure, production-ready application. Built with a vanilla JS frontend and a Node.js/Express backend backed by PostgreSQL, it requires no cloud services or external dependencies beyond a single database.

Version
v1.4.0  •  Production-ready  •  No Redis required  •  Zero new dependencies in v1.3.0+

Features

	Feature	Description
🔐	Authentication	JWT + bcrypt + email verification + token revocation
✅	Tasks	Create, update, delete & track status of personal tasks
💰	Expenses	Log and categorize spending with aggregated insights
❤️	Health	Monitor heart rate, blood pressure & blood sugar with alerts
⏰	Reminders	Schedule one-off or recurring reminders
📊	Dashboard	Unified view with aggregated stats across all modules
⚡	Rate Limiting	PostgreSQL-backed store — no Redis needed
🔒	Security	Helmet, HTTP-only cookies, HSTS, CORS, XSS protection

Prerequisites
•	Node.js Node.js v18 or later
•	PostgreSQL PostgreSQL v13 or later
•	npm npm (bundled with Node.js)
•	Email nodemailer (optional — console fallback in dev)

Folder Structure

lifehub/
├── schema.sql                 ← PostgreSQL database schema
├── migrations/
│   └── 0001_baseline.sql
│
├── backend/
│   ├── server.js              ← Express app entry point
│   ├── package.json
│   ├── .env.example           ← Copy to .env and fill in values
│   ├── config/
│   │   ├── db.js              ← PostgreSQL connection pool
│   │   ├── rateLimitStore.js  ← PostgreSQL-backed rate-limit store
│   │   └── mailer.js          ← Email helper (console fallback in dev)
│   ├── middleware/
│   │   ├── auth.js            ← JWT authentication middleware
│   │   └── validateId.js      ← Integer :id param guard
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── tasksController.js
│   │   ├── expensesController.js
│   │   ├── healthController.js
│   │   ├── remindersController.js
│   │   └── dashboardController.js
│   └── routes/
│       ├── auth.js  tasks.js  expenses.js
│       └── health.js  reminders.js  dashboard.js
│
└── frontend/
    ├── index.html
    ├── css/style.css
    ├── js/
    │   ├── app.js  auth.js  dashboard.js
    │   ├── tasks.js  expenses.js
    │   └── health.js  reminders.js
    └── pages/
        ├── login.html  tasks.html  expenses.html
        └── health.html  reminders.html

Setup Instructions
1 — Create the PostgreSQL database
psql -U postgres
CREATE DATABASE lifehub;
\q

2 — Run the schema
psql -U postgres -d lifehub -f schema.sql
# or apply migrations:
psql -U postgres -d lifehub -f migrations/0001_baseline.sql

3 — Configure environment variables
cd backend
cp .env.example .env
# Generate a strong JWT secret:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

4 — Install dependencies
cd backend
npm install
 
# Optional: production email support
npm install nodemailer

5 — Start the server
# Production
npm start
 
# Development (auto-restart on changes)
npm run dev
 
# Server starts at http://localhost:5000

Environment Variables
Copy backend/.env.example to backend/.env and fill in the values below. Variables marked REQUIRED in production will cause the server to refuse startup if missing.

Variable	Example Value	Notes
PORT	5000	Server port
NODE_ENV	development / production	Controls SMTP enforcement, HSTS
JWT_SECRET	<64-byte hex string>	REQUIRED — must not be default placeholder
DATABASE_URL	postgres://user:pass@host:5432/db	Full PostgreSQL connection string
DB_SSL_CA	<path to CA cert>	Optional — needed when DB requires TLS
ALLOWED_ORIGIN	https://yourdomain.com	Comma-separated CORS origins
APP_BASE_URL	https://yourdomain.com	Used in email verification links
SMTP_HOST	smtp.gmail.com	Required in production
SMTP_PORT	587	Required in production
SMTP_USER	you@gmail.com	Required in production
SMTP_PASS	<app password>	Required in production
SMTP_FROM	LifeHub <you@gmail.com>	Display name in outbound emails
LOG_LEVEL	info	Pino log level: trace/debug/info/warn/error

API Reference
All endpoints are prefixed with /api. Protected routes require a valid JWT sent as an HTTP-only cookie.

Method	Endpoint	Description
POST	/api/auth/register	Register new account; sends verification email
GET	/api/auth/verify-email?token=<hex>	Activate account via email link
POST	/api/auth/resend-verification	Resend verification email
POST	/api/auth/login	Authenticate; sets HTTP-only JWT cookie
POST	/api/auth/logout	Revoke token & clear cookie
GET	/api/tasks	List all tasks for authenticated user
POST	/api/tasks	Create a new task
PUT	/api/tasks/:id	Update a task
DELETE	/api/tasks/:id	Delete a task
GET	/api/expenses	List expenses
POST	/api/expenses	Log an expense
GET	/api/health	List health records
POST	/api/health	Add a health record (triggers alerts if needed)
GET	/api/reminders	List reminders
POST	/api/reminders	Create a reminder
GET	/api/dashboard	Aggregated stats across all modules

Email Verification Flow

1.	User registers → a verification token is created in email_verify_tokens (24-hour expiry).
2.	Dev mode (no SMTP): token is printed to the server console and returned as devVerifyToken in the registration response.
3.	Production (SMTP configured): a verification link is sent to the user's email.
4.	User clicks the link → GET /api/auth/verify-email?token=<hex> → account marked verified = TRUE.
5.	User can now log in — unverified accounts receive 403 EMAIL_NOT_VERIFIED.
6.	The login page shows a "Resend verification email" button on this error.

Gmail Setup
Go to Google Account → Security → 2-Step Verification → App Passwords → generate one for 'Mail'. Use this as SMTP_PASS — never your real Gmail password.

Security

•	JWT stored in HTTP-only cookies — prevents XSS token theft
•	Token revocation on logout — invalidated tokens are rejected
•	Helmet — sets secure HTTP headers (X-Frame-Options, CSP, etc.)
•	HSTS — enforces HTTPS in production via Strict-Transport-Security
•	Rate limiting — backed by PostgreSQL, survives server restarts
•	Zod validation — all incoming request bodies are schema-validated
•	Email verification — accounts cannot log in until verified

Production Fixes (v1.3.0)
All five pre-production issues resolved with zero new required dependencies.

#	Issue	Fix
1	JWT in localStorage (XSS risk)	Moved to HTTP-only cookie via credentials: 'include'
2	In-memory rate limiter (resets on restart)	PgRateLimitStore — counters persist in rate_limit_hits table
3	No HTTPS redirect	trust proxy + x-forwarded-proto redirect; HSTS via Helmet
4	No email verification	email_verify_tokens table; works without SMTP in dev (console fallback)
5	cleanup_expired_tokens() never scheduled	setInterval in server.js runs cleanup_expired_rows() every hour

Health Alert Thresholds
The health module triggers an alert in the dashboard when any logged metric exceeds these thresholds:

Metric	Alert Condition
Heart Rate	> 100 bpm or < 50 bpm
Systolic BP	> 140 mmHg
Diastolic BP	> 90 mmHg
Blood Sugar	> 140 mg/dL

Tech Stack

Layer	Technology
Frontend	HTML5, CSS3, Vanilla JavaScript
Backend	Node.js + Express.js
Database	PostgreSQL v13+
Authentication	JWT (jsonwebtoken) + bcryptjs
DB Driver	node-postgres (pg)
Email (optional)	nodemailer — console fallback in dev
Security	Helmet, cors, express-rate-limit, cookie-parser
Logging	Pino
Validation	Zod

Future Improvements
•	Password change endpoint for logged-in users
•	Advanced analytics dashboard with charts and trends
•	Mobile-responsive UI overhaul
•	Notification system (email / SMS) for reminders and health alerts
•	Data export (CSV / PDF) for expenses and health records
•	Two-factor authentication (TOTP)
•	Docker Compose file for one-command local setup

LifeHub  •  Personal Life Management Dashboard  •  v1.4.0
