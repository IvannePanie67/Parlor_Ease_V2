# ParlorEase — Salon Dashboard Application (CRUD)

A salon management dashboard with full **CRUD** for customers, services, staff, appointments, transactions and the service queue.

| Layer | Technology |
|-------|-----------|
| Backend | **Express.js** (REST API, `server/server.js`) |
| Database | **SQLite** (`data/parlorease.db`, created and seeded automatically) |
| Frontend | HTML / CSS / vanilla JavaScript dashboard (`public/`) |
| Auth | Email + password (scrypt-hashed), signed session tokens, 3 roles |

## Run it

```bash
npm install
npm start
```

Open **http://localhost:3000**. The database file and 20 sample services are created on first start. Requires Node.js 18+ (SQLite uses `better-sqlite3`, or Node's built-in `node:sqlite` on Node 22.5+ if it can't be installed).

Run the API tests: `npm test`

## Demo accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@parlorease.com | Admin@123 |
| Staff | staff@parlorease.com | Staff@123 |
| Customer | customer@parlorease.com | Customer@123 |

Customers can also register a new account from the Customer login tab.

## CRUD features (Admin dashboard)

| Module | Create | Read | Update | Delete |
|--------|:-----:|:----:|:------:|:------:|
| Customers | ✔ | ✔ search/sort | ✔ | ✔ |
| Services | ✔ | ✔ | ✔ | ✔ |
| Staff (optional login account) | ✔ | ✔ | ✔ | ✔ |
| Appointments (calendar + list, approve/reject) | ✔ | ✔ | ✔ | ✔ |
| Transactions (printable receipts) | ✔ | ✔ | ✔ | ✔ |
| Service queue (priority + serve next) | ✔ | ✔ | ✔ | ✔ |

Role rules: **Admin** manages everything; **Staff** sees their own schedule and marks appointments completed; **Customers** browse services, request bookings (admin approves) and cancel their own.

Validation: required fields, valid email/date/time, no negative prices, no past dates, no double-booking a staff member, unique emails, and foreign-key protection (e.g. a service in use can't be deleted).

## REST API

All routes except `/api/auth/*` need `Authorization: Bearer <token>`.

```
POST   /api/auth/register | /api/auth/login      GET /api/auth/me
GET    /api/bootstrap                             (everything the role may see)
GET/POST          /api/customers      PUT/DELETE /api/customers/:id
GET/POST          /api/services       PUT/DELETE /api/services/:id
GET/POST          /api/staff          PUT/DELETE /api/staff/:id
GET/POST          /api/appointments   PUT/DELETE /api/appointments/:id
PATCH             /api/appointments/:id/status
GET/POST          /api/transactions   PUT/DELETE /api/transactions/:id
GET/POST          /api/queue          PUT/DELETE /api/queue/:id
PATCH             /api/queue/:id/serve
```

## Data structures & algorithms

Hand-written in `public/dsa.js` (queue, min-heap, stack, hash map, BST; merge/insertion sort, binary/linear search). See `DSA-DOCUMENTATION.md`.

## Project structure

```
server/server.js   Express app + REST routes
server/db.js       SQLite schema, constraints, seed data
public/            Frontend (index.html, app.js, dsa.js, styles.css)
test/api.test.js   API smoke tests
data/              SQLite database (git-ignored)
legacy-supabase/   Earlier Supabase version (kept for reference only)
```
