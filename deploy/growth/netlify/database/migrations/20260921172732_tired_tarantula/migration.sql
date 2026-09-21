-- No-op reconciliation migration.
-- The prospect discovery columns are owned by
-- 20260921143000_add_prospect_discovery_evidence. This migration retains the
-- generated schema snapshot without attempting to add those columns again.
SELECT 1;
