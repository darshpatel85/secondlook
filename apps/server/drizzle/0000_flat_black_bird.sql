CREATE TABLE `agent_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`review_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agent_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`path` text,
	`question` text NOT NULL,
	`answer` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `context_gaps` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`question` text NOT NULL,
	`answer` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `doc_edits` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`review_id` text,
	`path` text NOT NULL,
	`diff` text NOT NULL,
	`rationale` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`path` text,
	`line` integer,
	`end_line` integer,
	`origin` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`evidence` text,
	`confidence` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`reject_reason` text,
	`agent_challenge` text,
	`github_comment_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `repos` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`clone_url` text NOT NULL,
	`default_branch` text NOT NULL,
	`kind` text NOT NULL,
	`skill_path` text NOT NULL,
	`docs_paths` text NOT NULL,
	`clone_path` text NOT NULL,
	`clone_state` text NOT NULL,
	`clone_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`pr_number` integer NOT NULL,
	`pr_url` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`author` text,
	`head_ref` text NOT NULL,
	`base_ref` text NOT NULL,
	`head_sha` text NOT NULL,
	`phase` text NOT NULL,
	`phase_error` text,
	`session_id` text NOT NULL,
	`session_started` integer DEFAULT false NOT NULL,
	`worktree_path` text,
	`jira_key` text,
	`figma_url` text,
	`intent_summary` text,
	`approach_summary` text,
	`approach_observation` text,
	`approach_decision` text,
	`reviewer_notes` text,
	`posted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `step_files` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`step_id` text NOT NULL,
	`position` integer NOT NULL,
	`path` text NOT NULL,
	`skipped` integer DEFAULT false NOT NULL,
	`skip_reason` text,
	`state` text DEFAULT 'not_started' NOT NULL,
	`checked` text,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`step_id`) REFERENCES `steps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `steps` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`purpose` text NOT NULL,
	`risk` text NOT NULL,
	`kind` text DEFAULT 'code' NOT NULL,
	`review_mode` text DEFAULT 'as_you_go' NOT NULL,
	`state` text DEFAULT 'not_started' NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE no action
);
