/**
 * SVoltix Pulse — MQTT Consumer
 * Assina svoltix/pulse/# e persiste no PostgreSQL
 */

'use strict';

require('dotenv').config();

const mqtt = require('mqtt');
const { Pool } = require('pg');

/* ─── BANCO ───────────────────────────────────────────────── */
const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'svoltix',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'admin',
  max: 5
});

pool.on('error', err => console.error('[DB] erro no pool:', err.message));

/* ─── MQTT ────────────────────────────────────────────────── */
const BROKER  = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const TOPIC   = process.env.MQTT_TOPIC  || 'svoltix/pulse/#';

const client = mqtt.connect(BROKER, {
  reconnectPeriod: 5000,
  connectTimeout:  10000,
  clean: true
});

client.on('connect', () => {
  console.log(`[MQTT] Conectado em ${BROKER}`);
  client.subscribe(TOPIC, err => {
    if (err) console.error('[MQTT] Falha ao assinar:', err.message);
    else console.log(`[MQTT] Assinado: ${TOPIC}`);
  });
});

client.on('reconnect', () => console.log('[MQTT] Reconectando…'));
client.on('error', err  => console.error('[MQTT] Erro:', err.message));

/* ─── MENSAGEM ────────────────────────────────────────────── */
client.on('message', async (topic, message) => {
  let d;

  try {
    d = JSON.parse(message.toString());
  } catch {
    console.warn('[MQTT] Payload inválido em', topic);
    return;
  }

  if (!d.device) {
    console.warn('[MQTT] Campo "device" ausente');
    return;
  }

  try {
    await pool.query(
      `INSERT INTO telemetria
         (device,
          va, vb, vc, vab, vbc, vca,
          ia, ib, ic,
          fpa, fpb, fpc, fpt,
          hz,
          pa, pb, pc, pt,
          sa, sb, sc, st,
          qa, qb, qc,
          tc, uptime)
       VALUES
         ($1,
          $2,  $3,  $4,  $5,  $6,  $7,
          $8,  $9,  $10,
          $11, $12, $13, $14,
          $15,
          $16, $17, $18, $19,
          $20, $21, $22, $23,
          $24, $25, $26,
          $27, $28)`,
      [
        d.device,
        d.va,  d.vb,  d.vc,
        d.vab, d.vbc, d.vca,
        d.ia,  d.ib,  d.ic,
        d.fpa, d.fpb, d.fpc, d.fpt,
        d.hz,
        d.pa,  d.pb,  d.pc,  d.pt,
        d.sa,  d.sb,  d.sc,  d.st,
        d.qa,  d.qb,  d.qc,
        d.tc,  d.uptime
      ]
    );

    console.log(`[OK] ${d.device} · PT=${d.pt ?? '—'}W · FPT=${d.fpt ?? '—'} · Hz=${d.hz ?? '—'}`);

  } catch (err) {
    console.error(`[DB] Falha ao inserir (${d.device}):`, err.message);
  }
});
