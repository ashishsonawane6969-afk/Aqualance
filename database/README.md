# Aqualence Ventures — Database Setup

## Fresh Install (run in this order)

```sql
-- 1. Base schema — creates all tables, indexes, and seed data
SOURCE schema.sql;

-- 2. Salesman module
SOURCE migration_salesman.sql;

-- 3. Geo / GPS lead tracking
SOURCE migration_geo.sql;

-- 4. Taluka area assignment
SOURCE migration_taluka_assignment.sql;
```

`migration_auth_hardening.sql` and `migration_product_images.sql` are **not needed for fresh installs** — their columns are already in `schema.sql`. Run them only to upgrade an existing database.

## Upgrading an Existing Database

```sql
SOURCE migration_auth_hardening.sql;     -- adds failed_attempts, locked_until, must_change_password, taluka columns
SOURCE migration_product_images.sql;     -- adds images column to products
SOURCE migration_salesman.sql;           -- adds shop_leads table
SOURCE migration_geo.sql;                -- adds GPS columns + talukas table
SOURCE migration_taluka_assignment.sql;  -- adds salesman_areas table
```

## Seed Data (after schema.sql)

```bash
npm run seed
```

This re-hashes all passwords with the configured `BCRYPT_ROUNDS` and upserts users. Use it if you need to reset credentials.

## Default Credentials

Default credentials are generated on first startup. Contact your administrator for initial login details.

> **Change all default passwords before any production deployment.**

## Bug History

| Bug | File | Description | Fix |
|-----|------|-------------|-----|
| Critical | `schema.sql` | INSERT users used `$2a$10$92IX...` — a well-known Laravel test hash for the word `"password"`, not for `Admin@123` etc. Caused 100% login failure. | Replaced with correct bcrypt hashes |
| High | `schema.sql` | `users` CREATE TABLE missing `failed_attempts`, `locked_until`, `must_change_password` — added only by ALTER at end of file, causing race condition on login | Moved all columns into CREATE TABLE |
| Medium | `migration_salesman.sql` | `CREATE INDEX` without `IF NOT EXISTS` → `Duplicate key name` error on re-run | Added `IF NOT EXISTS` |
| Medium | `migration_taluka_assignment.sql` | Same `CREATE INDEX` issue | Added `IF NOT EXISTS` |
| Medium | `migration_salesman.sql` | `INSERT IGNORE` with `PLACEHOLDER_RUN_SEED` as password → user stored with invalid hash, can never log in | Removed placeholder insert |
| Low | `schema.sql` | AUTH HARDENING section at bottom duplicated `migration_auth_hardening.sql` | Removed duplicate ALTER |
