/**
 * SVoltix Pulse — API Server
 * Node.js + Express + PostgreSQL
 */

'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ─── MIDDLEWARES ─────────────────────────────────────────── */
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static('public'));

/* ─── BANCO ───────────────────────────────────────────────── */
const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000
});

pool.on('error', err => console.error('[DB] cliente inativo:', err.message));

/* ─── HELPERS ─────────────────────────────────────────────── */
const ok  = (res, data = {}) => res.json({ sucesso: true, ...data });
const fail = (res, err, status = 500) => {
  console.error('[API]', err?.message || err);
  res.status(status).json({ sucesso: false, erro: err?.message || String(err) });
};

/* ─── HEALTH CHECK ────────────────────────────────────────── */
app.get('/health', async (_, res) => {
  try {
    await pool.query('SELECT 1');
    ok(res, { status: 'ok', ts: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: 'error', erro: e.message });
  }
});

/* ─── FRONTEND ────────────────────────────────────────────── */
app.get('/', (req, res) =>
  res.sendFile(__dirname + '/public/index.html')
);

/* ═══════════════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════════════ */
app.post('/login', async (req, res) => {
  try {
    const { usuario, senha } = req.body;

    if (!usuario || !senha)
      return res.status(400).json({ sucesso: false, mensagem: 'Campos obrigatórios.' });

    const result = await pool.query(
      `SELECT id, usuario FROM usuarios WHERE usuario = $1 AND senha = $2`,
      [usuario, senha]
    );

    if (!result.rows.length)
      return res.status(401).json({ sucesso: false, mensagem: 'Usuário ou senha inválidos.' });

    ok(res, { usuario: result.rows[0].usuario });

  } catch (e) { fail(res, e); }
});

/* ═══════════════════════════════════════════════════════════
   TELEMETRIA — inserção (usada pelo mqtt.js)
═══════════════════════════════════════════════════════════ */
app.post('/telemetria', async (req, res) => {
  try {
    const d = req.body;

    await pool.query(
      `INSERT INTO telemetria
         (device,va,vb,vc,vab,vbc,vca,ia,ib,ic,
          fpa,fpb,fpc,fpt,hz,pa,pb,pc,pt,
          sa,sb,sc,st,qa,qb,qc,tc,uptime)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,
          $20,$21,$22,$23,$24,$25,$26,$27,$28)`,
      [
        d.device,
        d.va, d.vb, d.vc, d.vab, d.vbc, d.vca,
        d.ia, d.ib, d.ic,
        d.fpa, d.fpb, d.fpc, d.fpt,
        d.hz,
        d.pa, d.pb, d.pc, d.pt,
        d.sa, d.sb, d.sc, d.st,
        d.qa, d.qb, d.qc,
        d.tc, d.uptime
      ]
    );

    ok(res);
  } catch (e) { fail(res, e); }
});

/* ═══════════════════════════════════════════════════════════
   DASHBOARD — último registro por device
═══════════════════════════════════════════════════════════ */
app.get('/api/dashboard', async (_, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (device)
         device,
         va, vb, vc, vab, vbc, vca,
         ia, ib, ic,
         fpa, fpb, fpc, fpt,
         hz,
         pa, pb, pc, pt,
         sa, sb, sc, st,
         qa, qb, qc,
         tc, uptime,
         created_at
       FROM telemetria
       ORDER BY device, id DESC`
    );
    res.json(result.rows);
  } catch (e) { fail(res, e); }
});

/* ═══════════════════════════════════════════════════════════
   ÚLTIMA LEITURA POR DEVICE
═══════════════════════════════════════════════════════════ */
app.get('/api/ultima-leitura/:device', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM telemetria
       WHERE device = $1
       ORDER BY id DESC LIMIT 1`,
      [req.params.device]
    );
    res.json(result.rows[0] || null);
  } catch (e) { fail(res, e); }
});

/* ═══════════════════════════════════════════════════════════
   DISPOSITIVOS
═══════════════════════════════════════════════════════════ */
app.get('/api/dispositivos', async (_, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT device FROM telemetria ORDER BY device`
    );
    res.json(result.rows);
  } catch (e) { fail(res, e); }
});

/* ═══════════════════════════════════════════════════════════
   HISTÓRICO POR DEVICE
═══════════════════════════════════════════════════════════ */
app.get('/api/historico/:device', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);

    const result = await pool.query(
      `SELECT * FROM telemetria
       WHERE device = $1
       ORDER BY id DESC
       LIMIT $2`,
      [req.params.device, limit]
    );
    res.json(result.rows);
  } catch (e) { fail(res, e); }
});

/* ═══════════════════════════════════════════════════════════
   ÚLTIMOS REGISTROS (global)
═══════════════════════════════════════════════════════════ */
app.get('/ultimos', async (_, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM telemetria ORDER BY id DESC LIMIT 50`
    );
    res.json(result.rows);
  } catch (e) { fail(res, e); }
});

/* ═══════════════════════════════════════════════════════════
   RESUMO
═══════════════════════════════════════════════════════════ */
app.get('/resumo', async (_, res) => {
  try {
    const [ultimo, total] = await Promise.all([
      pool.query(`SELECT * FROM telemetria ORDER BY id DESC LIMIT 1`),
      pool.query(`SELECT COUNT(*) FROM telemetria`)
    ]);
    res.json({ ultimo: ultimo.rows[0] || null, total: total.rows[0].count });
  } catch (e) { fail(res, e); }
});

/* ═══════════════════════════════════════════════════════════
   GRUPOS
═══════════════════════════════════════════════════════════ */
app.get('/grupos', async (_, res) => {
  try {
    const result = await pool.query(`SELECT dispositivo, nome_grupo FROM grupos`);
    res.json(result.rows);
  } catch (e) { fail(res, e); }
});

app.post('/grupos', async (req, res) => {
  const { dispositivo, nome_grupo } = req.body;
  if (!dispositivo || !nome_grupo)
    return res.status(400).json({ sucesso: false, erro: 'dispositivo e nome_grupo são obrigatórios.' });

  try {
    await pool.query(
      `INSERT INTO grupos (dispositivo, nome_grupo)
       VALUES ($1, $2)
       ON CONFLICT (dispositivo)
       DO UPDATE SET nome_grupo = EXCLUDED.nome_grupo`,
      [dispositivo, nome_grupo]
    );
    ok(res);
  } catch (e) { fail(res, e); }
});

/* ═══════════════════════════════════════════════════════════
   START
═══════════════════════════════════════════════════════════ */
app.listen(PORT, () =>
  console.log(`[SVoltix Pulse] API rodando na porta ${PORT}`)
);
