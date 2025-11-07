BEGIN;

-- === services ===
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='services' AND column_name='duration_minutes'
  ) THEN
ALTER TABLE services ADD COLUMN duration_minutes INT;
-- נסה להעתיק מערך ישן אם קיים (durationMinutes ב-camelCase)
IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='services' AND column_name='durationMinutes'
    ) THEN
      EXECUTE 'UPDATE services SET duration_minutes = "durationMinutes"';
ALTER TABLE services DROP COLUMN "durationMinutes";
ELSE
UPDATE services SET duration_minutes = 30 WHERE duration_minutes IS NULL;
END IF;
ALTER TABLE services ALTER COLUMN duration_minutes SET NOT NULL;
END IF;

  -- order_index
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='services' AND column_name='orderIndex'
  ) THEN
ALTER TABLE services RENAME COLUMN "orderIndex" TO order_index;
END IF;

  -- is_active
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='services' AND column_name='isActive'
  ) THEN
ALTER TABLE services RENAME COLUMN "isActive" TO is_active;
END IF;
END$$;

-- === business_hours ===
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='business_hours' AND column_name='slotIntervalMinutes'
  ) THEN
ALTER TABLE business_hours RENAME COLUMN "slotIntervalMinutes" TO slot_interval_minutes;
END IF;
END$$;

-- === clients ===
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='firstName') THEN
ALTER TABLE clients RENAME COLUMN "firstName" TO first_name;
END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='lastName') THEN
ALTER TABLE clients RENAME COLUMN "lastName" TO last_name;
END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='createdAt') THEN
ALTER TABLE clients RENAME COLUMN "createdAt" TO created_at;
END IF;
END$$;

-- === appointments (צריך לטפל בקשרים) ===
-- מפילים FK ישנים אם קיימים
DO $$
BEGIN
  PERFORM 1 FROM pg_constraint WHERE conname = 'fk_appointments_client';
  IF FOUND THEN EXECUTE 'ALTER TABLE appointments DROP CONSTRAINT fk_appointments_client'; END IF;

  PERFORM 1 FROM pg_constraint WHERE conname = 'fk_appointments_service';
  IF FOUND THEN EXECUTE 'ALTER TABLE appointments DROP CONSTRAINT fk_appointments_service'; END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='startAt') THEN
ALTER TABLE appointments RENAME COLUMN "startAt" TO starts_at;
END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='endAt') THEN
ALTER TABLE appointments RENAME COLUMN "endAt" TO ends_at;
END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='createdAt') THEN
ALTER TABLE appointments RENAME COLUMN "createdAt" TO created_at;
END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='clientId') THEN
ALTER TABLE appointments RENAME COLUMN "clientId" TO client_id;
END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='serviceId') THEN
ALTER TABLE appointments RENAME COLUMN "serviceId" TO service_id;
END IF;
END$$;

-- מחזירים FK לשמות החדשים
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_appointments_client'
  ) THEN
ALTER TABLE appointments
    ADD CONSTRAINT fk_appointments_client
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_appointments_service'
  ) THEN
ALTER TABLE appointments
    ADD CONSTRAINT fk_appointments_service
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT;
END IF;
END$$;

-- === blocked_times ===
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='blocked_times' AND column_name='startAt') THEN
ALTER TABLE blocked_times RENAME COLUMN "startAt" TO starts_at;
END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='blocked_times' AND column_name='endAt') THEN
ALTER TABLE blocked_times RENAME COLUMN "endAt" TO ends_at;
END IF;
END$$;

-- === waiting_list ===
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='waiting_list' AND column_name='clientId') THEN
ALTER TABLE waiting_list RENAME COLUMN "clientId" TO client_id;
END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='waiting_list' AND column_name='serviceId') THEN
ALTER TABLE waiting_list RENAME COLUMN "serviceId" TO service_id;
END IF;
END$$;

-- === testimonials ===
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='testimonials' AND column_name='orderIndex') THEN
ALTER TABLE testimonials RENAME COLUMN "orderIndex" TO order_index;
END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='testimonials' AND column_name='isActive') THEN
ALTER TABLE testimonials RENAME COLUMN "isActive" TO is_active;
END IF;
END$$;

-- === products ===
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='imageUrl') THEN
ALTER TABLE products RENAME COLUMN "imageUrl" TO image_url;
END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='orderIndex') THEN
ALTER TABLE products RENAME COLUMN "orderIndex" TO order_index;
END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='isActive') THEN
ALTER TABLE products RENAME COLUMN "isActive" TO is_active;
END IF;
END$$;

-- === gallery_videos ===
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gallery_videos' AND column_name='videoUrl') THEN
ALTER TABLE gallery_videos RENAME COLUMN "videoUrl" TO video_url;
END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gallery_videos' AND column_name='orderIndex') THEN
ALTER TABLE gallery_videos RENAME COLUMN "orderIndex" TO order_index;
END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gallery_videos' AND column_name='isActive') THEN
ALTER TABLE gallery_videos RENAME COLUMN "isActive" TO is_active;
END IF;
END$$;

-- === background_videos ===
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='background_videos' AND column_name='videoUrl') THEN
ALTER TABLE background_videos RENAME COLUMN "videoUrl" TO url;
END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='background_videos' AND column_name='orderIndex') THEN
ALTER TABLE background_videos RENAME COLUMN "orderIndex" TO order_index;
END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='background_videos' AND column_name='isActive') THEN
ALTER TABLE background_videos RENAME COLUMN "isActive" TO is_active;
END IF;
END$$;

COMMIT;
