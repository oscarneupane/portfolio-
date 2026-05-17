const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const nodemailer = require("nodemailer");

const DEPARTMENTS = ["HR", "Training", "Medical", "Payslip", "PPE", "LeaveApplication", "Compensation"];
const UPLOADS_ROOT = path.join(__dirname, "../uploads");

// Ensure base upload dir exists
if (!fs.existsSync(UPLOADS_ROOT)) fs.mkdirSync(UPLOADS_ROOT, { recursive: true });

function formatEmployeeFolderName(surname, firstname) {
  const s = (surname || "").trim().toUpperCase();
  const f = (firstname || "").trim();
  return `${s}_${f}`;
}

function formatDate(dateStr) {
  if (!dateStr) return new Date().toISOString().split("T")[0];
  const d = new Date(dateStr);
  return isNaN(d) ? new Date().toISOString().split("T")[0] : d.toISOString().split("T")[0];
}

function getDeptPath(department) {
  const dept = DEPARTMENTS.find(d => d.toLowerCase() === (department || "").toLowerCase());
  if (!dept) throw new Error(`Invalid department. Must be one of: ${DEPARTMENTS.join(", ")}`);
  return path.join(UPLOADS_ROOT, dept);
}

function getFilePath(department, surname, firstname, date, originalName) {
  const deptPath = getDeptPath(department);
  const empFolder = formatEmployeeFolderName(surname, firstname);
  const empPath = path.join(deptPath, empFolder);
  fs.mkdirSync(empPath, { recursive: true });
  const safeDate = formatDate(date);
  const ext = path.extname(originalName) || ".pdf";
  const base = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_\-]/g, "_");
  return path.join(empPath, `${safeDate}_${base}${ext}`);
}

// Multer: store in temp, then move to structured path
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tmp = path.join(UPLOADS_ROOT, "_tmp");
    fs.mkdirSync(tmp, { recursive: true });
    cb(null, tmp);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"));
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// GET /api/docs/departments
router.get("/departments", (req, res) => {
  res.json({ departments: DEPARTMENTS });
});

// GET /api/docs/list?dept=HR&surname=SMITH&date=2024-01
router.get("/list", (req, res) => {
  const { dept, surname, date } = req.query;
  const results = [];

  const scanDir = (dirPath, department, employee) => {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isDirectory()) {
        scanDir(path.join(dirPath, entry.name), department, entry.name);
      } else if (entry.name.endsWith(".pdf")) {
        const [fileDate, ...rest] = entry.name.replace(".pdf", "").split("_");
        if (date && !fileDate.startsWith(date)) continue;
        results.push({
          department,
          employee: employee || "",
          filename: entry.name,
          date: fileDate,
          path: path.join(dirPath, entry.name).replace(UPLOADS_ROOT + "/", ""),
        });
      }
    }
  };

  const deptsToScan = dept
    ? DEPARTMENTS.filter(d => d.toLowerCase() === dept.toLowerCase())
    : DEPARTMENTS;

  for (const d of deptsToScan) {
    const deptPath = path.join(UPLOADS_ROOT, d);
    if (!fs.existsSync(deptPath)) continue;
    const empDirs = fs.readdirSync(deptPath, { withFileTypes: true });
    const filtered = surname
      ? empDirs.filter(e => e.name.toLowerCase().startsWith(surname.toLowerCase()))
      : empDirs;
    for (const emp of filtered.filter(e => e.isDirectory())) {
      scanDir(path.join(deptPath, emp.name), d, emp.name);
    }
  }

  results.sort((a, b) => b.date.localeCompare(a.date));
  res.json({ files: results, total: results.length });
});

// GET /api/docs/tree — full folder tree
router.get("/tree", (req, res) => {
  const tree = {};
  for (const dept of DEPARTMENTS) {
    tree[dept] = {};
    const deptPath = path.join(UPLOADS_ROOT, dept);
    if (!fs.existsSync(deptPath)) continue;
    const empDirs = fs.readdirSync(deptPath, { withFileTypes: true });
    for (const emp of empDirs.filter(e => e.isDirectory())) {
      const empPath = path.join(deptPath, emp.name);
      const files = fs.readdirSync(empPath).filter(f => f.endsWith(".pdf"));
      tree[dept][emp.name] = files.sort();
    }
  }
  res.json({ tree });
});

// POST /api/docs/upload
router.post("/upload", upload.array("pdfs", 20), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: "No files uploaded" });

  const { department, surname, firstname, date } = req.body;
  if (!department || !surname || !firstname) {
    return res.status(400).json({ error: "department, surname, and firstname are required" });
  }

  const results = [];
  for (const file of req.files) {
    try {
      const destPath = getFilePath(department, surname, firstname, date, file.originalname);
      fs.renameSync(file.path, destPath);
      const buffer = fs.readFileSync(destPath);
      let textPreview = "";
      try {
        const parsed = await pdfParse(buffer);
        textPreview = parsed.text.slice(0, 300).replace(/\s+/g, " ").trim();
      } catch (_) {}
      results.push({
        original: file.originalname,
        saved: path.relative(UPLOADS_ROOT, destPath),
        department,
        employee: formatEmployeeFolderName(surname, firstname),
        date: formatDate(date),
        size: file.size,
        preview: textPreview,
      });
    } catch (err) {
      // cleanup temp if rename failed
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      results.push({ original: file.originalname, error: err.message });
    }
  }
  res.json({ uploaded: results });
});

// GET /api/docs/scan?path=HR/SMITH_John/2024-01-01_doc.pdf
router.get("/scan", async (req, res) => {
  const relPath = req.query.path;
  if (!relPath) return res.status(400).json({ error: "path query param required" });
  const absPath = path.join(UPLOADS_ROOT, relPath);
  if (!absPath.startsWith(UPLOADS_ROOT)) return res.status(403).json({ error: "Forbidden" });
  if (!fs.existsSync(absPath)) return res.status(404).json({ error: "File not found" });
  try {
    const buffer = fs.readFileSync(absPath);
    const parsed = await pdfParse(buffer);
    res.json({
      path: relPath,
      pages: parsed.numpages,
      text: parsed.text,
      info: parsed.info,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to parse PDF: " + err.message });
  }
});

// GET /api/docs/download?path=HR/SMITH_John/2024-01-01_doc.pdf
router.get("/download", (req, res) => {
  const relPath = req.query.path;
  if (!relPath) return res.status(400).json({ error: "path required" });
  const absPath = path.join(UPLOADS_ROOT, relPath);
  if (!absPath.startsWith(UPLOADS_ROOT)) return res.status(403).json({ error: "Forbidden" });
  if (!fs.existsSync(absPath)) return res.status(404).json({ error: "File not found" });
  res.download(absPath);
});

// POST /api/docs/send — email a PDF
router.post("/send", async (req, res) => {
  const { filePath, toEmail, subject, message, smtpHost, smtpPort, smtpUser, smtpPass } = req.body;
  if (!filePath || !toEmail) return res.status(400).json({ error: "filePath and toEmail required" });
  const absPath = path.join(UPLOADS_ROOT, filePath);
  if (!absPath.startsWith(UPLOADS_ROOT)) return res.status(403).json({ error: "Forbidden" });
  if (!fs.existsSync(absPath)) return res.status(404).json({ error: "File not found" });

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost || process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(smtpPort || process.env.SMTP_PORT || "587"),
      secure: false,
      auth: {
        user: smtpUser || process.env.SMTP_USER,
        pass: smtpPass || process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: smtpUser || process.env.SMTP_USER,
      to: toEmail,
      subject: subject || `Document: ${path.basename(filePath)}`,
      text: message || "Please find the attached document.",
      attachments: [{ filename: path.basename(filePath), path: absPath }],
    });

    res.json({ success: true, message: `Email sent to ${toEmail}` });
  } catch (err) {
    res.status(500).json({ error: "Failed to send email: " + err.message });
  }
});

// POST /api/docs/move — reassign department/employee
router.post("/move", (req, res) => {
  const { fromPath, department, surname, firstname, date } = req.body;
  if (!fromPath || !department || !surname || !firstname) {
    return res.status(400).json({ error: "fromPath, department, surname, firstname required" });
  }
  const absFrom = path.join(UPLOADS_ROOT, fromPath);
  if (!absFrom.startsWith(UPLOADS_ROOT)) return res.status(403).json({ error: "Forbidden" });
  if (!fs.existsSync(absFrom)) return res.status(404).json({ error: "Source file not found" });
  try {
    const destPath = getFilePath(department, surname, firstname, date, path.basename(absFrom));
    fs.renameSync(absFrom, destPath);
    res.json({ moved: path.relative(UPLOADS_ROOT, destPath) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/docs/delete?path=HR/SMITH_John/file.pdf
router.delete("/delete", (req, res) => {
  const relPath = req.query.path;
  if (!relPath) return res.status(400).json({ error: "path required" });
  const absPath = path.join(UPLOADS_ROOT, relPath);
  if (!absPath.startsWith(UPLOADS_ROOT)) return res.status(403).json({ error: "Forbidden" });
  if (!fs.existsSync(absPath)) return res.status(404).json({ error: "File not found" });
  fs.unlinkSync(absPath);
  res.json({ deleted: relPath });
});

module.exports = router;
