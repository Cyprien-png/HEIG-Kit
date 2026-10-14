-- Documents come from sources (Cyberlearn, local folders…); their extracted text is split into chunks.
-- Chunks belong to a content (identified by its hash), not to a document: identical files found in several
-- places share the same chunks and are only embedded once.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE contents (
  content_hash text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id bigserial PRIMARY KEY,
  source text NOT NULL,              -- e.g. cyberlearn, local
  external_id text NOT NULL,         -- stable id within the source (Moodle file id, file path…)
  title text NOT NULL,
  url text,
  local_path text,                   -- original file under data/, relative to the project root
  version text NOT NULL,             -- source-side version (modification date, size…), to skip unchanged documents
  content_hash text REFERENCES contents (content_hash),
  course_code text,                  -- timetable code, e.g. MAD
  course_name text,
  teachers text[] NOT NULL DEFAULT '{}',
  chapter text,                      -- course section, e.g. "2. Relations"
  doc_type text NOT NULL DEFAULT 'other', -- lecture, exercises, solutions, exam, lab, planning, other
  uploaded_at timestamptz,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,            -- set when the document disappeared from its source
  UNIQUE (source, external_id)
);
CREATE INDEX documents_course_idx ON documents (course_code, doc_type) WHERE removed_at IS NULL;
CREATE INDEX documents_content_idx ON documents (content_hash);

CREATE TABLE chunks (
  id bigserial PRIMARY KEY,
  content_hash text NOT NULL REFERENCES contents (content_hash) ON DELETE CASCADE,
  ordinal int NOT NULL,
  page_from int,
  page_to int,
  heading_path text,                 -- headings leading to the chunk, e.g. "Chapitre 2 > Relations d'ordre"
  exercise text,                     -- exercise number for exercise sheets, e.g. 2.22
  text text NOT NULL,
  embedding vector(1024) NOT NULL,   -- bge-m3
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('french', coalesce(heading_path, '') || ' ' || text)) STORED,
  UNIQUE (content_hash, ordinal)
);
CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX chunks_tsv_idx ON chunks USING gin (tsv);
CREATE INDEX chunks_exercise_idx ON chunks (exercise) WHERE exercise IS NOT NULL;
