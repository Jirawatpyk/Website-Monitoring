
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
            "agent_heartbeats": {
                  Row: {
                    "created_at": string,"info": NonNullable<Json>,"last_seen_at": string,"name": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"info"?: NonNullable<Json>,"last_seen_at": string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"info"?: NonNullable<Json>,"last_seen_at"?: string,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"audit_log": {
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
                },"check_results": {
                  Row: {
                    "akamai_ok": boolean | null,"attempt": number,"checked_at": string,"control_ok": boolean | null,"created_at": string,"error": string | null,"final_url": string | null,"id": string,"keyword_forbidden": (string)[] | null,"keyword_missing": (string)[] | null,"location": string,"monitor_id": string,"outcome": Database["public"]['Enums']["check_outcome"],"resolved_ip": unknown,"response_ms": number | null,"status_code": number | null,"ttfb_ms": number | null,"waf": string | null
                  }
                  Insert: {
                    "akamai_ok"?: boolean | null,"attempt"?: number,"checked_at": string,"control_ok"?: boolean | null,"created_at"?: string,"error"?: string | null,"final_url"?: string | null,"id"?: string,"keyword_forbidden"?: (string)[] | null,"keyword_missing"?: (string)[] | null,"location": string,"monitor_id": string,"outcome": Database["public"]['Enums']["check_outcome"],"resolved_ip"?: unknown,"response_ms"?: number | null,"status_code"?: number | null,"ttfb_ms"?: number | null,"waf"?: string | null
                  }
                  Update: {
                    "akamai_ok"?: boolean | null,"attempt"?: number,"checked_at"?: string,"control_ok"?: boolean | null,"created_at"?: string,"error"?: string | null,"final_url"?: string | null,"id"?: string,"keyword_forbidden"?: (string)[] | null,"keyword_missing"?: (string)[] | null,"location"?: string,"monitor_id"?: string,"outcome"?: Database["public"]['Enums']["check_outcome"],"resolved_ip"?: unknown,"response_ms"?: number | null,"status_code"?: number | null,"ttfb_ms"?: number | null,"waf"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "check_results_location_fkey"
      columns: ["location"]
isOneToOne: false
      referencedRelation: "probe_locations"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "check_results_monitor_id_fkey"
      columns: ["monitor_id"]
isOneToOne: false
      referencedRelation: "monitors"
      referencedColumns: ["id"]
    }
                  ]
                },"check_rollups": {
                  Row: {
                    "blocked": number,"bucket": Database["public"]['Enums']["rollup_bucket"],"bucket_start": string,"checks": number,"created_at": string,"hard_fails": number,"id": string,"location": string | null,"monitor_id": string,"p50_ms": number | null,"p95_ms": number | null,"updated_at": string
                  }
                  Insert: {
                    "blocked": number,"bucket": Database["public"]['Enums']["rollup_bucket"],"bucket_start": string,"checks": number,"created_at"?: string,"hard_fails": number,"id"?: string,"location"?: string | null,"monitor_id": string,"p50_ms"?: number | null,"p95_ms"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "blocked"?: number,"bucket"?: Database["public"]['Enums']["rollup_bucket"],"bucket_start"?: string,"checks"?: number,"created_at"?: string,"hard_fails"?: number,"id"?: string,"location"?: string | null,"monitor_id"?: string,"p50_ms"?: number | null,"p95_ms"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "check_rollups_location_fkey"
      columns: ["location"]
isOneToOne: false
      referencedRelation: "probe_locations"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "check_rollups_monitor_id_fkey"
      columns: ["monitor_id"]
isOneToOne: false
      referencedRelation: "monitors"
      referencedColumns: ["id"]
    }
                  ]
                },"clients": {
                  Row: {
                    "am_user_id": string | null,"contact_email": string | null,"created_at": string,"id": string,"is_internal": boolean,"language": string,"name": string,"updated_at": string
                  }
                  Insert: {
                    "am_user_id"?: string | null,"contact_email"?: string | null,"created_at"?: string,"id"?: string,"is_internal"?: boolean,"language"?: string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "am_user_id"?: string | null,"contact_email"?: string | null,"created_at"?: string,"id"?: string,"is_internal"?: boolean,"language"?: string,"name"?: string,"updated_at"?: string
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
                },"incident_events": {
                  Row: {
                    "actor_id": string | null,"at": string,"id": string,"incident_id": string,"payload": NonNullable<Json>,"type": string
                  }
                  Insert: {
                    "actor_id"?: string | null,"at"?: string,"id"?: string,"incident_id": string,"payload"?: NonNullable<Json>,"type": string
                  }
                  Update: {
                    "actor_id"?: string | null,"at"?: string,"id"?: string,"incident_id"?: string,"payload"?: NonNullable<Json>,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "incident_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "incident_events_incident_id_fkey"
      columns: ["incident_id"]
isOneToOne: false
      referencedRelation: "incidents"
      referencedColumns: ["id"]
    }
                  ]
                },"incidents": {
                  Row: {
                    "acked_at": string | null,"acked_by": string | null,"auto_resolved": boolean,"client_update_due_at": string | null,"client_update_note": string | null,"client_update_required": boolean,"client_updated_at": string | null,"client_updated_by": string | null,"created_at": string,"detected_at": string,"episode_severity": Database["public"]['Enums']["severity"],"escalation_level": number,"id": string,"is_flapping": boolean,"is_manual": boolean,"monitor_id": string | null,"number": number,"recovered_at": string | null,"resolved_at": string | null,"review_state": string | null,"root_cause": string | null,"root_cause_category": string | null,"severity": Database["public"]['Enums']["severity"],"site_id": string,"started_at": string,"state": Database["public"]['Enums']["incident_state"],"trigger": Database["public"]['Enums']["incident_trigger"],"updated_at": string
                  }
                  Insert: {
                    "acked_at"?: string | null,"acked_by"?: string | null,"auto_resolved"?: boolean,"client_update_due_at"?: string | null,"client_update_note"?: string | null,"client_update_required"?: boolean,"client_updated_at"?: string | null,"client_updated_by"?: string | null,"created_at"?: string,"detected_at": string,"episode_severity": Database["public"]['Enums']["severity"],"escalation_level"?: number,"id"?: string,"is_flapping"?: boolean,"is_manual"?: boolean,"monitor_id"?: string | null,"number"?: never,"recovered_at"?: string | null,"resolved_at"?: string | null,"review_state"?: string | null,"root_cause"?: string | null,"root_cause_category"?: string | null,"severity": Database["public"]['Enums']["severity"],"site_id": string,"started_at": string,"state"?: Database["public"]['Enums']["incident_state"],"trigger": Database["public"]['Enums']["incident_trigger"],"updated_at"?: string
                  }
                  Update: {
                    "acked_at"?: string | null,"acked_by"?: string | null,"auto_resolved"?: boolean,"client_update_due_at"?: string | null,"client_update_note"?: string | null,"client_update_required"?: boolean,"client_updated_at"?: string | null,"client_updated_by"?: string | null,"created_at"?: string,"detected_at"?: string,"episode_severity"?: Database["public"]['Enums']["severity"],"escalation_level"?: number,"id"?: string,"is_flapping"?: boolean,"is_manual"?: boolean,"monitor_id"?: string | null,"number"?: never,"recovered_at"?: string | null,"resolved_at"?: string | null,"review_state"?: string | null,"root_cause"?: string | null,"root_cause_category"?: string | null,"severity"?: Database["public"]['Enums']["severity"],"site_id"?: string,"started_at"?: string,"state"?: Database["public"]['Enums']["incident_state"],"trigger"?: Database["public"]['Enums']["incident_trigger"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "incidents_acked_by_fkey"
      columns: ["acked_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "incidents_client_updated_by_fkey"
      columns: ["client_updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "incidents_monitor_id_fkey"
      columns: ["monitor_id"]
isOneToOne: false
      referencedRelation: "monitors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "incidents_site_id_fkey"
      columns: ["site_id"]
isOneToOne: false
      referencedRelation: "sites"
      referencedColumns: ["id"]
    }
                  ]
                },"monitor_status": {
                  Row: {
                    "cause": string | null,"created_at": string,"failing_since": NonNullable<Json>,"last_round_at": string,"monitor_id": string,"site_id": string,"slow_rounds": number,"status": Database["public"]['Enums']["site_state"],"trigger": Database["public"]['Enums']["incident_trigger"] | null,"updated_at": string
                  }
                  Insert: {
                    "cause"?: string | null,"created_at"?: string,"failing_since"?: NonNullable<Json>,"last_round_at": string,"monitor_id": string,"site_id": string,"slow_rounds"?: number,"status"?: Database["public"]['Enums']["site_state"],"trigger"?: Database["public"]['Enums']["incident_trigger"] | null,"updated_at"?: string
                  }
                  Update: {
                    "cause"?: string | null,"created_at"?: string,"failing_since"?: NonNullable<Json>,"last_round_at"?: string,"monitor_id"?: string,"site_id"?: string,"slow_rounds"?: number,"status"?: Database["public"]['Enums']["site_state"],"trigger"?: Database["public"]['Enums']["incident_trigger"] | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "monitor_status_monitor_id_fkey"
      columns: ["monitor_id"]
isOneToOne: true
      referencedRelation: "monitors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "monitor_status_site_id_fkey"
      columns: ["site_id"]
isOneToOne: false
      referencedRelation: "sites"
      referencedColumns: ["id"]
    }
                  ]
                },"monitors": {
                  Row: {
                    "allowed_redirect_domains": (string)[],"created_at": string,"enabled": boolean,"expected_status": number,"headers": NonNullable<Json>,"id": string,"is_primary": boolean,"method": string,"must_contain": (string)[],"must_not_contain": (string)[],"removed_at": string | null,"site_id": string,"thresholds": NonNullable<Json>,"timeout_ms": number,"type": Database["public"]['Enums']["monitor_type"],"updated_at": string,"url": string
                  }
                  Insert: {
                    "allowed_redirect_domains"?: (string)[],"created_at"?: string,"enabled"?: boolean,"expected_status"?: number,"headers"?: NonNullable<Json>,"id"?: string,"is_primary"?: boolean,"method"?: string,"must_contain"?: (string)[],"must_not_contain"?: (string)[],"removed_at"?: string | null,"site_id": string,"thresholds"?: NonNullable<Json>,"timeout_ms"?: number,"type": Database["public"]['Enums']["monitor_type"],"updated_at"?: string,"url": string
                  }
                  Update: {
                    "allowed_redirect_domains"?: (string)[],"created_at"?: string,"enabled"?: boolean,"expected_status"?: number,"headers"?: NonNullable<Json>,"id"?: string,"is_primary"?: boolean,"method"?: string,"must_contain"?: (string)[],"must_not_contain"?: (string)[],"removed_at"?: string | null,"site_id"?: string,"thresholds"?: NonNullable<Json>,"timeout_ms"?: number,"type"?: Database["public"]['Enums']["monitor_type"],"updated_at"?: string,"url"?: string
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
                },"notification_attempts": {
                  Row: {
                    "at": string,"attempt": number,"error": string | null,"id": string,"notification_id": string,"ok": boolean,"provider_message_id": string | null
                  }
                  Insert: {
                    "at"?: string,"attempt": number,"error"?: string | null,"id"?: string,"notification_id": string,"ok": boolean,"provider_message_id"?: string | null
                  }
                  Update: {
                    "at"?: string,"attempt"?: number,"error"?: string | null,"id"?: string,"notification_id"?: string,"ok"?: boolean,"provider_message_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_attempts_notification_id_fkey"
      columns: ["notification_id"]
isOneToOne: false
      referencedRelation: "notifications"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "attempts": number,"channel": Database["public"]['Enums']["notification_channel"],"context": NonNullable<Json>,"created_at": string,"dedupe_key": string,"error": string | null,"hold_until": string | null,"id": string,"incident_id": string | null,"next_retry_at": string | null,"provider_message_id": string | null,"sent_at": string | null,"status": Database["public"]['Enums']["notification_status"],"system_alert_id": string | null,"template": string,"thread_key": string | null,"updated_at": string,"user_id": string | null
                  }
                  Insert: {
                    "attempts"?: number,"channel": Database["public"]['Enums']["notification_channel"],"context"?: NonNullable<Json>,"created_at"?: string,"dedupe_key"?: string,"error"?: string | null,"hold_until"?: string | null,"id"?: string,"incident_id"?: string | null,"next_retry_at"?: string | null,"provider_message_id"?: string | null,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["notification_status"],"system_alert_id"?: string | null,"template": string,"thread_key"?: string | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"channel"?: Database["public"]['Enums']["notification_channel"],"context"?: NonNullable<Json>,"created_at"?: string,"dedupe_key"?: string,"error"?: string | null,"hold_until"?: string | null,"id"?: string,"incident_id"?: string | null,"next_retry_at"?: string | null,"provider_message_id"?: string | null,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["notification_status"],"system_alert_id"?: string | null,"template"?: string,"thread_key"?: string | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_incident_id_fkey"
      columns: ["incident_id"]
isOneToOne: false
      referencedRelation: "incidents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_system_alert_id_fkey"
      columns: ["system_alert_id"]
isOneToOne: false
      referencedRelation: "system_alerts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"probe_locations": {
                  Row: {
                    "code": string,"created_at": string,"is_active": boolean,"last_heartbeat_at": string | null,"provider": string,"region": string,"updated_at": string
                  }
                  Insert: {
                    "code": string,"created_at"?: string,"is_active"?: boolean,"last_heartbeat_at"?: string | null,"provider": string,"region": string,"updated_at"?: string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"is_active"?: boolean,"last_heartbeat_at"?: string | null,"provider"?: string,"region"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
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
                },"site_status": {
                  Row: {
                    "created_at": string,"flip_ok": boolean | null,"flips": (string)[],"last_evaluated_at": string | null,"last_round_at": string | null,"note": string | null,"ok_rounds": number,"since": string,"site_id": string,"status": Database["public"]['Enums']["site_state"],"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"flip_ok"?: boolean | null,"flips"?: (string)[],"last_evaluated_at"?: string | null,"last_round_at"?: string | null,"note"?: string | null,"ok_rounds"?: number,"since"?: string,"site_id": string,"status"?: Database["public"]['Enums']["site_state"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"flip_ok"?: boolean | null,"flips"?: (string)[],"last_evaluated_at"?: string | null,"last_round_at"?: string | null,"note"?: string | null,"ok_rounds"?: number,"since"?: string,"site_id"?: string,"status"?: Database["public"]['Enums']["site_state"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "site_status_site_id_fkey"
      columns: ["site_id"]
isOneToOne: true
      referencedRelation: "sites"
      referencedColumns: ["id"]
    }
                  ]
                },"sites": {
                  Row: {
                    "backup_owner_id": string | null,"behind_waf": boolean,"client_id": string,"created_at": string,"credential_ref": string | null,"hosting": string | null,"id": string,"is_active": boolean,"monitoring_started_at": string | null,"mute_reason": string | null,"muted_until": string | null,"name": string,"notes": string | null,"primary_owner_id": string | null,"tier": number,"updated_at": string,"waf_allowlist_confirmed": boolean
                  }
                  Insert: {
                    "backup_owner_id"?: string | null,"behind_waf"?: boolean,"client_id": string,"created_at"?: string,"credential_ref"?: string | null,"hosting"?: string | null,"id"?: string,"is_active"?: boolean,"monitoring_started_at"?: string | null,"mute_reason"?: string | null,"muted_until"?: string | null,"name": string,"notes"?: string | null,"primary_owner_id"?: string | null,"tier": number,"updated_at"?: string,"waf_allowlist_confirmed"?: boolean
                  }
                  Update: {
                    "backup_owner_id"?: string | null,"behind_waf"?: boolean,"client_id"?: string,"created_at"?: string,"credential_ref"?: string | null,"hosting"?: string | null,"id"?: string,"is_active"?: boolean,"monitoring_started_at"?: string | null,"mute_reason"?: string | null,"muted_until"?: string | null,"name"?: string,"notes"?: string | null,"primary_owner_id"?: string | null,"tier"?: number,"updated_at"?: string,"waf_allowlist_confirmed"?: boolean
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
                },"system_alerts": {
                  Row: {
                    "cleared_at": string | null,"context": NonNullable<Json>,"created_at": string,"id": string,"kind": string,"opened_at": string,"updated_at": string
                  }
                  Insert: {
                    "cleared_at"?: string | null,"context"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"kind": string,"opened_at"?: string,"updated_at"?: string
                  }
                  Update: {
                    "cleared_at"?: string | null,"context"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"kind"?: string,"opened_at"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"verification_jobs": {
                  Row: {
                    "attempts": number,"completed_at": string | null,"created_at": string,"detail": string | null,"http_status": number | null,"id": string,"incident_id": string | null,"kind": string,"lease_until": string | null,"monitor_id": string,"must_contain": (string)[],"result": string | null,"round_at": string | null,"screenshot_path": string | null,"site_id": string,"status": string,"updated_at": string,"url": string
                  }
                  Insert: {
                    "attempts"?: number,"completed_at"?: string | null,"created_at"?: string,"detail"?: string | null,"http_status"?: number | null,"id"?: string,"incident_id"?: string | null,"kind": string,"lease_until"?: string | null,"monitor_id": string,"must_contain"?: (string)[],"result"?: string | null,"round_at"?: string | null,"screenshot_path"?: string | null,"site_id": string,"status"?: string,"updated_at"?: string,"url": string
                  }
                  Update: {
                    "attempts"?: number,"completed_at"?: string | null,"created_at"?: string,"detail"?: string | null,"http_status"?: number | null,"id"?: string,"incident_id"?: string | null,"kind"?: string,"lease_until"?: string | null,"monitor_id"?: string,"must_contain"?: (string)[],"result"?: string | null,"round_at"?: string | null,"screenshot_path"?: string | null,"site_id"?: string,"status"?: string,"updated_at"?: string,"url"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "verification_jobs_incident_id_fkey"
      columns: ["incident_id"]
isOneToOne: false
      referencedRelation: "incidents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "verification_jobs_monitor_id_fkey"
      columns: ["monitor_id"]
isOneToOne: false
      referencedRelation: "monitors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "verification_jobs_site_id_fkey"
      columns: ["site_id"]
isOneToOne: false
      referencedRelation: "sites"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "ack_incident":
{ Args: { "p_incident_id": string }; Returns: string
                           },
"claim_notifications":
{ Args: { "p_channel": Database["public"]['Enums']["notification_channel"],"p_incident_id"?: string,"p_limit"?: number }; Returns: {
              "attempts": number,
"channel": Database["public"]['Enums']["notification_channel"],
"context": NonNullable<Json>,
"created_at": string,
"dedupe_key": string,
"error": string | null,
"hold_until": string | null,
"id": string,
"incident_id": string | null,
"next_retry_at": string | null,
"provider_message_id": string | null,
"sent_at": string | null,
"status": Database["public"]['Enums']["notification_status"],
"system_alert_id": string | null,
"template": string,
"thread_key": string | null,
"updated_at": string,
"user_id": string | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "notifications"
        isOneToOne: false
        isSetofReturn: true
      } },
"claim_verification_jobs":
{ Args: { "p_limit"?: number }; Returns: {
              "attempts": number,
"completed_at": string | null,
"created_at": string,
"detail": string | null,
"http_status": number | null,
"id": string,
"incident_id": string | null,
"kind": string,
"lease_until": string | null,
"monitor_id": string,
"must_contain": (string)[],
"result": string | null,
"round_at": string | null,
"screenshot_path": string | null,
"site_id": string,
"status": string,
"updated_at": string,
"url": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "verification_jobs"
        isOneToOne: false
        isSetofReturn: true
      } },
"clear_system_alert":
{ Args: { "p_kind": string }; Returns: boolean
                           },
"complete_verification_job":
{ Args: { "p_detail"?: string,"p_http_status"?: number,"p_job_id": string,"p_result": string,"p_screenshot_path"?: string }; Returns: {
              "attempts": number,
"completed_at": string | null,
"created_at": string,
"detail": string | null,
"http_status": number | null,
"id": string,
"incident_id": string | null,
"kind": string,
"lease_until": string | null,
"monitor_id": string,
"must_contain": (string)[],
"result": string | null,
"round_at": string | null,
"screenshot_path": string | null,
"site_id": string,
"status": string,
"updated_at": string,
"url": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "verification_jobs"
        isOneToOne: false
        isSetofReturn: true
      } },
"create_site":
{ Args: { "p_monitors": Json,"p_site": Json,"p_start"?: boolean }; Returns: string
                           },
"current_app_role":
{ Args: Record<PropertyKey, never>; Returns: Database["public"]['Enums']["app_role"]
                           },
"delete_site":
{ Args: { "p_site_id": string }; Returns: undefined
                           },
"engine_cancel_flap_summary":
{ Args: { "p_incident_id": string }; Returns: undefined
                           },
"engine_checks":
{ Args: { "p_after_checked_at"?: string,"p_after_id"?: string,"p_limit"?: number,"p_since": string }; Returns: {
              "akamai_ok": boolean | null,
"attempt": number,
"checked_at": string,
"control_ok": boolean | null,
"created_at": string,
"error": string | null,
"final_url": string | null,
"id": string,
"keyword_forbidden": (string)[] | null,
"keyword_missing": (string)[] | null,
"location": string,
"monitor_id": string,
"outcome": Database["public"]['Enums']["check_outcome"],
"resolved_ip": unknown,
"response_ms": number | null,
"status_code": number | null,
"ttfb_ms": number | null,
"waf": string | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "check_results"
        isOneToOne: false
        isSetofReturn: true
      } },
"engine_escalate_incident":
{ Args: { "p_context": Json,"p_detected_at": string,"p_flapping"?: boolean,"p_incident_id": string,"p_monitors"?: Json,"p_notify": boolean,"p_round_at": string,"p_status"?: Database["public"]['Enums']["site_state"] }; Returns: boolean
                           },
"engine_monitor_status":
{ Args: Record<PropertyKey, never>; Returns: {
              "cause": string | null,
"created_at": string,
"failing_since": NonNullable<Json>,
"last_round_at": string,
"monitor_id": string,
"site_id": string,
"slow_rounds": number,
"status": Database["public"]['Enums']["site_state"],
"trigger": Database["public"]['Enums']["incident_trigger"] | null,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "monitor_status"
        isOneToOne: false
        isSetofReturn: true
      } },
"engine_note_site":
{ Args: { "p_note"?: string,"p_round_at": string,"p_site_id": string }; Returns: undefined
                           },
"engine_open_incident":
{ Args: { "p_context": Json,"p_detected_at": string,"p_monitor_id": string,"p_monitors"?: Json,"p_notify": boolean,"p_round_at": string,"p_severity": Database["public"]['Enums']["severity"],"p_site_id": string,"p_started_at": string,"p_status"?: Database["public"]['Enums']["site_state"],"p_trigger": Database["public"]['Enums']["incident_trigger"] }; Returns: string
                           },
"engine_record_flip":
{ Args: { "p_ok": boolean,"p_round_at": string,"p_site_id": string }; Returns: undefined
                           },
"engine_record_round":
{ Args: { "p_evaluated_at": string,"p_monitors"?: Json,"p_ok_rounds": number,"p_round_at": string,"p_site_id": string,"p_status"?: Database["public"]['Enums']["site_state"] }; Returns: undefined
                           },
"engine_recover_incident":
{ Args: { "p_auto_resolve"?: boolean,"p_context": Json,"p_flip_ok"?: boolean,"p_from": Database["public"]['Enums']["incident_state"],"p_hold_summary"?: boolean,"p_incident_id": string,"p_monitors"?: Json,"p_notify": boolean,"p_recovered_at": string,"p_round_at": string,"p_status"?: Database["public"]['Enums']["site_state"],"p_to": Database["public"]['Enums']["incident_state"] }; Returns: boolean
                           },
"engine_relapse_incident":
{ Args: { "p_context": Json,"p_detected_at": string,"p_flapping": boolean,"p_incident_id": string,"p_monitors"?: Json,"p_notify": boolean,"p_round_at": string,"p_severity": Database["public"]['Enums']["severity"],"p_started_at": string,"p_status"?: Database["public"]['Enums']["site_state"],"p_trigger": Database["public"]['Enums']["incident_trigger"] }; Returns: boolean
                           },
"engine_settle_incident":
{ Args: { "p_at": string,"p_from": Database["public"]['Enums']["incident_state"],"p_incident_id": string,"p_monitors"?: Json,"p_round_at": string,"p_status"?: Database["public"]['Enums']["site_state"],"p_to": Database["public"]['Enums']["incident_state"] }; Returns: boolean
                           },
"engine_verify_jobs":
{ Args: { "p_since": string }; Returns: {
              "attempts": number,
"completed_at": string | null,
"created_at": string,
"detail": string | null,
"http_status": number | null,
"id": string,
"incident_id": string | null,
"kind": string,
"lease_until": string | null,
"monitor_id": string,
"must_contain": (string)[],
"result": string | null,
"round_at": string | null,
"screenshot_path": string | null,
"site_id": string,
"status": string,
"updated_at": string,
"url": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "verification_jobs"
        isOneToOne: false
        isSetofReturn: true
      } },
"engine_write_monitors":
{ Args: { "p_monitors": Json,"p_round_at": string,"p_site_id": string,"p_status": Database["public"]['Enums']["site_state"] }; Returns: undefined
                           },
"expire_verification_jobs":
{ Args: Record<PropertyKey, never>; Returns: number
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
"open_system_alert":
{ Args: { "p_context": Json,"p_kind": string }; Returns: string
                           },
"owns_site":
{ Args: { "p_site_id": string }; Returns: boolean
                           },
"queue_fallback_emails":
{ Args: { "p_notification_id": string }; Returns: number
                           },
"save_monitors":
{ Args: { "p_removals"?: (string)[],"p_site_id": string,"p_upserts": Json }; Returns: undefined
                           },
"set_site_monitoring":
{ Args: { "p_on": boolean,"p_site_id": string }; Returns: undefined
                           },
"site_list_locations":
{ Args: Record<PropertyKey, never>; Returns: {
              "checked_at": string,"error": string,"location": string,"outcome": Database["public"]['Enums']["check_outcome"],"response_ms": number,"site_id": string
            }[]
                           },
"site_list_response_24h":
{ Args: Record<PropertyKey, never>; Returns: {
              "p50_ms": number,"site_id": string
            }[]
                           },
"site_response_series":
{ Args: { "p_bucket": string,"p_from": string,"p_site_id": string }; Returns: {
              "bucket_start": string,"checks": number,"hard_fails": number,"location": string,"p50_ms": number,"p95_ms": number
            }[]
                           },
"undo_ack":
{ Args: { "p_incident_id": string }; Returns: undefined
                           },
"update_site":
{ Args: { "p_site": Json,"p_site_id": string }; Returns: undefined
                           },
"write_audit":
{ Args: { "p_action": string,"p_after"?: Json,"p_before"?: Json,"p_entity": string,"p_entity_id"?: string }; Returns: string
                           }
          }
          Enums: {
            "app_role": "admin"|"responder"|"stakeholder"|"viewer"|"client","check_outcome": "pass"|"fail"|"blocked","incident_state": "unacked"|"escalated"|"acknowledged"|"monitoring"|"needs_root_cause"|"resolved"|"in_review"|"closed","incident_trigger": "hard_fail"|"blocked_unverified"|"slow"|"keyword"|"key_page"|"ssl"|"domain"|"redirect"|"regional"|"manual"|"tls_chain","monitor_type": "http"|"keyword"|"ssl"|"domain"|"browser","notification_channel": "google_chat"|"email"|"voice","notification_status": "queued"|"sent"|"failed"|"cancelled","rollup_bucket": "hour"|"day","severity": "problem"|"down","site_state": "ok"|"problem"|"down"|"maintenance"
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
            "app_role": ["admin", "responder", "stakeholder", "viewer", "client"],"check_outcome": ["pass", "fail", "blocked"],"incident_state": ["unacked", "escalated", "acknowledged", "monitoring", "needs_root_cause", "resolved", "in_review", "closed"],"incident_trigger": ["hard_fail", "blocked_unverified", "slow", "keyword", "key_page", "ssl", "domain", "redirect", "regional", "manual", "tls_chain"],"monitor_type": ["http", "keyword", "ssl", "domain", "browser"],"notification_channel": ["google_chat", "email", "voice"],"notification_status": ["queued", "sent", "failed", "cancelled"],"rollup_bucket": ["hour", "day"],"severity": ["problem", "down"],"site_state": ["ok", "problem", "down", "maintenance"]
          }
        }
} as const
