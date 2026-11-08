-- Work copies: a PDF (a test, an exercise sheet) copied so that the student fills it in on the web app, from a computer or a
-- phone, with pen, text and shapes. The PDF itself is a file (data/workcopies/<id>/source.pdf); the annotations are kept here,
-- by page, in coordinates relative to the page. `rev` detects an edit made from another device. Once submitted, the
-- annotated pages become the photos of a correction (corrections.id).
CREATE TABLE workcopies (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  course text,
  exam text,                         -- same reference as corrections.exam, passed on when the copy is submitted
  source_label text,                 -- where the PDF comes from, for display
  page_count int NOT NULL DEFAULT 0,
  annotations jsonb NOT NULL DEFAULT '{}'::jsonb,
  rev int NOT NULL DEFAULT 0,
  has_source boolean NOT NULL DEFAULT false,
  correction_id uuid REFERENCES corrections (id) ON DELETE SET NULL,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workcopies_updated_idx ON workcopies (updated_at DESC);
