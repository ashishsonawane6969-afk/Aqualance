# 📦 Product Selection System — Integration Guide
## Aqualence Ventures · Salesman Lead Form

---

## 🗂 Files Changed / Added

| File | Change |
|------|--------|
| `database/migration_lead_products.sql` | **NEW** — Creates `lead_products` table, adds `grand_total` column |
| `backend/controllers/salesmanController.js` | **UPDATED** — addLead, getLeads, getLead, updateLead handle products |
| `backend/validation/schemas.js` | **UPDATED** — leadCreateSchema now requires `products[]` array |
| `frontend/salesman/dashboard.html` | **UPDATED** — Product selector UI injected into lead modal |
| `frontend/salesman/js/salesman.js` | **UPDATED** — Product state, dropdown, row logic, form submit |
| `frontend/admin/salesmen.html` | **UPDATED** — Lead detail modal now shows products correctly |

---

## 🚀 Step-by-Step Integration Instructions

### Step 1 — Run the Database Migration

```sql
-- Connect to your MySQL instance and run:
SOURCE /path/to/database/migration_lead_products.sql;

-- Or paste and run manually:
USE aqualence_db;

CREATE TABLE IF NOT EXISTS lead_products (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  lead_id     INT            NOT NULL,
  product_id  INT            NOT NULL,
  name        VARCHAR(150)   NOT NULL,
  price       DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
  quantity    INT            NOT NULL DEFAULT 1,
  total       DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
  created_at  TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id)    REFERENCES shop_leads(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)   ON DELETE RESTRICT
);

ALTER TABLE shop_leads
  ADD COLUMN IF NOT EXISTS grand_total DECIMAL(10,2) DEFAULT 0.00
  AFTER sale_status;
```

> ✅ **Safe to run on existing data** — uses `IF NOT EXISTS` / `IF NOT EXISTS` guards.  
> Existing leads get `grand_total = 0.00` which is correct (they had no products).

---

### Step 2 — Replace Backend Files

Copy these two files from the output into your project:

```
backend/controllers/salesmanController.js  →  replace existing
backend/validation/schemas.js              →  replace existing
```

No changes to `routes/salesman.js` or `server.js` are needed.

---

### Step 3 — Replace Frontend Files

```
frontend/salesman/dashboard.html    →  replace existing
frontend/salesman/js/salesman.js    →  replace existing
frontend/admin/salesmen.html        →  replace existing
```

---

### Step 4 — Verify Products API is Working

The product selector fetches from `/api/v1/products`.  
Make sure products exist in your database:

```sql
SELECT id, name, price, unit, is_active FROM products WHERE is_active = 1 LIMIT 10;
```

If no products exist, add some via the Admin → Products panel first.

---

### Step 5 — Restart Backend

```bash
# If using PM2:
pm2 restart aqualence

# If running directly:
node server.js
```

---

## 📡 API Reference

### POST /api/v1/salesman/leads — Create Lead with Products

**Request Body:**
```json
{
  "shop_name":   "Sharma General Store",
  "shop_type":   "Kirana",
  "owner_name":  "Ramesh Sharma",
  "mobile":      "9876543210",
  "village":     "Nimgaon",
  "taluka":      "Sangamner",
  "district":    "Ahmednagar",
  "sale_status": "YES",
  "notes":       "Very interested in soap range",
  "visited_at":  "2024-01-15T10:30:00",
  "products": [
    {
      "product_id": 1,
      "name":       "Aqualence Face Wash",
      "price":      120.00,
      "quantity":   5,
      "total":      600.00
    },
    {
      "product_id": 3,
      "name":       "Aqualence Body Soap",
      "price":      45.00,
      "quantity":   12,
      "total":      540.00
    }
  ]
}
```

**Success Response (201):**
```json
{
  "success": true,
  "id": 42,
  "message": "Lead added successfully"
}
```

**Validation Error (400):**
```json
{
  "success": false,
  "message": "At least one product is required."
}
```

---

### GET /api/v1/salesman/leads — Get Leads (with products attached)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 42,
      "salesman_id": 4,
      "salesman_name": "Arun Kumar",
      "shop_name": "Sharma General Store",
      "owner_name": "Ramesh Sharma",
      "mobile": "9876543210",
      "village": "Nimgaon",
      "taluka": "Sangamner",
      "district": "Ahmednagar",
      "sale_status": "YES",
      "grand_total": 1140.00,
      "notes": "Very interested in soap range",
      "visited_at": "2024-01-15T10:30:00.000Z",
      "products": [
        {
          "id": 101,
          "product_id": 1,
          "name": "Aqualence Face Wash",
          "price": 120.00,
          "quantity": 5,
          "total": 600.00,
          "category": "Face Care"
        },
        {
          "id": 102,
          "product_id": 3,
          "name": "Aqualence Body Soap",
          "price": 45.00,
          "quantity": 12,
          "total": 540.00,
          "category": "Body Care"
        }
      ]
    }
  ],
  "pagination": { "total": 1, "page": 1, "per_page": 100 }
}
```

---

## 🗄 Database Schema

### `lead_products` table
```
id          INT AUTO_INCREMENT PK
lead_id     INT  FK → shop_leads.id  ON DELETE CASCADE
product_id  INT  FK → products.id    ON DELETE RESTRICT
name        VARCHAR(150)   — product name snapshot at time of lead
price       DECIMAL(10,2)  — editable price per unit
quantity    INT            — quantity ≥ 1
total       DECIMAL(10,2)  — price × quantity
created_at  TIMESTAMP
```

### `shop_leads` table (added column)
```
grand_total  DECIMAL(10,2)  DEFAULT 0.00  — sum of all lead_products.total
```

### Design decisions
- **Separate table** (not JSON column) — enables `GROUP BY product_id` reporting, joins, and future analytics.
- **Name snapshot** — product name is stored at lead creation time so historical leads remain accurate even if products are renamed.
- **`ON DELETE CASCADE`** on `lead_id` — deleting a lead automatically removes its products.
- **`ON DELETE RESTRICT`** on `product_id` — prevents deleting a product that's referenced by a lead (data integrity).

---

## 🎯 Frontend Behavior

### Product Dropdown
- Fetches `/api/v1/products` once per modal open (cached after first load)
- Already-selected products are **disabled** in the dropdown (no duplicates)
- Resets on modal close

### Product Row Table
- **Price** — editable input, pre-filled from product catalog price, allows salesman override
- **Quantity** — editable input, starts at 1, min 1
- **Total** — readonly display, auto-recalculated as `price × quantity` on any input change
- **Remove (✕)** — removes the row and re-enables in dropdown

### Grand Total
- Live sum of all product totals, displayed below the table

### Validations (frontend)
- At least 1 product required (blocks submit, scrolls to section, shows error)
- Price must be ≥ 0
- Quantity must be ≥ 1
- All other existing validations (required fields, taluka restriction) unchanged

---

## ⚠️ Notes & Gotchas

1. **Existing leads** — Leads created before this migration have `products = []` and `grand_total = 0`. They display gracefully ("No products recorded for this lead.") in the admin panel.

2. **Validation schema** — `leadCreateSchema` now **requires** the `products` array (min 1 item). Any existing code calling `POST /salesman/leads` without products will get a 422. The salesman app enforces this at the UI layer too.

3. **Photo body parser limit** — The existing 300KB limit in `routes/salesman.js` is unchanged. Products add only a small JSON payload.

4. **Geo leads** — The geo lead form (`geo-lead.html`) is NOT modified. It uses a separate endpoint (`POST /salesman/geo/lead`) and controller. You can add the same product selector to it following the same pattern if needed.

5. **Price override** — Salesmen can edit prices in the lead form (e.g. negotiated price). The `products.price` stored in `lead_products` may differ from `products.price` in the products catalog.

6. **Rollback** — To undo: drop `lead_products`, run `ALTER TABLE shop_leads DROP COLUMN grand_total`, restore the original controller and schema files.
