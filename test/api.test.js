// Smoke test for the ParlorEase API. Run with:  npm test
// Uses an in-memory SQLite database, so it never touches data/parlorease.db.
process.env.DB_FILE = ":memory:";
process.env.SESSION_SECRET = "test-secret";
const assert = require("assert");
const app = require("../server/server");

let passed = 0;
const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, body, token) => {
    const r = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let data = {}; try { data = await r.json(); } catch (e) {}
    return { status: r.status, data };
  };
  const ok = (name, cond) => { assert.ok(cond, "FAILED: " + name); passed++; console.log("  ok -", name); };
  const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  try {
    console.log("Auth");
    let r = await call("POST", "/auth/login", { email: "admin@parlorease.com", password: "wrong" });
    ok("wrong password rejected (401)", r.status === 401);
    r = await call("POST", "/auth/login", { email: "admin@parlorease.com", password: "Admin@123", role: "admin" });
    ok("admin login", r.status === 200 && r.data.token);
    const A = r.data.token;
    r = await call("POST", "/auth/login", { email: "customer@parlorease.com", password: "Customer@123", role: "customer" });
    const C = r.data.token; ok("customer login", !!C);
    r = await call("POST", "/auth/login", { email: "staff@parlorease.com", password: "Staff@123", role: "staff" });
    const S = r.data.token; ok("staff login", !!S);
    r = await call("GET", "/customers");
    ok("no token -> 401", r.status === 401);
    r = await call("GET", "/customers", undefined, C);
    ok("customer cannot list customers (403)", r.status === 403);

    console.log("Customers CRUD");
    r = await call("POST", "/customers", { name: "Test Person", phone: "0900", email: "test@example.com" }, A);
    ok("create customer (201)", r.status === 201); const cid = r.data.id;
    r = await call("POST", "/customers", { name: "X", email: "bad" }, A);
    ok("invalid customer rejected (400)", r.status === 400);
    r = await call("POST", "/customers", { name: "Dup Person", phone: "", email: "test@example.com" }, A);
    ok("duplicate email rejected (409)", r.status === 409);
    r = await call("PUT", "/customers/" + cid, { name: "Test Updated", phone: "0911", email: "test@example.com" }, A);
    ok("update customer", r.status === 200);
    r = await call("GET", "/customers", undefined, A);
    ok("read customers shows update", r.data.some((c) => c.id === cid && c.name === "Test Updated"));

    console.log("Services CRUD");
    r = await call("POST", "/services", { name: "Test Service", category: "Hair", price: 100, duration: 30 }, A);
    ok("create service", r.status === 201); const sid = r.data.id;
    r = await call("POST", "/services", { name: "Bad", category: "Hair", price: -5, duration: 30 }, A);
    ok("negative price rejected", r.status === 400);
    r = await call("PUT", "/services/" + sid, { name: "Test Service 2", category: "Nails", price: 150, duration: 45 }, A);
    ok("update service", r.status === 200);
    r = await call("GET", "/services", undefined, C);
    ok("customer can read services", r.status === 200 && r.data.length >= 21);

    console.log("Staff CRUD");
    r = await call("POST", "/staff", { name: "Test Staff", role: "Stylist", status: "Available" }, A);
    ok("create staff", r.status === 201); const stid = r.data.id;
    r = await call("PUT", "/staff/" + stid, { name: "Test Staff", role: "Colorist", status: "Busy" }, A);
    ok("update staff", r.status === 200);

    console.log("Appointments CRUD + rules");
    r = await call("POST", "/appointments", { customerId: cid, serviceId: sid, staffId: stid, date: iso(2), time: "11:00" }, A);
    ok("admin creates appointment", r.status === 201); const aid = r.data.id;
    r = await call("POST", "/appointments", { customerId: cid, serviceId: sid, staffId: stid, date: iso(2), time: "11:00" }, A);
    ok("double-booking staff rejected (409)", r.status === 409);
    r = await call("POST", "/appointments", { customerId: cid, serviceId: sid, date: iso(-3), time: "11:00" }, A);
    ok("past date rejected (400)", r.status === 400);
    r = await call("PUT", "/appointments/" + aid, { customerId: cid, serviceId: sid, staffId: stid, date: iso(3), time: "12:00" }, A);
    ok("update appointment", r.status === 200);
    r = await call("POST", "/appointments", { serviceId: sid, date: iso(1), time: "09:00" }, C);
    ok("customer requests booking (Pending)", r.status === 201); const caid = r.data.id;
    r = await call("PATCH", "/appointments/" + caid + "/status", { status: "Confirmed" }, C);
    ok("customer cannot approve (403)", r.status === 403);
    r = await call("PATCH", "/appointments/" + caid + "/status", { status: "Confirmed" }, A);
    ok("admin approves booking", r.status === 200);
    r = await call("GET", "/appointments", undefined, C);
    ok("customer sees only own appointments", r.data.length >= 1 && r.data.every((a) => a.customerEmail === "customer@parlorease.com"));
    r = await call("PATCH", "/appointments/" + caid + "/status", { status: "Cancelled" }, C);
    ok("customer cancels own booking", r.status === 200);

    console.log("Transactions CRUD");
    r = await call("POST", "/transactions", { customerId: cid, serviceId: sid, amount: 150, date: iso(0), method: "Cash" }, A);
    ok("create transaction", r.status === 201); const tid = r.data.id;
    r = await call("PUT", "/transactions/" + tid, { customerId: cid, serviceId: sid, amount: 175, date: iso(0), method: "GCash" }, A);
    ok("update transaction", r.status === 200);
    r = await call("GET", "/transactions", undefined, A);
    ok("read transactions", r.data.some((t) => t.id === tid && t.amount === 175 && t.method === "GCash"));

    console.log("Queue CRUD");
    r = await call("POST", "/queue", { customerId: cid, serviceId: sid, priority: "Priority", time: "10:30" }, A);
    ok("add to queue", r.status === 201); const qid = r.data.id;
    r = await call("PUT", "/queue/" + qid, { customerId: cid, serviceId: sid, priority: "Regular", time: "10:45" }, A);
    ok("update queue entry", r.status === 200);
    r = await call("PATCH", "/queue/" + qid + "/serve", undefined, A);
    ok("serve queue entry", r.status === 200);
    r = await call("POST", "/queue", { customerId: cid, serviceId: sid, priority: "Regular", time: "11:00" }, A);
    r = await call("DELETE", "/queue/" + r.data.id, undefined, A);
    ok("delete queue entry", r.status === 200);

    console.log("Dashboard bootstrap");
    r = await call("GET", "/bootstrap", undefined, A);
    ok("admin bootstrap has all modules", ["services", "staff", "appointments", "customers", "transactions", "queue"].every((k) => Array.isArray(r.data[k])));

    console.log("Deletes");
    r = await call("DELETE", "/services/" + sid, undefined, A);
    ok("service in use cannot be deleted (409)", r.status === 409);
    r = await call("DELETE", "/appointments/" + aid, undefined, A);
    ok("delete appointment", r.status === 200);
    r = await call("DELETE", "/transactions/" + tid, undefined, A);
    ok("delete transaction", r.status === 200);
    r = await call("DELETE", "/staff/" + stid, undefined, A);
    ok("delete staff", r.status === 200);
    r = await call("DELETE", "/appointments/" + caid, undefined, A);
    ok("delete customer appointment", r.status === 200);
    r = await call("DELETE", "/queue/" + qid, undefined, A);
    r = await call("DELETE", "/services/" + sid, undefined, A);
    ok("delete service once unused", r.status === 200);
    r = await call("DELETE", "/customers/" + cid, undefined, A);
    ok("delete customer", r.status === 200);
    r = await call("DELETE", "/customers/" + cid, undefined, A);
    ok("deleting twice -> 404", r.status === 404);

    console.log(`\nAll ${passed} checks passed.`);
    server.close(); process.exit(0);
  } catch (e) {
    console.error("\n" + e.message); server.close(); process.exit(1);
  }
});
