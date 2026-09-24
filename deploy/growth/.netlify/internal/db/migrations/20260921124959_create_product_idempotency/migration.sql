CREATE TABLE "product_operation_idempotency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"operation_scope" text NOT NULL,
	"idempotency_key_hash" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_idempotency_status_check" CHECK ("status" in ('in_progress', 'completed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "product_idempotency_scope_key_unique" ON "product_operation_idempotency" ("operation_scope","idempotency_key_hash");--> statement-breakpoint
CREATE INDEX "product_idempotency_created_at_idx" ON "product_operation_idempotency" ("created_at");