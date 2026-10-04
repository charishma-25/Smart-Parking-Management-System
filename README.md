# Smart Parking Management System

A full-stack parking management web application built as a software engineering case study. The application includes a public landing page, user reservation workflow, parking administrator dashboard, and system administrator dashboard.

## Features

- Secure login and registration
- Role-based access for parking users, parking administrators, and system administrators
- Parking area and slot discovery
- Reservation and payment workflows
- Notifications and personal reservation history
- Administrative monitoring for occupancy, reservations, and payments
- SQLite-backed persistence for easy local deployment

## Seeded accounts

- User: user@smartparking.com / password123
- Administrator: admin@smartparking.com / password123
- System administrator: system@smartparking.com / password123

## Run locally

1. Install dependencies:
   npm install
2. Start the application:
   npm start
3. Open http://localhost:3000

## Project files

- app.js: Express server and route logic
- database/spms.db: SQLite database created on startup
- views/: EJS templates for the application pages
- public/styles.css: shared front-end styling
- docs/requirements-traceability-matrix.md: requirement mapping summary
