# Smart Parking Management System - Requirement Traceability Matrix

| Requirement ID | Requirement summary | Implementation | UI / page / component | Backend / API | Data model | Verification approach |
|---|---|---|---|---|---|---|
| FR1 | User registration and login | Express session-based authentication with user creation and password hashing | Login and registration pages | `/login`, `/register`, `/api/reservations`, `/api/payments` | `users` table | Validate registration flow and login redirect |
| FR2 | Role-based access for user, admin, system admin | Session role checks and guarded routes | User dashboard, admin dashboard, system dashboard | `requireRole`, `requireAnyRole` guards | `users.role` | Check restricted routes return 403 |
| FR3 | Parking area discovery | Parking area list with search and details | Find Parking, Parking Area Details pages | `/find-parking`, `/parking/:areaId`, `/api/areas` | `parking_areas` | Confirm area listings render and API returns JSON |
| FR4 | Slot availability review | Display slot status and capacity | Parking slot selection page | `/reserve`, `/parking/:areaId` | `parking_slots` | Validate slot availability and status badges |
| FR5 | Reservation creation and fee calculation | Reservation creation with duration-based pricing | Reservation confirmation page | `/api/reservations` | `reservations` | Confirm fee calculation and reservation code generation |
| FR6 | Payment processing | Payment confirmation and payment record creation | Payment page | `/api/payments` | `payments` | Confirm payment status updates and transaction reference |
| FR7 | Notification handling | Notification storage and unread/read tracking | Notifications page | `notifications` inserts on key actions | `notifications` | Review unread counters and notification history |
| FR8 | Reservation management | Reservation history views and status tracking | My Reservations | `/reservations` | `reservations` | Check user reservation list and status badges |
| FR9 | Admin parking area management | CRUD operations for areas and slots | Admin area management and slot management pages | `/api/admin/areas`, `/admin/areas`, `/admin/slots` | `parking_areas`, `parking_slots` | Validate area creation and slot count generation |
| FR10 | Admin occupancy monitoring | Total, available, and occupied counts | Occupancy monitoring page | `/admin/occupancy` | `parking_slots` | Check aggregated occupancy summary |
| FR11 | Admin reservation operations | View reservation records | Reservation management page | `/admin/reservations` | `reservations` | Confirm all site reservations are accessible |
| FR12 | Admin payment overview | Payment records and transaction visibility | Payment information page | `/admin/payments` | `payments` | Confirm payment totals and references |
| FR13 | Report generation | Reporting summary for parking performance | Reports page | `/admin/reports` | `parking_areas`, `payments` | Validate report view outputs |
| FR14 | System administration | User and admin management plus configuration | System dashboard, user management, admin management, system config | `/system/*` | `users`, `system_settings` | Check protected system access and configuration page |
| FR15 | Public landing page | Landing page and front-end marketing content | `/` | Static page render | N/A | Validate landing page loads |
| FR16 | Access control and error handling | Permission enforcement and 404 responses | Access denied and not found pages | Route guards and fallback routes | N/A | Confirm unauthorized requests are redirected or denied |
| NFR1 | Responsive design | Responsive CSS layout | All pages | N/A | N/A | Review mobile breakpoints |
| NFR2 | Secure authentication | SHA-256 hashed password storage and session security | Login and registration flows | `hashPassword` and `express-session` | `users.password_hash` | Inspect implementation and credential handling |
| NFR3 | Data integrity | Referential integrity and unique constraints | N/A | SQL schema constraints | `users`, `parking_areas`, `parking_slots`, `reservations` | Validate schema constraints and data uniqueness |
| NFR4 | Performance and scalability | Structured SQLite schema, filtered queries, and lightweight server-side render | Dashboard and search | SQL queries with ordering and limiting | Indexed tables via natural keys | Test under a small realistic dataset |
| NFR5 | Maintainability | Modular Express routes and clear database setup | Structured app layout | `initializeDatabase` and route groups | SQLite persistence | Review code readability and structure |
| NFR6 | Reliability | Database initialization with seed data and graceful fallback | System start-up | `initializeDatabase()` and startup checks | `database/spms.db` | Launch server and validate startup |

This matrix maps the core SRS objectives into the current implementation and identifies the relevant verification steps. When a detailed SRS item is expanded in the full requirements document, this traceability matrix should be revisited to preserve requirement ID continuity and implementation coverage.
