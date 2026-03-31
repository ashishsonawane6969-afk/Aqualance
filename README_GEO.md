# Aqualence Ventures — Geo-Verified Lead Capture System

## What's New in This Update

| Module | Description |
|--------|-------------|
| 📍 Taluka Geofencing | GPS boundary check using Haversine formula — blocks leads from outside assigned area |
| 📷 GPS Photo Capture | Camera + canvas watermark stamping lat/lng/address/time on every photo |
| 🗺️ Admin Map Dashboard | Leaflet map showing all geo-leads, live salesman positions, taluka zones |
| 🔴 Live Tracking | Salesman app pings GPS every 2 minutes; admin sees live positions |
| 🔒 Dual Validation | Both frontend and backend independently validate GPS location |
| 🌐 Reverse Geocoding | Free Nominatim (OpenStreetMap) — no API key needed |

---

## New Files Added

```
backend/
  controllers/geoController.js   ← All geo logic (Haversine, geofencing, tracking)
  routes/geo.js                  ← API endpoints

frontend/
  salesman/geo-lead.html         ← Geo Lead Capture page (camera + GPS + form)
  admin/geo-map.html             ← Admin Map Dashboard

database/
  migration_geo.sql              ← Run this to add new tables/columns
```

---

## Database Migration

Run **after** your existing schema:

```sql
-- Option 1: Run the migration file
mysql -u root -p aqualence_db < database/migration_geo.sql

-- Option 2: Tables are auto-created on server start (ensureGeoTables())
-- No action needed — just start the server
```

### New Tables Created Automatically

```sql
-- Taluka master (center coordinates + radius)
talukas (id, name, district, state, center_lat, center_lng, radius_km)

-- Live GPS pings (every 2 min from salesman app)
salesman_tracking (id, salesman_id, latitude, longitude, accuracy, recorded_at)

-- New columns added to shop_leads
latitude, longitude, gps_accuracy, address_geo, geo_verified, distance_km

-- New columns added to users
taluka_id, taluka_name
```

---

## API Endpoints

### Salesman Endpoints
| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/geo/talukas` | List all active talukas |
| GET | `/api/geo/my-taluka` | Get salesman's assigned taluka |
| POST | `/api/geo/validate` | Validate GPS against assigned taluka |
| POST | `/api/geo/leads` | Submit geo-verified lead |
| POST | `/api/geo/track` | Ping live GPS location |

### Admin Endpoints
| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/geo/map-leads` | All leads with coordinates |
| GET | `/api/geo/live-positions` | Latest GPS ping per salesman |
| GET | `/api/geo/talukas` | List all talukas |
| POST | `/api/geo/talukas` | Create taluka |
| PUT | `/api/geo/talukas/:id` | Update taluka |
| POST | `/api/geo/assign/:id` | Assign taluka to salesman |

---

## How Geofencing Works

```
Salesman opens geo-lead.html
        ↓
Browser Geolocation API → GPS coordinates
        ↓
Haversine formula: distance = great-circle distance to taluka center
        ↓
distance > radius_km? → BLOCKED (red overlay shown, cannot submit)
distance ≤ radius_km? → ALLOWED (green GPS bar, proceed to form)
        ↓
Photo captured → Canvas overlay stamps GPS + address + time
        ↓
Frontend sends POST /api/geo/leads
        ↓
Backend INDEPENDENTLY recalculates Haversine (cannot be bypassed)
        ↓
Backend blocked? → 403 + distance info
Backend ok? → Lead saved with geo_verified=1
```

### Haversine Formula (both client + server)
```javascript
function haversine(lat1, lng1, lat2, lng2) {
  const R  = 6371; // Earth radius km
  const dL = (lat2 - lat1) * Math.PI / 180;
  const dN = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(dL/2) ** 2 +
             Math.cos(lat1 * Math.PI / 180) *
             Math.cos(lat2 * Math.PI / 180) *
             Math.sin(dN/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

---

## Assigning a Taluka to a Salesman (Admin)

**Method 1 — Admin Geo Map page:**
1. Open `admin/geo-map.html`
2. Click **🗺️ Talukas** tab
3. Under "Assign Taluka to Salesman", select salesman + taluka → click **Assign**

**Method 2 — Direct API call:**
```bash
POST /api/geo/assign/4
Body: { "taluka_id": 1 }
# Assigns Sangamner taluka to salesman with id=4
```

**Method 3 — SQL:**
```sql
UPDATE users SET taluka_id = 1, taluka_name = 'Sangamner'
WHERE id = 4 AND role = 'salesman';
```

---

## Camera + Canvas Watermark

The photo watermark is drawn using HTML Canvas before upload:

```
┌─────────────────────────────────────┐
│                                     │ ┌──────┐
│         [SHOP PHOTO]                │ │ GPS  │
│                                     │ └──────┘
│                                     │
│ ┌─────────────────────────────────┐ │
│ │📍 19.640408, 74.488821 ±12m     │ │
│ │Pimpari Nirmal, Ahmednagar...    │ │
│ │🕐 09 Mar 2026, 04:56 PM         │ │
│ │👤 Ajay Kumar  |  Aqualence      │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

- Stored as base64 JPEG in `shop_leads.photo_proof`
- Body limit increased to **10MB** to accommodate photos

---

## Live Salesman Tracking

Salesman app (`geo-lead.html`) calls `POST /api/geo/track` every **2 minutes** while the page is open.

Admin map dashboard (`geo-map.html`) shows:
- 🔵 **Blue pulsing dot** = online (pinged in last 5 minutes)
- ⚫ **Grey dot** = offline (last seen X minutes/hours ago)
- Auto-refreshes every **60 seconds**

Data stored in `salesman_tracking` table. Old rows accumulate — you may want to add a cleanup job:
```sql
-- Run weekly to clean up old tracking data
DELETE FROM salesman_tracking WHERE recorded_at < NOW() - INTERVAL 30 DAY;
```

---

## Environment Variables

No new required env vars. The system uses:
- **Leaflet + OpenStreetMap** for maps — **free, no API key**
- **Nominatim** for reverse geocoding — **free, no API key**

Optional (only if you already have it):
```env
GOOGLE_MAPS_API_KEY=   # Not used — removed in favour of free alternatives
```

---

## Salesman App Flow

1. Login → `salesman/login.html`
2. Dashboard → `salesman/dashboard.html`
3. Click **📍 Geo Lead** in bottom nav → `salesman/geo-lead.html`
4. GPS acquires → green bar shows "Inside Sangamner — 3.2km from center"
5. Tap **Open Camera** → point at shop → tap **Capture**
6. Fill form (taluka/district auto-filled from assignment)
7. Tap **Submit Lead** → dual validation → saved

---

## Admin Map Dashboard

Navigate to `admin/geo-map.html` (also accessible from sidebar **Geo Map**).

**Three tabs:**
- **📍 Leads** — Filter by salesman, date range. Click a lead in the list or on the map to see the detail panel with photo.
- **🟢 Live** — Current GPS positions of all salesmen. Auto-refreshes every 60 seconds.
- **🗺️ Talukas** — Add new talukas, assign to salesmen, view all zone circles on map.

**Map layer toggles (top-right of map):**
- 📍 Leads — green/red dots per lead (green = sale made)
- 🟢 Live — blue pulsing dots for salesmen
- 🗺️ Zones — dashed circle overlays for each taluka radius

---

## Default Talukas (auto-seeded)

| Taluka | District | Center | Radius |
|--------|----------|--------|--------|
| Sangamner | Ahmednagar | 19.5741, 74.2103 | 25 km |
| Rahuri | Ahmednagar | 19.3917, 74.6497 | 20 km |
| Shrirampur | Ahmednagar | 19.6225, 74.6514 | 22 km |
| Kopargaon | Ahmednagar | 19.8935, 74.4780 | 22 km |
| Nevasa | Ahmednagar | 19.5594, 74.9855 | 20 km |
| Rahata | Ahmednagar | 19.7160, 74.4760 | 25 km |
| Ahmednagar | Ahmednagar | 19.0948, 74.7480 | 28 km |
| Parner | Ahmednagar | 19.0015, 74.4359 | 22 km |
| Pathardi | Ahmednagar | 18.8624, 75.1914 | 20 km |
| Akole | Ahmednagar | 19.5200, 74.0200 | 25 km |
