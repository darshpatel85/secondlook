ALTER TABLE `reviews` ADD `context_checklist` text;--> statement-breakpoint
ALTER TABLE `reviews` ADD `context_auto_confirmed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `steps` ADD `routing` text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE `steps` ADD `risk_reason` text;