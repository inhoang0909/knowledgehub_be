/**
 * FULL DIAGNOSTIC SCRIPT
 * Checks every step of the chatbot discovery & conversation sync pipeline.
 */
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

// ── Load .env manually ────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const m = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*)$/);
  if (m) {
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    env[m[1].trim()] = val;
  }
});

console.log('══════════════════════════════════════════════════════════');
console.log('  DIFY WRAPPER — FULL CHATBOT DIAGNOSTIC');
console.log('══════════════════════════════════════════════════════════');
console.log('ENV VALUES:');
console.log('  DATABASE_URL :', env.DATABASE_URL);
console.log('  DIFY_DB_HOST :', env.DIFY_DB_HOST);
console.log('  DIFY_DB_PORT :', env.DIFY_DB_PORT);
console.log('  DIFY_DB_USER :', env.DIFY_DB_USER);
console.log('  DIFY_DB_NAME :', env.DIFY_DB_NAME);

const localPool = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000 });
const difyPool  = new Pool({
  host    : env.DIFY_DB_HOST,
  port    : parseInt(env.DIFY_DB_PORT || '5432', 10),
  user    : env.DIFY_DB_USER,
  password: env.DIFY_DB_PASSWORD,
  database: env.DIFY_DB_NAME || 'dify',
  connectionTimeoutMillis: 5000,
});

async function main() {
  // ── STEP 1: local datasets ─────────────────────────────────────────────────
  console.log('\n══ STEP 1: ALL DATASETS IN LOCAL DB ══');
  let localDatasetIds = [];
  try {
    const r = await localPool.query(`SELECT id, dify_dataset_id, name, owner_id FROM datasets ORDER BY id`);
    if (r.rows.length === 0) {
      console.log('  ⚠  No datasets found in local DB — user has no permitted datasets.');
    }
    for (const row of r.rows) {
      console.log(`  ✔  id=${row.id}  name="${row.name}"  dify_dataset_id=${row.dify_dataset_id}`);
      localDatasetIds.push(row.dify_dataset_id);

      // members
      const mems = await localPool.query(
        `SELECT u.email, dm.role FROM dataset_members dm JOIN users u ON dm.user_id = u.id WHERE dm.dataset_id = $1`, [row.id]);
      console.log(`       Members (${mems.rows.length}): ${mems.rows.map(m => `${m.email}[${m.role}]`).join(', ') || 'none'}`);

      // dept perms
      const deps = await localPool.query(
        `SELECT d.code, dp.role FROM dataset_department_permissions dp JOIN departments d ON dp.department_id = d.id WHERE dp.dataset_id = $1`, [row.id]);
      console.log(`       Dept perms (${deps.rows.length}): ${deps.rows.map(d => `${d.code}[${d.role}]`).join(', ') || 'none'}`);
    }
  } catch (e) { console.error('  ✘ Local DB error:', e.message); }

  // ── STEP 2: all local users ────────────────────────────────────────────────
  console.log('\n══ STEP 2: ALL USERS IN LOCAL DB ══');
  try {
    const r = await localPool.query(`SELECT id, email, role, department_code FROM users ORDER BY id`);
    r.rows.forEach(u => console.log(`  id=${u.id}  email=${u.email}  role=${u.role}  dept=${u.department_code}`));
  } catch (e) { console.error('  ✘ Local DB error:', e.message); }

  if (localDatasetIds.length === 0) {
    console.log('\n  ⛔ Cannot continue — no local datasets to search for in Dify DB.');
    await cleanup(); return;
  }

  // ── STEP 3: Dify DB datasets ───────────────────────────────────────────────
  console.log('\n══ STEP 3: ALL DATASETS IN DIFY DB (first 20) ══');
  try {
    const r = await difyPool.query(`SELECT id, name FROM datasets ORDER BY created_at DESC LIMIT 20`);
    console.log(`  Total rows returned: ${r.rows.length}`);
    r.rows.forEach(row => console.log(`  id=${row.id}  name="${row.name}"`));
    console.log('\n  Looking for local dataset IDs in Dify:');
    localDatasetIds.forEach(id => {
      const found = r.rows.find(d => d.id === id);
      console.log(`  ${found ? '✔ FOUND' : '✘ MISSING'} ${id} ${found ? `("${found.name}")` : ''}`);
    });
  } catch (e) { console.error('  ✘ Dify DB error:', e.message); }

  // ── STEP 4: ALL apps in Dify ───────────────────────────────────────────────
  console.log('\n══ STEP 4: ALL APPS IN DIFY DB (first 20) ══');
  try {
    const r = await difyPool.query(`SELECT id, name, mode, created_at FROM apps ORDER BY created_at DESC LIMIT 20`);
    console.log(`  Total apps in Dify: ${r.rows.length}`);
    r.rows.forEach(row => console.log(`  id=${row.id}  name="${row.name}"  mode=${row.mode}`));
  } catch (e) { console.error('  ✘ Dify DB error:', e.message); }

  // ── STEP 5: app_dataset_joins ──────────────────────────────────────────────
  console.log('\n══ STEP 5: app_dataset_joins FOR LOCAL DATASET IDs ══');
  try {
    const r = await difyPool.query(
      `SELECT adj.app_id, a.name AS app_name, a.mode, adj.dataset_id
       FROM app_dataset_joins adj
       JOIN apps a ON a.id = adj.app_id
       WHERE adj.dataset_id = ANY($1::uuid[])`,
      [localDatasetIds]
    );
    console.log(`  Rows found: ${r.rows.length}`);
    if (r.rows.length === 0) {
      console.log('  ⚠  No apps linked to local datasets in Dify — this is why chatbots list is empty!');
      console.log('     Check: did you link the Dify chatbot to the dataset in Dify Studio?');
    }
    r.rows.forEach(row =>
      console.log(`  ✔  App "${row.app_name}" (${row.app_id}) mode=${row.mode} ← dataset ${row.dataset_id}`)
    );

    // ── STEP 6: conversations & messages for each app ──────────────────────
    for (const row of r.rows) {
      const appId = row.app_id;
      console.log(`\n══ STEP 6: DIFY CONVERSATIONS for App "${row.app_name}" (${appId}) ══`);
      const convs = await difyPool.query(
        `SELECT id, created_at, from_account_id FROM conversations WHERE app_id = $1 ORDER BY created_at DESC`,
        [appId]
      );
      console.log(`  Conversations in Dify: ${convs.rows.length}`);
      convs.rows.forEach(c => console.log(`  id=${c.id}  created_at=${c.created_at}`));

      if (convs.rows.length > 0) {
        const msgs = await difyPool.query(
          `SELECT m.id, m.created_at, LEFT(m.query, 60) AS q
           FROM messages m JOIN conversations c ON m.conversation_id = c.id
           WHERE c.app_id = $1 ORDER BY m.created_at DESC LIMIT 5`,
          [appId]
        );
        console.log(`  Messages in Dify (last 5): ${msgs.rows.length}`);
        msgs.rows.forEach(m => console.log(`    id=${m.id}  q="${m.q}"`));
      }

      console.log(`\n══ STEP 7: LOCAL DB conversations for App ${appId} ══`);
      const localConvs = await localPool.query(
        `SELECT id, dify_conversation_id, created_at FROM conversations WHERE dify_app_id = $1 ORDER BY created_at DESC`,
        [appId]
      );
      console.log(`  Conversations in LOCAL DB: ${localConvs.rows.length}`);
      if (localConvs.rows.length === 0) {
        console.log('  ⚠  No local conversations — you need to click "Sync" button in the UI first!');
      }
      localConvs.rows.forEach(c => console.log(`  local_id=${c.id}  dify_conv_id=${c.dify_conversation_id}`));

      for (const c of localConvs.rows) {
        const localMsgs = await localPool.query(
          `SELECT id, dify_message_id, LEFT(query, 60) AS q FROM messages WHERE conversation_id = $1`,
          [c.id]
        );
        console.log(`    Messages for local conv ${c.id}: ${localMsgs.rows.length}`);
        localMsgs.rows.forEach(m => console.log(`      local_id=${m.id}  q="${m.q}"`));
      }
    }
  } catch (e) { console.error('  ✘ Dify DB error:', e.stack); }

  await cleanup();
}

async function cleanup() {
  await localPool.end().catch(() => {});
  await difyPool.end().catch(() => {});
}

main().catch(e => { console.error('Fatal:', e); cleanup(); });
