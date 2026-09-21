CREATE TABLE "acquisition_audit_events" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"prospect_id" uuid,
	"attempt_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acquisition_audit_events_name_check" CHECK ("name" in ('prospect_created', 'prospect_qualified', 'prospect_rejected', 'prospect_queued', 'prospect_suppressed', 'outreach_attempt_created', 'outreach_marked_sent', 'prospect_marked_replied', 'prospect_marked_converted'))
);
--> statement-breakpoint
CREATE TABLE "acquisition_outreach_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"prospect_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acquisition_attempts_sequence_check" CHECK ("sequence_number" between 1 and 2),
	CONSTRAINT "acquisition_attempts_status_check" CHECK ("status" in ('queued', 'sent', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "acquisition_prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"business_name" text NOT NULL,
	"website_url" text,
	"public_contact_email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"industry" text,
	"location_text" text,
	"source_url" text NOT NULL,
	"source_type" text NOT NULL,
	"source_observed_at" timestamp with time zone NOT NULL,
	"qualification_status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"outreach_status" text DEFAULT 'not_contacted' NOT NULL,
	"personalization_context" text,
	"personalization_evidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acquisition_prospects_source_type_check" CHECK ("source_type" in ('business_website', 'public_business_directory', 'public_social_business_page', 'manual')),
	CONSTRAINT "acquisition_prospects_qualification_status_check" CHECK ("qualification_status" in ('pending', 'qualified', 'rejected')),
	CONSTRAINT "acquisition_prospects_outreach_status_check" CHECK ("outreach_status" in ('not_contacted', 'queued', 'sent', 'replied', 'converted', 'suppressed'))
);
--> statement-breakpoint
CREATE TABLE "acquisition_suppressions" (
	"normalized_email" text PRIMARY KEY,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acquisition_suppressions_reason_check" CHECK ("reason" in ('unsubscribe', 'bounce', 'complaint', 'manual', 'invalid'))
);
--> statement-breakpoint
CREATE INDEX "acquisition_audit_events_prospect_created_idx" ON "acquisition_audit_events" ("prospect_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "acquisition_attempts_prospect_sequence_unique" ON "acquisition_outreach_attempts" ("prospect_id","sequence_number");--> statement-breakpoint
CREATE INDEX "acquisition_attempts_status_idx" ON "acquisition_outreach_attempts" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "acquisition_prospects_normalized_email_unique" ON "acquisition_prospects" ("normalized_email");--> statement-breakpoint
CREATE INDEX "acquisition_prospects_outreach_status_idx" ON "acquisition_prospects" ("outreach_status");--> statement-breakpoint
CREATE INDEX "acquisition_suppressions_email_idx" ON "acquisition_suppressions" ("normalized_email");--> statement-breakpoint
ALTER TABLE "acquisition_audit_events" ADD CONSTRAINT "acquisition_audit_events_nZd4mWbXqlf4_fkey" FOREIGN KEY ("prospect_id") REFERENCES "acquisition_prospects"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "acquisition_audit_events" ADD CONSTRAINT "acquisition_audit_events_LGAzyfMkl0iC_fkey" FOREIGN KEY ("attempt_id") REFERENCES "acquisition_outreach_attempts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "acquisition_outreach_attempts" ADD CONSTRAINT "acquisition_outreach_attempts_0oi4ClblNPWv_fkey" FOREIGN KEY ("prospect_id") REFERENCES "acquisition_prospects"("id") ON DELETE CASCADE;