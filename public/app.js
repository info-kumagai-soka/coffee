// 仕入・在庫・賞味期限・販売・配送・回収管理タブのフロントエンド(バニラJS + fetch)
(function () {
  const API = "/api";

  async function api(path, options) {
    const res = await fetch(API + path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) throw new Error((data && data.error) || `エラーが発生しました (${res.status})`);
    return data;
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function fmtNum(n) {
    if (n === null || n === undefined || n === "") return "-";
    const num = Number(n);
    return Number.isInteger(num) ? String(num) : String(Math.round(num * 100) / 100);
  }

  function fmtYen(n) {
    if (n === null || n === undefined || n === "") return "-";
    return `¥${Number(n).toLocaleString("ja-JP")}`;
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function connectionErrorHtml(e) {
    return `<div class="card"><div class="empty">データの読み込みに失敗しました: ${escapeHtml(e.message)}<br>サーバーが起動しているか確認してください(node server/server.js)。</div></div>`;
  }

  const STATUS_LABELS = {
    confirmed: "確定", delivered: "配送済", canceled: "キャンセル",
    pending: "準備中", in_transit: "配送中", completed: "完了", delayed: "延期",
    planned: "予定",
    active: "在庫あり", depleted: "在庫切れ", disposed: "廃棄済",
  };
  function statusBadge(status) {
    const label = STATUS_LABELS[status] || status || "-";
    let cls = "";
    if (["canceled", "delayed", "disposed"].includes(status)) cls = "danger";
    else if (["completed", "active"].includes(status)) cls = "ok";
    return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
  }

  function optionsHtml(items, valueKey, labelFn, selectedValue) {
    return items.map((it) => `<option value="${it[valueKey]}" ${String(it[valueKey]) === String(selectedValue) ? "selected" : ""}>${escapeHtml(labelFn(it))}</option>`).join("");
  }

  // ================= 商品・取引先マスタ =================
  const masterState = { tab: "products", editProductId: null, editPartnerId: null };

  async function renderMaster() {
    const root = document.getElementById("master-root");
    root.innerHTML = `
      <div class="subtabs">
        <button data-tab="products" class="${masterState.tab === "products" ? "active" : ""}">商品</button>
        <button data-tab="partners" class="${masterState.tab === "partners" ? "active" : ""}">取引先(仕入先・得意先)</button>
      </div>
      <div id="master-body"></div>
    `;
    root.querySelectorAll(".subtabs button").forEach((btn) => {
      btn.addEventListener("click", () => { masterState.tab = btn.dataset.tab; renderMaster(); });
    });
    if (masterState.tab === "products") await renderProducts();
    else await renderPartners();
  }

  async function renderProducts() {
    const body = document.getElementById("master-body");
    let products;
    try {
      products = await api("/products");
    } catch (e) { body.innerHTML = connectionErrorHtml(e); return; }
    const editing = products.find((p) => p.id === masterState.editProductId);
    body.innerHTML = `
      <div class="card">
        <h2>${editing ? "商品を編集" : "商品を登録"}</h2>
        <form id="product-form">
          <div class="row2">
            <div class="field"><label>商品名</label><input type="text" id="pf-name" required value="${editing ? escapeHtml(editing.name) : ""}" /></div>
            <div class="field"><label>カテゴリ</label><input type="text" id="pf-category" value="${escapeHtml(editing?.category || "")}" placeholder="例: 豆・カップ・POP資材" /></div>
          </div>
          <div class="row3">
            <div class="field"><label>単位</label><input type="text" id="pf-unit" value="${escapeHtml(editing ? editing.unit : "個")}" /></div>
            <div class="field"><label>仕入単価</label><input type="number" step="0.01" id="pf-purchase-price" value="${editing?.purchase_price ?? ""}" /></div>
            <div class="field"><label>販売単価</label><input type="number" step="0.01" id="pf-sale-price" value="${editing?.sale_price ?? ""}" /></div>
          </div>
          <div class="field"><label>SKU・備考</label><input type="text" id="pf-sku" value="${escapeHtml(editing?.sku || "")}" /></div>
          <div class="btn-row">
            <button type="submit" class="btn">${editing ? "更新を保存" : "登録"}</button>
            ${editing ? `<button type="button" class="btn secondary" id="pf-cancel">キャンセル</button>` : ""}
          </div>
          <div class="form-msg" id="pf-msg"></div>
        </form>
      </div>
      <div class="card">
        <div class="section-title"><h3>商品一覧</h3><span class="hint">${products.length}件</span></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>商品名</th><th>カテゴリ</th><th>単位</th><th>仕入単価</th><th>販売単価</th><th>状態</th><th></th></tr></thead>
            <tbody>
              ${products.map((p) => `
                <tr>
                  <td>${escapeHtml(p.name)}</td>
                  <td>${escapeHtml(p.category || "-")}</td>
                  <td>${escapeHtml(p.unit)}</td>
                  <td>${fmtYen(p.purchase_price)}</td>
                  <td>${fmtYen(p.sale_price)}</td>
                  <td>${p.is_active ? '<span class="badge ok">有効</span>' : '<span class="badge">無効</span>'}</td>
                  <td class="row-actions">
                    <button data-edit="${p.id}">編集</button>
                    <button data-toggle="${p.id}">${p.is_active ? "無効化" : "有効化"}</button>
                    <button data-delete="${p.id}">削除</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        ${products.length === 0 ? '<div class="empty">商品が登録されていません</div>' : ""}
      </div>
    `;

    document.getElementById("product-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("pf-msg");
      const payload = {
        name: document.getElementById("pf-name").value.trim(),
        category: document.getElementById("pf-category").value.trim() || null,
        unit: document.getElementById("pf-unit").value.trim() || "個",
        purchase_price: document.getElementById("pf-purchase-price").value || null,
        sale_price: document.getElementById("pf-sale-price").value || null,
        sku: document.getElementById("pf-sku").value.trim() || null,
      };
      try {
        if (editing) await api(`/products/${editing.id}`, { method: "PUT", body: JSON.stringify(payload) });
        else await api("/products", { method: "POST", body: JSON.stringify(payload) });
        masterState.editProductId = null;
        await renderProducts();
      } catch (err) {
        msg.textContent = err.message;
        msg.className = "form-msg error";
      }
    });
    const cancelBtn = document.getElementById("pf-cancel");
    if (cancelBtn) cancelBtn.addEventListener("click", () => { masterState.editProductId = null; renderProducts(); });

    body.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => {
      masterState.editProductId = Number(btn.dataset.edit); renderProducts();
    }));
    body.querySelectorAll("[data-toggle]").forEach((btn) => btn.addEventListener("click", async () => {
      const p = products.find((x) => x.id === Number(btn.dataset.toggle));
      try { await api(`/products/${p.id}`, { method: "PUT", body: JSON.stringify({ is_active: p.is_active ? 0 : 1 }) }); await renderProducts(); }
      catch (err) { alert(err.message); }
    }));
    body.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", async () => {
      if (!confirm("この商品を削除しますか?(関連する仕入・在庫・販売の履歴は残ります)")) return;
      try { await api(`/products/${btn.dataset.delete}`, { method: "DELETE" }); await renderProducts(); }
      catch (err) { alert(err.message); }
    }));
  }

  async function renderPartners() {
    const body = document.getElementById("master-body");
    let partners;
    try {
      partners = await api("/partners");
    } catch (e) { body.innerHTML = connectionErrorHtml(e); return; }
    const editing = partners.find((p) => p.id === masterState.editPartnerId);
    const roleLabel = { supplier: "仕入先", customer: "得意先", both: "仕入先/得意先" };
    body.innerHTML = `
      <div class="card">
        <h2>${editing ? "取引先を編集" : "取引先を登録"}</h2>
        <form id="partner-form">
          <div class="row2">
            <div class="field"><label>取引先名</label><input type="text" id="pn-name" required value="${escapeHtml(editing?.name || "")}" /></div>
            <div class="field"><label>区分</label>
              <select id="pn-role">
                <option value="both" ${!editing || editing.role === "both" ? "selected" : ""}>仕入先/得意先 両方</option>
                <option value="supplier" ${editing?.role === "supplier" ? "selected" : ""}>仕入先のみ</option>
                <option value="customer" ${editing?.role === "customer" ? "selected" : ""}>得意先のみ</option>
              </select>
            </div>
          </div>
          <div class="row2">
            <div class="field"><label>担当者</label><input type="text" id="pn-contact" value="${escapeHtml(editing?.contact_name || "")}" /></div>
            <div class="field"><label>電話番号</label><input type="text" id="pn-phone" value="${escapeHtml(editing?.phone || "")}" /></div>
          </div>
          <div class="field"><label>住所・メモ</label><textarea id="pn-address">${escapeHtml(editing?.address || "")}</textarea></div>
          <div class="btn-row">
            <button type="submit" class="btn">${editing ? "更新を保存" : "登録"}</button>
            ${editing ? `<button type="button" class="btn secondary" id="pn-cancel">キャンセル</button>` : ""}
          </div>
          <div class="form-msg" id="pn-msg"></div>
        </form>
      </div>
      <div class="card">
        <div class="section-title"><h3>取引先一覧</h3><span class="hint">${partners.length}件</span></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>名称</th><th>区分</th><th>担当者</th><th>電話番号</th><th></th></tr></thead>
            <tbody>
              ${partners.map((p) => `
                <tr>
                  <td>${escapeHtml(p.name)}</td>
                  <td>${roleLabel[p.role] || p.role}</td>
                  <td>${escapeHtml(p.contact_name || "-")}</td>
                  <td>${escapeHtml(p.phone || "-")}</td>
                  <td class="row-actions">
                    <button data-edit="${p.id}">編集</button>
                    <button data-delete="${p.id}">削除</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        ${partners.length === 0 ? '<div class="empty">取引先が登録されていません</div>' : ""}
      </div>
    `;

    document.getElementById("partner-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("pn-msg");
      const payload = {
        name: document.getElementById("pn-name").value.trim(),
        role: document.getElementById("pn-role").value,
        contact_name: document.getElementById("pn-contact").value.trim() || null,
        phone: document.getElementById("pn-phone").value.trim() || null,
        address: document.getElementById("pn-address").value.trim() || null,
      };
      try {
        if (editing) await api(`/partners/${editing.id}`, { method: "PUT", body: JSON.stringify(payload) });
        else await api("/partners", { method: "POST", body: JSON.stringify(payload) });
        masterState.editPartnerId = null;
        await renderPartners();
      } catch (err) {
        msg.textContent = err.message;
        msg.className = "form-msg error";
      }
    });
    const cancelBtn = document.getElementById("pn-cancel");
    if (cancelBtn) cancelBtn.addEventListener("click", () => { masterState.editPartnerId = null; renderPartners(); });

    body.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => {
      masterState.editPartnerId = Number(btn.dataset.edit); renderPartners();
    }));
    body.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", async () => {
      if (!confirm("この取引先を削除しますか?")) return;
      try { await api(`/partners/${btn.dataset.delete}`, { method: "DELETE" }); await renderPartners(); }
      catch (err) { alert(err.message); }
    }));
  }

  // ================= 仕入 =================
  async function renderPurchase() {
    const root = document.getElementById("purchase-root");
    let products, suppliers, purchases;
    try {
      [products, suppliers, purchases] = await Promise.all([
        api("/products?active=1"), api("/partners?role=supplier"), api("/purchases"),
      ]);
    } catch (e) { root.innerHTML = connectionErrorHtml(e); return; }

    root.innerHTML = `
      <div class="card">
        <h2>仕入・入荷を登録</h2>
        <p class="hint">入荷すると自動的に在庫ロットが作成され、賞味期限で管理されます。</p>
        <form id="purchase-form">
          <div class="row2">
            <div class="field"><label>商品</label><select id="pu-product" required><option value="">選択してください</option>${optionsHtml(products, "id", (p) => p.name)}</select></div>
            <div class="field"><label>仕入先</label><select id="pu-supplier"><option value="">未選択</option>${optionsHtml(suppliers, "id", (p) => p.name)}</select></div>
          </div>
          <div class="row3">
            <div class="field"><label>仕入日</label><input type="date" id="pu-date" value="${todayStr()}" /></div>
            <div class="field"><label>数量</label><input type="number" step="0.01" id="pu-qty" required min="0" /></div>
            <div class="field"><label>仕入単価</label><input type="number" step="0.01" id="pu-price" /></div>
          </div>
          <div class="row3">
            <div class="field"><label>ロット番号</label><input type="text" id="pu-lot" placeholder="任意" /></div>
            <div class="field"><label>賞味期限</label><input type="date" id="pu-expiration" /></div>
            <div class="field"><label>保管場所</label><input type="text" id="pu-location" placeholder="例: 倉庫A" /></div>
          </div>
          <div class="field"><label>備考</label><textarea id="pu-notes"></textarea></div>
          <div class="btn-row"><button type="submit" class="btn">仕入・入荷を登録</button></div>
          <div class="form-msg" id="pu-msg"></div>
        </form>
      </div>
      <div class="card">
        <div class="section-title"><h3>仕入履歴</h3><span class="hint">${purchases.length}件</span></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>日付</th><th>商品</th><th>仕入先</th><th>数量</th><th>単価</th><th>ロット</th><th>賞味期限</th><th>在庫残</th><th></th></tr></thead>
            <tbody>
              ${purchases.map((p) => `
                <tr>
                  <td>${escapeHtml(p.purchase_date)}</td>
                  <td>${escapeHtml(p.product_name || "-")}</td>
                  <td>${escapeHtml(p.supplier_name || "-")}</td>
                  <td>${fmtNum(p.quantity)} ${escapeHtml(p.product_unit || "")}</td>
                  <td>${fmtYen(p.unit_price)}</td>
                  <td>${escapeHtml(p.lot_number || "-")}</td>
                  <td>${escapeHtml(p.expiration_date || "-")}</td>
                  <td>${p.lot_remaining != null ? fmtNum(p.lot_remaining) : "-"}</td>
                  <td class="row-actions"><button data-delete="${p.id}">削除</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        ${purchases.length === 0 ? '<div class="empty">仕入記録がありません</div>' : ""}
      </div>
    `;

    document.getElementById("purchase-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("pu-msg");
      const payload = {
        product_id: document.getElementById("pu-product").value,
        supplier_id: document.getElementById("pu-supplier").value || null,
        purchase_date: document.getElementById("pu-date").value,
        quantity: document.getElementById("pu-qty").value,
        unit_price: document.getElementById("pu-price").value || null,
        lot_number: document.getElementById("pu-lot").value.trim() || null,
        expiration_date: document.getElementById("pu-expiration").value || null,
        warehouse_location: document.getElementById("pu-location").value.trim() || null,
        notes: document.getElementById("pu-notes").value.trim() || null,
      };
      try {
        await api("/purchases", { method: "POST", body: JSON.stringify(payload) });
        await renderPurchase();
      } catch (err) {
        msg.textContent = err.message;
        msg.className = "form-msg error";
      }
    });
    root.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", async () => {
      if (!confirm("この仕入記録を削除しますか?")) return;
      try { await api(`/purchases/${btn.dataset.delete}`, { method: "DELETE" }); await renderPurchase(); }
      catch (err) { alert(err.message); }
    }));
  }

  // ================= 在庫・賞味期限 =================
  const inventoryState = { productFilter: "" };

  async function renderInventory() {
    const root = document.getElementById("inventory-root");
    let products, lots;
    try {
      const q = inventoryState.productFilter ? `?product_id=${inventoryState.productFilter}` : "";
      [products, lots] = await Promise.all([api("/products"), api(`/inventory/lots${q}`)]);
    } catch (e) { root.innerHTML = connectionErrorHtml(e); return; }

    root.innerHTML = `
      <div class="card">
        <div class="section-title"><h3>在庫一覧(賞味期限が近い順)</h3><span class="hint">${lots.length}件</span></div>
        <div class="field" style="max-width:280px;">
          <label>商品で絞り込み</label>
          <select id="inv-filter">
            <option value="">すべての商品</option>
            ${optionsHtml(products, "id", (p) => p.name, inventoryState.productFilter)}
          </select>
        </div>
        <p class="hint">期限まで7日以内は<span class="badge warn">警告</span>、期限切れ・在庫切れは<span class="badge danger">危険</span>で表示されます。</p>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>商品</th><th>ロット</th><th>保管場所</th><th>残数</th><th>賞味期限</th><th>残り日数</th><th>状態</th><th></th></tr></thead>
            <tbody>
              ${lots.map((l) => {
                let rowCls = "";
                let daysLabel = "-";
                if (l.expiration_date) {
                  const d = l.days_until_expiration;
                  daysLabel = d >= 0 ? `あと${d}日` : `${Math.abs(d)}日経過`;
                  if (d < 0) rowCls = "row-danger";
                  else if (d <= 7) rowCls = "row-warn";
                }
                if (l.status !== "active") rowCls = "row-danger";
                return `
                <tr class="${rowCls}">
                  <td>${escapeHtml(l.product_name || "-")}</td>
                  <td>${escapeHtml(l.lot_number || "-")}</td>
                  <td>${escapeHtml(l.warehouse_location || "-")}</td>
                  <td>${fmtNum(l.quantity_remaining)} ${escapeHtml(l.product_unit || "")}</td>
                  <td>${escapeHtml(l.expiration_date || "-")}</td>
                  <td>${daysLabel}</td>
                  <td>${statusBadge(l.status)}</td>
                  <td class="row-actions">
                    <button data-adjust="${l.id}">調整</button>
                    <button data-dispose="${l.id}">廃棄</button>
                  </td>
                </tr>
              `;
              }).join("")}
            </tbody>
          </table>
        </div>
        ${lots.length === 0 ? '<div class="empty">在庫データがありません</div>' : ""}
      </div>
    `;

    document.getElementById("inv-filter").addEventListener("change", (e) => {
      inventoryState.productFilter = e.target.value; renderInventory();
    });

    async function adjustLotPrompt(lotId, type) {
      const lot = lots.find((l) => l.id === lotId);
      const label = type === "disposal" ? "廃棄する数量" : "調整する数量(在庫を減らす場合は負の数)";
      const input = prompt(`${label}を入力してください(現在の残数: ${fmtNum(lot.quantity_remaining)})`, "");
      if (input === null || input.trim() === "") return;
      const val = Number(input);
      if (Number.isNaN(val) || val === 0) { alert("有効な数値を入力してください"); return; }
      const delta = type === "disposal" ? -Math.abs(val) : val;
      try {
        await api(`/inventory/lots/${lotId}/adjust`, { method: "POST", body: JSON.stringify({ delta, type, memo: type === "disposal" ? "廃棄処理" : "在庫調整" }) });
        await renderInventory();
      } catch (err) { alert(err.message); }
    }
    root.querySelectorAll("[data-adjust]").forEach((btn) => btn.addEventListener("click", () => adjustLotPrompt(Number(btn.dataset.adjust), "adjustment")));
    root.querySelectorAll("[data-dispose]").forEach((btn) => btn.addEventListener("click", () => adjustLotPrompt(Number(btn.dataset.dispose), "disposal")));
  }

  // ================= 販売 =================
  async function renderSales() {
    const root = document.getElementById("sales-root");
    let products, customers, sales;
    try {
      [products, customers, sales] = await Promise.all([
        api("/products?active=1"), api("/partners?role=customer"), api("/sales"),
      ]);
    } catch (e) { root.innerHTML = connectionErrorHtml(e); return; }

    root.innerHTML = `
      <div class="card">
        <h2>販売を登録</h2>
        <form id="sale-form">
          <div class="row2">
            <div class="field"><label>商品</label><select id="sa-product" required><option value="">選択してください</option>${optionsHtml(products, "id", (p) => p.name)}</select></div>
            <div class="field"><label>得意先</label><select id="sa-customer"><option value="">未選択</option>${optionsHtml(customers, "id", (p) => p.name)}</select></div>
          </div>
          <div class="row2">
            <div class="field"><label>在庫ロット</label><select id="sa-lot"><option value="">自動選択(賞味期限が近い順)</option></select></div>
            <div class="field"><label>販売日</label><input type="date" id="sa-date" value="${todayStr()}" /></div>
          </div>
          <div class="row2">
            <div class="field"><label>数量</label><input type="number" step="0.01" min="0" id="sa-qty" required /></div>
            <div class="field"><label>販売単価</label><input type="number" step="0.01" id="sa-price" /></div>
          </div>
          <div class="field"><label>備考</label><textarea id="sa-notes"></textarea></div>
          <div class="btn-row"><button type="submit" class="btn">販売を登録</button></div>
          <div class="form-msg" id="sa-msg"></div>
        </form>
      </div>
      <div class="card">
        <div class="section-title"><h3>販売履歴</h3><span class="hint">${sales.length}件</span></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>日付</th><th>商品</th><th>得意先</th><th>数量</th><th>単価</th><th>ロット</th><th>状態</th><th></th></tr></thead>
            <tbody>
              ${sales.map((s) => `
                <tr>
                  <td>${escapeHtml(s.sale_date)}</td>
                  <td>${escapeHtml(s.product_name || "-")}</td>
                  <td>${escapeHtml(s.customer_name || "-")}</td>
                  <td>${fmtNum(s.quantity)} ${escapeHtml(s.product_unit || "")}</td>
                  <td>${fmtYen(s.unit_price)}</td>
                  <td>${escapeHtml(s.lot_number || "-")}</td>
                  <td>${statusBadge(s.status)}</td>
                  <td class="row-actions">
                    ${s.status !== "canceled" ? `<button data-cancel="${s.id}">キャンセル</button><button data-deliver="${s.id}" data-customer="${s.customer_id || ""}">配送登録</button>` : ""}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        ${sales.length === 0 ? '<div class="empty">販売記録がありません</div>' : ""}
      </div>
    `;

    const productSelect = document.getElementById("sa-product");
    const lotSelect = document.getElementById("sa-lot");
    productSelect.addEventListener("change", async () => {
      lotSelect.innerHTML = '<option value="">自動選択(賞味期限が近い順)</option>';
      if (!productSelect.value) return;
      try {
        const lots = await api(`/inventory/lots?product_id=${productSelect.value}`);
        lotSelect.innerHTML += lots.map((l) => `<option value="${l.id}">${escapeHtml(l.lot_number || `ロット#${l.id}`)} / 期限:${escapeHtml(l.expiration_date || "なし")} / 残${fmtNum(l.quantity_remaining)}</option>`).join("");
      } catch (err) { /* 一覧取得失敗時は自動選択のみ */ }
      const product = products.find((p) => p.id === Number(productSelect.value));
      if (product && product.sale_price != null) document.getElementById("sa-price").value = product.sale_price;
    });

    document.getElementById("sale-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("sa-msg");
      const payload = {
        product_id: productSelect.value,
        customer_id: document.getElementById("sa-customer").value || null,
        lot_id: lotSelect.value || null,
        sale_date: document.getElementById("sa-date").value,
        quantity: document.getElementById("sa-qty").value,
        unit_price: document.getElementById("sa-price").value || null,
        notes: document.getElementById("sa-notes").value.trim() || null,
      };
      try {
        await api("/sales", { method: "POST", body: JSON.stringify(payload) });
        await renderSales();
      } catch (err) {
        msg.textContent = err.message;
        msg.className = "form-msg error";
      }
    });

    root.querySelectorAll("[data-cancel]").forEach((btn) => btn.addEventListener("click", async () => {
      if (!confirm("この販売をキャンセルしますか?(在庫に戻し入れされます)")) return;
      try { await api(`/sales/${btn.dataset.cancel}`, { method: "PUT", body: JSON.stringify({ status: "canceled" }) }); await renderSales(); }
      catch (err) { alert(err.message); }
    }));
    root.querySelectorAll("[data-deliver]").forEach((btn) => btn.addEventListener("click", async () => {
      const scheduled = prompt("配送予定日を入力してください(YYYY-MM-DD、空欄可)", todayStr());
      if (scheduled === null) return;
      try {
        await api("/deliveries", { method: "POST", body: JSON.stringify({ sale_id: btn.dataset.deliver, customer_id: btn.dataset.customer || null, scheduled_date: scheduled || null }) });
        alert("配送予定を登録しました。「配送」タブから確認できます。");
      } catch (err) { alert(err.message); }
    }));
  }

  // ================= 配送 =================
  async function renderDelivery() {
    const root = document.getElementById("delivery-root");
    let customers, sales, deliveries;
    try {
      [customers, sales, deliveries] = await Promise.all([api("/partners?role=customer"), api("/sales"), api("/deliveries")]);
    } catch (e) { root.innerHTML = connectionErrorHtml(e); return; }

    root.innerHTML = `
      <div class="card">
        <h2>配送を登録</h2>
        <form id="delivery-form">
          <div class="row2">
            <div class="field"><label>得意先</label><select id="de-customer"><option value="">未選択</option>${optionsHtml(customers, "id", (p) => p.name)}</select></div>
            <div class="field"><label>関連する販売</label><select id="de-sale"><option value="">なし</option>${optionsHtml(sales, "id", (s) => `${s.sale_date} ${s.product_name} x${s.quantity}`)}</select></div>
          </div>
          <div class="row2">
            <div class="field"><label>配送予定日</label><input type="date" id="de-date" value="${todayStr()}" /></div>
            <div class="field"><label>担当・車両</label><input type="text" id="de-driver" /></div>
          </div>
          <div class="field"><label>備考</label><textarea id="de-notes"></textarea></div>
          <div class="btn-row"><button type="submit" class="btn">配送を登録</button></div>
          <div class="form-msg" id="de-msg"></div>
        </form>
      </div>
      <div class="card">
        <div class="section-title"><h3>配送一覧</h3><span class="hint">${deliveries.length}件</span></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>予定日</th><th>得意先</th><th>商品</th><th>担当</th><th>完了日</th><th>状態</th><th></th></tr></thead>
            <tbody>
              ${deliveries.map((d) => `
                <tr>
                  <td>${escapeHtml(d.scheduled_date || "-")}</td>
                  <td>${escapeHtml(d.customer_name || "-")}</td>
                  <td>${escapeHtml(d.product_name ? `${d.product_name} x${fmtNum(d.sale_quantity)}` : "-")}</td>
                  <td>${escapeHtml(d.driver || "-")}</td>
                  <td>${escapeHtml(d.delivered_date || "-")}</td>
                  <td>${statusBadge(d.status)}</td>
                  <td class="row-actions">
                    <select data-status="${d.id}">
                      ${["pending", "in_transit", "completed", "delayed", "canceled"].map((s) => `<option value="${s}" ${s === d.status ? "selected" : ""}>${STATUS_LABELS[s]}</option>`).join("")}
                    </select>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        ${deliveries.length === 0 ? '<div class="empty">配送記録がありません</div>' : ""}
      </div>
    `;

    document.getElementById("delivery-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("de-msg");
      const payload = {
        customer_id: document.getElementById("de-customer").value || null,
        sale_id: document.getElementById("de-sale").value || null,
        scheduled_date: document.getElementById("de-date").value || null,
        driver: document.getElementById("de-driver").value.trim() || null,
        notes: document.getElementById("de-notes").value.trim() || null,
      };
      try {
        await api("/deliveries", { method: "POST", body: JSON.stringify(payload) });
        await renderDelivery();
      } catch (err) {
        msg.textContent = err.message;
        msg.className = "form-msg error";
      }
    });
    root.querySelectorAll("[data-status]").forEach((sel) => sel.addEventListener("change", async () => {
      try { await api(`/deliveries/${sel.dataset.status}`, { method: "PUT", body: JSON.stringify({ status: sel.value }) }); await renderDelivery(); }
      catch (err) { alert(err.message); }
    }));
  }

  // ================= 回収 =================
  const TYPE_LABELS = { pop: "POP・広告物回収", unsold_return: "売れ残り・返品回収" };

  async function renderCollection() {
    const root = document.getElementById("collection-root");
    let partners, products, collections;
    try {
      [partners, products, collections] = await Promise.all([api("/partners"), api("/products"), api("/collections")]);
    } catch (e) { root.innerHTML = connectionErrorHtml(e); return; }

    root.innerHTML = `
      <div class="card">
        <h2>回収を登録</h2>
        <p class="hint">店舗のPOP・広告物の回収や、売れ残り・返品商品(賞味期限接近品を含む)の回収予定を管理します。</p>
        <form id="collection-form">
          <div class="row2">
            <div class="field"><label>回収種別</label>
              <select id="co-type">
                <option value="unsold_return">売れ残り・返品商品の回収</option>
                <option value="pop">POP・広告物の回収</option>
              </select>
            </div>
            <div class="field"><label>回収先(店舗・取引先)</label><select id="co-partner"><option value="">未選択</option>${optionsHtml(partners, "id", (p) => p.name)}</select></div>
          </div>
          <div class="row2">
            <div class="field" id="co-product-field"><label>対象商品</label><select id="co-product"><option value="">選択なし</option>${optionsHtml(products, "id", (p) => p.name)}</select></div>
            <div class="field"><label>品目名(商品マスタにない場合)</label><input type="text" id="co-item-name" placeholder="例: 店頭ポスターA" /></div>
          </div>
          <div class="row3">
            <div class="field"><label>数量</label><input type="number" step="0.01" id="co-qty" /></div>
            <div class="field"><label>回収予定日</label><input type="date" id="co-date" value="${todayStr()}" /></div>
            <div class="field"><label>理由</label><input type="text" id="co-reason" placeholder="例: 販促期間終了・賞味期限接近" /></div>
          </div>
          <div class="field"><label>備考</label><textarea id="co-notes"></textarea></div>
          <div class="btn-row"><button type="submit" class="btn">回収を登録</button></div>
          <div class="form-msg" id="co-msg"></div>
        </form>
      </div>
      <div class="card">
        <div class="section-title"><h3>回収一覧</h3><span class="hint">${collections.length}件</span></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>種別</th><th>回収先</th><th>品目</th><th>数量</th><th>予定日</th><th>完了日</th><th>状態</th><th></th></tr></thead>
            <tbody>
              ${collections.map((c) => `
                <tr>
                  <td>${escapeHtml(TYPE_LABELS[c.type] || c.type)}</td>
                  <td>${escapeHtml(c.partner_name || "-")}</td>
                  <td>${escapeHtml(c.product_name || c.item_name || "-")}</td>
                  <td>${fmtNum(c.quantity)}</td>
                  <td>${escapeHtml(c.scheduled_date || "-")}</td>
                  <td>${escapeHtml(c.collected_date || "-")}</td>
                  <td>${statusBadge(c.status)}</td>
                  <td class="row-actions">
                    <select data-status="${c.id}">
                      ${["planned", "completed", "canceled"].map((s) => `<option value="${s}" ${s === c.status ? "selected" : ""}>${STATUS_LABELS[s]}</option>`).join("")}
                    </select>
                    <button data-delete="${c.id}">削除</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        ${collections.length === 0 ? '<div class="empty">回収記録がありません</div>' : ""}
      </div>
    `;

    document.getElementById("collection-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("co-msg");
      const payload = {
        type: document.getElementById("co-type").value,
        partner_id: document.getElementById("co-partner").value || null,
        product_id: document.getElementById("co-product").value || null,
        item_name: document.getElementById("co-item-name").value.trim() || null,
        quantity: document.getElementById("co-qty").value || null,
        scheduled_date: document.getElementById("co-date").value || null,
        reason: document.getElementById("co-reason").value.trim() || null,
        notes: document.getElementById("co-notes").value.trim() || null,
      };
      try {
        await api("/collections", { method: "POST", body: JSON.stringify(payload) });
        await renderCollection();
      } catch (err) {
        msg.textContent = err.message;
        msg.className = "form-msg error";
      }
    });
    root.querySelectorAll("[data-status]").forEach((sel) => sel.addEventListener("change", async () => {
      try { await api(`/collections/${sel.dataset.status}`, { method: "PUT", body: JSON.stringify({ status: sel.value }) }); await renderCollection(); }
      catch (err) { alert(err.message); }
    }));
    root.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", async () => {
      if (!confirm("この回収記録を削除しますか?")) return;
      try { await api(`/collections/${btn.dataset.delete}`, { method: "DELETE" }); await renderCollection(); }
      catch (err) { alert(err.message); }
    }));
  }

  // ================= ビュー切替イベント =================
  const RENDERERS = {
    master: renderMaster,
    purchase: renderPurchase,
    inventory: renderInventory,
    sales: renderSales,
    delivery: renderDelivery,
    collection: renderCollection,
  };
  document.addEventListener("view:activated", (e) => {
    const fn = RENDERERS[e.detail.view];
    if (fn) fn();
  });
})();
