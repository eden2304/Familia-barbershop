const { Client } = require('pg');

async function run() {
  const connectionString = process.env.DATABASE_URL || 'postgres://familia_app:change_me_strong@localhost:5432/familia';
  const client = new Client({ connectionString });
  await client.connect();

  const serviceName = `Concurrency Test Service ${Date.now()}`;
  const phoneBase = String(Date.now()).slice(-8);

  try {
    const serviceRes = await client.query(
      `insert into services (name, duration_minutes, price, order_index, is_active)
       values ($1, 30, 100, 0, true)
       returning id`,
      [serviceName],
    );
    const serviceId = serviceRes.rows[0].id;

    const startsAt = new Date(Date.now() + 48 * 3600 * 1000);
    startsAt.setUTCMinutes(0, 0, 0);
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);

    const workers = 12;
    const attempts = [];

    for (let i = 0; i < workers; i += 1) {
      const phone = `05${phoneBase}${String(i).padStart(2, '0')}`.slice(0, 10);
      attempts.push((async () => {
        const c = new Client({ connectionString });
        await c.connect();
        try {
          const cRes = await c.query(
            `insert into clients (first_name, last_name, phone, is_member) values ($1, $2, $3, false)
             on conflict (phone) do update set first_name = excluded.first_name
             returning id`,
            ['Load', `User${i}`, phone],
          );
          await c.query(
            `insert into appointments (client_id, service_id, starts_at, ends_at, status)
             values ($1, $2, $3, $4, 'booked')`,
            [cRes.rows[0].id, serviceId, startsAt.toISOString(), endsAt.toISOString()],
          );
          return { ok: true };
        } catch (e) {
          if (e && e.code === '23P01') return { ok: false, code: 'SLOT_TAKEN' };
          return { ok: false, code: e.code || 'UNKNOWN' };
        } finally {
          await c.end();
        }
      })());
    }

    const results = await Promise.all(attempts);
    const successCount = results.filter(r => r.ok).length;
    const conflicts = results.filter(r => !r.ok && r.code === 'SLOT_TAKEN').length;

    if (successCount !== 1) throw new Error(`Expected exactly 1 success, got ${successCount}`);
    if (conflicts !== workers - 1) throw new Error(`Expected ${workers - 1} conflicts, got ${conflicts}`);

    const overlapCountRes = await client.query(
      `select count(*)::int as count
       from appointments
       where service_id = $1 and starts_at = $2 and ends_at = $3 and status in ('booked','completed','blocked')`,
      [serviceId, startsAt.toISOString(), endsAt.toISOString()],
    );
    if (overlapCountRes.rows[0].count !== 1) {
      throw new Error(`Expected exactly 1 stored appointment, got ${overlapCountRes.rows[0].count}`);
    }

    const adjacentStart = new Date(endsAt.getTime());
    const adjacentEnd = new Date(adjacentStart.getTime() + 30 * 60 * 1000);
    const client2Res = await client.query(
      `insert into clients (first_name, last_name, phone, is_member)
       values ('Adjacent', 'Case', $1, false)
       on conflict (phone) do update set first_name = excluded.first_name
       returning id`,
      [`059${phoneBase.slice(0, 7)}`],
    );

    await client.query(
      `insert into appointments (client_id, service_id, starts_at, ends_at, status)
       values ($1, $2, $3, $4, 'booked')`,
      [client2Res.rows[0].id, serviceId, adjacentStart.toISOString(), adjacentEnd.toISOString()],
    );

    console.log('PASS concurrency + adjacency checks');
  } finally {
    await client.query(`delete from appointments where service_id in (select id from services where name = $1)`, [serviceName]).catch(() => {});
    await client.query(`delete from services where name = $1`, [serviceName]).catch(() => {});
    await client.end();
  }
}

run().catch((e) => {
  console.error('FAIL', e.message || e);
  process.exit(1);
});
