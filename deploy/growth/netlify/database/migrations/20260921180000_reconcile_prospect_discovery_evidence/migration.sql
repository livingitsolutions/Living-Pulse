DO $$
BEGIN
  IF to_regclass('public.acquisition_prospects') IS NOT NULL THEN
    ALTER TABLE "acquisition_prospects" ADD COLUMN IF NOT EXISTS "evidence_note" text;
    ALTER TABLE "acquisition_prospects" ADD COLUMN IF NOT EXISTS "potential_use_case" text;
    ALTER TABLE "acquisition_prospects" ADD COLUMN IF NOT EXISTS "email_source_url" text;

    UPDATE "acquisition_prospects"
    SET "evidence_note" = COALESCE("evidence_note", 'Imported before structured discovery evidence was introduced.'),
        "email_source_url" = COALESCE("email_source_url", "source_url")
    WHERE "evidence_note" IS NULL OR "email_source_url" IS NULL;

    ALTER TABLE "acquisition_prospects" ALTER COLUMN "evidence_note" SET NOT NULL;
    ALTER TABLE "acquisition_prospects" ALTER COLUMN "email_source_url" SET NOT NULL;
  END IF;
END
$$;
