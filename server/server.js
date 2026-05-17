const express = require("express");
const path = require("path");
const cors = require("cors");
const db = require("./db");
const pdfRoutes = require("./pdfRoutes");

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/admin.html"));
});

app.get("/docs", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/docs.html"));
});

app.use("/api/docs", pdfRoutes);

// Example API route
app.get("/api/projects", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM projects");
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});