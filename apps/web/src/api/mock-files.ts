import type { Confidence, Severity } from "./types";

export type MockHunk = { oldStart: number; newStart: number; lines: string[] };

export type ScriptedFinding = {
  line: number;
  severity: Severity;
  title: string;
  body: string;
  evidence: string | null;
  confidence: Confidence;
};

export type MockFile = {
  status: "added" | "modified" | "deleted";
  hunks: MockHunk[];
  findings: ScriptedFinding[];
  checked: string[];
};

const added = (text: string): MockHunk => ({
  oldStart: 0,
  newStart: 1,
  lines: text.replace(/\n$/, "").split("\n").map((line) => `+${line}`),
});

const hunk = (oldStart: number, newStart: number, text: string): MockHunk => ({
  oldStart,
  newStart,
  lines: text.replace(/\n$/, "").split("\n"),
});

function hunkCounts(lines: string[]): { oldCount: number; newCount: number } {
  let oldCount = 0;
  let newCount = 0;
  for (const line of lines) {
    if (line.startsWith("-") || line.startsWith(" ")) {
      oldCount += 1;
    }
    if (line.startsWith("+") || line.startsWith(" ")) {
      newCount += 1;
    }
  }
  return { oldCount, newCount };
}

export function renderPatch(path: string, file: MockFile): string {
  const oldName = file.status === "added" ? "/dev/null" : `a/${path}`;
  const newName = file.status === "deleted" ? "/dev/null" : `b/${path}`;
  const header = [`diff --git a/${path} b/${path}`, `--- ${oldName}`, `+++ ${newName}`];
  const body = file.hunks.flatMap((item) => {
    const { oldCount, newCount } = hunkCounts(item.lines);
    return [`@@ -${item.oldStart},${oldCount} +${item.newStart},${newCount} @@`, ...item.lines];
  });
  return `${[...header, ...body].join("\n")}\n`;
}

export function renderContent(file: MockFile, side: "new" | "old"): string {
  const keep = side === "new" ? "+" : "-";
  const drop = side === "new" ? "-" : "+";
  return `${file.hunks
    .flatMap((item) => item.lines.filter((line) => !line.startsWith(drop)))
    .map((line) => (line.startsWith(keep) || line.startsWith(" ") ? line.slice(1) : line))
    .join("\n")}\n`;
}

export const mockFiles: Record<string, MockFile> = {
  "db/migrate/20260914_create_export_jobs.rb": {
    status: "added",
    hunks: [
      added(`# frozen_string_literal: true

class CreateExportJobs < ActiveRecord::Migration[7.1]
  def change
    create_table :export_jobs do |t|
      t.references :tenant, null: false, foreign_key: true
      t.references :requested_by, null: false, foreign_key: { to_table: :users }
      t.date :from_date, null: false
      t.date :to_date, null: false
      t.integer :status, null: false, default: 0
      t.integer :rows_written, null: false, default: 0
      t.string :file_key
      t.string :error
      t.datetime :started_at
      t.datetime :finished_at
      t.timestamps
    end

    add_index :export_jobs, [:tenant_id, :created_at]
  end
end
`),
    ],
    findings: [],
    checked: ["foreign keys point at the right tables", "status default matches the queued enum value", "index covers the admin list query"],
  },

  "app/models/export_job.rb": {
    status: "added",
    hunks: [
      added(`# frozen_string_literal: true

class ExportJob < ApplicationRecord
  belongs_to :tenant
  belongs_to :requested_by, class_name: "User"

  validates :from_date, :to_date, presence: true
  validate :date_range_is_sane

  scope :recent, -> { order(created_at: :desc).limit(50) }

  enum status: { queued: 0, running: 1, finished: 2, failed: 3 }

  def download_url
    return nil unless finished? && file_key.present?

    Storage.signed_url(file_key, expires_in: 24.hours)
  end

  def progress_label
    "#{rows_written} rows"
  end

  private

  def date_range_is_sane
    return if from_date.blank? || to_date.blank?

    errors.add(:to_date, "must be after the start date") if to_date < from_date
    errors.add(:requested_by, "must belong to the tenant") if requested_by && requested_by.tenant_id != tenant_id
  end
end
`),
    ],
    findings: [],
    checked: ["null handling for missing customer", "date range is inclusive at both ends"],
  },

  "app/jobs/invoice_export_job.rb": {
    status: "added",
    hunks: [
      added(`# frozen_string_literal: true

require "csv"
require "tempfile"

class InvoiceExportJob < ApplicationJob
  queue_as :exports

  PAGE_SIZE = 500
  HEADERS = %w[number issued_on customer total_cents currency status].freeze

  def perform(export_job_id)
    export = ExportJob.find(export_job_id)
    export.update!(status: :running, started_at: Time.current)

    file = Tempfile.new(["invoices-", ".csv"])
    write_rows(export, file)
    upload(export, file)

    export.update!(status: :finished, finished_at: Time.current)
    InvoiceMailer.export_ready(export).deliver_later
  rescue StandardError => e
    export&.update!(status: :failed, error: e.message)
    raise
  end

  private

  def write_rows(export, file)
    csv = CSV.new(file, write_headers: true, headers: HEADERS)
    scope = Invoice.where(tenant_id: export.tenant_id)
                   .where(issued_on: export.from_date..export.to_date)
                   .where(status: %w[issued paid])
                   .order(:id)

    last_id = 0
    loop do
      page = scope.where("id > ?", last_id).limit(PAGE_SIZE).to_a
      break if page.empty?

      page.each { |invoice| csv << row_for(invoice) }
      last_id = page.last.id
      export.update_columns(rows_written: export.rows_written + page.size)
    end
    csv.flush
  end

  def row_for(invoice)
    [
      invoice.number,
      invoice.issued_on.iso8601,
      invoice.customer&.display_name,
      invoice.total_cents,
      invoice.currency,
      invoice.status,
    ]
  end

  def upload(export, file)
    key = "exports/#{export.tenant_id}/#{export.id}.csv"
    Storage.put(key, file.path, content_type: "text/csv")
    export.update!(file_key: key)
  ensure
    file.close
  end
end
`),
    ],
    findings: [],
    checked: [],
  },

  "db/schema.rb": {
    status: "modified",
    hunks: [
      hunk(
        13,
        13,
        `-ActiveRecord::Schema[7.1].define(version: 2026_08_30_101500) do
+ActiveRecord::Schema[7.1].define(version: 2026_09_14_091200) do
   create_table "customers", force: :cascade do |t|
     t.bigint "tenant_id", null: false
     t.string "name", null: false
`,
      ),
      hunk(
        61,
        61,
        `     t.index ["tenant_id"], name: "index_discounts_on_tenant_id"
   end

+  create_table "export_jobs", force: :cascade do |t|
+    t.bigint "tenant_id", null: false
+    t.bigint "requested_by_id", null: false
+    t.date "from_date", null: false
+    t.date "to_date", null: false
+    t.integer "status", default: 0, null: false
+    t.integer "rows_written", default: 0, null: false
+    t.string "file_key"
+    t.string "error"
+    t.datetime "started_at"
+    t.datetime "finished_at"
+    t.datetime "created_at", null: false
+    t.datetime "updated_at", null: false
+    t.index ["tenant_id", "created_at"], name: "index_export_jobs_on_tenant_id_and_created_at"
+  end
+
   create_table "invoices", force: :cascade do |t|
     t.bigint "tenant_id", null: false
     t.bigint "customer_id", null: false
`,
      ),
    ],
    findings: [],
    checked: [],
  },

  "app/controllers/api/invoice_exports_controller.rb": {
    status: "added",
    hunks: [
      added(`# frozen_string_literal: true

module Api
  class InvoiceExportsController < ApiController
    before_action :require_finance_role, only: :create

    def create
      export = ExportJob.create!(export_params.merge(tenant: current_tenant, requested_by: current_user))
      InvoiceExportJob.perform_later(export.id)

      render json: { id: export.id, status: export.status }, status: :accepted
    end

    def show
      export = ExportJob.find(params[:id])

      render json: {
        id: export.id,
        status: export.status,
        rows_written: export.rows_written,
        download_url: export.download_url,
      }
    end

    private

    def export_params
      params.require(:export).permit(:from_date, :to_date)
    end

    def require_finance_role
      head :forbidden unless current_user.finance?
    end
  end
end
`),
    ],
    findings: [
      {
        line: 15,
        severity: "should_fix",
        title: "show leaks exports across tenants",
        body: "ExportJob.find(params[:id]) is not scoped to current_tenant, so any signed-in user can poll another tenant's export and get its signed download URL once it finishes. Scope through current_tenant.export_jobs like the other controllers do.",
        evidence: "Compare Api::StatementsController#show at app/controllers/api/statements_controller.rb:21, which uses current_tenant.statements.find.",
        confidence: "high",
      },
    ],
    checked: ["create requires the finance role", "strong parameters only allow the two dates", "202 is the right status for an enqueued job"],
  },

  "app/mailers/invoice_mailer.rb": {
    status: "modified",
    hunks: [
      hunk(
        1,
        1,
        ` # frozen_string_literal: true

 class InvoiceMailer < ApplicationMailer
   default from: "finance@acme.example"

+  def export_ready(export)
+    @export = export
+    @download_url = export.download_url
+    @expires_at = 24.hours.from_now
+
+    mail(to: export.requested_by.email, subject: "Your invoice export is ready")
+  end
+
   def overdue_reminder(invoice)
     @invoice = invoice
     mail(to: invoice.customer.billing_email, subject: "Invoice #{invoice.number} is overdue")
`,
      ),
    ],
    findings: [
      {
        line: 9,
        severity: "nit",
        title: "Expiry is computed twice",
        body: "The 24 hour window is set here and again inside ExportJob#download_url. A constant on ExportJob keeps the email and the link from drifting apart.",
        evidence: null,
        confidence: "medium",
      },
    ],
    checked: ["recipient is the requester, not the tenant contact", "subject is plain and matches the other mailers"],
  },

  "app/views/invoice_mailer/export_ready.html.erb": {
    status: "added",
    hunks: [
      added(`<p>Hello <%= @export.requested_by.first_name %>,</p>

<p>
  Your export of <%= number_with_delimiter(@export.rows_written) %> invoices
  from <%= l(@export.from_date) %> to <%= l(@export.to_date) %> is ready.
</p>

<p><%= link_to "Download the CSV", @download_url %></p>

<p class="muted">The link works until <%= l(@expires_at, format: :long) %>.</p>
`),
    ],
    findings: [],
    checked: ["every value is escaped by ERB", "copy matches the Figma frame"],
  },

  "spec/requests/invoice_exports_spec.rb": {
    status: "added",
    hunks: [
      added(`# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Invoice exports", type: :request do
  let(:tenant) { create(:tenant) }
  let(:user) { create(:user, tenant: tenant, role: :finance) }

  before { sign_in user }

  describe "POST /api/invoice_exports" do
    it "enqueues an export job" do
      expect do
        post "/api/invoice_exports", params: { export: { from_date: "2026-01-01", to_date: "2026-03-31" } }
      end.to have_enqueued_job(InvoiceExportJob)

      expect(response).to have_http_status(:accepted)
    end

    it "rejects users without the finance role" do
      user.update!(role: :viewer)

      post "/api/invoice_exports", params: { export: { from_date: "2026-01-01", to_date: "2026-03-31" } }

      expect(response).to have_http_status(:forbidden)
    end
  end
end
`),
    ],
    findings: [
      {
        line: 11,
        severity: "question",
        title: "No test for the 50,000 row cap or the truncation warning",
        body: "The gap answer says the export truncates at 50,000 rows and warns in the email. Nothing here exercises that path. Is that covered somewhere else, or should it be added to this spec?",
        evidence: null,
        confidence: "medium",
      },
    ],
    checked: ["happy path enqueues exactly one job", "forbidden path is covered"],
  },
};
