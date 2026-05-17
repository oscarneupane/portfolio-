const API = "/api/docs";
let activeDept = "";

// ── Navigation ────────────────────────────────────────────────────
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`view-${btn.dataset.view}`).classList.add("active");
    if (btn.dataset.view === "dashboard") loadDashboard();
    if (btn.dataset.view === "browse") loadFiles();
    if (btn.dataset.view === "send") populateSendSelect();
  });
});

document.querySelectorAll(".dept-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".dept-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeDept = btn.dataset.dept;
    const browseView = document.getElementById("view-browse");
    if (browseView.classList.contains("active")) loadFiles();
    else if (document.getElementById("view-dashboard").classList.contains("active")) loadDashboard();
  });
});

// ── Dashboard ─────────────────────────────────────────────────────
async function loadDashboard() {
  const dateFilter = document.getElementById("dashDateFilter").value;
  const url = `${API}/list${activeDept ? `?dept=${activeDept}` : ""}${dateFilter ? `${activeDept ? "&" : "?"}date=${dateFilter}` : ""}`;
  const data = await fetchJSON(url);
  renderStats(data.files || []);
  renderFileList("recentFiles", (data.files || []).slice(0, 30));
}

function renderStats(files) {
  const grid = document.getElementById("statsGrid");
  const depts = ["HR", "Training", "Medical", "Payslip", "PPE", "LeaveApplication", "Compensation"];
  const counts = {};
  depts.forEach(d => (counts[d] = { files: 0, employees: new Set() }));
  files.forEach(f => {
    if (counts[f.department]) {
      counts[f.department].files++;
      counts[f.department].employees.add(f.employee);
    }
  });

  grid.innerHTML = depts
    .map(d => `
      <div class="stat-card">
        <div class="stat-dept">${d}</div>
        <div class="stat-count">${counts[d].files}</div>
        <div class="stat-files">${counts[d].employees.size} employees</div>
      </div>`)
    .join("");
}

document.getElementById("dashDateFilter").addEventListener("change", loadDashboard);

// ── Browse / File list ────────────────────────────────────────────
async function loadFiles() {
  const surname = document.getElementById("searchSurname").value.trim();
  const date = document.getElementById("searchDate").value;
  const params = new URLSearchParams();
  if (activeDept) params.set("dept", activeDept);
  if (surname) params.set("surname", surname);
  if (date) params.set("date", date);
  const data = await fetchJSON(`${API}/list?${params}`);
  renderFileList("fileResults", data.files || []);
}

function clearSearch() {
  document.getElementById("searchSurname").value = "";
  document.getElementById("searchDate").value = "";
  loadFiles();
}

function renderFileList(containerId, files) {
  const el = document.getElementById(containerId);
  if (!files.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">📭</div><p>No documents found.</p></div>`;
    return;
  }
  el.innerHTML = files.map(f => fileCard(f)).join("");
}

function fileCard(f) {
  const badgeClass = { HR: "", Training: "badge-green", Medical: "badge-warn", Payslip: "", PPE: "badge-green", LeaveApplication: "badge-warn", Compensation: "" }[f.department] || "";
  return `
    <div class="file-card">
      <span class="file-icon">📄</span>
      <div class="file-info">
        <div class="file-name">${escHtml(f.filename)}</div>
        <div class="file-meta">
          <span class="badge ${badgeClass}">${f.department}</span>
          <span>👤 ${escHtml(f.employee)}</span>
          <span>📅 ${f.date}</span>
        </div>
      </div>
      <div class="file-actions">
        <button class="btn btn-sm btn-secondary" onclick="scanDoc('${escAttr(f.path)}','${escAttr(f.filename)}')">Scan</button>
        <a class="btn btn-sm btn-secondary" href="${API}/download?path=${encodeURIComponent(f.path)}" download>Download</a>
        <button class="btn btn-sm btn-danger" onclick="deleteDoc('${escAttr(f.path)}')">Delete</button>
      </div>
    </div>`;
}

// ── Upload ────────────────────────────────────────────────────────
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
let selectedFiles = [];

dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  addFiles([...e.dataTransfer.files]);
});
dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => addFiles([...fileInput.files]));

function addFiles(files) {
  const pdfs = files.filter(f => f.type === "application/pdf");
  selectedFiles.push(...pdfs);
  renderPreview();
}

function renderPreview() {
  const preview = document.getElementById("filePreview");
  preview.innerHTML = selectedFiles.map(f => `<span class="preview-chip">📄 ${escHtml(f.name)}</span>`).join("");
}

document.getElementById("uploadForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!selectedFiles.length) return alert("Please select at least one PDF.");
  const dept = document.getElementById("upDept").value;
  const surname = document.getElementById("upSurname").value.trim();
  const firstname = document.getElementById("upFirstname").value.trim();
  const date = document.getElementById("upDate").value;

  const fd = new FormData();
  fd.append("department", dept);
  fd.append("surname", surname);
  fd.append("firstname", firstname);
  if (date) fd.append("date", date);
  selectedFiles.forEach(f => fd.append("pdfs", f));

  const res = await fetch(`${API}/upload`, { method: "POST", body: fd });
  const data = await res.json();
  const resultsEl = document.getElementById("uploadResults");
  resultsEl.innerHTML = (data.uploaded || []).map(r =>
    r.error
      ? `<div class="result-item result-err">❌ ${escHtml(r.original)}: ${escHtml(r.error)}</div>`
      : `<div class="result-item result-ok">✅ Saved as: ${escHtml(r.saved)} — ${escHtml(r.preview || "(no text preview)")}</div>`
  ).join("");

  selectedFiles = [];
  renderPreview();
});

// ── Scan modal ────────────────────────────────────────────────────
async function scanDoc(filePath, filename) {
  document.getElementById("scanTitle").textContent = filename;
  document.getElementById("scanContent").textContent = "Scanning…";
  document.getElementById("scanModal").classList.remove("hidden");
  const data = await fetchJSON(`${API}/scan?path=${encodeURIComponent(filePath)}`);
  if (data.error) {
    document.getElementById("scanContent").textContent = "Error: " + data.error;
  } else {
    document.getElementById("scanContent").innerHTML =
      `<strong>Pages:</strong> ${data.pages}\n\n<strong>Extracted Text:</strong>\n\n${escHtml(data.text)}`;
  }
}

function closeModal() { document.getElementById("scanModal").classList.add("hidden"); }
document.getElementById("scanModal").addEventListener("click", e => { if (e.target === document.getElementById("scanModal")) closeModal(); });

// ── Delete ────────────────────────────────────────────────────────
async function deleteDoc(filePath) {
  if (!confirm("Delete this file permanently?")) return;
  const res = await fetch(`${API}/delete?path=${encodeURIComponent(filePath)}`, { method: "DELETE" });
  const data = await res.json();
  if (data.deleted) {
    loadFiles();
    loadDashboard();
  } else {
    alert(data.error || "Delete failed");
  }
}

// ── Send ──────────────────────────────────────────────────────────
async function populateSendSelect() {
  const data = await fetchJSON(`${API}/list`);
  const sel = document.getElementById("sendFileSelect");
  sel.innerHTML = `<option value="">— select a file —</option>` +
    (data.files || []).map(f => `<option value="${escAttr(f.path)}">[${f.department}] ${escHtml(f.employee)} — ${escHtml(f.filename)}</option>`).join("");
}

async function sendDoc() {
  const filePath = document.getElementById("sendFileSelect").value;
  const toEmail = document.getElementById("sendTo").value.trim();
  if (!filePath) return alert("Please select a file.");
  if (!toEmail) return alert("Please enter a recipient email.");

  const body = {
    filePath,
    toEmail,
    subject: document.getElementById("sendSubject").value,
    message: document.getElementById("sendMsg").value,
    smtpHost: document.getElementById("smtpHost").value,
    smtpPort: document.getElementById("smtpPort").value,
    smtpUser: document.getElementById("smtpUser").value,
    smtpPass: document.getElementById("smtpPass").value,
  };

  const res = await fetch(`${API}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  const el = document.getElementById("sendResult");
  el.innerHTML = data.success
    ? `<div class="result-item result-ok">✅ ${escHtml(data.message)}</div>`
    : `<div class="result-item result-err">❌ ${escHtml(data.error)}</div>`;
}

// ── Helpers ───────────────────────────────────────────────────────
async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
}

function escHtml(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escAttr(str) {
  return String(str || "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ── Init ──────────────────────────────────────────────────────────
loadDashboard();
