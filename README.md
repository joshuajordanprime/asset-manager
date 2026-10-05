# IT Asset Manager

Joshua Jordan 12 - 5 - 2026

A full-stack web app for tracking IT equipment: what you own, who has it, what condition it's in, and when warranties run out.

## Features

- Signup and login (bcrypt password hashing + JWT); each account manages its own inventory
- Add, edit, and delete assets (laptops, desktops, phones, monitors, network gear, software licenses)
- Status tracking: In Use, In Storage, In Repair, Retired
- Assignment tracking with an automatic change history (who had it, status changes)
- Search by name, serial number, or person; filter by status and category
- Warranty alerts: assets with warranties ending within 60 days or already expired are flagged
- Overview page: active asset count and total value, counts by status and category, expiring warranties
- CSV export

## Stack

Node, Express, SQLite (better-sqlite3), plain JavaScript front end.

## Run it locally

```bash
npm install
JWT_SECRET=pick-a-long-random-string npm start
```

Then open http://localhost:3000.

## Database

- `users(id, email, password_hash)`
- `assets(id, user_id, name, category, serial, assigned_to, status, purchase_date, warranty_expiry, cost, notes)`
- `asset_history(id, asset_id, change, created_at)`

Assets belong to a user and every query is scoped by `user_id`. History rows are written by the server whenever an asset's assignment or status changes, and are removed with the asset (cascading delete).

## API

| Method | Route | Purpose |
|---|---|---|
| POST | /api/signup, /api/login | Returns a JWT |
| GET/POST | /api/assets | List (`?status=`, `?category=`, `?q=`) / create |
| PUT/DELETE | /api/assets/:id | Update / delete |
| GET | /api/assets/:id/history | Assignment and status history |
| GET | /api/stats | Overview numbers and expiring warranties |
| GET | /api/export.csv | CSV download |

## Next steps

- Email alerts when warranties are about to expire
- CSV import for bulk adding assets
- Shared team inventories with technician and viewer roles
- Deploy on Render (set `JWT_SECRET`; the free tier resets the SQLite file on restart)
