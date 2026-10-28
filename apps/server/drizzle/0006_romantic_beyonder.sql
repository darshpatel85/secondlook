ALTER TABLE `repos` ADD `related_paths` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `reviews` ADD `setup_warnings` text DEFAULT '[]' NOT NULL;