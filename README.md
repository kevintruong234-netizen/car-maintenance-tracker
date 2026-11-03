# GarageLog — Multi-Vehicle Maintenance & Service Tracker

A full-stack & offline-capable web application for tracking multiple cars, scheduling recurring maintenance tasks (by mileage and/or time intervals), marking tasks complete at a specific date and odometer reading, attaching notes and photos, and browsing your full vehicle service history.

## Features

- **Multi-Car Fleet Garage**:
  - Add, edit, and switch between multiple vehicles (`Year`, `Make`, `Model`, `Nickname`, `Current Odometer Mileage`, `VIN`, `License Plate`, `Accent Color`, and `Fluid/Spec Notes`).
  - Quick odometer update widget for any selected car, plus an **All Garage Vehicles** unified view.
- **Recurring Maintenance Schedules**:
  - Create custom recurring tasks or auto-populate from 9 built-in automotive service presets (Oil & Filter, Tire Rotation, Cabin/Engine Air Filters, Brake Fluid Flush, Coolant, Spark Plugs, Transmission/Diff Fluid, 12V Battery).
  - Track intervals by **Mileage** (e.g., every 5,000 miles), **Time** (e.g., every 6 months), or **Both** ("whichever comes first").
  - Automatic calculation of **Next Mileage Due**, **Next Date Due**, visual progress bars, and urgency badges (**Overdue**, **Due Soon**, **On Track**).
- **Mark Complete with Date, Mileage, Notes & Photos**:
  - Click **✓ Mark Complete** on any recurring task (or **Log Completed Service** for one-off maintenance) to record the exact **Completion Date**, **Odometer Mileage at Service**, **Cost**, **Shop / Performed By**, **Service Notes**, and **Multiple Photos**.
  - Completing a task automatically logs the entry to **Car Maintenance History**, advances the recurring schedule's next due date and mileage, and updates the car's current odometer reading if higher.
  - Upload photos (`JPEG`, `PNG`, `WebP`, `SVG`) with client-side resize/compression, or click **+ Generate Sample Receipt Photo** to attach a structured inspection/receipt image immediately.
- **Interactive Car Maintenance History**:
  - Searchable, filterable service log (filter by Vehicle, Category, Keyword, or "With Photos Only").
  - Click any photo thumbnail to inspect it in the full-size modal lightbox (`#photo-dialog`), or click **Edit / +Photo** on any historical entry to append notes or photos.
  - One-click **Export JSON** backup.

## Getting Started

### Option 1: Run with the Node.js + SQLite Server (Recommended)

Requires Node.js `v22.5+` (uses built-in `node:sqlite` with zero external `npm install` dependencies required):

```bash
cd C:\Users\kevin\.gemini\antigravity\scratch\car-maintenance-tracker
npm start
```

Then open `http://localhost:3000` in your browser. Data is stored in `data/garage.db`.

### Option 2: Open Directly in Browser

You can also open `public/index.html` directly in any modern browser. When the backend API is not running, the app automatically falls back to `localStorage` persistence pre-loaded with demo vehicles, recurring schedules, and photo-annotated history logs.

## Running Tests

```bash
npm test
```
