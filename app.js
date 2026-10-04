const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const dbDir = path.join(__dirname, 'database');
const dbPath = path.join(dbDir, 'spms.db');

fs.mkdirSync(dbDir, { recursive: true });
const db = new sqlite3.Database(dbPath);

const ROLE_LABELS = {
  user: 'Parking User',
  admin: 'Parking Administrator',
  system_admin: 'System Administrator',
};

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function toMoney(value) {
  const amount = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
  return `\u20B9${amount}`;
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) {
        reject(error);
        return;
      }
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows || []);
    });
  });
}

async function seedDatabase() {
  const userCount = await get('SELECT COUNT(*) AS total FROM users');
  if (userCount.total === 0) {
    await run(
      `INSERT INTO users (name, email, phone, password_hash, role, status) VALUES
       ('Alice Johnson', 'user@smartparking.com', '5550101010', ?, 'user', 'active'),
       ('Marcus Reed', 'admin@smartparking.com', '5550102020', ?, 'admin', 'active'),
       ('Priya Nair', 'system@smartparking.com', '5550103030', ?, 'system_admin', 'active')`,
      [
        hashPassword('password123'),
        hashPassword('password123'),
        hashPassword('password123'),
      ]
    );
  }

  const areaCount = await get('SELECT COUNT(*) AS total FROM parking_areas');
  if (areaCount.total === 0) {
    await run(
      `INSERT INTO parking_areas (name, location, address, description, hourly_rate, total_slots) VALUES
       ('City Center Plaza', 'Downtown', '12 Market Street', 'High-demand parking close to offices and retail.', 8, 12),
       ('Riverside Deck', 'North Bank', '28 River Road', 'Covered deck with EV charging and secure access.', 10, 10),
       ('Airport Terminal Park', 'Airport District', '4 Terminal Avenue', 'Ideal for long-term travelers and commuter parking.', 12, 15)`
    );

    const areas = await all('SELECT * FROM parking_areas ORDER BY id');
    const slotValues = [];
    let slotCounter = 1;

    for (const area of areas) {
      for (let i = 1; i <= area.total_slots; i += 1) {
        const status = i % 4 === 0 ? 'occupied' : (i % 3 === 0 ? 'reserved' : 'available');
        slotValues.push(`(${area.id}, '${area.name.substring(0, 2).toUpperCase()}${String(i).padStart(2, '0')}', 'car', '${status}')`);
        slotCounter += 1;
      }
    }

    if (slotValues.length > 0) {
      await run(`INSERT INTO parking_slots (area_id, slot_number, slot_type, status) VALUES ${slotValues.join(', ')}`);
    }
  }

  const reservationCount = await get('SELECT COUNT(*) AS total FROM reservations');
  if (reservationCount.total === 0) {
    const user = await get('SELECT id FROM users WHERE role = ? LIMIT 1', ['user']);
    const area = await get('SELECT id FROM parking_areas ORDER BY id LIMIT 1');
    const slot = await get('SELECT id, slot_number FROM parking_slots WHERE area_id = ? LIMIT 1', [area.id]);

    if (user && area && slot) {
      const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const end = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
      const fee = 24;
      await run(
        `INSERT INTO reservations (user_id, area_id, slot_id, start_time, end_time, duration_hours, fee, currency, status, payment_status, reservation_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', 'confirmed', 'paid', 'SPMS-1001')`,
        [user.id, area.id, slot.id, start, end, 2, fee]
      );

      const reservation = await get('SELECT id FROM reservations WHERE reservation_code = ?', ['SPMS-1001']);
      await run(`INSERT INTO payments (reservation_id, user_id, amount, method, status, transaction_reference) VALUES (?, ?, ?, 'card', 'paid', 'TXN-1001')`, [reservation.id, user.id, fee]);
      await run(`INSERT INTO notifications (user_id, title, message, type, read_status) VALUES (?, 'Reservation confirmed', 'Your booking at City Center Plaza has been confirmed.', 'success', 'unread')`, [user.id]);
    }
  }

  const configCount = await get('SELECT COUNT(*) AS total FROM system_settings');
  if (configCount.total === 0) {
    await run(
      `INSERT INTO system_settings (setting_key, setting_value, description) VALUES
       ('currency', 'INR', 'Default currency used by the parking system'),
       ('cancellation_policy_hours', '2', 'Hours before reservation start for cancellation without penalty'),
       ('parking_max_duration', '12', 'Maximum reservation duration in hours')`
    );
  }
}

async function initializeDatabase() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'admin', 'system_admin')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'suspended')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS parking_areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      address TEXT,
      description TEXT,
      hourly_rate REAL NOT NULL DEFAULT 0,
      total_slots INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS parking_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      area_id INTEGER NOT NULL,
      slot_number TEXT NOT NULL,
      slot_type TEXT NOT NULL CHECK(slot_type IN ('car', 'motorcycle', 'ev')),
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'reserved', 'occupied')),
      FOREIGN KEY (area_id) REFERENCES parking_areas(id) ON DELETE CASCADE,
      UNIQUE(area_id, slot_number)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      area_id INTEGER NOT NULL,
      slot_id INTEGER NOT NULL,
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,
      duration_hours INTEGER NOT NULL,
      fee REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL CHECK(status IN ('pending', 'confirmed', 'cancelled', 'completed')) DEFAULT 'pending',
      payment_status TEXT NOT NULL CHECK(payment_status IN ('pending', 'paid', 'failed')) DEFAULT 'pending',
      reservation_code TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(area_id) REFERENCES parking_areas(id),
      FOREIGN KEY(slot_id) REFERENCES parking_slots(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'paid', 'failed')) DEFAULT 'pending',
      transaction_reference TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(reservation_id) REFERENCES reservations(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info',
      read_status TEXT NOT NULL CHECK(read_status IN ('read', 'unread')) DEFAULT 'unread',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_key TEXT NOT NULL UNIQUE,
      setting_value TEXT NOT NULL,
      description TEXT
    )
  `);

  await seedDatabase();
  // Keep existing installations aligned with the application's INR display.
  await run("UPDATE reservations SET currency = 'INR' WHERE currency = 'USD'");
  await run("UPDATE system_settings SET setting_value = 'INR' WHERE setting_key = 'currency' AND setting_value = 'USD'");
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireRole(allowedRole) {
  return (req, res, next) => {
    const user = req.session.user;
    if (!user || user.role !== allowedRole) {
      return res.status(403).render('access-denied', { title: 'Access denied', user: null });
    }
    next();
  };
}

function requireAnyRole(roles) {
  return (req, res, next) => {
    const user = req.session.user;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).render('access-denied', { title: 'Access denied', user: null });
    }
    next();
  };
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'smart-parking-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 8,
      httpOnly: true,
    },
  })
);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

app.get('/', (req, res) => {
  res.render('index', { user: req.session.user || null, pageTitle: 'Smart Parking Management System' });
});

app.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  res.render('login', { pageTitle: 'Login', user: null, mode: 'user', error: null });
});

app.get('/admin/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  res.render('login', { pageTitle: 'Admin Login', user: null, mode: 'admin', error: null });
});

app.get('/register', (req, res) => {
  res.render('register', { pageTitle: 'Create account', user: null, error: null });
});

app.get('/dashboard', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  if (req.session.user.role === 'admin') {
    return res.redirect('/admin/dashboard');
  }

  if (req.session.user.role === 'system_admin') {
    return res.redirect('/system/dashboard');
  }

  return res.redirect('/user/dashboard');
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.render('login', { pageTitle: 'Login', user: null, mode: 'user', error: 'Email and password are required.' });
  }

  try {
    const user = await get('SELECT * FROM users WHERE email = ? AND password_hash = ?', [email.trim().toLowerCase(), hashPassword(password)]);
    if (!user) {
      return res.render('login', { pageTitle: 'Login', user: null, mode: 'user', error: 'Invalid email or password.' });
    }

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
    };

    if (user.role === 'admin') {
      return res.redirect('/admin/dashboard');
    }

    if (user.role === 'system_admin') {
      return res.redirect('/system/dashboard');
    }

    return res.redirect('/user/dashboard');
  } catch (error) {
    console.error('Login error:', error);
    return res.render('login', { pageTitle: 'Login', user: null, mode: 'user', error: 'Unable to sign in at the moment.' });
  }
});

app.post('/admin/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await get('SELECT * FROM users WHERE email = ? AND password_hash = ? AND role = ?', [
    email.trim().toLowerCase(),
    hashPassword(password),
    'admin',
  ]);

  if (!user) {
    return res.render('login', { pageTitle: 'Admin Login', user: null, mode: 'admin', error: 'Invalid administrator credentials.' });
  }

  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
  };

  res.redirect('/admin/dashboard');
});

app.post('/register', async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) {
    return res.render('register', { pageTitle: 'Create account', user: null, error: 'Name, email and password are required.' });
  }

  try {
    const existing = await get('SELECT id FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    if (existing) {
      return res.render('register', { pageTitle: 'Create account', user: null, error: 'This email is already registered.' });
    }

    await run(
      'INSERT INTO users (name, email, phone, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)',
      [name.trim(), email.trim().toLowerCase(), phone || '', hashPassword(password), 'user', 'active']
    );

    const createdUser = await get('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);

    if (createdUser) {
      await run(
        'INSERT INTO notifications (user_id, title, message, type, read_status) VALUES (?, ?, ?, ?, ?)',
        [createdUser.id, 'Welcome to Smart Parking', 'Your account has been created. Start finding available parking near you.', 'info', 'unread']
      );
    }

    res.redirect('/login');
  } catch (error) {
    console.error('Registration error:', error);
    res.render('register', { pageTitle: 'Create account', user: null, error: 'Unable to create the account right now.' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.get('/user/dashboard', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'user') {
    return res.status(403).render('access-denied', { title: 'Access denied', user: req.session.user });
  }

  const [areas, reservations, notifications, payments] = await Promise.all([
    all('SELECT * FROM parking_areas ORDER BY name LIMIT 4'),
    all(
      `SELECT r.*, a.name AS area_name, s.slot_number
       FROM reservations r
       JOIN parking_areas a ON a.id = r.area_id
       JOIN parking_slots s ON s.id = r.slot_id
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC LIMIT 5`,
      [req.session.user.id]
    ),
    all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5', [req.session.user.id]),
    all(
      `SELECT p.*, r.reservation_code
       FROM payments p
       JOIN reservations r ON r.id = p.reservation_id
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC LIMIT 5`,
      [req.session.user.id]
    ),
  ]);

  const openSlots = await get('SELECT COUNT(*) AS total FROM parking_slots WHERE status = ?', ['available']);
  const upcomingTotal = reservations.filter((reservation) => reservation.status !== 'cancelled').length;

  res.render('user-dashboard', {
    pageTitle: 'My dashboard',
    user: req.session.user,
    areas,
    reservations,
    notifications,
    payments,
    stats: {
      nearbyAreas: areas.length,
      openSlots: openSlots.total,
      upcomingReservations: upcomingTotal,
      totalSpent: payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    },
    toMoney,
  });
});

app.get('/find-parking', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'user') {
    return res.status(403).render('access-denied', { user: req.session.user, title: 'Access denied' });
  }

  const areas = await all('SELECT * FROM parking_areas ORDER BY location, name');
  res.render('find-parking', { pageTitle: 'Find Parking', user: req.session.user, areas, toMoney });
});

app.get('/parking/:areaId', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'user') {
    return res.status(403).render('access-denied', { user: req.session.user, title: 'Access denied' });
  }

  const area = await get('SELECT * FROM parking_areas WHERE id = ?', [req.params.areaId]);
  if (!area) {
    return res.status(404).render('not-found', { title: 'Parking area not found', user: req.session.user });
  }

  const slots = await all('SELECT * FROM parking_slots WHERE area_id = ? ORDER BY slot_number', [area.id]);
  res.render('parking-area', { pageTitle: area.name, user: req.session.user, area, slots, toMoney });
});

app.get('/reserve', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'user') {
    return res.status(403).render('access-denied', { user: req.session.user, title: 'Access denied' });
  }

  const { areaId, slotId } = req.query;
  const area = await get('SELECT * FROM parking_areas WHERE id = ?', [areaId]);
  const slot = await get('SELECT * FROM parking_slots WHERE id = ? AND area_id = ?', [slotId, areaId]);

  if (!area || !slot) {
    return res.status(404).render('not-found', { title: 'Reservation not available', user: req.session.user });
  }

  res.render('reservation-confirmation', { pageTitle: 'Reservation summary', user: req.session.user, area, slot, toMoney });
});

app.post('/api/reservations', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'user') {
    return res.status(403).json({ success: false, message: 'Access denied for parking users only.' });
  }

  const { areaId, slotId, startTime, endTime } = req.body;
  if (!areaId || !slotId || !startTime || !endTime) {
    return res.status(400).json({ success: false, message: 'Area, slot, start time, and end time are required.' });
  }

  const area = await get('SELECT * FROM parking_areas WHERE id = ?', [areaId]);
  const slot = await get('SELECT * FROM parking_slots WHERE id = ?', [slotId]);
  if (!area || !slot || slot.area_id !== Number(areaId)) {
    return res.status(404).json({ success: false, message: 'Selected area or slot was not found.' });
  }

  if (slot.status === 'occupied' || slot.status === 'reserved') {
    return res.status(409).json({ success: false, message: 'This slot is already unavailable.' });
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  const durationHours = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60)));
  const fee = Number((durationHours * area.hourly_rate).toFixed(2));
  const reservationCode = `SPMS-${Date.now()}`;

  await run(
    `INSERT INTO reservations (user_id, area_id, slot_id, start_time, end_time, duration_hours, fee, currency, status, payment_status, reservation_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', 'confirmed', 'pending', ?)`,
    [req.session.user.id, area.id, slot.id, start.toISOString(), end.toISOString(), durationHours, fee, reservationCode]
  );

  await run('UPDATE parking_slots SET status = ? WHERE id = ?', ['reserved', slot.id]);

  const reservation = await get('SELECT * FROM reservations WHERE reservation_code = ?', [reservationCode]);
  await run(
    'INSERT INTO notifications (user_id, title, message, type, read_status) VALUES (?, ?, ?, ?, ?)',
    [req.session.user.id, 'Reservation created', `Your parking reservation at ${area.name} has been created.`, 'info', 'unread']
  );

  res.json({ success: true, reservation, next: '/payment/' + reservation.id });
});

app.get('/payment/:reservationId', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'user') {
    return res.status(403).render('access-denied', { user: req.session.user, title: 'Access denied' });
  }

  const reservation = await get(
    `SELECT r.*, a.name AS area_name, s.slot_number
     FROM reservations r
     JOIN parking_areas a ON a.id = r.area_id
     JOIN parking_slots s ON s.id = r.slot_id
     WHERE r.id = ? AND r.user_id = ?`,
    [req.params.reservationId, req.session.user.id]
  );

  if (!reservation) {
    return res.status(404).render('not-found', { title: 'Reservation not found', user: req.session.user });
  }

  res.render('payment', { pageTitle: 'Payment', user: req.session.user, reservation, toMoney });
});

app.post('/api/payments', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'user') {
    return res.status(403).json({ success: false, message: 'Only parking users can make payments.' });
  }

  const { reservationId, method } = req.body;
  const reservation = await get('SELECT * FROM reservations WHERE id = ? AND user_id = ?', [reservationId, req.session.user.id]);

  if (!reservation) {
    return res.status(404).json({ success: false, message: 'Reservation was not found.' });
  }

  const transactionReference = `TXN-${Date.now()}`;
  await run(
    'INSERT INTO payments (reservation_id, user_id, amount, method, status, transaction_reference) VALUES (?, ?, ?, ?, ?, ?)',
    [reservation.id, req.session.user.id, reservation.fee, method || 'card', 'paid', transactionReference]
  );

  await run('UPDATE reservations SET payment_status = ?, status = ? WHERE id = ?', ['paid', 'confirmed', reservation.id]);
  await run('UPDATE parking_slots SET status = ? WHERE id = ?', ['occupied', reservation.slot_id]);
  await run(
    'INSERT INTO notifications (user_id, title, message, type, read_status) VALUES (?, ?, ?, ?, ?)',
    [req.session.user.id, 'Payment successful', `Payment for reservation ${reservation.reservation_code} has been completed successfully.`, 'success', 'unread']
  );

  res.json({ success: true, reservationCode: reservation.reservation_code, amount: reservation.fee, redirect: '/reservations' });
});

app.get('/reservations', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'user') {
    return res.status(403).render('access-denied', { user: req.session.user, title: 'Access denied' });
  }

  const reservations = await all(
    `SELECT r.*, a.name AS area_name, s.slot_number
     FROM reservations r
     JOIN parking_areas a ON a.id = r.area_id
     JOIN parking_slots s ON s.id = r.slot_id
     WHERE r.user_id = ?
     ORDER BY r.created_at DESC`,
    [req.session.user.id]
  );

  res.render('reservations', { pageTitle: 'My reservations', user: req.session.user, reservations, toMoney });
});

app.get('/notifications', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'user') {
    return res.status(403).render('access-denied', { user: req.session.user, title: 'Access denied' });
  }

  const notifications = await all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC', [req.session.user.id]);
  await run('UPDATE notifications SET read_status = ? WHERE user_id = ?', ['read', req.session.user.id]);
  res.render('notifications', { pageTitle: 'Notifications', user: req.session.user, notifications });
});

app.get('/profile', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'user') {
    return res.status(403).render('access-denied', { user: req.session.user, title: 'Access denied' });
  }

  const profile = await get('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
  res.render('profile', { pageTitle: 'My profile', user: req.session.user, profile });
});

app.get('/admin/dashboard', requireRole('admin'), async (req, res) => {
  const [areaTotal, slotTotal, reservationTotal, paymentTotal] = await Promise.all([
    get('SELECT COUNT(*) AS total FROM parking_areas'),
    get('SELECT COUNT(*) AS total FROM parking_slots'),
    get('SELECT COUNT(*) AS total FROM reservations'),
    get('SELECT COALESCE(SUM(amount), 0) AS total FROM payments')
  ]);

  const areas = await all('SELECT * FROM parking_areas ORDER BY name');
  const reservations = await all(
    `SELECT r.*, u.name AS user_name, a.name AS area_name, s.slot_number
     FROM reservations r
     JOIN users u ON u.id = r.user_id
     JOIN parking_areas a ON a.id = r.area_id
     JOIN parking_slots s ON s.id = r.slot_id
     ORDER BY r.created_at DESC LIMIT 8`
  );

  res.render('admin-dashboard', {
    pageTitle: 'Admin dashboard',
    user: req.session.user,
    metrics: {
      areaTotal: areaTotal.total,
      slotTotal: slotTotal.total,
      reservationTotal: reservationTotal.total,
      paymentTotal: Number(paymentTotal.total || 0),
    },
    areas,
    reservations,
    toMoney,
  });
});

app.get('/admin/areas', requireRole('admin'), async (req, res) => {
  const areas = await all('SELECT * FROM parking_areas ORDER BY name');
  res.render('admin-areas', { pageTitle: 'Parking area management', user: req.session.user, areas, toMoney });
});

app.post('/api/admin/areas', requireRole('admin'), async (req, res) => {
  const { name, location, address, description, hourlyRate, totalSlots } = req.body;
  if (!name || !location || !hourlyRate || !totalSlots) {
    return res.status(400).json({ success: false, message: 'Name, location, hourly rate, and total slots are required.' });
  }

  const area = await run(
    'INSERT INTO parking_areas (name, location, address, description, hourly_rate, total_slots) VALUES (?, ?, ?, ?, ?, ?)',
    [name, location, address || '', description || '', Number(hourlyRate), Number(totalSlots)]
  );

  const areaId = area.id;
  const slots = [];
  for (let i = 1; i <= Number(totalSlots); i += 1) {
    slots.push(`(${areaId}, 'A${String(i).padStart(2, '0')}', 'car', 'available')`);
  }

  if (slots.length > 0) {
    await run(`INSERT INTO parking_slots (area_id, slot_number, slot_type, status) VALUES ${slots.join(', ')}`);
  }

  res.json({ success: true, message: 'Parking area created successfully.' });
});

app.get('/api/admin/areas', requireRole('admin'), async (req, res) => {
  const areas = await all('SELECT * FROM parking_areas ORDER BY name');
  res.json(areas);
});

app.delete('/api/admin/areas/:id', requireRole('admin'), async (req, res) => {
  const reservations = await get('SELECT COUNT(*) AS total FROM reservations WHERE area_id = ?', [req.params.id]);
  if (Number(reservations.total) > 0) {
    return res.status(400).json({ success: false, message: 'Cannot delete an area with active reservation history.' });
  }

  await run('DELETE FROM parking_slots WHERE area_id = ?', [req.params.id]);
  await run('DELETE FROM parking_areas WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Parking area removed successfully.' });
});

app.get('/api/admin/slots', requireRole('admin'), async (req, res) => {
  const slots = await all(
    `SELECT s.*, a.name AS area_name
     FROM parking_slots s
     JOIN parking_areas a ON a.id = s.area_id
     ORDER BY a.name, s.slot_number`
  );
  res.json(slots);
});

app.post('/api/admin/slots', requireRole('admin'), async (req, res) => {
  const { areaId, slotNumber, slotType, status } = req.body;
  if (!areaId || !slotNumber || !slotType) {
    return res.status(400).json({ success: false, message: 'Area, slot number, and slot type are required.' });
  }

  await run(
    'INSERT INTO parking_slots (area_id, slot_number, slot_type, status) VALUES (?, ?, ?, ?)',
    [areaId, slotNumber, slotType, status || 'available']
  );

  res.json({ success: true, message: 'Parking slot added successfully.' });
});

app.put('/api/admin/slots/:id', requireRole('admin'), async (req, res) => {
  const { slotNumber, slotType, status } = req.body;
  const slot = await get('SELECT * FROM parking_slots WHERE id = ?', [req.params.id]);
  if (!slot) {
    return res.status(404).json({ success: false, message: 'Parking slot was not found.' });
  }

  await run(
    'UPDATE parking_slots SET slot_number = ?, slot_type = ?, status = ? WHERE id = ?',
    [slotNumber || slot.slot_number, slotType || slot.slot_type, status || slot.status, req.params.id]
  );

  res.json({ success: true, message: 'Parking slot updated successfully.' });
});

app.delete('/api/admin/slots/:id', requireRole('admin'), async (req, res) => {
  const reservation = await get('SELECT COUNT(*) AS total FROM reservations WHERE slot_id = ?', [req.params.id]);
  if (Number(reservation.total) > 0) {
    return res.status(400).json({ success: false, message: 'Cannot delete a slot with reservation history.' });
  }

  await run('DELETE FROM parking_slots WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Parking slot removed successfully.' });
});

app.get('/admin/slots', requireRole('admin'), async (req, res) => {
  const slots = await all(
    `SELECT s.*, a.name AS area_name
     FROM parking_slots s
     JOIN parking_areas a ON a.id = s.area_id
     ORDER BY a.name, s.slot_number`
  );
  const areas = await all('SELECT id, name FROM parking_areas ORDER BY name');

  res.render('admin-slots', { pageTitle: 'Parking slot management', user: req.session.user, slots, areas });
});

app.get('/admin/occupancy', requireRole('admin'), async (req, res) => {
  const areas = await all('SELECT * FROM parking_areas ORDER BY name');
  const occupancy = [];
  for (const area of areas) {
    const total = await get('SELECT COUNT(*) AS total FROM parking_slots WHERE area_id = ?', [area.id]);
    const available = await get('SELECT COUNT(*) AS total FROM parking_slots WHERE area_id = ? AND status = ?', [area.id, 'available']);
    const occupied = await get('SELECT COUNT(*) AS total FROM parking_slots WHERE area_id = ? AND status = ?', [area.id, 'occupied']);
    occupancy.push({ ...area, total: total.total, available: available.total, occupied: occupied.total });
  }
  res.render('admin-occupancy', { pageTitle: 'Occupancy monitoring', user: req.session.user, occupancy });
});

app.get('/admin/reservations', requireRole('admin'), async (req, res) => {
  const reservations = await all(
    `SELECT r.*, u.name AS user_name, a.name AS area_name, s.slot_number
     FROM reservations r
     JOIN users u ON u.id = r.user_id
     JOIN parking_areas a ON a.id = r.area_id
     JOIN parking_slots s ON s.id = r.slot_id
     ORDER BY r.created_at DESC`
  );

  res.render('admin-reservations', { pageTitle: 'Reservation management', user: req.session.user, reservations, toMoney });
});

app.get('/api/admin/reservations', requireRole('admin'), async (req, res) => {
  const reservations = await all(
    `SELECT r.*, u.name AS user_name, a.name AS area_name, s.slot_number
     FROM reservations r
     JOIN users u ON u.id = r.user_id
     JOIN parking_areas a ON a.id = r.area_id
     JOIN parking_slots s ON s.id = r.slot_id
     ORDER BY r.created_at DESC`
  );
  res.json(reservations);
});

app.get('/api/admin/payments', requireRole('admin'), async (req, res) => {
  const payments = await all(
    `SELECT p.*, u.name AS user_name, r.reservation_code
     FROM payments p
     JOIN users u ON u.id = p.user_id
     JOIN reservations r ON r.id = p.reservation_id
     ORDER BY p.created_at DESC`
  );
  res.json(payments);
});

app.get('/admin/payments', requireRole('admin'), async (req, res) => {
  const payments = await all(
    `SELECT p.*, u.name AS user_name, r.reservation_code
     FROM payments p
     JOIN users u ON u.id = p.user_id
     JOIN reservations r ON r.id = p.reservation_id
     ORDER BY p.created_at DESC`
  );

  res.render('admin-payments', { pageTitle: 'Payment information', user: req.session.user, payments, toMoney });
});

app.get('/admin/reports', requireRole('admin'), async (req, res) => {
  const areas = await all('SELECT * FROM parking_areas ORDER BY name');
  const payments = await all('SELECT * FROM payments ORDER BY created_at DESC');
  res.render('admin-reports', { pageTitle: 'Reports', user: req.session.user, areas, payments, toMoney });
});

app.get('/system/dashboard', requireRole('system_admin'), async (req, res) => {
  const [userCount, adminCount, areaCount, paymentTotal] = await Promise.all([
    get('SELECT COUNT(*) AS total FROM users WHERE role = ?', ['user']),
    get('SELECT COUNT(*) AS total FROM users WHERE role = ?', ['admin']),
    get('SELECT COUNT(*) AS total FROM parking_areas'),
    get('SELECT COALESCE(SUM(amount), 0) AS total FROM payments')
  ]);

  res.render('system-dashboard', {
    pageTitle: 'System dashboard',
    user: req.session.user,
    metrics: {
      user_count: userCount.total,
      admin_count: adminCount.total,
      area_count: areaCount.total,
      total_revenue: Number(paymentTotal.total || 0),
    },
    toMoney,
  });
});

app.get('/system/users', requireRole('system_admin'), async (req, res) => {
  const users = await all('SELECT * FROM users ORDER BY created_at DESC');
  res.render('system-users', { pageTitle: 'User management', user: req.session.user, users });
});

app.get('/api/system/users', requireRole('system_admin'), async (req, res) => {
  const users = await all('SELECT * FROM users ORDER BY created_at DESC');
  res.json(users);
});

app.get('/system/admins', requireRole('system_admin'), async (req, res) => {
  const admins = await all('SELECT * FROM users WHERE role IN (?, ?) ORDER BY created_at DESC', ['admin', 'system_admin']);
  res.render('system-admins', { pageTitle: 'Administrator management', user: req.session.user, admins });
});

app.get('/api/system/admins', requireRole('system_admin'), async (req, res) => {
  const admins = await all('SELECT * FROM users WHERE role IN (?, ?) ORDER BY created_at DESC', ['admin', 'system_admin']);
  res.json(admins);
});

app.get('/system/config', requireRole('system_admin'), async (req, res) => {
  const settings = await all('SELECT * FROM system_settings ORDER BY setting_key');
  res.render('system-config', { pageTitle: 'System configuration', user: req.session.user, settings });
});

app.get('/api/system/settings', requireRole('system_admin'), async (req, res) => {
  const settings = await all('SELECT * FROM system_settings ORDER BY setting_key');
  res.json(settings);
});

app.get('/api/areas', async (req, res) => {
  const areas = await all('SELECT * FROM parking_areas ORDER BY name');
  res.json(areas);
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Smart Parking Management System is running.' });
});

app.use((req, res) => {
  res.status(404).render('not-found', { title: 'Page not found', user: req.session.user || null });
});

app.use((error, req, res, next) => {
  console.error('Unhandled application error:', error);
  res.status(500).render('not-found', { title: 'Unexpected error', user: req.session.user || null, error: 'An unexpected error occurred.' });
});

initializeDatabase()
  .then(() => {
    if (require.main === module) {
      app.listen(PORT, () => {
        console.log(`Smart Parking Management System running on http://localhost:${PORT}`);
      });
    }
  })
  .catch((error) => {
    console.error('Unable to start the application due to database initialization error:', error);
    process.exit(1);
  });

module.exports = app;
