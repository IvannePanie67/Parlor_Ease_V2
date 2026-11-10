// SQLite database layer for ParlorEase.
// Uses better-sqlite3 (installed by `npm install`). If it cannot be loaded, it falls back to
// Node's built-in `node:sqlite` module (Node 22.5+), which has the same prepare/run/get/all API.
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const DB_FILE = process.env.DB_FILE || path.join(__dirname, "..", "data", "parlorease.db");
if (DB_FILE !== ":memory:") fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

function open() {
  try {
    const Better = require("better-sqlite3");
    return new Better(DB_FILE);
  } catch (e) {
    try {
      const { DatabaseSync } = require("node:sqlite");
      return new DatabaseSync(DB_FILE);
    } catch (e2) {
      throw new Error("No SQLite driver available. Run `npm install` (needs better-sqlite3) or use Node 22.5+.");
    }
  }
}
const db = open();
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");

// ---- helpers -------------------------------------------------------------
const uid = () => crypto.randomUUID();
const clean = (params) => params.map((p) => (p === undefined ? null : p));
const all = (sql, ...p) => db.prepare(sql).all(...clean(p));
const get = (sql, ...p) => db.prepare(sql).get(...clean(p));
const run = (sql, ...p) => db.prepare(sql).run(...clean(p));
function tx(fn) {
  db.exec("BEGIN");
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return salt + ":" + crypto.scryptSync(password, salt, 64).toString("hex");
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const real = Buffer.from(hash, "hex");
  return test.length === real.length && crypto.timingSafeEqual(test, real);
}

// ---- schema ----------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL CHECK (length(trim(full_name)) >= 2),
  email TEXT NOT NULL UNIQUE,
  phone TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin','staff','customer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL CHECK (length(trim(full_name)) >= 2),
  email TEXT NOT NULL UNIQUE,
  phone TEXT DEFAULT '',
  visits INTEGER NOT NULL DEFAULT 0 CHECK (visits >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL CHECK (length(trim(full_name)) >= 2),
  specialty TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Available' CHECK (status IN ('Available','Busy','Off')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  price REAL NOT NULL CHECK (price >= 0),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  staff_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
  appointment_date TEXT NOT NULL,
  appointment_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Confirmed','Completed','Cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  amount REAL NOT NULL CHECK (amount >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash','GCash','Card')),
  receipt_number TEXT NOT NULL UNIQUE,
  paid_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS service_queue (
  id TEXT PRIMARY KEY,
  queue_number INTEGER NOT NULL,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  priority TEXT NOT NULL DEFAULT 'Regular' CHECK (priority IN ('Regular','Priority')),
  arrival_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(appointment_date, appointment_time);
CREATE INDEX IF NOT EXISTS idx_appt_customer ON appointments(customer_id);
CREATE INDEX IF NOT EXISTS idx_appt_staff ON appointments(staff_id);
`);

const nextQueueNumber = () => (get("SELECT COALESCE(MAX(queue_number),0)+1 AS n FROM service_queue").n);
const newReceiptNo = () => "PE-" + crypto.randomBytes(5).toString("hex").toUpperCase();

// ---- seed data (only on an empty database) ------------------------------------
function seed() {
  if (get("SELECT COUNT(*) AS n FROM users").n > 0) return;
  const iso = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  tx(() => {
    const mkUser = (name, email, role, pw, phone = "") => { const id = uid(); run("INSERT INTO users(id,full_name,email,phone,password_hash,role) VALUES (?,?,?,?,?,?)", id, name, email, phone, hashPassword(pw), role); return id; };
    mkUser("Salon Admin", "admin@parlorease.com", "admin", "Admin@123");
    const staffUser = mkUser("Maria Santos", "staff@parlorease.com", "staff", "Staff@123", "09171234567");
    const custUser = mkUser("Ana Reyes", "customer@parlorease.com", "customer", "Customer@123", "09181234567");

    const services = [
      ["Haircut & Blow Dry", "Hair", 350, 60], ["Hair Coloring", "Hair", 1200, 120], ["Hair Rebond", "Hair", 2500, 180],
      ["Hair Spa Treatment", "Hair", 800, 75], ["Keratin Treatment", "Hair", 1800, 120], ["Hair Highlights", "Hair", 1500, 120],
      ["Classic Manicure", "Nails", 300, 45], ["Gel Manicure", "Nails", 550, 60], ["Classic Pedicure", "Nails", 350, 50],
      ["Gel Pedicure", "Nails", 650, 70], ["Nail Art", "Nails", 450, 60], ["Foot Spa", "Nails", 500, 60],
      ["Facial Treatment", "Skin", 700, 60], ["Deep Cleansing Facial", "Skin", 900, 75], ["Whitening Facial", "Skin", 1100, 75],
      ["Body Scrub", "Skin", 850, 60], ["Full Body Massage", "Skin", 750, 60], ["Eyebrow Threading", "Skin", 150, 20],
      ["Eyelash Extension", "Skin", 1300, 90], ["Waxing (Underarm)", "Skin", 250, 20]
    ];
    const sid = {};
    for (const [n, c, p, d] of services) { const id = uid(); sid[n] = id; run("INSERT INTO services(id,name,category,price,duration_minutes) VALUES (?,?,?,?,?)", id, n, c, p, d); }

    const mkStaff = (name, spec, status, userId) => { const id = uid(); run("INSERT INTO staff(id,user_id,full_name,specialty,status) VALUES (?,?,?,?,?)", id, userId || null, name, spec, status); return id; };
    const st1 = mkStaff("Maria Santos", "Hair Stylist", "Available", staffUser);
    const st2 = mkStaff("Joy Dela Cruz", "Nail Technician", "Available");
    mkStaff("Liza Mendoza", "Esthetician", "Busy");

    const mkCust = (name, email, phone, visits, userId) => { const id = uid(); run("INSERT INTO customers(id,user_id,full_name,email,phone,visits) VALUES (?,?,?,?,?,?)", id, userId || null, name, email, phone, visits); return id; };
    const c1 = mkCust("Ana Reyes", "customer@parlorease.com", "09181234567", 2, custUser);
    const c2 = mkCust("Carla Gomez", "carla@example.com", "09191234567", 5);
    const c3 = mkCust("Beth Lim", "beth@example.com", "09201234567", 1);

    const mkAppt = (c, s, st, d, t, status) => run("INSERT INTO appointments(id,customer_id,service_id,staff_id,appointment_date,appointment_time,status) VALUES (?,?,?,?,?,?,?)", uid(), c, sid[s], st, d, t, status);
    mkAppt(c1, "Haircut & Blow Dry", st1, iso(0), "10:00", "Confirmed");
    mkAppt(c2, "Gel Manicure", st2, iso(0), "13:00", "Confirmed");
    mkAppt(c3, "Facial Treatment", null, iso(1), "15:00", "Pending");
    mkAppt(c1, "Hair Coloring", st1, iso(-7), "09:00", "Completed");

    const mkTx = (c, s, amt, d, m) => run("INSERT INTO transactions(id,customer_id,service_id,amount,payment_method,receipt_number,paid_date) VALUES (?,?,?,?,?,?,?)", uid(), c, sid[s], amt, m, newReceiptNo(), d);
    mkTx(c1, "Hair Coloring", 1200, iso(-7), "GCash");
    mkTx(c2, "Classic Manicure", 300, iso(-2), "Cash");

    const mkQ = (c, s, pr, t) => run("INSERT INTO service_queue(id,queue_number,customer_id,service_id,priority,arrival_time) VALUES (?,?,?,?,?,?)", uid(), nextQueueNumber(), c, sid[s], pr, t);
    mkQ(c2, "Classic Pedicure", "Regular", "09:30");
    mkQ(c3, "Eyebrow Threading", "Priority", "09:45");
  });
}
seed();

module.exports = { db, all, get, run, tx, uid, hashPassword, verifyPassword, nextQueueNumber, newReceiptNo };
