// 仕入・在庫・販売・配送・回収管理 API サーバー
// 依存パッケージなし(Node.js組み込みの http / node:sqlite のみ使用)
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const db = require("./db");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..");

// ---------- ユーティリティ ----------
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) req.destroy();
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("リクエストボディのJSON解析に失敗しました"));
      }
    });
    req.on("error", reject);
  });
}

function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}
function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}
function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ---------- マスタ: 商品 ----------
function listProducts(query) {
  if (query.get("active") === "1") {
    return all("SELECT * FROM products WHERE is_active = 1 ORDER BY name");
  }
  return all("SELECT * FROM products ORDER BY name");
}

function createProduct(b) {
  if (!b.name || !String(b.name).trim()) throw httpError(400, "商品名は必須です");
  const r = run(
    `INSERT INTO products (name, category, unit, sku, purchase_price, sale_price, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [b.name.trim(), b.category || null, b.unit || "個", b.sku || null,
      numOrNull(b.purchase_price), numOrNull(b.sale_price), b.notes || null]
  );
  return get("SELECT * FROM products WHERE id = ?", [r.lastInsertRowid]);
}

function updateProduct(id, b) {
  const existing = get("SELECT * FROM products WHERE id = ?", [id]);
  if (!existing) throw httpError(404, "商品が見つかりません");
  run(
    `UPDATE products SET name=?, category=?, unit=?, sku=?, purchase_price=?, sale_price=?, notes=?, is_active=?
     WHERE id=?`,
    [
      b.name != null ? b.name.trim() : existing.name,
      b.category !== undefined ? b.category : existing.category,
      b.unit !== undefined ? b.unit : existing.unit,
      b.sku !== undefined ? b.sku : existing.sku,
      b.purchase_price !== undefined ? numOrNull(b.purchase_price) : existing.purchase_price,
      b.sale_price !== undefined ? numOrNull(b.sale_price) : existing.sale_price,
      b.notes !== undefined ? b.notes : existing.notes,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : existing.is_active,
      id,
    ]
  );
  return get("SELECT * FROM products WHERE id = ?", [id]);
}

function deleteProduct(id) {
  run("DELETE FROM products WHERE id = ?", [id]);
}

// ---------- マスタ: 取引先 ----------
function listPartners(query) {
  const role = query.get("role");
  if (role) {
    return all("SELECT * FROM partners WHERE (role = ? OR role = 'both') ORDER BY name", [role]);
  }
  return all("SELECT * FROM partners ORDER BY name");
}

function createPartner(b) {
  if (!b.name || !String(b.name).trim()) throw httpError(400, "取引先名は必須です");
  const r = run(
    `INSERT INTO partners (name, role, contact_name, phone, email, address, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [b.name.trim(), b.role || "both", b.contact_name || null, b.phone || null,
      b.email || null, b.address || null, b.notes || null]
  );
  return get("SELECT * FROM partners WHERE id = ?", [r.lastInsertRowid]);
}

function updatePartner(id, b) {
  const existing = get("SELECT * FROM partners WHERE id = ?", [id]);
  if (!existing) throw httpError(404, "取引先が見つかりません");
  run(
    `UPDATE partners SET name=?, role=?, contact_name=?, phone=?, email=?, address=?, notes=?, is_active=?
     WHERE id=?`,
    [
      b.name != null ? b.name.trim() : existing.name,
      b.role !== undefined ? b.role : existing.role,
      b.contact_name !== undefined ? b.contact_name : existing.contact_name,
      b.phone !== undefined ? b.phone : existing.phone,
      b.email !== undefined ? b.email : existing.email,
      b.address !== undefined ? b.address : existing.address,
      b.notes !== undefined ? b.notes : existing.notes,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : existing.is_active,
      id,
    ]
  );
  return get("SELECT * FROM partners WHERE id = ?", [id]);
}

function deletePartner(id) {
  run("DELETE FROM partners WHERE id = ?", [id]);
}

// ---------- 仕入 ----------
function listPurchases() {
  return all(`
    SELECT p.*, pr.name AS product_name, pr.unit AS product_unit, s.name AS supplier_name,
      (SELECT id FROM inventory_lots WHERE purchase_id = p.id) AS lot_id,
      (SELECT quantity_remaining FROM inventory_lots WHERE purchase_id = p.id) AS lot_remaining
    FROM purchases p
    LEFT JOIN products pr ON pr.id = p.product_id
    LEFT JOIN partners s ON s.id = p.supplier_id
    ORDER BY p.purchase_date DESC, p.id DESC
  `);
}

function createPurchase(b) {
  if (!b.product_id) throw httpError(400, "商品を選択してください");
  const qty = numOrNull(b.quantity);
  if (!qty || qty <= 0) throw httpError(400, "数量は正の数で入力してください");
  const product = get("SELECT * FROM products WHERE id = ?", [b.product_id]);
  if (!product) throw httpError(404, "商品が見つかりません");
  const purchaseDate = b.purchase_date || today();

  const pr = run(
    `INSERT INTO purchases (supplier_id, purchase_date, product_id, lot_number, quantity, unit_price, expiration_date, warehouse_location, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.supplier_id || null, purchaseDate, b.product_id, b.lot_number || null, qty,
      numOrNull(b.unit_price), b.expiration_date || null, b.warehouse_location || null, b.notes || null]
  );
  const purchaseId = pr.lastInsertRowid;

  const lotR = run(
    `INSERT INTO inventory_lots (product_id, purchase_id, lot_number, expiration_date, warehouse_location, quantity_received, quantity_remaining, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
    [b.product_id, purchaseId, b.lot_number || null, b.expiration_date || null, b.warehouse_location || null, qty, qty]
  );

  run(
    `INSERT INTO stock_movements (lot_id, product_id, movement_type, quantity, related_type, related_id, memo)
     VALUES (?, ?, 'purchase_in', ?, 'purchase', ?, ?)`,
    [lotR.lastInsertRowid, b.product_id, qty, purchaseId, b.notes || null]
  );

  return get("SELECT * FROM purchases WHERE id = ?", [purchaseId]);
}

function deletePurchase(id) {
  const purchase = get("SELECT * FROM purchases WHERE id = ?", [id]);
  if (!purchase) throw httpError(404, "仕入記録が見つかりません");
  const lot = get("SELECT * FROM inventory_lots WHERE purchase_id = ?", [id]);
  if (lot && lot.quantity_remaining !== lot.quantity_received) {
    throw httpError(400, "この仕入から生じた在庫が既に使用されているため削除できません");
  }
  if (lot) {
    run("DELETE FROM stock_movements WHERE lot_id = ?", [lot.id]);
    run("DELETE FROM inventory_lots WHERE id = ?", [lot.id]);
  }
  run("DELETE FROM purchases WHERE id = ?", [id]);
}

// ---------- 在庫 ----------
function listLots(query) {
  const conditions = [];
  const params = [];
  if (query.get("product_id")) {
    conditions.push("l.product_id = ?");
    params.push(query.get("product_id"));
  }
  if (query.get("status")) {
    conditions.push("l.status = ?");
    params.push(query.get("status"));
  } else {
    conditions.push("l.quantity_remaining > 0");
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return all(`
    SELECT l.*, p.name AS product_name, p.unit AS product_unit,
      CAST(julianday(l.expiration_date) - julianday(?) AS INTEGER) AS days_until_expiration
    FROM inventory_lots l
    LEFT JOIN products p ON p.id = l.product_id
    ${where}
    ORDER BY (l.expiration_date IS NULL), l.expiration_date ASC, l.id ASC
  `, [today(), ...params]);
}

function adjustLot(id, b) {
  const lot = get("SELECT * FROM inventory_lots WHERE id = ?", [id]);
  if (!lot) throw httpError(404, "在庫ロットが見つかりません");
  const delta = numOrNull(b.delta);
  if (delta == null || delta === 0) throw httpError(400, "増減数量を入力してください");
  const newRemaining = lot.quantity_remaining + delta;
  if (newRemaining < 0) throw httpError(400, "在庫残数を下回る減算はできません");
  const type = b.type === "disposal" ? "disposal" : "adjustment";
  let status = lot.status;
  if (newRemaining <= 0) status = type === "disposal" ? "disposed" : "depleted";
  else if (status !== "active") status = "active";

  run("UPDATE inventory_lots SET quantity_remaining = ?, status = ? WHERE id = ?", [newRemaining, status, id]);
  run(
    `INSERT INTO stock_movements (lot_id, product_id, movement_type, quantity, related_type, memo)
     VALUES (?, ?, ?, ?, 'manual', ?)`,
    [id, lot.product_id, type, delta, b.memo || null]
  );
  return get("SELECT * FROM inventory_lots WHERE id = ?", [id]);
}

// ---------- 販売 ----------
function listSales() {
  return all(`
    SELECT s.*, p.name AS product_name, p.unit AS product_unit, c.name AS customer_name,
      l.lot_number, l.expiration_date
    FROM sales s
    LEFT JOIN products p ON p.id = s.product_id
    LEFT JOIN partners c ON c.id = s.customer_id
    LEFT JOIN inventory_lots l ON l.id = s.lot_id
    ORDER BY s.sale_date DESC, s.id DESC
  `);
}

function createSale(b) {
  if (!b.product_id) throw httpError(400, "商品を選択してください");
  const qty = numOrNull(b.quantity);
  if (!qty || qty <= 0) throw httpError(400, "数量は正の数で入力してください");

  let lot;
  if (b.lot_id) {
    lot = get("SELECT * FROM inventory_lots WHERE id = ?", [b.lot_id]);
    if (!lot) throw httpError(404, "指定された在庫ロットが見つかりません");
    if (lot.quantity_remaining < qty) throw httpError(400, "在庫が不足しています");
  } else {
    lot = get(
      `SELECT * FROM inventory_lots
       WHERE product_id = ? AND status = 'active' AND quantity_remaining >= ?
       ORDER BY (expiration_date IS NULL), expiration_date ASC, id ASC LIMIT 1`,
      [b.product_id, qty]
    );
    if (!lot) throw httpError(400, "十分な在庫を持つロットがありません。在庫を確認するかロットを指定してください");
  }

  const saleDate = b.sale_date || today();
  const r = run(
    `INSERT INTO sales (customer_id, sale_date, product_id, lot_id, quantity, unit_price, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [b.customer_id || null, saleDate, b.product_id, lot.id, qty, numOrNull(b.unit_price), b.notes || null]
  );

  const newRemaining = lot.quantity_remaining - qty;
  run("UPDATE inventory_lots SET quantity_remaining = ?, status = ? WHERE id = ?",
    [newRemaining, newRemaining <= 0 ? "depleted" : "active", lot.id]);
  run(
    `INSERT INTO stock_movements (lot_id, product_id, movement_type, quantity, related_type, related_id, memo)
     VALUES (?, ?, 'sale_out', ?, 'sale', ?, ?)`,
    [lot.id, b.product_id, -qty, r.lastInsertRowid, b.notes || null]
  );

  return get("SELECT * FROM sales WHERE id = ?", [r.lastInsertRowid]);
}

function updateSale(id, b) {
  const sale = get("SELECT * FROM sales WHERE id = ?", [id]);
  if (!sale) throw httpError(404, "販売記録が見つかりません");
  if (b.status === "canceled" && sale.status !== "canceled") {
    if (sale.lot_id) {
      const lot = get("SELECT * FROM inventory_lots WHERE id = ?", [sale.lot_id]);
      if (lot) {
        const newRemaining = lot.quantity_remaining + sale.quantity;
        run("UPDATE inventory_lots SET quantity_remaining = ?, status = 'active' WHERE id = ?", [newRemaining, lot.id]);
        run(
          `INSERT INTO stock_movements (lot_id, product_id, movement_type, quantity, related_type, related_id, memo)
           VALUES (?, ?, 'adjustment', ?, 'sale_cancel', ?, ?)`,
          [lot.id, sale.product_id, sale.quantity, id, "販売キャンセルによる戻し入れ"]
        );
      }
    }
  }
  run("UPDATE sales SET status = ?, notes = ? WHERE id = ?",
    [b.status || sale.status, b.notes !== undefined ? b.notes : sale.notes, id]);
  return get("SELECT * FROM sales WHERE id = ?", [id]);
}

// ---------- 配送 ----------
function listDeliveries() {
  return all(`
    SELECT d.*, c.name AS customer_name, s.product_id, s.quantity AS sale_quantity, p.name AS product_name
    FROM deliveries d
    LEFT JOIN partners c ON c.id = d.customer_id
    LEFT JOIN sales s ON s.id = d.sale_id
    LEFT JOIN products p ON p.id = s.product_id
    ORDER BY (d.scheduled_date IS NULL), d.scheduled_date ASC, d.id DESC
  `);
}

function createDelivery(b) {
  const r = run(
    `INSERT INTO deliveries (sale_id, customer_id, scheduled_date, driver, notes, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [b.sale_id || null, b.customer_id || null, b.scheduled_date || null, b.driver || null, b.notes || null]
  );
  return get("SELECT * FROM deliveries WHERE id = ?", [r.lastInsertRowid]);
}

function updateDelivery(id, b) {
  const existing = get("SELECT * FROM deliveries WHERE id = ?", [id]);
  if (!existing) throw httpError(404, "配送記録が見つかりません");
  const status = b.status !== undefined ? b.status : existing.status;
  const deliveredDate = status === "completed" && !existing.delivered_date && !b.delivered_date
    ? today()
    : (b.delivered_date !== undefined ? b.delivered_date : existing.delivered_date);
  run(
    `UPDATE deliveries SET scheduled_date=?, delivered_date=?, status=?, driver=?, notes=? WHERE id=?`,
    [
      b.scheduled_date !== undefined ? b.scheduled_date : existing.scheduled_date,
      deliveredDate,
      status,
      b.driver !== undefined ? b.driver : existing.driver,
      b.notes !== undefined ? b.notes : existing.notes,
      id,
    ]
  );
  return get("SELECT * FROM deliveries WHERE id = ?", [id]);
}

// ---------- 回収 ----------
function listCollections() {
  return all(`
    SELECT col.*, pt.name AS partner_name, pr.name AS product_name
    FROM collections col
    LEFT JOIN partners pt ON pt.id = col.partner_id
    LEFT JOIN products pr ON pr.id = col.product_id
    ORDER BY (col.scheduled_date IS NULL), col.scheduled_date ASC, col.id DESC
  `);
}

function createCollection(b) {
  if (!b.type || !["pop", "unsold_return"].includes(b.type)) {
    throw httpError(400, "回収種別(pop または unsold_return)を指定してください");
  }
  const r = run(
    `INSERT INTO collections (type, partner_id, product_id, item_name, quantity, reason, scheduled_date, notes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned')`,
    [b.type, b.partner_id || null, b.product_id || null, b.item_name || null,
      numOrNull(b.quantity), b.reason || null, b.scheduled_date || null, b.notes || null]
  );
  return get("SELECT * FROM collections WHERE id = ?", [r.lastInsertRowid]);
}

function updateCollection(id, b) {
  const existing = get("SELECT * FROM collections WHERE id = ?", [id]);
  if (!existing) throw httpError(404, "回収記録が見つかりません");
  const status = b.status !== undefined ? b.status : existing.status;
  const collectedDate = status === "completed" && !existing.collected_date && !b.collected_date
    ? today()
    : (b.collected_date !== undefined ? b.collected_date : existing.collected_date);
  run(
    `UPDATE collections SET status=?, collected_date=?, notes=? WHERE id=?`,
    [status, collectedDate, b.notes !== undefined ? b.notes : existing.notes, id]
  );
  return get("SELECT * FROM collections WHERE id = ?", [id]);
}

function deleteCollection(id) {
  run("DELETE FROM collections WHERE id = ?", [id]);
}

// ---------- ヘルパー ----------
function numOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// ---------- ルーティング ----------
const routes = [
  { method: "GET", pattern: /^\/api\/products$/, handler: (q) => listProducts(q) },
  { method: "POST", pattern: /^\/api\/products$/, handler: (q, b) => createProduct(b) },
  { method: "PUT", pattern: /^\/api\/products\/(\d+)$/, handler: (q, b, m) => updateProduct(m[1], b) },
  { method: "DELETE", pattern: /^\/api\/products\/(\d+)$/, handler: (q, b, m) => { deleteProduct(m[1]); return { ok: true }; } },

  { method: "GET", pattern: /^\/api\/partners$/, handler: (q) => listPartners(q) },
  { method: "POST", pattern: /^\/api\/partners$/, handler: (q, b) => createPartner(b) },
  { method: "PUT", pattern: /^\/api\/partners\/(\d+)$/, handler: (q, b, m) => updatePartner(m[1], b) },
  { method: "DELETE", pattern: /^\/api\/partners\/(\d+)$/, handler: (q, b, m) => { deletePartner(m[1]); return { ok: true }; } },

  { method: "GET", pattern: /^\/api\/purchases$/, handler: () => listPurchases() },
  { method: "POST", pattern: /^\/api\/purchases$/, handler: (q, b) => createPurchase(b) },
  { method: "DELETE", pattern: /^\/api\/purchases\/(\d+)$/, handler: (q, b, m) => { deletePurchase(m[1]); return { ok: true }; } },

  { method: "GET", pattern: /^\/api\/inventory\/lots$/, handler: (q) => listLots(q) },
  { method: "POST", pattern: /^\/api\/inventory\/lots\/(\d+)\/adjust$/, handler: (q, b, m) => adjustLot(m[1], b) },

  { method: "GET", pattern: /^\/api\/sales$/, handler: () => listSales() },
  { method: "POST", pattern: /^\/api\/sales$/, handler: (q, b) => createSale(b) },
  { method: "PUT", pattern: /^\/api\/sales\/(\d+)$/, handler: (q, b, m) => updateSale(m[1], b) },

  { method: "GET", pattern: /^\/api\/deliveries$/, handler: () => listDeliveries() },
  { method: "POST", pattern: /^\/api\/deliveries$/, handler: (q, b) => createDelivery(b) },
  { method: "PUT", pattern: /^\/api\/deliveries\/(\d+)$/, handler: (q, b, m) => updateDelivery(m[1], b) },

  { method: "GET", pattern: /^\/api\/collections$/, handler: () => listCollections() },
  { method: "POST", pattern: /^\/api\/collections$/, handler: (q, b) => createCollection(b) },
  { method: "PUT", pattern: /^\/api\/collections\/(\d+)$/, handler: (q, b, m) => updateCollection(m[1], b) },
  { method: "DELETE", pattern: /^\/api\/collections\/(\d+)$/, handler: (q, b, m) => { deleteCollection(m[1]); return { ok: true }; } },
];

// ---------- 静的ファイル配信 ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function serveStatic(req, res, pathname) {
  let filePath;
  if (pathname === "/" || pathname === "/index.html") {
    filePath = path.join(ROOT, "index.html");
  } else if (pathname === "/app.js") {
    filePath = path.join(ROOT, "public", "app.js");
  } else {
    filePath = null;
  }
  if (!filePath || !fs.existsSync(filePath)) {
    sendError(res, 404, "Not Found");
    return;
  }
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendError(res, 500, "ファイルの読み込みに失敗しました");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (!pathname.startsWith("/api/")) {
    if (req.method === "GET") serveStatic(req, res, pathname);
    else sendError(res, 405, "Method Not Allowed");
    return;
  }

  const route = routes.find((r) => r.method === req.method && r.pattern.test(pathname));
  if (!route) {
    sendError(res, 404, "APIエンドポイントが見つかりません");
    return;
  }

  try {
    const body = ["POST", "PUT"].includes(req.method) ? await readBody(req) : {};
    const match = pathname.match(route.pattern);
    const result = route.handler(url.searchParams, body, match);
    sendJson(res, 200, result);
  } catch (e) {
    sendError(res, e.status || 500, e.message || "サーバーエラーが発生しました");
  }
});

server.listen(PORT, () => {
  console.log(`在庫・販売管理サーバーが起動しました: http://localhost:${PORT}`);
});
