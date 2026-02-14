# Backend notes

## Atomic booking / concurrency safety

Appointments now use a **PostgreSQL GiST exclusion constraint** (`appointments_no_overlap_active`) on `tstzrange(starts_at, ends_at, '[)')` to prevent overlapping active reservations at the database level.

- Active statuses that block overlap: `booked`, `completed`, `blocked`.
- `canceled` does **not** block new bookings (partial constraint scope).
- The `[)` range keeps the end boundary exclusive, so adjacent slots (e.g. `10:00-10:30` and `10:30-11:00`) are allowed.

### Future multi-barber extension

To scope availability per barber/resource, add `barber_id` (or `resource_id`) to `appointments`, then evolve the exclusion constraint to include equality scope + overlap, e.g.:

- `barber_id WITH =`
- `tstzrange(starts_at, ends_at, '[)') WITH &&`

This keeps overlap prevention isolated per barber while retaining DB-level atomic guarantees across all app instances.

## Rate limiting

The backend now uses a **distributed Redis-backed limiter** (via Upstash REST), so limits are shared across all instances.

### Policies
- OTP request (`POST /auth/request-code`, `/auth/request-code-login`, aliases):
  - 3/10m per normalized phone
  - 10/10m per IP
- OTP verify (`POST /auth/verify-code`, alias):
  - 10/10m per phone
  - 30/10m per IP
  - 10-minute lockout per phone after 10 failed attempts
- Availability (`GET /appointments/available`):
  - 60/min per IP
  - 120/5m per authenticated phone
- Booking create (`POST /appointments`):
  - 3/5m per phone
  - 5/day per phone
  - 20/day per IP
- Admin verify (`POST /admin/verify-code`):
  - 20/hour per IP
  - 5-minute lockout after 10 failed attempts per IP

### Response format
When throttled, the API returns:
```json
{ "error": "RATE_LIMITED", "retryAfterSeconds": 12 }
```
And sets `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` headers (`RateLimit-Reset` is epoch seconds).

### Cloudflare / proxy
`main.ts` uses `app.set('trust proxy', 1)`, and limiter keying uses Express `req.ip` to respect Cloudflare-forwarded client IP through the trusted proxy chain.

If Redis is temporarily unavailable, rate-limit checks fail-open (request is allowed) and a structured `rate_limit_redis_error` log is emitted, so outages do not take down the API.
