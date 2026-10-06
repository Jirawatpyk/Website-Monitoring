
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"after": Json | null,"at": string,"before": Json | null,"entity": string,"entity_id": string | null,"id": string
                  }
                  Insert: {
                    "action": string,"actor_id"?: string | null,"after"?: Json | null,"at"?: string,"before"?: Json | null,"entity": string,"entity_id"?: string | null,"id"?: string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"after"?: Json | null,"at"?: string,"before"?: Json | null,"entity"?: string,"entity_id"?: string | null,"id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"clients": {
                  Row: {
                    "am_user_id": string | null,"contact_email": string | null,"created_at": string,"id": string,"language": string,"name": string,"updated_at": string
                  }
                  Insert: {
                    "am_user_id"?: string | null,"contact_email"?: string | null,"created_at"?: string,"id"?: string,"language"?: string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "am_user_id"?: string | null,"contact_email"?: string | null,"created_at"?: string,"id"?: string,"language"?: string,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clients_am_user_id_fkey"
      columns: ["am_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"monitors": {
                  Row: {
                    "allowed_redirect_domains": (string)[],"created_at": string,"expected_status": number,"id": string,"is_primary": boolean,"method": string,"must_contain": (string)[],"must_not_contain": (string)[],"site_id": string,"thresholds": NonNullable<Json>,"timeout_ms": number,"type": Database["public"]['Enums']["monitor_type"],"updated_at": string,"url": string
                  }
                  Insert: {
                    "allowed_redirect_domains"?: (string)[],"created_at"?: string,"expected_status"?: number,"id"?: string,"is_primary"?: boolean,"method"?: string,"must_contain"?: (string)[],"must_not_contain"?: (string)[],"site_id": string,"thresholds"?: NonNullable<Json>,"timeout_ms"?: number,"type": Database["public"]['Enums']["monitor_type"],"updated_at"?: string,"url": string
                  }
                  Update: {
                    "allowed_redirect_domains"?: (string)[],"created_at"?: string,"expected_status"?: number,"id"?: string,"is_primary"?: boolean,"method"?: string,"must_contain"?: (string)[],"must_not_contain"?: (string)[],"site_id"?: string,"thresholds"?: NonNullable<Json>,"timeout_ms"?: number,"type"?: Database["public"]['Enums']["monitor_type"],"updated_at"?: string,"url"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "monitors_site_id_fkey"
      columns: ["site_id"]
isOneToOne: false
      referencedRelation: "sites"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string,"email": string,"google_chat_user_id": string | null,"id": string,"is_active": boolean,"notify_email": boolean,"phone": string | null,"role": Database["public"]['Enums']["app_role"],"timezone": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"display_name": string,"email": string,"google_chat_user_id"?: string | null,"id": string,"is_active"?: boolean,"notify_email"?: boolean,"phone"?: string | null,"role": Database["public"]['Enums']["app_role"],"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"email"?: string,"google_chat_user_id"?: string | null,"id"?: string,"is_active"?: boolean,"notify_email"?: boolean,"phone"?: string | null,"role"?: Database["public"]['Enums']["app_role"],"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"sites": {
                  Row: {
                    "backup_owner_id": string | null,"client_id": string,"created_at": string,"hosting": string | null,"id": string,"is_active": boolean,"mute_reason": string | null,"muted_until": string | null,"name": string,"notes": string | null,"primary_owner_id": string | null,"tier": number,"updated_at": string
                  }
                  Insert: {
                    "backup_owner_id"?: string | null,"client_id": string,"created_at"?: string,"hosting"?: string | null,"id"?: string,"is_active"?: boolean,"mute_reason"?: string | null,"muted_until"?: string | null,"name": string,"notes"?: string | null,"primary_owner_id"?: string | null,"tier": number,"updated_at"?: string
                  }
                  Update: {
                    "backup_owner_id"?: string | null,"client_id"?: string,"created_at"?: string,"hosting"?: string | null,"id"?: string,"is_active"?: boolean,"mute_reason"?: string | null,"muted_until"?: string | null,"name"?: string,"notes"?: string | null,"primary_owner_id"?: string | null,"tier"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sites_backup_owner_id_fkey"
      columns: ["backup_owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sites_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sites_primary_owner_id_fkey"
      columns: ["primary_owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "current_app_role":
{ Args: Record<PropertyKey, never>; Returns: Database["public"]['Enums']["app_role"]
                           },
"hook_before_user_created":
{ Args: { "event": Json }; Returns: Json
                           },
"is_staff":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"my_access":
{ Args: Record<PropertyKey, never>; Returns: {
              "display_name": string,"email": string,"id": string,"role": Database["public"]['Enums']["app_role"],"status": string
            }[]
                           },
"owns_site":
{ Args: { "p_site_id": string }; Returns: boolean
                           },
"write_audit":
{ Args: { "p_action": string,"p_after"?: Json,"p_before"?: Json,"p_entity": string,"p_entity_id"?: string }; Returns: string
                           }
          }
          Enums: {
            "app_role": "admin"|"responder"|"stakeholder"|"viewer"|"client","check_outcome": "pass"|"fail"|"blocked","incident_state": "unacked"|"escalated"|"acknowledged"|"monitoring"|"needs_root_cause"|"resolved"|"in_review"|"closed","incident_trigger": "hard_fail"|"blocked_unverified"|"slow"|"keyword"|"key_page"|"ssl"|"domain"|"redirect"|"regional"|"manual","monitor_type": "http"|"keyword"|"ssl"|"domain"|"browser","notification_channel": "google_chat"|"email"|"voice","notification_status": "queued"|"sent"|"failed"|"cancelled","severity": "problem"|"down","site_status": "ok"|"problem"|"down"|"maintenance"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "app_role": ["admin", "responder", "stakeholder", "viewer", "client"],"check_outcome": ["pass", "fail", "blocked"],"incident_state": ["unacked", "escalated", "acknowledged", "monitoring", "needs_root_cause", "resolved", "in_review", "closed"],"incident_trigger": ["hard_fail", "blocked_unverified", "slow", "keyword", "key_page", "ssl", "domain", "redirect", "regional", "manual"],"monitor_type": ["http", "keyword", "ssl", "domain", "browser"],"notification_channel": ["google_chat", "email", "voice"],"notification_status": ["queued", "sent", "failed", "cancelled"],"severity": ["problem", "down"],"site_status": ["ok", "problem", "down", "maintenance"]
          }
        }
} as const
