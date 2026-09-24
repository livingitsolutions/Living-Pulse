CREATE TABLE "counters" (
	"id" serial PRIMARY KEY,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"pulse_id" uuid,
	"session_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" serial PRIMARY KEY,
	"pulse_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"useful" text NOT NULL,
	"affected_plan" text NOT NULL,
	"use_again" text NOT NULL,
	"worth_paying" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pulses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"creator_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"business_name" text NOT NULL,
	"idea" text NOT NULL,
	"question" text NOT NULL,
	"options" jsonb NOT NULL,
	"follow_up" jsonb,
	"allow_updates" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'Testing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" serial PRIMARY KEY,
	"pulse_id" uuid NOT NULL,
	"option_id" text NOT NULL,
	"follow_up_option_id" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_pulse_id_pulses_id_fkey" FOREIGN KEY ("pulse_id") REFERENCES "pulses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_pulse_id_pulses_id_fkey" FOREIGN KEY ("pulse_id") REFERENCES "pulses"("id") ON DELETE CASCADE;