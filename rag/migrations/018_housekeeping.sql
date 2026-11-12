-- Photos of corrections are kept in full while they are being corrected, then made lighter (src/app/housekeeping.ts).
ALTER TABLE correction_photos ADD COLUMN compressed_at timestamptz;
ALTER TABLE correction_photos ADD COLUMN original_bytes int;
CREATE INDEX correction_photos_uncompressed_idx ON correction_photos (correction_id) WHERE compressed_at IS NULL;
