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
/*
 * O Vercel executa funções efêmeras. Por isso a aplicação usa o pooler
 * transacional do Supabase e TLS, evitando falhas de conexão direta IPv6.
 */
const configuracaoBanco = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    }
  : {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: { rejectUnauthorized: false },
    };

const pool = new Pool({
  ...configuracaoBanco,
  max: 5,
  idleTimeoutMillis: 30000,
});

pool.on('error', err => console.error('[DB] cliente inativo:', err.message));

/* ─── HELPERS ─────────────────────────────────────────────── */
const ok  = (res, data = {}) => res.json({ sucesso: true, ...data });
const fail = (res, err, status = 500) => {
  console.error('[API]', err?.message || err);
  res.status(status).json({ sucesso: false, erro: err?.message || String(err) });
};

let colunasTelemetria = null;
let colunaPayloadGarantida = false;
let tabelaLayoutsGarantida = false;

// Cada equipamento possui um layout independente para o painel operacional.
async function garantirTabelaLayouts() {
  if (tabelaLayoutsGarantida) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS public.dashboard_layouts (
    dispositivo TEXT PRIMARY KEY,
    layout JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  tabelaLayoutsGarantida = true;
}

/* Preserva o JSON industrial completo sem interferir no esquema legado. */
async function garantirColunaPayload() {
  if (colunaPayloadGarantida) return;

  await pool.query(
    'ALTER TABLE public.telemetria ADD COLUMN IF NOT EXISTS payload JSONB'
  );
  colunaPayloadGarantida = true;
}

/* Obtém o esquema existente sem alterar tabelas ou dados industriais. */
async function obterColunasTelemetria() {
  if (colunasTelemetria) return colunasTelemetria;

  await garantirColunaPayload();

  const resultado = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'telemetria'`
  );

  colunasTelemetria = new Set(resultado.rows.map(linha => linha.column_name));
  return colunasTelemetria;
}

/* Escapa identificadores vindos exclusivamente do catálogo PostgreSQL. */
function identificador(nome) {
  return `"${nome.replace(/"/g, '""')}"`;
}

function colunaDispositivo(colunas) {
  if (colunas.has('device')) return 'device';
  if (colunas.has('dispositivo')) return 'dispositivo';
  throw new Error('A tabela telemetria não possui coluna de identificação do equipamento.');
}

function colunaOrdenacao(colunas) {
  if (colunas.has('created_at')) return 'created_at';
  if (colunas.has('id')) return 'id';
  return colunaDispositivo(colunas);
}

/* Insere somente os campos que existem no esquema legado ou atual. */
async function inserirTelemetria(dados) {
  const colunas = await obterColunasTelemetria();
  const identificadorDispositivo = colunaDispositivo(colunas);
  const campos = [];
  const valores = [];

  for (const [campoOriginal, valor] of Object.entries(dados)) {
    const campo = campoOriginal === 'device' ? identificadorDispositivo : campoOriginal;
    if (!colunas.has(campo) || valor === undefined) continue;
    campos.push(campo);
    valores.push(valor);
  }

  if (!campos.includes(identificadorDispositivo)) {
    campos.unshift(identificadorDispositivo);
    valores.unshift(dados.device);
  }

  // O payload bruto permite evoluir o dashboard sem alterar o firmware.
  if (colunas.has('payload') && !campos.includes('payload')) {
    campos.push('payload');
    valores.push(JSON.stringify(dados));
  }

  const marcadores = valores.map((_, indice) => `$${indice + 1}`);
  await pool.query(
    `INSERT INTO telemetria (${campos.map(identificador).join(', ')})
     VALUES (${marcadores.join(', ')})`,
    valores
  );
}

/* Expõe os campos JSONB no mesmo formato esperado pelo dashboard atual. */
function normalizarTelemetria(linhas) {
  return linhas.map(linha => ({
    ...linha,
    ...(linha.payload && typeof linha.payload === 'object' ? linha.payload : {}),
    device: linha.device || linha.dispositivo,
  }));
}

/* ─── HEALTH CHECK ────────────────────────────────────────── */
app.get('/health', async (_, res) => {
  try {
    await pool.query('SELECT 1');
    ok(res, { status: 'ok', ts: new Date().toISOString() });
  } catch (e) {
    console.error('[DB] Health check falhou:', e.message);
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
    if (!d || !d.device) throw new Error('Campo device obrigatório.');

    await inserirTelemetria(d);

    ok(res);
  } catch (e) { fail(res, e); }
});

/* ═══════════════════════════════════════════════════════════
   DASHBOARD — último registro por device
═══════════════════════════════════════════════════════════ */
app.get('/api/dashboard', async (_, res) => {
  try {
    const colunas = await obterColunasTelemetria();
    const dispositivo = colunaDispositivo(colunas);
    const ordenacao = colunaOrdenacao(colunas);
    const result = await pool.query(
      `SELECT DISTINCT ON (${identificador(dispositivo)})
         *, ${identificador(dispositivo)} AS device
       FROM telemetria
       ORDER BY ${identificador(dispositivo)}, ${identificador(ordenacao)} DESC`
    );
    res.json(normalizarTelemetria(result.rows));
  } catch (e) { fail(res, e); }
});

/* ═══════════════════════════════════════════════════════════
   ÚLTIMA LEITURA POR DEVICE
═══════════════════════════════════════════════════════════ */
app.get('/api/ultima-leitura/:device', async (req, res) => {
  try {
    const colunas = await obterColunasTelemetria();
    const dispositivo = colunaDispositivo(colunas);
    const ordenacao = colunaOrdenacao(colunas);
    const result = await pool.query(
      `SELECT *, ${identificador(dispositivo)} AS device FROM telemetria
       WHERE ${identificador(dispositivo)} = $1
       ORDER BY ${identificador(ordenacao)} DESC LIMIT 1`,
      [req.params.device]
    );
    res.json(normalizarTelemetria(result.rows)[0] || null);
  } catch (e) { fail(res, e); }
});

/* ═══════════════════════════════════════════════════════════
   DISPOSITIVOS
═══════════════════════════════════════════════════════════ */
app.get('/api/dispositivos', async (_, res) => {
  try {
    const colunas = await obterColunasTelemetria();
    const dispositivo = colunaDispositivo(colunas);
    const result = await pool.query(
      `SELECT DISTINCT ${identificador(dispositivo)} AS device
         FROM telemetria ORDER BY device`
    );
    res.json(result.rows);
  } catch (e) { fail(res, e); }
});

/* ═══════════════════════════════════════════════════════════
   HISTÓRICO POR DEVICE
═══════════════════════════════════════════════════════════ */
app.get('/api/historico/:device', async (req, res) => {
  try {
    const colunas = await obterColunasTelemetria();
    const dispositivo = colunaDispositivo(colunas);
    const ordenacao = colunaOrdenacao(colunas);
    const possuiDataCriacao = colunas.has('created_at');
    // Suporta filtro por tempo via query.
    // periodo: '1h' | '6h' | '24h' | '7d'
    // janela/segundos/seconds: janela livre em segundos (ex.: 40)
    const periodo = req.query.periodo; // '1h' | '6h' | '24h' | '7d'
    const limMs = {
      '1h': 3600e3,
      '6h': 21600e3,
      '24h': 86400e3,
      '7d': 604800e3
    };

    const janelaSeg = Math.min(
      Math.max(parseInt(req.query.janela || req.query.segundos || req.query.seconds, 10) || 0, 0),
      30 * 24 * 3600
    );
    const data = /^\d{4}-\d{2}-\d{2}$/.test(req.query.data || '') ? req.query.data : null;
    const hasJanela = janelaSeg > 0;
    const hasPeriodo = !hasJanela && periodo && limMs[periodo];
    const sinceExpr = hasPeriodo ? `now() - interval '${Math.floor(limMs[periodo] / 1000)} seconds'` : null;

    const limit = Math.min(parseInt(req.query.limit, 10) || 2000, 10000);

    let sql;
    let params;

    if (data && possuiDataCriacao) {
      sql = `SELECT *, ${identificador(dispositivo)} AS device FROM telemetria
         WHERE ${identificador(dispositivo)} = $1
           AND "created_at" >= $3::date
           AND "created_at" < ($3::date + interval '1 day')
         ORDER BY ${identificador(ordenacao)} ASC
         LIMIT $2`;
      params = [req.params.device, limit, data];
    } else if (hasJanela && possuiDataCriacao) {
      sql = `SELECT *, ${identificador(dispositivo)} AS device FROM telemetria
         WHERE ${identificador(dispositivo)} = $1
           AND "created_at" >= now() - ($3 * interval '1 second')
         ORDER BY ${identificador(ordenacao)} DESC
         LIMIT $2`;
      params = [req.params.device, limit, janelaSeg];
    } else if (hasPeriodo && possuiDataCriacao) {
      sql = `SELECT *, ${identificador(dispositivo)} AS device FROM telemetria
         WHERE ${identificador(dispositivo)} = $1
           AND "created_at" >= ${sinceExpr}
         ORDER BY ${identificador(ordenacao)} DESC
         LIMIT $2`;
      params = [req.params.device, limit];
    } else {
      sql = `SELECT *, ${identificador(dispositivo)} AS device FROM telemetria
         WHERE ${identificador(dispositivo)} = $1
         ORDER BY ${identificador(ordenacao)} DESC
         LIMIT $2`;
      params = [req.params.device, limit];
    }

    const result = await pool.query(sql, params);
    res.json(normalizarTelemetria(result.rows));
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
    res.json(normalizarTelemetria(result.rows));
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
    res.json({ ultimo: normalizarTelemetria(ultimo.rows)[0] || null, total: total.rows[0].count });
  } catch (e) { fail(res, e); }
});

/* ═══════════════════════════════════════════════════════════
   GRUPOS
═══════════════════════════════════════════════════════════ */
app.get('/grupos', async (_, res) => {
  try {
    const result = await pool.query(`SELECT dispositivo, nome_grupo FROM grupos`);
    res.json(normalizarTelemetria(result.rows));
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

app.get('/api/dashboard-layout/:dispositivo', async (req, res) => {
  try {
    await garantirTabelaLayouts();
    const result = await pool.query(
      'SELECT layout FROM public.dashboard_layouts WHERE dispositivo = $1',
      [req.params.dispositivo]
    );
    ok(res, { layout: result.rows[0]?.layout || {} });
  } catch (e) { fail(res, e); }
});

app.post('/api/dashboard-layout/:dispositivo', async (req, res) => {
  const layout = req.body?.layout;
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
    return res.status(400).json({ sucesso: false, erro: 'Layout inválido.' });
  }
  if (JSON.stringify(layout).length > 12000) {
    return res.status(400).json({ sucesso: false, erro: 'Layout excede o tamanho permitido.' });
  }
  try {
    await garantirTabelaLayouts();
    await pool.query(
      `INSERT INTO public.dashboard_layouts (dispositivo, layout, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (dispositivo)
       DO UPDATE SET layout = EXCLUDED.layout, updated_at = NOW()`,
      [req.params.dispositivo, JSON.stringify(layout)]
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
