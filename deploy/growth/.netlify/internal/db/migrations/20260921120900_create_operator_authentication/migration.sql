CREATE TABLE "operator_login_attempts" (
	"id" serial PRIMARY KEY,
	"client_hash" text NOT NULL,
	"attempted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_sessions" (
	"token_hash" text PRIMARY KEY,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "operator_login_attempts_client_time_idx" ON "operator_login_attempts" ("client_hash","attempted_at");--> statement-breakpoint
CREATE INDEX "operator_sessions_expires_at_idx" ON "operator_sessions" ("expires_at");