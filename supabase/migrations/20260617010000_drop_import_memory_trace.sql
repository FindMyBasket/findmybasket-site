-- Close-out of the big-feed 546 diagnostic scaffolding (Phase 2/3/4/4b hunt).
-- import_memory_trace was a flag-gated (body.mem_trace) per-chunk / per-split-pass
-- probe used to diagnose the 546s; with Boots now importing end-to-end via Phase 4b
-- storage_passthrough, its job is done. The importer no longer references this table
-- (the mem_trace plumbing + prof timing object were removed alongside this drop).
-- Same close-out pattern as the earlier phases.
DROP TABLE IF EXISTS import_memory_trace;
