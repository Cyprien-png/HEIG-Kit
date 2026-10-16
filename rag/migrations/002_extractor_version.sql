-- Version of the extraction that produced a content's chunks (see EXTRACTOR_VERSION in src/rag/extract.ts):
-- contents extracted by an older version are converted and indexed again by the next ingestion.

ALTER TABLE contents ADD COLUMN extractor_version int NOT NULL DEFAULT 1;
