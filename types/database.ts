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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: string | null
          metadata: Json
          tenant_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          tenant_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          tenant_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_contacts: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          client_id: string
          created_at: string
          created_by: string
          email: string | null
          first_name: string
          id: string
          is_primary: boolean
          job_title: string | null
          last_name: string | null
          notes: string | null
          phone: string | null
          preferred_contact_method: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          client_id: string
          created_at?: string
          created_by: string
          email?: string | null
          first_name: string
          id?: string
          is_primary?: boolean
          job_title?: string | null
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          preferred_contact_method?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          client_id?: string
          created_at?: string
          created_by?: string
          email?: string | null
          first_name?: string
          id?: string
          is_primary?: boolean
          job_title?: string | null
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          preferred_contact_method?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_contacts_client_id_tenant_id_fkey"
            columns: ["client_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "client_contacts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address_line_1: string | null
          address_line_2: string | null
          archived_at: string | null
          archived_by: string | null
          city: string | null
          client_type: string
          country_code: string | null
          created_at: string
          created_by: string
          display_name: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          legal_name: string | null
          phone: string | null
          postal_code: string | null
          preferred_contact_method: string | null
          secondary_phone: string | null
          source: string | null
          state: string | null
          tax_exempt: boolean
          tenant_id: string
          updated_at: string
          website: string | null
        }
        Insert: {
          address_line_1?: string | null
          address_line_2?: string | null
          archived_at?: string | null
          archived_by?: string | null
          city?: string | null
          client_type: string
          country_code?: string | null
          created_at?: string
          created_by: string
          display_name: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          legal_name?: string | null
          phone?: string | null
          postal_code?: string | null
          preferred_contact_method?: string | null
          secondary_phone?: string | null
          source?: string | null
          state?: string | null
          tax_exempt?: boolean
          tenant_id: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          address_line_1?: string | null
          address_line_2?: string | null
          archived_at?: string | null
          archived_by?: string | null
          city?: string | null
          client_type?: string
          country_code?: string | null
          created_at?: string
          created_by?: string
          display_name?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          legal_name?: string | null
          phone?: string | null
          postal_code?: string | null
          preferred_contact_method?: string | null
          secondary_phone?: string | null
          source?: string | null
          state?: string | null
          tax_exempt?: boolean
          tenant_id?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_activities: {
        Row: {
          activity_type: string
          actor_user_id: string | null
          client_id: string | null
          created_at: string
          id: string
          metadata: Json
          opportunity_id: string | null
          project_id: string | null
          tenant_id: string
        }
        Insert: {
          activity_type: string
          actor_user_id?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          opportunity_id?: string | null
          project_id?: string | null
          tenant_id: string
        }
        Update: {
          activity_type?: string
          actor_user_id?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          opportunity_id?: string | null
          project_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_activities_client_id_tenant_id_fkey"
            columns: ["client_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "crm_activities_opportunity_id_tenant_id_fkey"
            columns: ["opportunity_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "crm_activities_project_id_tenant_id_fkey"
            columns: ["project_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "crm_activities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_notes: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          body: string
          client_id: string | null
          created_at: string
          created_by: string
          id: string
          opportunity_id: string | null
          project_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          body: string
          client_id?: string | null
          created_at?: string
          created_by: string
          id?: string
          opportunity_id?: string | null
          project_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          body?: string
          client_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          opportunity_id?: string | null
          project_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_notes_client_id_tenant_id_fkey"
            columns: ["client_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "crm_notes_opportunity_id_tenant_id_fkey"
            columns: ["opportunity_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "crm_notes_project_id_tenant_id_fkey"
            columns: ["project_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "crm_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      material_catalog_items: {
        Row: {
          archived_at: string | null
          brand: string | null
          category: string
          created_at: string
          default_unit: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          scope: string
          service_type: string | null
          sku: string | null
          supplier_name: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          brand?: string | null
          category: string
          created_at?: string
          default_unit: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          scope: string
          service_type?: string | null
          sku?: string | null
          supplier_name?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          brand?: string | null
          category?: string
          created_at?: string
          default_unit?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          scope?: string
          service_type?: string | null
          sku?: string | null
          supplier_name?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_catalog_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      material_zip_prices: {
        Row: {
          archived_at: string | null
          city: string | null
          created_at: string
          currency_code: string
          effective_date: string
          expires_at: string | null
          id: string
          material_catalog_item_id: string
          price_source: string
          state_code: string | null
          supplier_name: string | null
          tenant_id: string | null
          unit_price_cents: number
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          archived_at?: string | null
          city?: string | null
          created_at?: string
          currency_code?: string
          effective_date?: string
          expires_at?: string | null
          id?: string
          material_catalog_item_id: string
          price_source: string
          state_code?: string | null
          supplier_name?: string | null
          tenant_id?: string | null
          unit_price_cents: number
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          archived_at?: string | null
          city?: string | null
          created_at?: string
          currency_code?: string
          effective_date?: string
          expires_at?: string | null
          id?: string
          material_catalog_item_id?: string
          price_source?: string
          state_code?: string | null
          supplier_name?: string | null
          tenant_id?: string | null
          unit_price_cents?: number
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "material_zip_prices_material_catalog_item_id_fkey"
            columns: ["material_catalog_item_id"]
            isOneToOne: false
            referencedRelation: "material_catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_zip_prices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          caption: string
          created_at: string
          height: number | null
          id: string
          media_type: string
          mime_type: string
          original_filename: string
          size_bytes: number
          storage_bucket: string
          storage_path: string
          tenant_id: string
          updated_at: string
          uploaded_by: string
          width: number | null
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          caption?: string
          created_at?: string
          height?: number | null
          id?: string
          media_type: string
          mime_type: string
          original_filename: string
          size_bytes: number
          storage_bucket?: string
          storage_path: string
          tenant_id: string
          updated_at?: string
          uploaded_by: string
          width?: number | null
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          caption?: string
          created_at?: string
          height?: number | null
          id?: string
          media_type?: string
          mime_type?: string
          original_filename?: string
          size_bytes?: number
          storage_bucket?: string
          storage_path?: string
          tenant_id?: string
          updated_at?: string
          uploaded_by?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          assigned_to: string | null
          client_id: string
          created_at: string
          created_by: string
          estimated_value_cents: number | null
          expected_close_date: string | null
          id: string
          inspection_scheduled_at: string | null
          lost_reason: string | null
          pre_archive_status: string | null
          probability: number | null
          source: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          assigned_to?: string | null
          client_id: string
          created_at?: string
          created_by: string
          estimated_value_cents?: number | null
          expected_close_date?: string | null
          id?: string
          inspection_scheduled_at?: string | null
          lost_reason?: string | null
          pre_archive_status?: string | null
          probability?: number | null
          source?: string | null
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          assigned_to?: string | null
          client_id?: string
          created_at?: string
          created_by?: string
          estimated_value_cents?: number | null
          expected_close_date?: string | null
          id?: string
          inspection_scheduled_at?: string | null
          lost_reason?: string | null
          pre_archive_status?: string | null
          probability?: number | null
          source?: string | null
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_assigned_to_tenant_id_fkey"
            columns: ["assigned_to", "tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_memberships"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "opportunities_client_id_tenant_id_fkey"
            columns: ["client_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "opportunities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          created_at: string
          description: string | null
          id: string
          key: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          key: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          name?: string
        }
        Relationships: []
      }
      portfolio_project_media: {
        Row: {
          caption: string
          created_at: string
          id: string
          media_asset_id: string
          portfolio_project_id: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          caption?: string
          created_at?: string
          id?: string
          media_asset_id: string
          portfolio_project_id: string
          sort_order?: number
          tenant_id: string
        }
        Update: {
          caption?: string
          created_at?: string
          id?: string
          media_asset_id?: string
          portfolio_project_id?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_project_media_media_asset_id_tenant_id_fkey"
            columns: ["media_asset_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "portfolio_project_media_portfolio_project_id_tenant_id_fkey"
            columns: ["portfolio_project_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "portfolio_projects"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "portfolio_project_media_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_projects: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string
          id: string
          location_label: string
          service_type: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string
          id?: string
          location_label?: string
          service_type: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          location_label?: string
          service_type?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_projects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          locale: string
          timezone: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          locale?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          locale?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_addresses: {
        Row: {
          access_instructions: string | null
          address_line_1: string
          address_line_2: string | null
          archived_at: string | null
          archived_by: string | null
          city: string
          country_code: string
          created_at: string
          created_by: string
          id: string
          is_primary: boolean
          latitude: number | null
          longitude: number | null
          postal_code: string
          project_id: string
          state: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          access_instructions?: string | null
          address_line_1: string
          address_line_2?: string | null
          archived_at?: string | null
          archived_by?: string | null
          city: string
          country_code?: string
          created_at?: string
          created_by: string
          id?: string
          is_primary?: boolean
          latitude?: number | null
          longitude?: number | null
          postal_code: string
          project_id: string
          state: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          access_instructions?: string | null
          address_line_1?: string
          address_line_2?: string | null
          archived_at?: string | null
          archived_by?: string | null
          city?: string
          country_code?: string
          created_at?: string
          created_by?: string
          id?: string
          is_primary?: boolean
          latitude?: number | null
          longitude?: number | null
          postal_code?: string
          project_id?: string
          state?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_addresses_project_id_tenant_id_fkey"
            columns: ["project_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "project_addresses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          assigned_to: string | null
          client_id: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          inspection_scheduled_at: string | null
          name: string
          opportunity_id: string | null
          pre_archive_status: string | null
          primary_contact_id: string | null
          service_type: string | null
          status: string
          tenant_id: string
          tentative_start_date: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          assigned_to?: string | null
          client_id: string
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          inspection_scheduled_at?: string | null
          name: string
          opportunity_id?: string | null
          pre_archive_status?: string | null
          primary_contact_id?: string | null
          service_type?: string | null
          status?: string
          tenant_id: string
          tentative_start_date?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          assigned_to?: string | null
          client_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          inspection_scheduled_at?: string | null
          name?: string
          opportunity_id?: string | null
          pre_archive_status?: string | null
          primary_contact_id?: string | null
          service_type?: string | null
          status?: string
          tenant_id?: string
          tentative_start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_assigned_to_tenant_id_fkey"
            columns: ["assigned_to", "tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_memberships"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "projects_client_id_tenant_id_fkey"
            columns: ["client_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "projects_opportunity_id_tenant_id_fkey"
            columns: ["opportunity_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "projects_primary_contact_id_tenant_id_fkey"
            columns: ["primary_contact_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "client_contacts"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "projects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_client_responses: {
        Row: {
          accepted_terms: boolean
          client_email: string
          client_name: string | null
          created_at: string
          decline_reason: string | null
          id: string
          ip_hash: string | null
          portal_link_id: string
          portal_session_id: string
          proposal_id: string
          proposal_version_id: string
          responded_at: string
          response_type: string
          tenant_id: string
          user_agent_hash: string | null
        }
        Insert: {
          accepted_terms?: boolean
          client_email: string
          client_name?: string | null
          created_at?: string
          decline_reason?: string | null
          id?: string
          ip_hash?: string | null
          portal_link_id: string
          portal_session_id: string
          proposal_id: string
          proposal_version_id: string
          responded_at?: string
          response_type: string
          tenant_id: string
          user_agent_hash?: string | null
        }
        Update: {
          accepted_terms?: boolean
          client_email?: string
          client_name?: string | null
          created_at?: string
          decline_reason?: string | null
          id?: string
          ip_hash?: string | null
          portal_link_id?: string
          portal_session_id?: string
          proposal_id?: string
          proposal_version_id?: string
          responded_at?: string
          response_type?: string
          tenant_id?: string
          user_agent_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposal_client_responses_portal_link_id_tenant_id_fkey"
            columns: ["portal_link_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_portal_links"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_client_responses_portal_session_id_tenant_id_fkey"
            columns: ["portal_session_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_portal_sessions"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_client_responses_proposal_id_tenant_id_fkey"
            columns: ["proposal_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_client_responses_proposal_version_id_tenant_id_fkey"
            columns: ["proposal_version_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_versions"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_client_responses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_creation_requests: {
        Row: {
          created_at: string
          idempotency_key: string
          proposal_id: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          idempotency_key: string
          proposal_id?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          idempotency_key?: string
          proposal_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_creation_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_labor_items: {
        Row: {
          archived_at: string | null
          created_at: string
          estimated_days: number | null
          fixed_total_cents: number | null
          hourly_rate_cents: number | null
          hours_per_day: number | null
          id: string
          label: string
          labor_rate_per_area_cents: number | null
          labor_rate_per_linear_cents: number | null
          measured_area: number | null
          measured_linear_length: number | null
          pricing_method: string
          proposal_measurement_id: string | null
          proposal_version_id: string
          sort_order: number
          tenant_id: string
          total_cents: number
          total_hours: number
          updated_at: string
          worker_count: number | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          estimated_days?: number | null
          fixed_total_cents?: number | null
          hourly_rate_cents?: number | null
          hours_per_day?: number | null
          id?: string
          label: string
          labor_rate_per_area_cents?: number | null
          labor_rate_per_linear_cents?: number | null
          measured_area?: number | null
          measured_linear_length?: number | null
          pricing_method?: string
          proposal_measurement_id?: string | null
          proposal_version_id: string
          sort_order?: number
          tenant_id: string
          total_cents?: number
          total_hours?: number
          updated_at?: string
          worker_count?: number | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          estimated_days?: number | null
          fixed_total_cents?: number | null
          hourly_rate_cents?: number | null
          hours_per_day?: number | null
          id?: string
          label?: string
          labor_rate_per_area_cents?: number | null
          labor_rate_per_linear_cents?: number | null
          measured_area?: number | null
          measured_linear_length?: number | null
          pricing_method?: string
          proposal_measurement_id?: string | null
          proposal_version_id?: string
          sort_order?: number
          tenant_id?: string
          total_cents?: number
          total_hours?: number
          updated_at?: string
          worker_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "proposal_labor_items_measurement_fk"
            columns: ["proposal_measurement_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_measurements"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_labor_items_proposal_version_id_tenant_id_fkey"
            columns: ["proposal_version_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_versions"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_labor_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_line_items: {
        Row: {
          archived_at: string | null
          category: string
          created_at: string
          description: string
          id: string
          line_total_cents: number
          material_catalog_item_id: string | null
          material_zip_price_id: string | null
          proposal_version_id: string
          quantity: number
          section_id: string | null
          sort_order: number
          source_price_effective_date: string | null
          source_supplier_name: string | null
          source_type: string
          source_zip_code: string | null
          taxable: boolean
          tenant_id: string
          unit: string
          unit_price_cents: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          category: string
          created_at?: string
          description: string
          id?: string
          line_total_cents?: number
          material_catalog_item_id?: string | null
          material_zip_price_id?: string | null
          proposal_version_id: string
          quantity: number
          section_id?: string | null
          sort_order?: number
          source_price_effective_date?: string | null
          source_supplier_name?: string | null
          source_type?: string
          source_zip_code?: string | null
          taxable?: boolean
          tenant_id: string
          unit: string
          unit_price_cents: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          category?: string
          created_at?: string
          description?: string
          id?: string
          line_total_cents?: number
          material_catalog_item_id?: string | null
          material_zip_price_id?: string | null
          proposal_version_id?: string
          quantity?: number
          section_id?: string | null
          sort_order?: number
          source_price_effective_date?: string | null
          source_supplier_name?: string | null
          source_type?: string
          source_zip_code?: string | null
          taxable?: boolean
          tenant_id?: string
          unit?: string
          unit_price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_line_items_material_catalog_item_id_fkey"
            columns: ["material_catalog_item_id"]
            isOneToOne: false
            referencedRelation: "material_catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_line_items_material_zip_price_id_fkey"
            columns: ["material_zip_price_id"]
            isOneToOne: false
            referencedRelation: "material_zip_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_line_items_proposal_version_id_tenant_id_fkey"
            columns: ["proposal_version_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_versions"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_line_items_section_id_tenant_id_fkey"
            columns: ["section_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_sections"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_line_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_measurement_groups: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          proposal_version_id: string
          service_type: string | null
          tenant_id: string
          unit_system: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          proposal_version_id: string
          service_type?: string | null
          tenant_id: string
          unit_system?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          proposal_version_id?: string
          service_type?: string | null
          tenant_id?: string
          unit_system?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_measurement_groups_proposal_version_id_tenant_id_fkey"
            columns: ["proposal_version_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_versions"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_measurement_groups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_measurement_materials: {
        Row: {
          calculated_quantity: number
          coats: number
          coverage_rate: number
          coverage_unit: string | null
          created_at: string
          id: string
          material_catalog_item_id: string
          material_zip_price_id: string | null
          measurement_value_field: string
          proposal_line_item_id: string | null
          proposal_measurement_id: string
          proposal_version_id: string
          tenant_id: string
          total_cents_snapshot: number
          unit: string
          unit_price_cents_snapshot: number
          updated_at: string
          waste_bps: number
        }
        Insert: {
          calculated_quantity: number
          coats?: number
          coverage_rate: number
          coverage_unit?: string | null
          created_at?: string
          id?: string
          material_catalog_item_id: string
          material_zip_price_id?: string | null
          measurement_value_field: string
          proposal_line_item_id?: string | null
          proposal_measurement_id: string
          proposal_version_id: string
          tenant_id: string
          total_cents_snapshot: number
          unit: string
          unit_price_cents_snapshot: number
          updated_at?: string
          waste_bps?: number
        }
        Update: {
          calculated_quantity?: number
          coats?: number
          coverage_rate?: number
          coverage_unit?: string | null
          created_at?: string
          id?: string
          material_catalog_item_id?: string
          material_zip_price_id?: string | null
          measurement_value_field?: string
          proposal_line_item_id?: string | null
          proposal_measurement_id?: string
          proposal_version_id?: string
          tenant_id?: string
          total_cents_snapshot?: number
          unit?: string
          unit_price_cents_snapshot?: number
          updated_at?: string
          waste_bps?: number
        }
        Relationships: [
          {
            foreignKeyName: "proposal_measurement_material_proposal_line_item_id_tenant_fkey"
            columns: ["proposal_line_item_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_line_items"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_measurement_material_proposal_measurement_id_tena_fkey"
            columns: ["proposal_measurement_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_measurements"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_measurement_material_proposal_version_id_tenant_i_fkey"
            columns: ["proposal_version_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_versions"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_measurement_materials_material_catalog_item_id_fkey"
            columns: ["material_catalog_item_id"]
            isOneToOne: false
            referencedRelation: "material_catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_measurement_materials_material_zip_price_id_fkey"
            columns: ["material_zip_price_id"]
            isOneToOne: false
            referencedRelation: "material_zip_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_measurement_materials_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_measurement_shapes: {
        Row: {
          created_at: string
          id: string
          proposal_measurement_id: string
          proposal_version_id: string
          scale_reference_length: number | null
          scale_unit: string | null
          shape_data: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          proposal_measurement_id: string
          proposal_version_id: string
          scale_reference_length?: number | null
          scale_unit?: string | null
          shape_data: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          proposal_measurement_id?: string
          proposal_version_id?: string
          scale_reference_length?: number | null
          scale_unit?: string | null
          shape_data?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_measurement_shapes_proposal_measurement_id_tenant_fkey"
            columns: ["proposal_measurement_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_measurements"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_measurement_shapes_proposal_version_id_tenant_id_fkey"
            columns: ["proposal_version_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_versions"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_measurement_shapes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_measurements: {
        Row: {
          archived_at: string | null
          area: number | null
          created_at: string
          height: number | null
          id: string
          length: number | null
          linear_length: number | null
          measurement_group_id: string
          measurement_type: string
          name: string
          notes: string | null
          perimeter: number | null
          proposal_version_id: string
          shape_type: string
          sort_order: number
          tenant_id: string
          unit: string
          updated_at: string
          volume: number | null
          waste_bps: number
          width: number | null
        }
        Insert: {
          archived_at?: string | null
          area?: number | null
          created_at?: string
          height?: number | null
          id?: string
          length?: number | null
          linear_length?: number | null
          measurement_group_id: string
          measurement_type: string
          name: string
          notes?: string | null
          perimeter?: number | null
          proposal_version_id: string
          shape_type: string
          sort_order?: number
          tenant_id: string
          unit: string
          updated_at?: string
          volume?: number | null
          waste_bps?: number
          width?: number | null
        }
        Update: {
          archived_at?: string | null
          area?: number | null
          created_at?: string
          height?: number | null
          id?: string
          length?: number | null
          linear_length?: number | null
          measurement_group_id?: string
          measurement_type?: string
          name?: string
          notes?: string | null
          perimeter?: number | null
          proposal_version_id?: string
          shape_type?: string
          sort_order?: number
          tenant_id?: string
          unit?: string
          updated_at?: string
          volume?: number | null
          waste_bps?: number
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "proposal_measurements_measurement_group_id_tenant_id_fkey"
            columns: ["measurement_group_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_measurement_groups"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_measurements_proposal_version_id_tenant_id_fkey"
            columns: ["proposal_version_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_versions"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_measurements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_media: {
        Row: {
          archived_at: string | null
          caption: string
          created_at: string
          id: string
          media_asset_id: string
          portfolio_project_id: string | null
          proposal_version_id: string
          sort_order: number
          tenant_id: string
          usage_type: string
        }
        Insert: {
          archived_at?: string | null
          caption?: string
          created_at?: string
          id?: string
          media_asset_id: string
          portfolio_project_id?: string | null
          proposal_version_id: string
          sort_order?: number
          tenant_id: string
          usage_type: string
        }
        Update: {
          archived_at?: string | null
          caption?: string
          created_at?: string
          id?: string
          media_asset_id?: string
          portfolio_project_id?: string | null
          proposal_version_id?: string
          sort_order?: number
          tenant_id?: string
          usage_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_media_media_asset_id_tenant_id_fkey"
            columns: ["media_asset_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_media_portfolio_project_id_tenant_id_fkey"
            columns: ["portfolio_project_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "portfolio_projects"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_media_proposal_version_id_tenant_id_fkey"
            columns: ["proposal_version_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_versions"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_media_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_notification_deliveries: {
        Row: {
          created_at: string
          dedupe_key: string
          error_code: string | null
          event_type: string
          failed_at: string | null
          id: string
          proposal_id: string
          proposal_version_id: string
          provider: string
          recipient_email: string
          sent_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          dedupe_key: string
          error_code?: string | null
          event_type: string
          failed_at?: string | null
          id?: string
          proposal_id: string
          proposal_version_id: string
          provider: string
          recipient_email: string
          sent_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          dedupe_key?: string
          error_code?: string | null
          event_type?: string
          failed_at?: string | null
          id?: string
          proposal_id?: string
          proposal_version_id?: string
          provider?: string
          recipient_email?: string
          sent_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_notification_deliver_proposal_version_id_tenant_i_fkey"
            columns: ["proposal_version_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_versions"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_notification_deliveries_proposal_id_tenant_id_fkey"
            columns: ["proposal_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_notification_deliveries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_portal_links: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          id: string
          last_viewed_at: string | null
          proposal_id: string
          proposal_version_id: string
          revoked_at: string | null
          revoked_by: string | null
          status: string
          tenant_id: string
          token_hash: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          last_viewed_at?: string | null
          proposal_id: string
          proposal_version_id: string
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          tenant_id: string
          token_hash: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          last_viewed_at?: string | null
          proposal_id?: string
          proposal_version_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          tenant_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_portal_links_proposal_id_tenant_id_fkey"
            columns: ["proposal_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_portal_links_proposal_version_id_tenant_id_fkey"
            columns: ["proposal_version_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_versions"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_portal_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_portal_otps: {
        Row: {
          attempt_count: number
          client_email: string
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          ip_hash: string | null
          max_attempts: number
          portal_link_id: string
          proposal_id: string
          tenant_id: string
          user_agent_hash: string | null
        }
        Insert: {
          attempt_count?: number
          client_email: string
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          ip_hash?: string | null
          max_attempts?: number
          portal_link_id: string
          proposal_id: string
          tenant_id: string
          user_agent_hash?: string | null
        }
        Update: {
          attempt_count?: number
          client_email?: string
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          ip_hash?: string | null
          max_attempts?: number
          portal_link_id?: string
          proposal_id?: string
          tenant_id?: string
          user_agent_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposal_portal_otps_portal_link_id_tenant_id_fkey"
            columns: ["portal_link_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_portal_links"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_portal_otps_proposal_id_tenant_id_fkey"
            columns: ["proposal_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_portal_otps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_portal_sessions: {
        Row: {
          client_email: string
          created_at: string
          expires_at: string
          id: string
          last_seen_at: string
          portal_link_id: string
          proposal_id: string
          revoked_at: string | null
          session_token_hash: string
          tenant_id: string
        }
        Insert: {
          client_email: string
          created_at?: string
          expires_at: string
          id?: string
          last_seen_at?: string
          portal_link_id: string
          proposal_id: string
          revoked_at?: string | null
          session_token_hash: string
          tenant_id: string
        }
        Update: {
          client_email?: string
          created_at?: string
          expires_at?: string
          id?: string
          last_seen_at?: string
          portal_link_id?: string
          proposal_id?: string
          revoked_at?: string | null
          session_token_hash?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_portal_sessions_portal_link_id_tenant_id_fkey"
            columns: ["portal_link_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_portal_links"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_portal_sessions_proposal_id_tenant_id_fkey"
            columns: ["proposal_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_portal_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_sections: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string
          id: string
          proposal_version_id: string
          section_type: string
          sort_order: number
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string
          id?: string
          proposal_version_id: string
          section_type?: string
          sort_order?: number
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string
          id?: string
          proposal_version_id?: string
          section_type?: string
          sort_order?: number
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_sections_proposal_version_id_tenant_id_fkey"
            columns: ["proposal_version_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_versions"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_sections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_versions: {
        Row: {
          calculation_version: number
          created_at: string
          created_by: string
          default_hours_per_day: number | null
          discount_cents: number
          discount_type: string
          discount_value: number
          estimated_duration_days: number | null
          estimated_start_date: string | null
          exclusions: string
          id: string
          labor_total_cents: number
          line_items_subtotal_cents: number
          locked_at: string | null
          notes_for_client: string
          pricing_city: string | null
          pricing_state_code: string | null
          pricing_zip_code: string | null
          proposal_id: string
          scope_intro: string | null
          subtotal_cents: number
          summary: string | null
          tax_cents: number
          tax_rate_bps: number
          taxable_subtotal_cents: number
          tenant_id: string
          terms: string
          total_cents: number
          updated_at: string
          version_number: number
          version_status: string
        }
        Insert: {
          calculation_version?: number
          created_at?: string
          created_by: string
          default_hours_per_day?: number | null
          discount_cents?: number
          discount_type?: string
          discount_value?: number
          estimated_duration_days?: number | null
          estimated_start_date?: string | null
          exclusions?: string
          id?: string
          labor_total_cents?: number
          line_items_subtotal_cents?: number
          locked_at?: string | null
          notes_for_client?: string
          pricing_city?: string | null
          pricing_state_code?: string | null
          pricing_zip_code?: string | null
          proposal_id: string
          scope_intro?: string | null
          subtotal_cents?: number
          summary?: string | null
          tax_cents?: number
          tax_rate_bps?: number
          taxable_subtotal_cents?: number
          tenant_id: string
          terms?: string
          total_cents?: number
          updated_at?: string
          version_number: number
          version_status?: string
        }
        Update: {
          calculation_version?: number
          created_at?: string
          created_by?: string
          default_hours_per_day?: number | null
          discount_cents?: number
          discount_type?: string
          discount_value?: number
          estimated_duration_days?: number | null
          estimated_start_date?: string | null
          exclusions?: string
          id?: string
          labor_total_cents?: number
          line_items_subtotal_cents?: number
          locked_at?: string | null
          notes_for_client?: string
          pricing_city?: string | null
          pricing_state_code?: string | null
          pricing_zip_code?: string | null
          proposal_id?: string
          scope_intro?: string | null
          subtotal_cents?: number
          summary?: string | null
          tax_cents?: number
          tax_rate_bps?: number
          taxable_subtotal_cents?: number
          tenant_id?: string
          terms?: string
          total_cents?: number
          updated_at?: string
          version_number?: number
          version_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_versions_proposal_id_tenant_id_fkey"
            columns: ["proposal_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_view_events: {
        Row: {
          client_email: string
          id: string
          ip_hash: string | null
          portal_link_id: string
          proposal_id: string
          proposal_version_id: string
          tenant_id: string
          user_agent_hash: string | null
          viewed_at: string
        }
        Insert: {
          client_email: string
          id?: string
          ip_hash?: string | null
          portal_link_id: string
          proposal_id: string
          proposal_version_id: string
          tenant_id: string
          user_agent_hash?: string | null
          viewed_at?: string
        }
        Update: {
          client_email?: string
          id?: string
          ip_hash?: string | null
          portal_link_id?: string
          proposal_id?: string
          proposal_version_id?: string
          tenant_id?: string
          user_agent_hash?: string | null
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_view_events_portal_link_id_tenant_id_fkey"
            columns: ["portal_link_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_portal_links"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_view_events_proposal_id_tenant_id_fkey"
            columns: ["proposal_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_view_events_proposal_version_id_tenant_id_fkey"
            columns: ["proposal_version_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_versions"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposal_view_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      proposals: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          client_contact_id: string | null
          client_id: string
          created_at: string
          created_by: string
          current_version_id: string | null
          custom_service_name: string | null
          id: string
          opportunity_id: string | null
          pre_archive_status: string | null
          proposal_number: number
          service_type: string
          source: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          client_contact_id?: string | null
          client_id: string
          created_at?: string
          created_by: string
          current_version_id?: string | null
          custom_service_name?: string | null
          id?: string
          opportunity_id?: string | null
          pre_archive_status?: string | null
          proposal_number: number
          service_type: string
          source: string
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          client_contact_id?: string | null
          client_id?: string
          created_at?: string
          created_by?: string
          current_version_id?: string | null
          custom_service_name?: string | null
          id?: string
          opportunity_id?: string | null
          pre_archive_status?: string | null
          proposal_number?: number
          service_type?: string
          source?: string
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposals_client_contact_id_tenant_id_fkey"
            columns: ["client_contact_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "client_contacts"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposals_client_id_tenant_id_fkey"
            columns: ["client_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposals_current_version_id_fkey"
            columns: ["current_version_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "proposal_versions"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposals_opportunity_id_tenant_id_fkey"
            columns: ["opportunity_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "proposals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string
          permission_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          permission_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          key: string
          name: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key: string
          name: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key?: string
          name?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_memberships: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          joined_at: string | null
          role_id: string
          status: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string | null
          role_id: string
          status?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string | null
          role_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_proposal_settings: {
        Row: {
          created_at: string
          currency_code: string
          default_customer_hourly_rate_cents: number
          default_exclusions: string
          default_hours_per_day: number
          default_proposal_valid_days: number
          default_tax_rate_bps: number
          default_terms: string
          next_proposal_number: number
          proposal_number_prefix: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency_code?: string
          default_customer_hourly_rate_cents?: number
          default_exclusions?: string
          default_hours_per_day?: number
          default_proposal_valid_days?: number
          default_tax_rate_bps?: number
          default_terms?: string
          next_proposal_number?: number
          proposal_number_prefix?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency_code?: string
          default_customer_hourly_rate_cents?: number
          default_exclusions?: string
          default_hours_per_day?: number
          default_proposal_valid_days?: number
          default_tax_rate_bps?: number
          default_terms?: string
          next_proposal_number?: number
          proposal_number_prefix?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_proposal_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          logo_content_type: string | null
          logo_original_filename: string | null
          logo_size_bytes: number | null
          logo_storage_path: string | null
          logo_updated_at: string | null
          name: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          logo_content_type?: string | null
          logo_original_filename?: string | null
          logo_size_bytes?: number | null
          logo_storage_path?: string | null
          logo_updated_at?: string | null
          name: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          logo_content_type?: string | null
          logo_original_filename?: string | null
          logo_size_bytes?: number | null
          logo_storage_path?: string | null
          logo_updated_at?: string | null
          name?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: {
        Args: { p_membership_id: string }
        Returns: {
          created_at: string
          id: string
          invited_by: string | null
          joined_at: string | null
          role_id: string
          status: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tenant_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_measurement: {
        Args: {
          p_area?: number
          p_height?: number
          p_length?: number
          p_linear_length?: number
          p_measurement_group_id: string
          p_measurement_type: string
          p_name: string
          p_notes?: string
          p_proposal_version_id: string
          p_shape_type: string
          p_sort_order?: number
          p_unit: string
          p_waste_bps?: number
          p_width?: number
        }
        Returns: {
          archived_at: string | null
          area: number | null
          created_at: string
          height: number | null
          id: string
          length: number | null
          linear_length: number | null
          measurement_group_id: string
          measurement_type: string
          name: string
          notes: string | null
          perimeter: number | null
          proposal_version_id: string
          shape_type: string
          sort_order: number
          tenant_id: string
          unit: string
          updated_at: string
          volume: number | null
          waste_bps: number
          width: number | null
        }
        SetofOptions: {
          from: "*"
          to: "proposal_measurements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_portfolio_project_media: {
        Args: {
          p_caption?: string
          p_media_asset_id: string
          p_portfolio_project_id: string
          p_sort_order?: number
        }
        Returns: {
          caption: string
          created_at: string
          id: string
          media_asset_id: string
          portfolio_project_id: string
          sort_order: number
          tenant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "portfolio_project_media"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_proposal_labor_item: {
        Args: {
          p_estimated_days: number
          p_fixed_total_cents?: number
          p_hourly_rate_cents: number
          p_hours_per_day: number
          p_label: string
          p_pricing_method?: string
          p_proposal_version_id: string
          p_sort_order?: number
          p_worker_count: number
        }
        Returns: {
          archived_at: string | null
          created_at: string
          estimated_days: number | null
          fixed_total_cents: number | null
          hourly_rate_cents: number | null
          hours_per_day: number | null
          id: string
          label: string
          labor_rate_per_area_cents: number | null
          labor_rate_per_linear_cents: number | null
          measured_area: number | null
          measured_linear_length: number | null
          pricing_method: string
          proposal_measurement_id: string | null
          proposal_version_id: string
          sort_order: number
          tenant_id: string
          total_cents: number
          total_hours: number
          updated_at: string
          worker_count: number | null
        }
        SetofOptions: {
          from: "*"
          to: "proposal_labor_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_proposal_labor_item_from_measurement: {
        Args: {
          p_label: string
          p_pricing_method: string
          p_proposal_measurement_id: string
          p_proposal_version_id: string
          p_rate_cents: number
          p_sort_order?: number
        }
        Returns: {
          archived_at: string | null
          created_at: string
          estimated_days: number | null
          fixed_total_cents: number | null
          hourly_rate_cents: number | null
          hours_per_day: number | null
          id: string
          label: string
          labor_rate_per_area_cents: number | null
          labor_rate_per_linear_cents: number | null
          measured_area: number | null
          measured_linear_length: number | null
          pricing_method: string
          proposal_measurement_id: string | null
          proposal_version_id: string
          sort_order: number
          tenant_id: string
          total_cents: number
          total_hours: number
          updated_at: string
          worker_count: number | null
        }
        SetofOptions: {
          from: "*"
          to: "proposal_labor_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_proposal_line_item: {
        Args: {
          p_category: string
          p_description: string
          p_proposal_version_id: string
          p_quantity: number
          p_section_id?: string
          p_sort_order?: number
          p_taxable?: boolean
          p_unit: string
          p_unit_price_cents: number
        }
        Returns: {
          archived_at: string | null
          category: string
          created_at: string
          description: string
          id: string
          line_total_cents: number
          material_catalog_item_id: string | null
          material_zip_price_id: string | null
          proposal_version_id: string
          quantity: number
          section_id: string | null
          sort_order: number
          source_price_effective_date: string | null
          source_supplier_name: string | null
          source_type: string
          source_zip_code: string | null
          taxable: boolean
          tenant_id: string
          unit: string
          unit_price_cents: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "proposal_line_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_proposal_line_item_from_catalog: {
        Args: {
          p_material_catalog_item_id: string
          p_proposal_version_id: string
          p_quantity: number
          p_section_id?: string
          p_sort_order?: number
          p_taxable?: boolean
          p_unit_price_cents_override?: number
          p_zip_code?: string
        }
        Returns: {
          archived_at: string | null
          category: string
          created_at: string
          description: string
          id: string
          line_total_cents: number
          material_catalog_item_id: string | null
          material_zip_price_id: string | null
          proposal_version_id: string
          quantity: number
          section_id: string | null
          sort_order: number
          source_price_effective_date: string | null
          source_supplier_name: string | null
          source_type: string
          source_zip_code: string | null
          taxable: boolean
          tenant_id: string
          unit: string
          unit_price_cents: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "proposal_line_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_proposal_section: {
        Args: {
          p_description?: string
          p_proposal_version_id: string
          p_section_type?: string
          p_sort_order?: number
          p_title: string
        }
        Returns: {
          archived_at: string | null
          created_at: string
          description: string
          id: string
          proposal_version_id: string
          section_type: string
          sort_order: number
          tenant_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "proposal_sections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      allocate_next_proposal_number: {
        Args: { p_tenant_id: string }
        Returns: number
      }
      archive_client: {
        Args: { p_client_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          client_type: string
          created_at: string
          created_by: string
          display_name: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          legal_name: string | null
          phone: string | null
          preferred_contact_method: string | null
          secondary_phone: string | null
          source: string | null
          tax_exempt: boolean
          tenant_id: string
          updated_at: string
          website: string | null
        }
        SetofOptions: {
          from: "*"
          to: "clients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_client_contact: {
        Args: { p_contact_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          client_id: string
          created_at: string
          created_by: string
          email: string | null
          first_name: string
          id: string
          is_primary: boolean
          job_title: string | null
          last_name: string | null
          notes: string | null
          phone: string | null
          preferred_contact_method: string | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "client_contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_measurement: {
        Args: { p_measurement_id: string }
        Returns: {
          archived_at: string | null
          area: number | null
          created_at: string
          height: number | null
          id: string
          length: number | null
          linear_length: number | null
          measurement_group_id: string
          measurement_type: string
          name: string
          notes: string | null
          perimeter: number | null
          proposal_version_id: string
          shape_type: string
          sort_order: number
          tenant_id: string
          unit: string
          updated_at: string
          volume: number | null
          waste_bps: number
          width: number | null
        }
        SetofOptions: {
          from: "*"
          to: "proposal_measurements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_note: {
        Args: { p_note_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          body: string
          client_id: string | null
          created_at: string
          created_by: string
          id: string
          opportunity_id: string | null
          project_id: string | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "crm_notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_opportunity: {
        Args: { p_opportunity_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          assigned_to: string | null
          client_id: string
          created_at: string
          created_by: string
          estimated_value_cents: number | null
          expected_close_date: string | null
          id: string
          inspection_scheduled_at: string | null
          lost_reason: string | null
          pre_archive_status: string | null
          probability: number | null
          source: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "opportunities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_portfolio_project: {
        Args: { p_portfolio_project_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string
          id: string
          location_label: string
          service_type: string
          tenant_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "portfolio_projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_project: {
        Args: { p_project_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          assigned_to: string | null
          client_id: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          inspection_scheduled_at: string | null
          name: string
          opportunity_id: string | null
          pre_archive_status: string | null
          primary_contact_id: string | null
          service_type: string | null
          status: string
          tenant_id: string
          tentative_start_date: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_project_address: {
        Args: { p_address_id: string }
        Returns: {
          access_instructions: string | null
          address_line_1: string
          address_line_2: string | null
          archived_at: string | null
          archived_by: string | null
          city: string
          country_code: string
          created_at: string
          created_by: string
          id: string
          is_primary: boolean
          latitude: number | null
          longitude: number | null
          postal_code: string
          project_id: string
          state: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "project_addresses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_proposal: {
        Args: { p_proposal_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          client_contact_id: string | null
          client_id: string
          created_at: string
          created_by: string
          current_version_id: string | null
          id: string
          opportunity_id: string | null
          pre_archive_status: string | null
          proposal_number: number
          service_type: string
          source: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "proposals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_proposal_labor_item: {
        Args: { p_labor_item_id: string }
        Returns: {
          archived_at: string | null
          created_at: string
          estimated_days: number | null
          fixed_total_cents: number | null
          hourly_rate_cents: number | null
          hours_per_day: number | null
          id: string
          label: string
          labor_rate_per_area_cents: number | null
          labor_rate_per_linear_cents: number | null
          measured_area: number | null
          measured_linear_length: number | null
          pricing_method: string
          proposal_measurement_id: string | null
          proposal_version_id: string
          sort_order: number
          tenant_id: string
          total_cents: number
          total_hours: number
          updated_at: string
          worker_count: number | null
        }
        SetofOptions: {
          from: "*"
          to: "proposal_labor_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_proposal_line_item: {
        Args: { p_line_item_id: string }
        Returns: {
          archived_at: string | null
          category: string
          created_at: string
          description: string
          id: string
          line_total_cents: number
          material_catalog_item_id: string | null
          material_zip_price_id: string | null
          proposal_version_id: string
          quantity: number
          section_id: string | null
          sort_order: number
          source_price_effective_date: string | null
          source_supplier_name: string | null
          source_type: string
          source_zip_code: string | null
          taxable: boolean
          tenant_id: string
          unit: string
          unit_price_cents: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "proposal_line_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_proposal_section: {
        Args: { p_section_id: string }
        Returns: {
          archived_at: string | null
          created_at: string
          description: string
          id: string
          proposal_version_id: string
          section_type: string
          sort_order: number
          tenant_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "proposal_sections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_tenant_material: {
        Args: { p_material_id: string }
        Returns: {
          archived_at: string | null
          brand: string | null
          category: string
          created_at: string
          default_unit: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          scope: string
          service_type: string | null
          sku: string | null
          supplier_name: string | null
          tenant_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "material_catalog_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_tenant_material_price: {
        Args: { p_price_id: string }
        Returns: {
          archived_at: string | null
          city: string | null
          created_at: string
          currency_code: string
          effective_date: string
          expires_at: string | null
          id: string
          material_catalog_item_id: string
          price_source: string
          state_code: string | null
          supplier_name: string | null
          tenant_id: string | null
          unit_price_cents: number
          updated_at: string
          zip_code: string | null
        }
        SetofOptions: {
          from: "*"
          to: "material_zip_prices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attach_media_to_proposal: {
        Args: {
          p_caption?: string
          p_media_asset_id: string
          p_portfolio_project_id?: string
          p_proposal_version_id: string
          p_sort_order?: number
          p_usage_type: string
        }
        Returns: {
          archived_at: string | null
          caption: string
          created_at: string
          id: string
          media_asset_id: string
          portfolio_project_id: string | null
          proposal_version_id: string
          sort_order: number
          tenant_id: string
          usage_type: string
        }
        SetofOptions: {
          from: "*"
          to: "proposal_media"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      change_opportunity_status: {
        Args: {
          p_inspection_scheduled_at?: string
          p_lost_reason?: string
          p_new_status: string
          p_opportunity_id: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          assigned_to: string | null
          client_id: string
          created_at: string
          created_by: string
          estimated_value_cents: number | null
          expected_close_date: string | null
          id: string
          inspection_scheduled_at: string | null
          lost_reason: string | null
          pre_archive_status: string | null
          probability: number | null
          source: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "opportunities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      change_project_status: {
        Args: {
          p_inspection_scheduled_at?: string
          p_new_status: string
          p_project_id: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          assigned_to: string | null
          client_id: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          inspection_scheduled_at: string | null
          name: string
          opportunity_id: string | null
          pre_archive_status: string | null
          primary_contact_id: string | null
          service_type: string | null
          status: string
          tenant_id: string
          tentative_start_date: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      convert_opportunity_to_project: {
        Args: {
          p_description?: string
          p_opportunity_id: string
          p_project_name?: string
          p_service_type?: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          assigned_to: string | null
          client_id: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          inspection_scheduled_at: string | null
          name: string
          opportunity_id: string | null
          pre_archive_status: string | null
          primary_contact_id: string | null
          service_type: string | null
          status: string
          tenant_id: string
          tentative_start_date: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_client: {
        Args: {
          p_address_line1?: string
          p_address_line2?: string
          p_city?: string
          p_client_type: string
          p_country_code?: string
          p_display_name: string
          p_email?: string
          p_first_name?: string
          p_last_name?: string
          p_legal_name?: string
          p_phone?: string
          p_postal_code?: string
          p_preferred_contact_method?: string
          p_secondary_phone?: string
          p_source?: string
          p_state?: string
          p_tax_exempt?: boolean
          p_tenant_id: string
          p_website?: string
        }
        Returns: {
          address_line_1: string | null
          address_line_2: string | null
          archived_at: string | null
          archived_by: string | null
          city: string | null
          client_type: string
          country_code: string | null
          created_at: string
          created_by: string
          display_name: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          legal_name: string | null
          phone: string | null
          postal_code: string | null
          preferred_contact_method: string | null
          secondary_phone: string | null
          source: string | null
          state: string | null
          tax_exempt: boolean
          tenant_id: string
          updated_at: string
          website: string | null
        }
        SetofOptions: {
          from: "*"
          to: "clients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_client_contact: {
        Args: {
          p_client_id: string
          p_email?: string
          p_first_name: string
          p_is_primary?: boolean
          p_job_title?: string
          p_last_name?: string
          p_notes?: string
          p_phone?: string
          p_preferred_contact_method?: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          client_id: string
          created_at: string
          created_by: string
          email: string | null
          first_name: string
          id: string
          is_primary: boolean
          job_title: string | null
          last_name: string | null
          notes: string | null
          phone: string | null
          preferred_contact_method: string | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "client_contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_initial_proposal_version: {
        Args: { p_actor: string; p_pricing_zip_code?: string; p_proposal_id: string; p_tenant_id: string }
        Returns: {
          calculation_version: number
          created_at: string
          created_by: string
          default_hours_per_day: number | null
          discount_cents: number
          discount_type: string
          discount_value: number
          estimated_duration_days: number | null
          estimated_start_date: string | null
          exclusions: string
          id: string
          labor_total_cents: number
          line_items_subtotal_cents: number
          locked_at: string | null
          notes_for_client: string
          pricing_city: string | null
          pricing_state_code: string | null
          pricing_zip_code: string | null
          proposal_id: string
          scope_intro: string | null
          subtotal_cents: number
          summary: string | null
          tax_cents: number
          tax_rate_bps: number
          taxable_subtotal_cents: number
          tenant_id: string
          terms: string
          total_cents: number
          updated_at: string
          version_number: number
          version_status: string
        }
        SetofOptions: {
          from: "*"
          to: "proposal_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_measurement_group: {
        Args: {
          p_name: string
          p_proposal_version_id: string
          p_service_type?: string
          p_unit_system?: string
        }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          proposal_version_id: string
          service_type: string | null
          tenant_id: string
          unit_system: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "proposal_measurement_groups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_new_proposal_version: {
        Args: { p_proposal_id: string }
        Returns: {
          calculation_version: number
          created_at: string
          created_by: string
          default_hours_per_day: number | null
          discount_cents: number
          discount_type: string
          discount_value: number
          estimated_duration_days: number | null
          estimated_start_date: string | null
          exclusions: string
          id: string
          labor_total_cents: number
          line_items_subtotal_cents: number
          locked_at: string | null
          notes_for_client: string
          pricing_city: string | null
          pricing_state_code: string | null
          pricing_zip_code: string | null
          proposal_id: string
          scope_intro: string | null
          subtotal_cents: number
          summary: string | null
          tax_cents: number
          tax_rate_bps: number
          taxable_subtotal_cents: number
          tenant_id: string
          terms: string
          total_cents: number
          updated_at: string
          version_number: number
          version_status: string
        }
        SetofOptions: {
          from: "*"
          to: "proposal_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_note: {
        Args: {
          p_body: string
          p_client_id?: string
          p_opportunity_id?: string
          p_project_id?: string
          p_tenant_id: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          body: string
          client_id: string | null
          created_at: string
          created_by: string
          id: string
          opportunity_id: string | null
          project_id: string | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "crm_notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_opportunity: {
        Args: {
          p_assigned_to?: string
          p_client_id: string
          p_estimated_value_cents?: number
          p_expected_close_date?: string
          p_probability?: number
          p_source?: string
          p_tenant_id: string
          p_title: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          assigned_to: string | null
          client_id: string
          created_at: string
          created_by: string
          estimated_value_cents: number | null
          expected_close_date: string | null
          id: string
          inspection_scheduled_at: string | null
          lost_reason: string | null
          pre_archive_status: string | null
          probability: number | null
          source: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "opportunities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_portfolio_project: {
        Args: {
          p_completed_at?: string
          p_description?: string
          p_location_label?: string
          p_service_type: string
          p_tenant_id: string
          p_title: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string
          id: string
          location_label: string
          service_type: string
          tenant_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "portfolio_projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_project: {
        Args: {
          p_assigned_to?: string
          p_client_id: string
          p_description?: string
          p_name: string
          p_service_type?: string
          p_tenant_id: string
          p_tentative_start_date?: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          assigned_to: string | null
          client_id: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          inspection_scheduled_at: string | null
          name: string
          opportunity_id: string | null
          pre_archive_status: string | null
          primary_contact_id: string | null
          service_type: string | null
          status: string
          tenant_id: string
          tentative_start_date: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_project_address: {
        Args: {
          p_access_instructions?: string
          p_address_line_1: string
          p_address_line_2?: string
          p_city: string
          p_country_code?: string
          p_is_primary?: boolean
          p_postal_code: string
          p_project_id: string
          p_state: string
        }
        Returns: {
          access_instructions: string | null
          address_line_1: string
          address_line_2: string | null
          archived_at: string | null
          archived_by: string | null
          city: string
          country_code: string
          created_at: string
          created_by: string
          id: string
          is_primary: boolean
          latitude: number | null
          longitude: number | null
          postal_code: string
          project_id: string
          state: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "project_addresses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_project_from_accepted_proposal: {
        Args: { p_proposal_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          assigned_to: string | null
          client_id: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          inspection_scheduled_at: string | null
          name: string
          opportunity_id: string | null
          pre_archive_status: string | null
          primary_contact_id: string | null
          service_type: string | null
          status: string
          tenant_id: string
          tentative_start_date: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_proposal_direct: {
        Args: {
          p_client_contact_id?: string
          p_client_id: string
          p_custom_service_name?: string
          p_idempotency_key?: string
          p_opportunity_id?: string
          p_service_type: string
          p_tenant_id: string
          p_title: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          client_contact_id: string | null
          client_id: string
          created_at: string
          created_by: string
          current_version_id: string | null
          custom_service_name: string | null
          id: string
          opportunity_id: string | null
          pre_archive_status: string | null
          proposal_number: number
          service_type: string
          source: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "proposals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_proposal_from_opportunity: {
        Args: {
          p_client_contact_id?: string
          p_custom_service_name?: string
          p_idempotency_key?: string
          p_opportunity_id: string
          p_service_type: string
          p_tenant_id: string
          p_title: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          client_contact_id: string | null
          client_id: string
          created_at: string
          created_by: string
          current_version_id: string | null
          custom_service_name: string | null
          id: string
          opportunity_id: string | null
          pre_archive_status: string | null
          proposal_number: number
          service_type: string
          source: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "proposals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_proposal_portal_link: {
        Args: {
          p_expires_at: string
          p_proposal_id: string
          p_tenant_id: string
          p_token_hash: string
        }
        Returns: {
          created_at: string
          created_by: string
          expires_at: string
          id: string
          last_viewed_at: string | null
          proposal_id: string
          proposal_version_id: string
          revoked_at: string | null
          revoked_by: string | null
          status: string
          tenant_id: string
          token_hash: string
        }
        SetofOptions: {
          from: "*"
          to: "proposal_portal_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_proposal_revision: {
        Args: { p_proposal_id: string }
        Returns: {
          calculation_version: number
          created_at: string
          created_by: string
          default_hours_per_day: number | null
          discount_cents: number
          discount_type: string
          discount_value: number
          estimated_duration_days: number | null
          estimated_start_date: string | null
          exclusions: string
          id: string
          labor_total_cents: number
          line_items_subtotal_cents: number
          locked_at: string | null
          notes_for_client: string
          pricing_city: string | null
          pricing_state_code: string | null
          pricing_zip_code: string | null
          proposal_id: string
          scope_intro: string | null
          subtotal_cents: number
          summary: string | null
          tax_cents: number
          tax_rate_bps: number
          taxable_subtotal_cents: number
          tenant_id: string
          terms: string
          total_cents: number
          updated_at: string
          version_number: number
          version_status: string
        }
        SetofOptions: {
          from: "*"
          to: "proposal_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_tenant_material: {
        Args: {
          p_brand?: string
          p_category: string
          p_default_unit: string
          p_description?: string
          p_name: string
          p_service_type?: string
          p_sku?: string
          p_supplier_name?: string
          p_tenant_id: string
        }
        Returns: {
          archived_at: string | null
          brand: string | null
          category: string
          created_at: string
          default_unit: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          scope: string
          service_type: string | null
          sku: string | null
          supplier_name: string | null
          tenant_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "material_catalog_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_tenant_material_price: {
        Args: {
          p_city?: string
          p_effective_date?: string
          p_expires_at?: string
          p_material_catalog_item_id: string
          p_state_code?: string
          p_supplier_name?: string
          p_tenant_id: string
          p_unit_price_cents: number
          p_zip_code?: string
        }
        Returns: {
          archived_at: string | null
          city: string | null
          created_at: string
          currency_code: string
          effective_date: string
          expires_at: string | null
          id: string
          material_catalog_item_id: string
          price_source: string
          state_code: string | null
          supplier_name: string | null
          tenant_id: string | null
          unit_price_cents: number
          updated_at: string
          zip_code: string | null
        }
        SetofOptions: {
          from: "*"
          to: "material_zip_prices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_tenant_with_owner: {
        Args: { p_name: string; p_slug: string }
        Returns: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          name: string
          slug: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      detach_media_from_proposal: {
        Args: { p_proposal_media_id: string }
        Returns: undefined
      }
      ensure_tenant_proposal_settings: {
        Args: { p_tenant_id: string }
        Returns: {
          created_at: string
          currency_code: string
          default_customer_hourly_rate_cents: number
          default_exclusions: string
          default_hours_per_day: number
          default_proposal_valid_days: number
          default_tax_rate_bps: number
          default_terms: string
          next_proposal_number: number
          proposal_number_prefix: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenant_proposal_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      find_material_zip_price: {
        Args: {
          p_material_catalog_item_id: string
          p_tenant_id: string
          p_zip_code: string
        }
        Returns: {
          archived_at: string | null
          city: string | null
          created_at: string
          currency_code: string
          effective_date: string
          expires_at: string | null
          id: string
          material_catalog_item_id: string
          price_source: string
          state_code: string | null
          supplier_name: string | null
          tenant_id: string | null
          unit_price_cents: number
          updated_at: string
          zip_code: string | null
        }
        SetofOptions: {
          from: "*"
          to: "material_zip_prices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      generate_material_from_measurement: {
        Args: {
          p_coats?: number
          p_coverage_rate: number
          p_coverage_unit?: string
          p_material_catalog_item_id: string
          p_measurement_value_field: string
          p_proposal_measurement_id: string
          p_proposal_version_id: string
          p_section_id?: string
          p_sort_order?: number
          p_taxable?: boolean
          p_unit_price_cents_override?: number
          p_waste_bps?: number
          p_zip_code?: string
        }
        Returns: {
          archived_at: string | null
          category: string
          created_at: string
          description: string
          id: string
          line_total_cents: number
          material_catalog_item_id: string | null
          material_zip_price_id: string | null
          proposal_version_id: string
          quantity: number
          section_id: string | null
          sort_order: number
          source_price_effective_date: string | null
          source_supplier_name: string | null
          source_type: string
          source_zip_code: string | null
          taxable: boolean
          tenant_id: string
          unit: string
          unit_price_cents: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "proposal_line_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_pending_invitations: {
        Args: never
        Returns: {
          invited_at: string
          membership_id: string
          role_name: string
          tenant_id: string
          tenant_name: string
        }[]
      }
      get_proposal_notification_recipients: {
        Args: { p_tenant_id: string }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      get_tenant_branding: {
        Args: { p_tenant_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          logo_content_type: string | null
          logo_original_filename: string | null
          logo_size_bytes: number | null
          logo_storage_path: string | null
          logo_updated_at: string | null
          name: string
          slug: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_tenant_proposal_settings: {
        Args: { p_tenant_id: string }
        Returns: {
          created_at: string
          currency_code: string
          default_customer_hourly_rate_cents: number
          default_exclusions: string
          default_hours_per_day: number
          default_proposal_valid_days: number
          default_tax_rate_bps: number
          default_terms: string
          next_proposal_number: number
          proposal_number_prefix: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenant_proposal_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_user_tenants: {
        Args: never
        Returns: {
          membership_status: string
          role_key: string
          role_name: string
          tenant_id: string
          tenant_name: string
          tenant_slug: string
          tenant_status: string
        }[]
      }
      invite_member_by_email: {
        Args: { p_email: string; p_role_key: string; p_tenant_id: string }
        Returns: {
          created_at: string
          id: string
          invited_by: string | null
          joined_at: string | null
          role_id: string
          status: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tenant_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_active_member_of_tenant: {
        Args: { p_membership_id: string; p_tenant_id: string }
        Returns: boolean
      }
      log_audit_event: {
        Args: {
          p_action: string
          p_actor_user_id: string
          p_entity_id: string
          p_entity_type: string
          p_ip_address?: string
          p_metadata?: Json
          p_tenant_id: string
          p_user_agent?: string
        }
        Returns: string
      }
      log_crm_activity: {
        Args: {
          p_activity_type: string
          p_actor_user_id: string
          p_client_id: string
          p_metadata?: Json
          p_opportunity_id: string
          p_project_id: string
          p_tenant_id: string
        }
        Returns: string
      }
      mark_proposal_ready: {
        Args: { p_proposal_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          client_contact_id: string | null
          client_id: string
          created_at: string
          created_by: string
          current_version_id: string | null
          id: string
          opportunity_id: string | null
          pre_archive_status: string | null
          proposal_number: number
          service_type: string
          source: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "proposals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      portal_get_link_info: {
        Args: { p_token_hash: string }
        Returns: {
          business_name: string
          is_valid: boolean
          link_id: string
          proposal_id: string
          proposal_title: string
          status_reason: string
          tenant_id: string
        }[]
      }
      portal_get_session_context: {
        Args: {
          p_ip_hash: string
          p_session_token_hash: string
          p_user_agent_hash: string
        }
        Returns: {
          client_email: string
          is_first_view: boolean
          outcome: string
          proposal_id: string
          proposal_version_id: string
          tenant_id: string
        }[]
      }
      portal_request_otp: {
        Args: {
          p_code_hash: string
          p_email: string
          p_expires_at: string
          p_ip_hash: string
          p_token_hash: string
          p_user_agent_hash: string
        }
        Returns: {
          email_matched: boolean
          outcome: string
        }[]
      }
      portal_verify_otp: {
        Args: {
          p_code_hash: string
          p_email: string
          p_session_expires_at: string
          p_session_token_hash: string
          p_token_hash: string
        }
        Returns: {
          outcome: string
          proposal_id: string
          tenant_id: string
        }[]
      }
      recalculate_proposal_version: {
        Args: { p_proposal_version_id: string }
        Returns: {
          calculation_version: number
          created_at: string
          created_by: string
          default_hours_per_day: number | null
          discount_cents: number
          discount_type: string
          discount_value: number
          estimated_duration_days: number | null
          estimated_start_date: string | null
          exclusions: string
          id: string
          labor_total_cents: number
          line_items_subtotal_cents: number
          locked_at: string | null
          notes_for_client: string
          pricing_city: string | null
          pricing_state_code: string | null
          pricing_zip_code: string | null
          proposal_id: string
          scope_intro: string | null
          subtotal_cents: number
          summary: string | null
          tax_cents: number
          tax_rate_bps: number
          taxable_subtotal_cents: number
          tenant_id: string
          terms: string
          total_cents: number
          updated_at: string
          version_number: number
          version_status: string
        }
        SetofOptions: {
          from: "*"
          to: "proposal_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      register_media_asset: {
        Args: {
          p_caption?: string
          p_height?: number
          p_media_type: string
          p_mime_type: string
          p_original_filename: string
          p_size_bytes: number
          p_storage_path: string
          p_tenant_id: string
          p_width?: number
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          caption: string
          created_at: string
          height: number | null
          id: string
          media_type: string
          mime_type: string
          original_filename: string
          size_bytes: number
          storage_bucket: string
          storage_path: string
          tenant_id: string
          updated_at: string
          uploaded_by: string
          width: number | null
        }
        SetofOptions: {
          from: "*"
          to: "media_assets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_tenant_branding: {
        Args: { p_tenant_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          logo_content_type: string | null
          logo_original_filename: string | null
          logo_size_bytes: number | null
          logo_storage_path: string | null
          logo_updated_at: string | null
          name: string
          slug: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reorder_proposal_sections: {
        Args: { p_proposal_version_id: string; p_section_ids: string[] }
        Returns: undefined
      }
      restore_client: {
        Args: { p_client_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          client_type: string
          created_at: string
          created_by: string
          display_name: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          legal_name: string | null
          phone: string | null
          preferred_contact_method: string | null
          secondary_phone: string | null
          source: string | null
          tax_exempt: boolean
          tenant_id: string
          updated_at: string
          website: string | null
        }
        SetofOptions: {
          from: "*"
          to: "clients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_client_contact: {
        Args: { p_contact_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          client_id: string
          created_at: string
          created_by: string
          email: string | null
          first_name: string
          id: string
          is_primary: boolean
          job_title: string | null
          last_name: string | null
          notes: string | null
          phone: string | null
          preferred_contact_method: string | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "client_contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_opportunity: {
        Args: { p_opportunity_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          assigned_to: string | null
          client_id: string
          created_at: string
          created_by: string
          estimated_value_cents: number | null
          expected_close_date: string | null
          id: string
          inspection_scheduled_at: string | null
          lost_reason: string | null
          pre_archive_status: string | null
          probability: number | null
          source: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "opportunities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_portfolio_project: {
        Args: { p_portfolio_project_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string
          id: string
          location_label: string
          service_type: string
          tenant_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "portfolio_projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_project: {
        Args: { p_project_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          assigned_to: string | null
          client_id: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          inspection_scheduled_at: string | null
          name: string
          opportunity_id: string | null
          pre_archive_status: string | null
          primary_contact_id: string | null
          service_type: string | null
          status: string
          tenant_id: string
          tentative_start_date: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_project_address: {
        Args: { p_address_id: string }
        Returns: {
          access_instructions: string | null
          address_line_1: string
          address_line_2: string | null
          archived_at: string | null
          archived_by: string | null
          city: string
          country_code: string
          created_at: string
          created_by: string
          id: string
          is_primary: boolean
          latitude: number | null
          longitude: number | null
          postal_code: string
          project_id: string
          state: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "project_addresses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_proposal: {
        Args: { p_proposal_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          client_contact_id: string | null
          client_id: string
          created_at: string
          created_by: string
          current_version_id: string | null
          id: string
          opportunity_id: string | null
          pre_archive_status: string | null
          proposal_number: number
          service_type: string
          source: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "proposals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      return_proposal_to_draft: {
        Args: { p_proposal_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          client_contact_id: string | null
          client_id: string
          created_at: string
          created_by: string
          current_version_id: string | null
          id: string
          opportunity_id: string | null
          pre_archive_status: string | null
          proposal_number: number
          service_type: string
          source: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "proposals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_proposal_portal_link: {
        Args: { p_portal_link_id: string }
        Returns: {
          created_at: string
          created_by: string
          expires_at: string
          id: string
          last_viewed_at: string | null
          proposal_id: string
          proposal_version_id: string
          revoked_at: string | null
          revoked_by: string | null
          status: string
          tenant_id: string
          token_hash: string
        }
        SetofOptions: {
          from: "*"
          to: "proposal_portal_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_measurement_polygon_shape: {
        Args: {
          p_closed: boolean
          p_measurement_group_id: string
          p_measurement_type: string
          p_name: string
          p_notes?: string
          p_proposal_version_id: string
          p_scale_reference_length: number
          p_scale_unit: string
          p_shape_data: Json
          p_sort_order?: number
          p_strokes: Json
          p_unit: string
          p_waste_bps?: number
        }
        Returns: {
          archived_at: string | null
          area: number | null
          created_at: string
          height: number | null
          id: string
          length: number | null
          linear_length: number | null
          measurement_group_id: string
          measurement_type: string
          name: string
          notes: string | null
          perimeter: number | null
          proposal_version_id: string
          shape_type: string
          sort_order: number
          tenant_id: string
          unit: string
          updated_at: string
          volume: number | null
          waste_bps: number
          width: number | null
        }
        SetofOptions: {
          from: "*"
          to: "proposal_measurements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_measurement_shape: {
        Args: {
          p_length: number
          p_measurement_group_id: string
          p_measurement_type: string
          p_name: string
          p_notes?: string
          p_proposal_version_id: string
          p_scale_reference_length: number
          p_scale_unit: string
          p_shape_data: Json
          p_sort_order?: number
          p_unit: string
          p_waste_bps?: number
          p_width: number
        }
        Returns: {
          archived_at: string | null
          area: number | null
          created_at: string
          height: number | null
          id: string
          length: number | null
          linear_length: number | null
          measurement_group_id: string
          measurement_type: string
          name: string
          notes: string | null
          perimeter: number | null
          proposal_version_id: string
          shape_type: string
          sort_order: number
          tenant_id: string
          unit: string
          updated_at: string
          volume: number | null
          waste_bps: number
          width: number | null
        }
        SetofOptions: {
          from: "*"
          to: "proposal_measurements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      search_material_catalog: {
        Args: {
          p_category?: string
          p_limit?: number
          p_offset?: number
          p_search_text?: string
          p_service_type?: string
          p_tenant_id: string
          p_zip_code?: string
        }
        Returns: {
          brand: string
          category: string
          default_unit: string
          description: string
          id: string
          name: string
          price_effective_date: string
          price_id: string
          price_state_code: string
          price_supplier_name: string
          price_zip_code: string
          scope: string
          service_type: string
          sku: string
          supplier_name: string
          tenant_id: string
          total_count: number
          unit_price_cents: number
        }[]
      }
      set_primary_contact: {
        Args: { p_contact_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          client_id: string
          created_at: string
          created_by: string
          email: string | null
          first_name: string
          id: string
          is_primary: boolean
          job_title: string | null
          last_name: string | null
          notes: string | null
          phone: string | null
          preferred_contact_method: string | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "client_contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_primary_project_address: {
        Args: { p_address_id: string }
        Returns: {
          access_instructions: string | null
          address_line_1: string
          address_line_2: string | null
          archived_at: string | null
          archived_by: string | null
          city: string
          country_code: string
          created_at: string
          created_by: string
          id: string
          is_primary: boolean
          latitude: number | null
          longitude: number | null
          postal_code: string
          project_id: string
          state: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "project_addresses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_proposal_client_response: {
        Args: {
          p_accepted_terms: boolean
          p_client_name: string
          p_decline_reason: string
          p_ip_hash: string
          p_response_type: string
          p_session_token_hash: string
          p_user_agent_hash: string
        }
        Returns: {
          client_email: string
          outcome: string
          proposal_id: string
          proposal_version_id: string
          responded_at: string
          response_type: string
          tenant_id: string
        }[]
      }
      sync_opportunity_to_proposal_in_progress: {
        Args: { p_opportunity_id: string; p_tenant_id: string }
        Returns: undefined
      }
      try_parse_uuid: { Args: { p_text: string }; Returns: string }
      update_client: {
        Args: {
          p_address_line1?: string
          p_address_line2?: string
          p_city?: string
          p_client_id: string
          p_client_type: string
          p_country_code?: string
          p_display_name: string
          p_email?: string
          p_first_name?: string
          p_last_name?: string
          p_legal_name?: string
          p_phone?: string
          p_postal_code?: string
          p_preferred_contact_method?: string
          p_secondary_phone?: string
          p_source?: string
          p_state?: string
          p_tax_exempt?: boolean
          p_website?: string
        }
        Returns: {
          address_line_1: string | null
          address_line_2: string | null
          archived_at: string | null
          archived_by: string | null
          city: string | null
          client_type: string
          country_code: string | null
          created_at: string
          created_by: string
          display_name: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          legal_name: string | null
          phone: string | null
          postal_code: string | null
          preferred_contact_method: string | null
          secondary_phone: string | null
          source: string | null
          state: string | null
          tax_exempt: boolean
          tenant_id: string
          updated_at: string
          website: string | null
        }
        SetofOptions: {
          from: "*"
          to: "clients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_client_contact: {
        Args: {
          p_contact_id: string
          p_email?: string
          p_first_name: string
          p_job_title?: string
          p_last_name?: string
          p_notes?: string
          p_phone?: string
          p_preferred_contact_method?: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          client_id: string
          created_at: string
          created_by: string
          email: string | null
          first_name: string
          id: string
          is_primary: boolean
          job_title: string | null
          last_name: string | null
          notes: string | null
          phone: string | null
          preferred_contact_method: string | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "client_contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_measurement: {
        Args: {
          p_area?: number
          p_height?: number
          p_length?: number
          p_linear_length?: number
          p_measurement_id: string
          p_measurement_type: string
          p_name: string
          p_notes?: string
          p_waste_bps?: number
          p_width?: number
        }
        Returns: {
          archived_at: string | null
          area: number | null
          created_at: string
          height: number | null
          id: string
          length: number | null
          linear_length: number | null
          measurement_group_id: string
          measurement_type: string
          name: string
          notes: string | null
          perimeter: number | null
          proposal_version_id: string
          shape_type: string
          sort_order: number
          tenant_id: string
          unit: string
          updated_at: string
          volume: number | null
          waste_bps: number
          width: number | null
        }
        SetofOptions: {
          from: "*"
          to: "proposal_measurements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_membership: {
        Args: {
          p_membership_id: string
          p_new_role_key?: string
          p_new_status?: string
        }
        Returns: {
          created_at: string
          id: string
          invited_by: string | null
          joined_at: string | null
          role_id: string
          status: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tenant_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_note: {
        Args: { p_body: string; p_note_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          body: string
          client_id: string | null
          created_at: string
          created_by: string
          id: string
          opportunity_id: string | null
          project_id: string | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "crm_notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_opportunity: {
        Args: {
          p_assigned_to?: string
          p_estimated_value_cents?: number
          p_expected_close_date?: string
          p_opportunity_id: string
          p_probability?: number
          p_source?: string
          p_title: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          assigned_to: string | null
          client_id: string
          created_at: string
          created_by: string
          estimated_value_cents: number | null
          expected_close_date: string | null
          id: string
          inspection_scheduled_at: string | null
          lost_reason: string | null
          pre_archive_status: string | null
          probability: number | null
          source: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "opportunities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_portfolio_project: {
        Args: {
          p_completed_at: string
          p_description: string
          p_location_label: string
          p_portfolio_project_id: string
          p_service_type: string
          p_title: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string
          id: string
          location_label: string
          service_type: string
          tenant_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "portfolio_projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_project: {
        Args: {
          p_assigned_to?: string
          p_description?: string
          p_name: string
          p_primary_contact_id?: string
          p_project_id: string
          p_service_type?: string
          p_tentative_start_date?: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          assigned_to: string | null
          client_id: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          inspection_scheduled_at: string | null
          name: string
          opportunity_id: string | null
          pre_archive_status: string | null
          primary_contact_id: string | null
          service_type: string | null
          status: string
          tenant_id: string
          tentative_start_date: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_project_address: {
        Args: {
          p_access_instructions?: string
          p_address_id: string
          p_address_line_1: string
          p_address_line_2?: string
          p_city: string
          p_country_code?: string
          p_postal_code: string
          p_state: string
        }
        Returns: {
          access_instructions: string | null
          address_line_1: string
          address_line_2: string | null
          archived_at: string | null
          archived_by: string | null
          city: string
          country_code: string
          created_at: string
          created_by: string
          id: string
          is_primary: boolean
          latitude: number | null
          longitude: number | null
          postal_code: string
          project_id: string
          state: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "project_addresses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_proposal_labor_item: {
        Args: {
          p_estimated_days: number
          p_fixed_total_cents?: number
          p_hourly_rate_cents: number
          p_hours_per_day: number
          p_label: string
          p_labor_item_id: string
          p_pricing_method?: string
          p_worker_count: number
        }
        Returns: {
          archived_at: string | null
          created_at: string
          estimated_days: number | null
          fixed_total_cents: number | null
          hourly_rate_cents: number | null
          hours_per_day: number | null
          id: string
          label: string
          labor_rate_per_area_cents: number | null
          labor_rate_per_linear_cents: number | null
          measured_area: number | null
          measured_linear_length: number | null
          pricing_method: string
          proposal_measurement_id: string | null
          proposal_version_id: string
          sort_order: number
          tenant_id: string
          total_cents: number
          total_hours: number
          updated_at: string
          worker_count: number | null
        }
        SetofOptions: {
          from: "*"
          to: "proposal_labor_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_proposal_line_item: {
        Args: {
          p_category: string
          p_description: string
          p_line_item_id: string
          p_quantity: number
          p_taxable: boolean
          p_unit: string
          p_unit_price_cents: number
        }
        Returns: {
          archived_at: string | null
          category: string
          created_at: string
          description: string
          id: string
          line_total_cents: number
          material_catalog_item_id: string | null
          material_zip_price_id: string | null
          proposal_version_id: string
          quantity: number
          section_id: string | null
          sort_order: number
          source_price_effective_date: string | null
          source_supplier_name: string | null
          source_type: string
          source_zip_code: string | null
          taxable: boolean
          tenant_id: string
          unit: string
          unit_price_cents: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "proposal_line_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_proposal_pricing: {
        Args: {
          p_discount_type: string
          p_discount_value: number
          p_exclusions: string
          p_notes_for_client: string
          p_proposal_version_id: string
          p_tax_rate_bps: number
          p_terms: string
        }
        Returns: {
          calculation_version: number
          created_at: string
          created_by: string
          default_hours_per_day: number | null
          discount_cents: number
          discount_type: string
          discount_value: number
          estimated_duration_days: number | null
          estimated_start_date: string | null
          exclusions: string
          id: string
          labor_total_cents: number
          line_items_subtotal_cents: number
          locked_at: string | null
          notes_for_client: string
          pricing_city: string | null
          pricing_state_code: string | null
          pricing_zip_code: string | null
          proposal_id: string
          scope_intro: string | null
          subtotal_cents: number
          summary: string | null
          tax_cents: number
          tax_rate_bps: number
          taxable_subtotal_cents: number
          tenant_id: string
          terms: string
          total_cents: number
          updated_at: string
          version_number: number
          version_status: string
        }
        SetofOptions: {
          from: "*"
          to: "proposal_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_proposal_pricing_zip: {
        Args: {
          p_city?: string
          p_proposal_version_id: string
          p_state_code?: string
          p_zip_code: string
        }
        Returns: {
          calculation_version: number
          created_at: string
          created_by: string
          default_hours_per_day: number | null
          discount_cents: number
          discount_type: string
          discount_value: number
          estimated_duration_days: number | null
          estimated_start_date: string | null
          exclusions: string
          id: string
          labor_total_cents: number
          line_items_subtotal_cents: number
          locked_at: string | null
          notes_for_client: string
          pricing_city: string | null
          pricing_state_code: string | null
          pricing_zip_code: string | null
          proposal_id: string
          scope_intro: string | null
          subtotal_cents: number
          summary: string | null
          tax_cents: number
          tax_rate_bps: number
          taxable_subtotal_cents: number
          tenant_id: string
          terms: string
          total_cents: number
          updated_at: string
          version_number: number
          version_status: string
        }
        SetofOptions: {
          from: "*"
          to: "proposal_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_proposal_scope: {
        Args: {
          p_estimated_duration_days?: number
          p_estimated_start_date?: string
          p_proposal_version_id: string
          p_scope_intro?: string
          p_summary?: string
        }
        Returns: {
          calculation_version: number
          created_at: string
          created_by: string
          default_hours_per_day: number | null
          discount_cents: number
          discount_type: string
          discount_value: number
          estimated_duration_days: number | null
          estimated_start_date: string | null
          exclusions: string
          id: string
          labor_total_cents: number
          line_items_subtotal_cents: number
          locked_at: string | null
          notes_for_client: string
          pricing_city: string | null
          pricing_state_code: string | null
          pricing_zip_code: string | null
          proposal_id: string
          scope_intro: string | null
          subtotal_cents: number
          summary: string | null
          tax_cents: number
          tax_rate_bps: number
          taxable_subtotal_cents: number
          tenant_id: string
          terms: string
          total_cents: number
          updated_at: string
          version_number: number
          version_status: string
        }
        SetofOptions: {
          from: "*"
          to: "proposal_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_proposal_section: {
        Args: {
          p_description: string
          p_section_id: string
          p_section_type: string
          p_title: string
        }
        Returns: {
          archived_at: string | null
          created_at: string
          description: string
          id: string
          proposal_version_id: string
          section_type: string
          sort_order: number
          tenant_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "proposal_sections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_tenant_branding: {
        Args: {
          p_logo_content_type: string
          p_logo_original_filename: string
          p_logo_size_bytes: number
          p_logo_storage_path: string
          p_tenant_id: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          logo_content_type: string | null
          logo_original_filename: string | null
          logo_size_bytes: number | null
          logo_storage_path: string | null
          logo_updated_at: string | null
          name: string
          slug: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_tenant_material: {
        Args: {
          p_brand: string
          p_category: string
          p_default_unit: string
          p_description: string
          p_material_id: string
          p_name: string
          p_service_type: string
          p_sku: string
          p_supplier_name: string
        }
        Returns: {
          archived_at: string | null
          brand: string | null
          category: string
          created_at: string
          default_unit: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          scope: string
          service_type: string | null
          sku: string | null
          supplier_name: string | null
          tenant_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "material_catalog_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_tenant_material_price: {
        Args: {
          p_city: string
          p_effective_date: string
          p_expires_at: string
          p_price_id: string
          p_state_code: string
          p_supplier_name: string
          p_unit_price_cents: number
          p_zip_code: string
        }
        Returns: {
          archived_at: string | null
          city: string | null
          created_at: string
          currency_code: string
          effective_date: string
          expires_at: string | null
          id: string
          material_catalog_item_id: string
          price_source: string
          state_code: string | null
          supplier_name: string | null
          tenant_id: string | null
          unit_price_cents: number
          updated_at: string
          zip_code: string | null
        }
        SetofOptions: {
          from: "*"
          to: "material_zip_prices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_tenant_proposal_settings: {
        Args: {
          p_default_customer_hourly_rate_cents: number
          p_default_exclusions: string
          p_default_hours_per_day: number
          p_default_proposal_valid_days: number
          p_default_tax_rate_bps: number
          p_default_terms: string
          p_proposal_number_prefix: string
          p_tenant_id: string
        }
        Returns: {
          created_at: string
          currency_code: string
          default_customer_hourly_rate_cents: number
          default_exclusions: string
          default_hours_per_day: number
          default_proposal_valid_days: number
          default_tax_rate_bps: number
          default_terms: string
          next_proposal_number: number
          proposal_number_prefix: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenant_proposal_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      user_has_permission: {
        Args: { p_permission_key: string; p_tenant_id: string }
        Returns: boolean
      }
      user_is_active_tenant_member: {
        Args: { p_tenant_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
