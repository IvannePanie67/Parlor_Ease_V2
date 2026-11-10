// ParlorEase — Express.js backend (REST API + static frontend) with a SQLite database.
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { all, get, run, tx, uid, hashPassword, verifyPassword, nextQueueNumber, newReceiptNo } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// ---- session tokens (HMAC-signed, no external dependency) ---------------------
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(__dirname, "..", "data", ".secret");
  try { return fs.readFileSync(file, "utf8"); } catch (e) {}
  const s = crypto.randomBytes(32).toString("hex");
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, s); } catch (e) {}
  return s;
}
const SECRET = loadSecret();
const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (data) => crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
function makeToken(userId) {
  const body = b64(JSON.stringify({ uid: userId, exp: Date.now() + 1000 * 60 * 60 * 12 }));
  return body + "." + sign(body);
}
function readToken(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try { const p = JSON.parse(Buffer.from(body, "base64url").toString()); return p.exp > Date.now() ? p : null; } catch (e) { return null; }
}

// ---- small helpers -------------------------------------------------------------
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);
const wrap = (fn) => (req, res, next) => { try { Promise.resolve(fn(req, res, next)).catch(next); } catch (e) { next(e); } };
const str = (v) => String(v ?? "").trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const need = (row, what) => { if (!row) throw new HttpError(404, `${what} not found.`); return row; };

function userPayload(u) {
  const out = { id: u.id, role: u.role, name: u.full_name, email: u.email, phone: u.phone || "", staffName: u.full_name };
  if (u.role === "staff") { const s = get("SELECT id, full_name FROM staff WHERE user_id = ?", u.id); if (s) { out.staffId = s.id; out.staffName = s.full_name; } }
  if (u.role === "customer") { const c = get("SELECT id FROM customers WHERE user_id = ?", u.id); out.customerId = c ? c.id : null; }
  return out;
}

// ---- auth middleware -----------------------------------------------------------
function auth(...roles) {
  return (req, res, next) => {
    const h = req.headers.authorization || "";
    const p = readToken(h.startsWith("Bearer ") ? h.slice(7) : "");
    if (!p) return next(new HttpError(401, "Please log in first."));
    const user = get("SELECT * FROM users WHERE id = ?", p.uid);
    if (!user) return next(new HttpError(401, "Please log in again."));
    if (roles.length && !roles.includes(user.role)) return next(new HttpError(403, "You don't have permission to do that."));
    req.user = user;
    next();
  };
}
const adminOnly = auth("admin");

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// ---- SQL used by several routes ----------------------------------------------
const APPT_SQL = `SELECT a.id, a.customer_id AS customerId, a.service_id AS serviceId, a.staff_id AS staffId,
  c.full_name AS customer, c.email AS customerEmail, s.name AS service, COALESCE(st.full_name,'') AS staff,
  a.appointment_date AS date, a.appointment_time AS time, a.status
  FROM appointments a JOIN customers c ON c.id = a.customer_id JOIN services s ON s.id = a.service_id
  LEFT JOIN staff st ON st.id = a.staff_id`;
const apptList = (where = "", ...p) => all(`${APPT_SQL} ${where} ORDER BY a.appointment_date, a.appointment_time`, ...p);
const listServices = () => all("SELECT id, name, category, price, duration_minutes AS duration FROM services ORDER BY name");
const listStaff = () => all(`SELECT st.id, st.full_name AS name, st.specialty AS role, st.status, COALESCE(u.email,'') AS email
  FROM staff st LEFT JOIN users u ON u.id = st.user_id ORDER BY st.full_name`);
const listCustomers = () => all("SELECT id, full_name AS name, phone, email, visits FROM customers ORDER BY full_name");
const listTransactions = () => all(`SELECT t.id, t.customer_id AS customerId, t.service_id AS serviceId, COALESCE(c.full_name,'') AS customer,
  s.name AS service, t.amount, t.paid_date AS date, t.payment_method AS method, t.receipt_number AS receiptNo
  FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id JOIN services s ON s.id = t.service_id ORDER BY t.paid_date DESC, t.created_at DESC`);
const listQueue = () => all(`SELECT q.id, q.queue_number AS number, q.customer_id AS customerId, q.service_id AS serviceId,
  COALESCE(c.full_name,'Walk-in') AS customer, s.name AS service, q.priority, q.arrival_time AS time
  FROM service_queue q LEFT JOIN customers c ON c.id = q.customer_id JOIN services s ON s.id = q.service_id
  WHERE q.status = 'waiting' ORDER BY q.queue_number`);

// ================================ AUTH ===========================================
app.post("/api/auth/register", wrap((req, res) => {
  const name = str(req.body.name), email = str(req.body.email).toLowerCase(), phone = str(req.body.phone), password = String(req.body.password || "");
  if (name.length < 2) throw bad("Enter your full name.");
  if (!EMAIL_RE.test(email)) throw bad("Enter a valid email address.");
  if (password.length < 6) throw bad("Password must be at least 6 characters.");
  if (get("SELECT id FROM users WHERE email = ?", email)) throw new HttpError(409, "An account with that email already exists.");
  const userId = uid();
  tx(() => {
    run("INSERT INTO users(id,full_name,email,phone,password_hash,role) VALUES (?,?,?,?,?,'customer')", userId, name, email, phone, hashPassword(password));
    const existing = get("SELECT id FROM customers WHERE email = ? AND user_id IS NULL", email);
    if (existing) run("UPDATE customers SET user_id = ? WHERE id = ?", userId, existing.id);
    else run("INSERT INTO customers(id,user_id,full_name,email,phone) VALUES (?,?,?,?,?)", uid(), userId, name, email, phone);
  });
  res.status(201).json({ token: makeToken(userId), user: userPayload(get("SELECT * FROM users WHERE id = ?", userId)) });
}));

app.post("/api/auth/login", wrap((req, res) => {
  const email = str(req.body.email).toLowerCase(), password = String(req.body.password || ""), role = req.body.role;
  const user = get("SELECT * FROM users WHERE email = ?", email);
  if (!user || !verifyPassword(password, user.password_hash)) throw new HttpError(401, "The email or password is incorrect.");
  if (role && user.role !== role) throw new HttpError(403, `This account can't sign in as ${role}. Try another tab.`);
  res.json({ token: makeToken(user.id), user: userPayload(user) });
}));

app.get("/api/auth/me", auth(), wrap((req, res) => res.json({ user: userPayload(req.user) })));

// ============================ DASHBOARD DATA =====================================
// One call returns everything the signed-in role is allowed to see.
app.get("/api/bootstrap", auth(), wrap((req, res) => {
  const u = req.user, out = { services: listServices(), staff: listStaff().map(({ email, ...s }) => s) };
  if (u.role === "admin") {
    Object.assign(out, { staff: listStaff(), appointments: apptList(), customers: listCustomers(), transactions: listTransactions(), queue: listQueue() });
  } else if (u.role === "staff") {
    out.appointments = apptList("WHERE a.staff_id = (SELECT id FROM staff WHERE user_id = ?)", u.id);
  } else {
    out.appointments = apptList("WHERE c.user_id = ?", u.id);
  }
  res.json(out);
}));

// ================================ CUSTOMERS ======================================
function customerBody(b) {
  const v = { name: str(b.name), phone: str(b.phone), email: str(b.email).toLowerCase() };
  if (v.name.length < 2) throw bad("Enter a valid customer name.");
  if (!EMAIL_RE.test(v.email)) throw bad("Enter a valid email address.");
  return v;
}
app.get("/api/customers", adminOnly, wrap((req, res) => res.json(listCustomers())));
app.post("/api/customers", adminOnly, wrap((req, res) => {
  const v = customerBody(req.body), id = uid();
  run("INSERT INTO customers(id,full_name,email,phone) VALUES (?,?,?,?)", id, v.name, v.email, v.phone);
  res.status(201).json({ id });
}));
app.put("/api/customers/:id", adminOnly, wrap((req, res) => {
  const v = customerBody(req.body);
  need(get("SELECT id FROM customers WHERE id = ?", req.params.id), "Customer");
  run("UPDATE customers SET full_name=?, email=?, phone=? WHERE id=?", v.name, v.email, v.phone, req.params.id);
  res.json({ ok: true });
}));
app.delete("/api/customers/:id", adminOnly, wrap((req, res) => {
  need(get("SELECT id FROM customers WHERE id = ?", req.params.id), "Customer");
  run("DELETE FROM customers WHERE id = ?", req.params.id);
  res.json({ ok: true });
}));

// ================================= SERVICES ======================================
function serviceBody(b) {
  const v = { name: str(b.name), category: str(b.category), price: Number(b.price), duration: Math.round(Number(b.duration)) };
  if (!v.name || !v.category) throw bad("Service name and category are required.");
  if (!(v.price >= 0)) throw bad("Price cannot be negative.");
  if (!(v.duration > 0)) throw bad("Duration must be more than 0 minutes.");
  return v;
}
app.get("/api/services", auth(), wrap((req, res) => res.json(listServices())));
app.post("/api/services", adminOnly, wrap((req, res) => {
  const v = serviceBody(req.body), id = uid();
  run("INSERT INTO services(id,name,category,price,duration_minutes) VALUES (?,?,?,?,?)", id, v.name, v.category, v.price, v.duration);
  res.status(201).json({ id });
}));
app.put("/api/services/:id", adminOnly, wrap((req, res) => {
  const v = serviceBody(req.body);
  need(get("SELECT id FROM services WHERE id = ?", req.params.id), "Service");
  run("UPDATE services SET name=?, category=?, price=?, duration_minutes=? WHERE id=?", v.name, v.category, v.price, v.duration, req.params.id);
  res.json({ ok: true });
}));
app.delete("/api/services/:id", adminOnly, wrap((req, res) => {
  need(get("SELECT id FROM services WHERE id = ?", req.params.id), "Service");
  run("DELETE FROM services WHERE id = ?", req.params.id);
  res.json({ ok: true });
}));

// ================================== STAFF ========================================
const STAFF_STATUSES = ["Available", "Busy", "Off"];
app.get("/api/staff", auth(), wrap((req, res) => res.json(req.user.role === "admin" ? listStaff() : listStaff().map(({ email, ...s }) => s))));
function staffBody(b) {
  const v = { name: str(b.name), role: str(b.role), status: str(b.status) || "Available", email: str(b.email).toLowerCase() };
  if (v.name.length < 2) throw bad("Enter the staff member's name.");
  if (!v.role) throw bad("Enter the staff member's role.");
  if (!STAFF_STATUSES.includes(v.status)) throw bad("Invalid staff status.");
  if (v.email && !EMAIL_RE.test(v.email)) throw bad("Enter a valid login email.");
  return v;
}
// Optional login: links an existing account (or creates one with the default password Staff@123).
function linkStaffAccount(staffId, email, name) {
  let user = get("SELECT * FROM users WHERE email = ?", email), created = false;
  if (user && user.role === "admin") throw new HttpError(409, "That email belongs to an admin account.");
  const taken = user && get("SELECT id FROM staff WHERE user_id = ? AND id <> ?", user.id, staffId);
  if (taken) throw new HttpError(409, "That login is already linked to another staff member.");
  if (!user) {
    const id = uid();
    run("INSERT INTO users(id,full_name,email,password_hash,role) VALUES (?,?,?,?,'staff')", id, name, email, hashPassword("Staff@123"));
    user = { id }; created = true;
  } else if (user.role !== "staff") {
    run("UPDATE users SET role='staff' WHERE id = ?", user.id);
  }
  run("UPDATE staff SET user_id = ? WHERE id = ?", user.id, staffId);
  return created;
}
function saveStaff(id, v) {
  return tx(() => {
    if (get("SELECT id FROM staff WHERE id = ?", id)) run("UPDATE staff SET full_name=?, specialty=?, status=? WHERE id=?", v.name, v.role, v.status, id);
    else run("INSERT INTO staff(id,full_name,specialty,status) VALUES (?,?,?,?)", id, v.name, v.role, v.status);
    return v.email ? linkStaffAccount(id, v.email, v.name) : false;
  });
}
app.post("/api/staff", adminOnly, wrap((req, res) => {
  const v = staffBody(req.body), id = uid(), created = saveStaff(id, v);
  res.status(201).json({ id, message: created ? "Staff added. Login created with password Staff@123." : "Record added" });
}));
app.put("/api/staff/:id", adminOnly, wrap((req, res) => {
  const v = staffBody(req.body);
  need(get("SELECT id FROM staff WHERE id = ?", req.params.id), "Staff member");
  const created = saveStaff(req.params.id, v);
  res.json({ ok: true, message: created ? "Staff updated. Login created with password Staff@123." : "Record updated" });
}));
app.delete("/api/staff/:id", adminOnly, wrap((req, res) => {
  need(get("SELECT id FROM staff WHERE id = ?", req.params.id), "Staff member");
  run("DELETE FROM staff WHERE id = ?", req.params.id);
  res.json({ ok: true });
}));

// =============================== APPOINTMENTS ====================================
const ACTIVE = "('Pending','Confirmed')";
function staffConflict(staffId, date, time, ignoreId) {
  if (!staffId) return false;
  return !!get(`SELECT id FROM appointments WHERE staff_id=? AND appointment_date=? AND appointment_time=? AND status IN ${ACTIVE} AND id <> ?`, staffId, date, time, ignoreId || "");
}
function apptBody(b) {
  const v = { serviceId: str(b.serviceId), staffId: str(b.staffId) || null, customerId: str(b.customerId), date: str(b.date), time: str(b.time) };
  if (!DATE_RE.test(v.date)) throw bad("Choose a valid date.");
  if (!TIME_RE.test(v.time)) throw bad("Choose a valid time.");
  need(get("SELECT id FROM services WHERE id = ?", v.serviceId), "Service");
  if (v.staffId) need(get("SELECT id FROM staff WHERE id = ?", v.staffId), "Staff member");
  return v;
}
app.get("/api/appointments", auth(), wrap((req, res) => {
  const u = req.user;
  res.json(u.role === "admin" ? apptList() : u.role === "staff"
    ? apptList("WHERE a.staff_id = (SELECT id FROM staff WHERE user_id = ?)", u.id) : apptList("WHERE c.user_id = ?", u.id));
}));
app.post("/api/appointments", auth("admin", "customer"), wrap((req, res) => {
  const v = apptBody(req.body), id = uid();
  if (v.date < todayISO()) throw bad("Choose today or a future date.");
  let status = "Pending";
  if (req.user.role === "customer") {
    const c = get("SELECT id FROM customers WHERE user_id = ?", req.user.id);
    if (!c) throw bad("Your customer record is missing. Please contact the salon.");
    v.customerId = c.id; v.staffId = null; // customers request; admin assigns staff on approval
  } else {
    need(get("SELECT id FROM customers WHERE id = ?", v.customerId), "Customer");
    if (staffConflict(v.staffId, v.date, v.time)) throw new HttpError(409, "That staff member already has an appointment at this time.");
  }
  run("INSERT INTO appointments(id,customer_id,service_id,staff_id,appointment_date,appointment_time,status) VALUES (?,?,?,?,?,?,?)",
    id, v.customerId, v.serviceId, v.staffId, v.date, v.time, status);
  res.status(201).json({ id, message: req.user.role === "customer" ? "Booking request sent for admin approval." : "Record added" });
}));
app.put("/api/appointments/:id", adminOnly, wrap((req, res) => {
  const old = need(get("SELECT * FROM appointments WHERE id = ?", req.params.id), "Appointment");
  const v = apptBody(req.body);
  if (v.date !== old.appointment_date && v.date < todayISO()) throw bad("Choose today or a future date.");
  need(get("SELECT id FROM customers WHERE id = ?", v.customerId), "Customer");
  if (["Pending", "Confirmed"].includes(old.status) && staffConflict(v.staffId, v.date, v.time, old.id)) throw new HttpError(409, "That staff member already has an appointment at this time.");
  run("UPDATE appointments SET customer_id=?, service_id=?, staff_id=?, appointment_date=?, appointment_time=? WHERE id=?",
    v.customerId, v.serviceId, v.staffId, v.date, v.time, old.id);
  res.json({ ok: true });
}));
// Status changes: admin approves/rejects/etc.; staff completes their own; customers cancel their own.
app.patch("/api/appointments/:id/status", auth(), wrap((req, res) => {
  const a = need(get("SELECT * FROM appointments WHERE id = ?", req.params.id), "Appointment");
  const status = str(req.body.status), u = req.user;
  if (!["Pending", "Confirmed", "Completed", "Cancelled"].includes(status)) throw bad("Invalid status.");
  if (u.role === "staff") {
    const s = get("SELECT id FROM staff WHERE user_id = ?", u.id);
    if (!s || a.staff_id !== s.id) throw new HttpError(403, "This appointment is not assigned to your account.");
    if (status !== "Completed" || a.status !== "Confirmed") throw new HttpError(403, "Staff can only mark confirmed appointments as completed.");
  } else if (u.role === "customer") {
    const c = get("SELECT id FROM customers WHERE user_id = ?", u.id);
    if (!c || a.customer_id !== c.id) throw new HttpError(403, "You can only change your own appointments.");
    if (status !== "Cancelled" || !["Pending", "Confirmed"].includes(a.status)) throw new HttpError(403, "You can only cancel an upcoming appointment.");
  }
  let staffId = a.staff_id;
  if (u.role === "admin" && status === "Confirmed") {
    staffId = str(req.body.staffId) || a.staff_id;
    if (!staffId) { const free = get("SELECT id FROM staff WHERE status = 'Available' ORDER BY full_name"); staffId = free ? free.id : null; }
    if (staffConflict(staffId, a.appointment_date, a.appointment_time, a.id)) throw new HttpError(409, "A staff member already has a booking at that time.");
  }
  tx(() => {
    run("UPDATE appointments SET status = ?, staff_id = ? WHERE id = ?", status, staffId, a.id);
    if (status === "Completed" && a.status !== "Completed") run("UPDATE customers SET visits = visits + 1 WHERE id = ?", a.customer_id);
  });
  res.json({ ok: true });
}));
app.delete("/api/appointments/:id", adminOnly, wrap((req, res) => {
  need(get("SELECT id FROM appointments WHERE id = ?", req.params.id), "Appointment");
  run("DELETE FROM appointments WHERE id = ?", req.params.id);
  res.json({ ok: true });
}));

// ================================ TRANSACTIONS ===================================
const METHODS = ["Cash", "GCash", "Card"];
function txBody(b) {
  const v = { customerId: str(b.customerId), serviceId: str(b.serviceId), amount: Number(b.amount), date: str(b.date), method: str(b.method) };
  if (!(v.amount >= 0)) throw bad("Amounts cannot be negative.");
  if (!DATE_RE.test(v.date)) throw bad("Choose a valid date.");
  if (!METHODS.includes(v.method)) throw bad("Choose a valid payment method.");
  need(get("SELECT id FROM customers WHERE id = ?", v.customerId), "Customer");
  need(get("SELECT id FROM services WHERE id = ?", v.serviceId), "Service");
  return v;
}
app.get("/api/transactions", adminOnly, wrap((req, res) => res.json(listTransactions())));
app.post("/api/transactions", adminOnly, wrap((req, res) => {
  const v = txBody(req.body), id = uid();
  run("INSERT INTO transactions(id,customer_id,service_id,amount,payment_method,receipt_number,paid_date) VALUES (?,?,?,?,?,?,?)",
    id, v.customerId, v.serviceId, v.amount, v.method, newReceiptNo(), v.date);
  res.status(201).json({ id });
}));
app.put("/api/transactions/:id", adminOnly, wrap((req, res) => {
  const v = txBody(req.body);
  need(get("SELECT id FROM transactions WHERE id = ?", req.params.id), "Transaction");
  run("UPDATE transactions SET customer_id=?, service_id=?, amount=?, payment_method=?, paid_date=? WHERE id=?", v.customerId, v.serviceId, v.amount, v.method, v.date, req.params.id);
  res.json({ ok: true });
}));
app.delete("/api/transactions/:id", adminOnly, wrap((req, res) => {
  need(get("SELECT id FROM transactions WHERE id = ?", req.params.id), "Transaction");
  run("DELETE FROM transactions WHERE id = ?", req.params.id);
  res.json({ ok: true });
}));

// ==================================== QUEUE ======================================
function queueBody(b) {
  const v = { customerId: str(b.customerId), serviceId: str(b.serviceId), priority: str(b.priority) || "Regular", time: str(b.time) };
  if (!["Regular", "Priority"].includes(v.priority)) throw bad("Invalid priority.");
  if (!TIME_RE.test(v.time)) throw bad("Choose a valid arrival time.");
  need(get("SELECT id FROM customers WHERE id = ?", v.customerId), "Customer");
  need(get("SELECT id FROM services WHERE id = ?", v.serviceId), "Service");
  return v;
}
app.get("/api/queue", adminOnly, wrap((req, res) => res.json(listQueue())));
app.post("/api/queue", adminOnly, wrap((req, res) => {
  const v = queueBody(req.body), id = uid();
  run("INSERT INTO service_queue(id,queue_number,customer_id,service_id,priority,arrival_time) VALUES (?,?,?,?,?,?)", id, nextQueueNumber(), v.customerId, v.serviceId, v.priority, v.time);
  res.status(201).json({ id });
}));
app.put("/api/queue/:id", adminOnly, wrap((req, res) => {
  const v = queueBody(req.body);
  need(get("SELECT id FROM service_queue WHERE id = ?", req.params.id), "Queue entry");
  run("UPDATE service_queue SET customer_id=?, service_id=?, priority=?, arrival_time=? WHERE id=?", v.customerId, v.serviceId, v.priority, v.time, req.params.id);
  res.json({ ok: true });
}));
app.patch("/api/queue/:id/serve", adminOnly, wrap((req, res) => {
  need(get("SELECT id FROM service_queue WHERE id = ? AND status = 'waiting'", req.params.id), "Queue entry");
  run("UPDATE service_queue SET status = 'completed' WHERE id = ?", req.params.id);
  res.json({ ok: true });
}));
app.delete("/api/queue/:id", adminOnly, wrap((req, res) => {
  need(get("SELECT id FROM service_queue WHERE id = ?", req.params.id), "Queue entry");
  run("DELETE FROM service_queue WHERE id = ?", req.params.id);
  res.json({ ok: true });
}));

// ================================ ERRORS =========================================
app.use("/api", (req, res, next) => next(new HttpError(404, "Route not found.")));
app.use((err, req, res, next) => {
  let status = err.status || 500, message = err.message || "Server error.";
  if (!err.status) {
    if (/UNIQUE constraint failed/i.test(message)) { status = 409; message = /staff|user_id/.test(message) ? "That login is already linked." : "A record with those details already exists."; }
    else if (/FOREIGN KEY constraint failed/i.test(message)) { status = 409; message = "This record is still in use by other records, so it can't be deleted."; }
    else if (/constraint failed/i.test(message)) { status = 400; message = "Some of the details are not valid."; }
    else { console.error(err); message = "Something went wrong on the server."; }
  }
  res.status(status).json({ error: message });
});

if (require.main === module) app.listen(PORT, () => console.log(`ParlorEase running at http://localhost:${PORT}`));
module.exports = app;
