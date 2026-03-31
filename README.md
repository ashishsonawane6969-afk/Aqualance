# Aqualence Ventures — iKrish Wellness Distribution System

A full-stack ordering & delivery management platform for Aqualence Ventures, Sangamner.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MySQL 8.0+

### Setup

```bash
# 1. Clone / extract the project
cd backend

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your database credentials and a STRONG JWT_SECRET

# 4. Create the database
mysql -u root -p < ../database/schema.sql
mysql -u root -p aqualence_db < ../database/migration_salesman.sql

# 5. Seed demo users
npm run seed

# 6. Start the server
npm start        # production
npm run dev      # development (with nodemon)
```

Server runs on **http://localhost:5000**

---

## 👤 Default Login Credentials

| Role     | URL                            | Phone      | Password     |
|----------|-------------------------------|------------|--------------|
| Admin    | /admin/login.html              | 9000000001 | Admin@123    |
| Delivery | /delivery/login.html           | 9000000002 | Delivery@123 |
| Salesman | /salesman/login.html           | 9000000004 | Sales@123    |
| Customer | / (no login required)          | —          | —            |

> ⚠️ **Change all default passwords and the JWT_SECRET before going to production!**

---

## 🐛 Bugs Fixed in this Version

### Critical Security Fixes
1. **Delivery boy order isolation** — A delivery boy could previously access any other delivery boy's orders by changing the URL param. Now enforced server-side.
2. **Trusted server-side pricing** — Order prices are now fetched from the database, not accepted from the client. Prevents price manipulation.
3. **Stock validation** — Orders now check for sufficient stock before placement. Prevents overselling.

### Backend Fixes
4. **`updateStatus` missing validation** — `order_id` is now required and validated; delivery boys can only update their own orders.
5. **`productController.update` validation** — Name and price are now validated on update.
6. **`addDeliveryBoy` / `addSalesman` validation** — Phone format (10 digits) and password length (≥6) now validated.
7. **Duplicate `require('dotenv').config()`** — Removed redundant call from `db.js`.
8. **CORS restriction** — Configurable allowed origins; permissive only in development.
9. **Auth rate limiting** — 20 attempts per 15 minutes per IP on `/api/auth/*`.
10. **JWT_SECRET validation** — Exits with error if default secret is used in production.

### Frontend Fixes
11. **Stray `query` file** — Removed leftover MySQL80 file from project root.
12. **Duplicate JS files** — Consolidated `frontend/js/delivery.js`, `frontend/js/salesman.js`, `frontend/js/admin.js` (were identical copies). Single canonical files now used.
13. **Admin sidebar navigation** — `overview.html` and `leaderboard.html` were missing the "Salesmen" nav link. `salesmen.html` was missing "Overview" and "Leaderboard" links.
14. **XSS protection in checkout** — Product names in review are now HTML-escaped. Order submit sends only IDs+quantities (not client prices).
15. **Geolocation timeout** — Added 10-second timeout to prevent indefinitely spinning button.
16. **Pincode validation** — Added 6-digit validation in checkout form.

---

## 📁 Project Structure

```
aqualence-app/
├── backend/
│   ├── config/db.js              # MySQL connection pool
│   ├── controllers/              # Business logic
│   ├── middleware/auth.js        # JWT auth + role guard
│   ├── routes/                   # Express routes
│   ├── scripts/seed.js           # DB seeder
│   ├── server.js                 # Entry point
│   ├── .env                      # Your config (git-ignored)
│   └── .env.example              # Config template
├── database/
│   ├── schema.sql                # Full DB schema + seed data
│   └── migration_salesman.sql    # Salesman module migration
└── frontend/
    ├── index.html                # Customer product catalog
    ├── cart.html / checkout.html / order-success.html
    ├── admin/                    # Admin portal
    ├── delivery/                 # Delivery partner app
    └── salesman/                 # Field salesman app
```

---

## 🔐 Production Checklist

- [ ] Change `JWT_SECRET` to a random 64-char string
- [ ] Set `NODE_ENV=production`
- [ ] Set `ALLOWED_ORIGINS` to your domain
- [ ] Change all default user passwords
- [ ] Use HTTPS (via reverse proxy like Nginx)
- [ ] Enable MySQL SSL
