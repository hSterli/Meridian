// Generated from the live Supabase project (meridian-qa / ucnfcsosbdgknmzyuqbw).
// Regenerate after schema changes with:
//   npx supabase gen types typescript --project-id ucnfcsosbdgknmzyuqbw > src/lib/types/database.generated.ts
// (then re-add the hand-written convenience aliases at the bottom of this file)

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      api_keys: {
        Row: {
          created_at: string
          created_by: string
          id: string
          key_hash: string
          last_used_at: string | null
          name: string
          org_id: string
          revoked_at: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          key_hash: string
          last_used_at?: string | null
          name: string
          org_id: string
          revoked_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          key_hash?: string
          last_used_at?: string | null
          name?: string
          org_id?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_tracker_connections: {
        Row: {
          created_at: string
          created_by: string
          github_repo_name: string | null
          github_repo_owner: string | null
          github_webhook_id: number | null
          github_webhook_secret: string | null
          id: string
          jira_base_url: string
          jira_email: string
          jira_project_key: string
          org_id: string
          project_id: string | null
          provider: Database["public"]["Enums"]["issue_tracker_provider"]
          vault_secret_id: string
          webhook_token: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          github_repo_name?: string | null
          github_repo_owner?: string | null
          github_webhook_id?: number | null
          github_webhook_secret?: string | null
          id?: string
          jira_base_url: string
          jira_email: string
          jira_project_key: string
          org_id: string
          project_id?: string | null
          provider: Database["public"]["Enums"]["issue_tracker_provider"]
          vault_secret_id: string
          webhook_token?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          github_repo_name?: string | null
          github_repo_owner?: string | null
          github_webhook_id?: number | null
          github_webhook_secret?: string | null
          id?: string
          jira_base_url?: string
          jira_email?: string
          jira_project_key?: string
          org_id?: string
          project_id?: string | null
          provider?: Database["public"]["Enums"]["issue_tracker_provider"]
          vault_secret_id?: string
          webhook_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "issue_tracker_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_tracker_connections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_tracker_links: {
        Row: {
          connection_id: string
          created_at: string
          external_issue_id: string
          external_issue_key: string
          external_updated_at: string | null
          id: string
          issue_id: string
          last_sync_error: string | null
        }
        Insert: {
          connection_id: string
          created_at?: string
          external_issue_id: string
          external_issue_key: string
          external_updated_at?: string | null
          id?: string
          issue_id: string
          last_sync_error?: string | null
        }
        Update: {
          connection_id?: string
          created_at?: string
          external_issue_id?: string
          external_issue_key?: string
          external_updated_at?: string | null
          id?: string
          issue_id?: string
          last_sync_error?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "issue_tracker_links_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "issue_tracker_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_tracker_links_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: true
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
        ]
      }
      issues: {
        Row: {
          assignee_id: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          linked_run_case_id: string | null
          linked_test_case_id: string | null
          project_id: string
          severity: Database["public"]["Enums"]["issue_severity"]
          status: Database["public"]["Enums"]["issue_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          linked_run_case_id?: string | null
          linked_test_case_id?: string | null
          project_id: string
          severity?: Database["public"]["Enums"]["issue_severity"]
          status?: Database["public"]["Enums"]["issue_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          linked_run_case_id?: string | null
          linked_test_case_id?: string | null
          project_id?: string
          severity?: Database["public"]["Enums"]["issue_severity"]
          status?: Database["public"]["Enums"]["issue_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "issues_linked_run_case_id_fkey"
            columns: ["linked_run_case_id"]
            isOneToOne: false
            referencedRelation: "test_run_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_linked_test_case_id_fkey"
            columns: ["linked_test_case_id"]
            isOneToOne: false
            referencedRelation: "test_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invites: {
        Row: {
          created_at: string
          email: string
          id: string
          invited_by: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invited_by: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_by?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
        }
        Relationships: [
          {
            foreignKeyName: "organization_invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          created_by: string
          id: string
          key: string
          name: string
          org_id: string
          template: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          key: string
          name: string
          org_id: string
          template?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          key?: string
          name?: string
          org_id?: string
          template?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_buckets: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start?: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      run_folders: {
        Row: {
          created_at: string
          id: string
          name: string
          project_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          project_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "run_folders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_connections: {
        Row: {
          channel_id: string
          created_at: string
          created_by: string
          id: string
          org_id: string
          project_id: string
          vault_secret_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          created_by: string
          id?: string
          org_id: string
          project_id: string
          vault_secret_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          created_by?: string
          id?: string
          org_id?: string
          project_id?: string
          vault_secret_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "slack_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slack_connections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      test_case_attachments: {
        Row: {
          file_name: string
          file_size: number | null
          id: string
          run_case_id: string | null
          storage_path: string
          test_case_id: string
          uploaded_at: string
          uploaded_by: string
        }
        Insert: {
          file_name: string
          file_size?: number | null
          id?: string
          run_case_id?: string | null
          storage_path: string
          test_case_id: string
          uploaded_at?: string
          uploaded_by: string
        }
        Update: {
          file_name?: string
          file_size?: number | null
          id?: string
          run_case_id?: string | null
          storage_path?: string
          test_case_id?: string
          uploaded_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_case_attachments_run_case_id_fkey"
            columns: ["run_case_id"]
            isOneToOne: false
            referencedRelation: "test_run_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_case_attachments_test_case_id_fkey"
            columns: ["test_case_id"]
            isOneToOne: false
            referencedRelation: "test_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      test_case_custom_fields: {
        Row: {
          created_at: string
          display_order: number
          field_type: Database["public"]["Enums"]["test_case_custom_field_type"]
          id: string
          name: string
          options: Json
          project_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          field_type: Database["public"]["Enums"]["test_case_custom_field_type"]
          id?: string
          name: string
          options?: Json
          project_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          field_type?: Database["public"]["Enums"]["test_case_custom_field_type"]
          id?: string
          name?: string
          options?: Json
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_case_custom_fields_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      test_case_features: {
        Row: {
          created_at: string
          id: string
          name: string
          project_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          project_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_case_features_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      test_case_tag_links: {
        Row: {
          tag_id: string
          test_case_id: string
        }
        Insert: {
          tag_id: string
          test_case_id: string
        }
        Update: {
          tag_id?: string
          test_case_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_case_tag_links_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "test_case_tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_case_tag_links_test_case_id_fkey"
            columns: ["test_case_id"]
            isOneToOne: false
            referencedRelation: "test_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      test_case_tags: {
        Row: {
          color: string
          id: string
          name: string
          project_id: string
        }
        Insert: {
          color?: string
          id?: string
          name: string
          project_id: string
        }
        Update: {
          color?: string
          id?: string
          name?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_case_tags_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      test_case_versions: {
        Row: {
          changed_at: string
          changed_by: string
          id: string
          snapshot: Json
          test_case_id: string
          version: number
        }
        Insert: {
          changed_at?: string
          changed_by: string
          id?: string
          snapshot: Json
          test_case_id: string
          version: number
        }
        Update: {
          changed_at?: string
          changed_by?: string
          id?: string
          snapshot?: Json
          test_case_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "test_case_versions_test_case_id_fkey"
            columns: ["test_case_id"]
            isOneToOne: false
            referencedRelation: "test_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      test_cases: {
        Row: {
          assigned_to: string | null
          automation_script_ref: string | null
          automation_status: Database["public"]["Enums"]["test_case_automation_status"]
          created_at: string
          created_by: string
          custom_fields: Json
          feature_id: string
          id: string
          preconditions: string | null
          priority: Database["public"]["Enums"]["test_case_priority"]
          project_id: string
          reference_link: string | null
          sprint_number: number | null
          status: Database["public"]["Enums"]["test_case_status"]
          steps: Json
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          assigned_to?: string | null
          automation_script_ref?: string | null
          automation_status?: Database["public"]["Enums"]["test_case_automation_status"]
          created_at?: string
          created_by: string
          custom_fields?: Json
          feature_id: string
          id?: string
          preconditions?: string | null
          priority?: Database["public"]["Enums"]["test_case_priority"]
          project_id: string
          reference_link?: string | null
          sprint_number?: number | null
          status?: Database["public"]["Enums"]["test_case_status"]
          steps?: Json
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          assigned_to?: string | null
          automation_script_ref?: string | null
          automation_status?: Database["public"]["Enums"]["test_case_automation_status"]
          created_at?: string
          created_by?: string
          custom_fields?: Json
          feature_id?: string
          id?: string
          preconditions?: string | null
          priority?: Database["public"]["Enums"]["test_case_priority"]
          project_id?: string
          reference_link?: string | null
          sprint_number?: number | null
          status?: Database["public"]["Enums"]["test_case_status"]
          steps?: Json
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "test_cases_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "test_case_features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_cases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      test_run_cases: {
        Row: {
          executed_at: string | null
          executed_by: string | null
          id: string
          notes: string | null
          order_index: number
          run_id: string
          status: Database["public"]["Enums"]["run_case_status"]
          test_case_id: string
        }
        Insert: {
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          notes?: string | null
          order_index?: number
          run_id: string
          status?: Database["public"]["Enums"]["run_case_status"]
          test_case_id: string
        }
        Update: {
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          notes?: string | null
          order_index?: number
          run_id?: string
          status?: Database["public"]["Enums"]["run_case_status"]
          test_case_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_run_cases_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "test_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_run_cases_test_case_id_fkey"
            columns: ["test_case_id"]
            isOneToOne: false
            referencedRelation: "test_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      test_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string
          folder_id: string | null
          id: string
          name: string
          pr_number: number | null
          pr_url: string | null
          project_id: string
          status: Database["public"]["Enums"]["run_status"]
          suite_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by: string
          folder_id?: string | null
          id?: string
          name: string
          pr_number?: number | null
          pr_url?: string | null
          project_id: string
          status?: Database["public"]["Enums"]["run_status"]
          suite_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string
          folder_id?: string | null
          id?: string
          name?: string
          pr_number?: number | null
          pr_url?: string | null
          project_id?: string
          status?: Database["public"]["Enums"]["run_status"]
          suite_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "test_runs_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "run_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_runs_suite_id_fkey"
            columns: ["suite_id"]
            isOneToOne: false
            referencedRelation: "test_suites"
            referencedColumns: ["id"]
          },
        ]
      }
      test_suite_cases: {
        Row: {
          added_at: string
          suite_id: string
          test_case_id: string
        }
        Insert: {
          added_at?: string
          suite_id: string
          test_case_id: string
        }
        Update: {
          added_at?: string
          suite_id?: string
          test_case_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_suite_cases_suite_id_fkey"
            columns: ["suite_id"]
            isOneToOne: false
            referencedRelation: "test_suites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_suite_cases_test_case_id_fkey"
            columns: ["test_case_id"]
            isOneToOne: false
            referencedRelation: "test_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      test_suites: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          project_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          project_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_suites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          id: string
          org_id: string | null
          payload: Json
          processed_at: string | null
          received_at: string
          signature_valid: boolean
          source: string
        }
        Insert: {
          id?: string
          org_id?: string | null
          payload: Json
          processed_at?: string | null
          received_at?: string
          signature_valid: boolean
          source: string
        }
        Update: {
          id?: string
          org_id?: string | null
          payload?: Json
          processed_at?: string | null
          received_at?: string
          signature_valid?: boolean
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_report_daily_plans: {
        Row: {
          id: string
          plan_date: string
          planned_count: number
          project_id: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          id?: string
          plan_date: string
          planned_count?: number
          project_id: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          id?: string
          plan_date?: string
          planned_count?: number
          project_id?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_report_daily_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_report_drafts: {
        Row: {
          highlights: string
          project_id: string
          rag_status: Database["public"]["Enums"]["report_rag_status"]
          updated_at: string
          updated_by: string
        }
        Insert: {
          highlights?: string
          project_id: string
          rag_status?: Database["public"]["Enums"]["report_rag_status"]
          updated_at?: string
          updated_by: string
        }
        Update: {
          highlights?: string
          project_id?: string
          rag_status?: Database["public"]["Enums"]["report_rag_status"]
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_report_drafts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_report_snapshots: {
        Row: {
          created_at: string
          created_by: string
          daily_planned: Json
          highlights: string
          id: string
          metrics: Json
          project_id: string
          rag_status: Database["public"]["Enums"]["report_rag_status"]
          week_ending: string
        }
        Insert: {
          created_at?: string
          created_by: string
          daily_planned: Json
          highlights: string
          id?: string
          metrics: Json
          project_id: string
          rag_status: Database["public"]["Enums"]["report_rag_status"]
          week_ending: string
        }
        Update: {
          created_at?: string
          created_by?: string
          daily_planned?: Json
          highlights?: string
          id?: string
          metrics?: Json
          project_id?: string
          rag_status?: Database["public"]["Enums"]["report_rag_status"]
          week_ending?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_report_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      api_create_run_result: {
        Args: {
          p_notes?: string
          p_org_id: string
          p_run_id: string
          p_status: Database["public"]["Enums"]["run_case_status"]
          p_test_case_id: string
        }
        Returns: {
          executed_at: string | null
          executed_by: string | null
          id: string
          notes: string | null
          order_index: number
          run_id: string
          status: Database["public"]["Enums"]["run_case_status"]
          test_case_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "test_run_cases"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      api_get_github_pat_for_project: {
        Args: { p_org_id: string; p_project_id: string }
        Returns: {
          repo_name: string
          repo_owner: string
          token: string
        }[]
      }
      api_get_run: {
        Args: { p_org_id: string; p_run_id: string }
        Returns: {
          completed_at: string | null
          created_at: string
          created_by: string
          folder_id: string | null
          id: string
          name: string
          pr_number: number | null
          pr_url: string | null
          project_id: string
          status: Database["public"]["Enums"]["run_status"]
          suite_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "test_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      api_get_slack_bot_token_for_project: {
        Args: { p_org_id: string; p_project_id: string }
        Returns: {
          channel_id: string
          token: string
        }[]
      }
      api_get_test_case: {
        Args: { p_org_id: string; p_test_case_id: string }
        Returns: {
          assigned_to: string | null
          automation_script_ref: string | null
          automation_status: Database["public"]["Enums"]["test_case_automation_status"]
          created_at: string
          created_by: string
          custom_fields: Json
          feature_id: string
          id: string
          preconditions: string | null
          priority: Database["public"]["Enums"]["test_case_priority"]
          project_id: string
          reference_link: string | null
          sprint_number: number | null
          status: Database["public"]["Enums"]["test_case_status"]
          steps: Json
          title: string
          updated_at: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "test_cases"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      api_ingest_run_results: {
        Args: {
          p_key_id: string
          p_org_id: string
          p_pr_number?: number
          p_project_id: string
          p_results: Json
          p_run_name: string
        }
        Returns: {
          auto_created: number
          matched: number
          pr_url: string
          run_id: string
        }[]
      }
      api_list_runs: {
        Args: { p_org_id: string; p_project_id: string }
        Returns: {
          completed_at: string | null
          created_at: string
          created_by: string
          folder_id: string | null
          id: string
          name: string
          pr_number: number | null
          pr_url: string | null
          project_id: string
          status: Database["public"]["Enums"]["run_status"]
          suite_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "test_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      api_list_test_cases: {
        Args: { p_org_id: string; p_project_id: string }
        Returns: {
          assigned_to: string | null
          automation_script_ref: string | null
          automation_status: Database["public"]["Enums"]["test_case_automation_status"]
          created_at: string
          created_by: string
          custom_fields: Json
          feature_id: string
          id: string
          preconditions: string | null
          priority: Database["public"]["Enums"]["test_case_priority"]
          project_id: string
          reference_link: string | null
          sprint_number: number | null
          status: Database["public"]["Enums"]["test_case_status"]
          steps: Json
          title: string
          updated_at: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "test_cases"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      check_api_key_rate_limit: {
        Args: {
          p_action: string
          p_key_id: string
          p_limit: number
          p_window_seconds: number
        }
        Returns: boolean
      }
      check_rate_limit: {
        Args: { p_action: string; p_limit: number; p_window_seconds: number }
        Returns: boolean
      }
      create_github_connection: {
        Args: {
          p_project_id: string
          p_repo_name: string
          p_repo_owner: string
          p_token: string
          p_webhook_secret: string
        }
        Returns: string
      }
      create_jira_connection: {
        Args: {
          p_base_url: string
          p_email: string
          p_org_id: string
          p_project_key: string
          p_token: string
          p_webhook_token: string
        }
        Returns: string
      }
      create_organization_with_owner: {
        Args: { org_name: string; org_slug: string }
        Returns: {
          created_at: string
          created_by: string
          id: string
          name: string
          slug: string
        }
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_slack_connection: {
        Args: {
          p_bot_token: string
          p_channel_id: string
          p_project_id: string
        }
        Returns: string
      }
      delete_github_connection: {
        Args: { p_connection_id: string }
        Returns: undefined
      }
      delete_jira_connection: {
        Args: { p_connection_id: string }
        Returns: undefined
      }
      delete_slack_connection: {
        Args: { p_connection_id: string }
        Returns: undefined
      }
      get_github_pat: { Args: { p_connection_id: string }; Returns: string }
      get_jira_api_token: { Args: { p_connection_id: string }; Returns: string }
      get_org_members: {
        Args: { check_org_id: string }
        Returns: {
          created_at: string
          email: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }[]
      }
      get_slack_bot_token: {
        Args: { p_connection_id: string }
        Returns: string
      }
      validate_api_key: {
        Args: { p_key: string }
        Returns: {
          key_id: string
          org_id: string
        }[]
      }
    }
    Enums: {
      issue_severity: "low" | "medium" | "high" | "critical"
      issue_status: "open" | "in_progress" | "resolved" | "closed"
      issue_tracker_provider: "jira" | "github"
      org_role: "owner" | "admin" | "member"
      report_rag_status: "red" | "amber" | "green"
      run_case_status: "pending" | "passed" | "failed" | "blocked" | "skipped"
      run_status: "planned" | "in_progress" | "completed"
      test_case_automation_status:
        | "manual_only"
        | "to_be_automated"
        | "automated"
      test_case_custom_field_type: "text" | "number" | "select"
      test_case_priority: "low" | "medium" | "high" | "critical"
      test_case_status: "active" | "draft" | "deprecated"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      issue_severity: ["low", "medium", "high", "critical"],
      issue_status: ["open", "in_progress", "resolved", "closed"],
      issue_tracker_provider: ["jira", "github"],
      org_role: ["owner", "admin", "member"],
      report_rag_status: ["red", "amber", "green"],
      run_case_status: ["pending", "passed", "failed", "blocked", "skipped"],
      run_status: ["planned", "in_progress", "completed"],
      test_case_automation_status: [
        "manual_only",
        "to_be_automated",
        "automated",
      ],
      test_case_custom_field_type: ["text", "number", "select"],
      test_case_priority: ["low", "medium", "high", "critical"],
      test_case_status: ["active", "draft", "deprecated"],
    },
  },
} as const

// --- App-level convenience aliases on top of the generated types above ---

export type OrgRole = Enums<"org_role">;
export type TestCasePriority = Enums<"test_case_priority">;
export type TestCaseStatus = Enums<"test_case_status">;
export type RunStatus = Enums<"run_status">;
export type RunCaseStatus = Enums<"run_case_status">;
export type ReportRagStatus = Enums<"report_rag_status">;
export type IssueStatus = Enums<"issue_status">;
export type IssueSeverity = Enums<"issue_severity">;
export type TestCaseAutomationStatus = Enums<"test_case_automation_status">;
export type TestCaseCustomFieldType = Enums<"test_case_custom_field_type">;
export type ProjectTemplate = "web" | "mobile" | "api" | "blank";

// The extra index signature keeps this structurally assignable to/from the
// generated `Json` type (used for the `steps` jsonb column) without casts
// through `unknown` at every call site.
export interface TestStep {
  step: string;
  expected: string;
  [key: string]: Json | undefined;
}
