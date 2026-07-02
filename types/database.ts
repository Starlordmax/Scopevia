/**
 * Hand-written types for the Phase 0 schema.
 *
 * This is a minimal stand-in for the real generated types. Once a Supabase
 * project exists (local or hosted), replace this file's contents with the
 * output of:
 *
 *   npm run db:types
 *
 * which runs `supabase gen types typescript --local`. Keep the exported
 * type names (`Database`, `Tables`, `Enums`) stable so the rest of the
 * codebase does not need to change when you do.
 */

export type RoleKey = "owner" | "admin" | "estimator" | "sales" | "field_worker" | "viewer";
export type MembershipStatus = "invited" | "active" | "suspended" | "removed";
export type TenantStatus = "active" | "suspended" | "archived";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          locale: string;
          timezone: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & { id: string };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          status: TenantStatus;
          created_by: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: never; // created only via create_tenant_with_owner()
        Update: Partial<Pick<Database["public"]["Tables"]["tenants"]["Row"], "name" | "status">>;
        Relationships: [];
      };
      tenant_memberships: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          role_id: string;
          status: MembershipStatus;
          invited_by: string | null;
          joined_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never; // created only via create_tenant_with_owner() / invite_member_by_email()
        Update: never; // mutated only via update_membership()
        Relationships: [];
      };
      roles: {
        Row: {
          id: string;
          key: string;
          name: string;
          description: string | null;
          is_system: boolean;
          tenant_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      permissions: {
        Row: {
          id: string;
          key: string;
          name: string;
          description: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      role_permissions: {
        Row: {
          role_id: string;
          permission_id: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          tenant_id: string | null;
          actor_user_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          metadata: Record<string, unknown>;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: never; // written only via log_audit_event()
        Update: never; // append-only
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_user_tenants: {
        Args: Record<string, never>;
        Returns: {
          tenant_id: string;
          tenant_name: string;
          tenant_slug: string;
          tenant_status: TenantStatus;
          role_key: RoleKey;
          role_name: string;
          membership_status: MembershipStatus;
        }[];
      };
      user_has_permission: {
        Args: { p_tenant_id: string; p_permission_key: string };
        Returns: boolean;
      };
      user_is_active_tenant_member: {
        Args: { p_tenant_id: string };
        Returns: boolean;
      };
      create_tenant_with_owner: {
        Args: { p_name: string; p_slug: string };
        Returns: Database["public"]["Tables"]["tenants"]["Row"];
      };
      update_membership: {
        Args: { p_membership_id: string; p_new_status: MembershipStatus | null; p_new_role_key: RoleKey | null };
        Returns: Database["public"]["Tables"]["tenant_memberships"]["Row"];
      };
      invite_member_by_email: {
        Args: { p_tenant_id: string; p_email: string; p_role_key: RoleKey };
        Returns: Database["public"]["Tables"]["tenant_memberships"]["Row"];
      };
      accept_invitation: {
        Args: { p_membership_id: string };
        Returns: Database["public"]["Tables"]["tenant_memberships"]["Row"];
      };
      get_pending_invitations: {
        Args: Record<string, never>;
        Returns: {
          membership_id: string;
          tenant_id: string;
          tenant_name: string;
          role_name: string;
          invited_at: string;
        }[];
      };
      log_audit_event: {
        Args: {
          p_tenant_id: string | null;
          p_actor_user_id: string | null;
          p_action: string;
          p_entity_type: string;
          p_entity_id: string | null;
          p_metadata?: Record<string, unknown>;
          p_ip_address?: string | null;
          p_user_agent?: string | null;
        };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
