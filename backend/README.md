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
