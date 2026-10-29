
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
                  ComputedFields: never
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
                  ComputedFields: never
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
                  ComputedFields: never
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
                  ComputedFields: never
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
                  ComputedFields: never
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
                },"company_holidays": {
                  Row: {
                    "created_at": string,"day": string,"id": string,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"day": string,"id"?: string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"day"?: string,"id"?: string,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"crawler_checks": {
                  Row: {
                    "checked_at": string,"created_at": string,"error": string | null,"final_url": string | null,"fingerprint": Json | null,"fingerprint_hash": string | null,"forbidden": (string)[] | null,"id": string,"monitor_id": string,"outcome": Database["public"]['Enums']["check_outcome"],"response_ms": number | null,"scan_complete": boolean | null,"status_code": number | null,"updated_at": string,"usable": boolean,"view": string
                  }
                  ComputedFields: never
                  Insert: {
                    "checked_at": string,"created_at"?: string,"error"?: string | null,"final_url"?: string | null,"fingerprint"?: Json | null,"fingerprint_hash"?: never,"forbidden"?: (string)[] | null,"id"?: string,"monitor_id": string,"outcome": Database["public"]['Enums']["check_outcome"],"response_ms"?: number | null,"scan_complete"?: boolean | null,"status_code"?: number | null,"updated_at"?: string,"usable": boolean,"view": string
                  }
                  Update: {
                    "checked_at"?: string,"created_at"?: string,"error"?: string | null,"final_url"?: string | null,"fingerprint"?: Json | null,"fingerprint_hash"?: never,"forbidden"?: (string)[] | null,"id"?: string,"monitor_id"?: string,"outcome"?: Database["public"]['Enums']["check_outcome"],"response_ms"?: number | null,"scan_complete"?: boolean | null,"status_code"?: number | null,"updated_at"?: string,"usable"?: boolean,"view"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "crawler_checks_monitor_id_fkey"
      columns: ["monitor_id"]
isOneToOne: false
      referencedRelation: "monitors"
      referencedColumns: ["id"]
    }
                  ]
                },"escalation_policies": {
                  Row: {
                    "created_at": string,"id": string,"severity": Database["public"]['Enums']["severity"],"tier": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"severity": Database["public"]['Enums']["severity"],"tier"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"severity"?: Database["public"]['Enums']["severity"],"tier"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"escalation_steps": {
                  Row: {
                    "channels": (string)[],"created_at": string,"delay_min": number,"fyi": boolean,"id": string,"level": number,"policy_id": string,"targets": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channels": (string)[],"created_at"?: string,"delay_min": number,"fyi"?: boolean,"id"?: string,"level": number,"policy_id": string,"targets": (string)[],"updated_at"?: string
                  }
                  Update: {
                    "channels"?: (string)[],"created_at"?: string,"delay_min"?: number,"fyi"?: boolean,"id"?: string,"level"?: number,"policy_id"?: string,"targets"?: (string)[],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "escalation_steps_policy_id_fkey"
      columns: ["policy_id"]
isOneToOne: false
      referencedRelation: "escalation_policies"
      referencedColumns: ["id"]
    }
                  ]
                },"incident_events": {
                  Row: {
                    "actor_id": string | null,"at": string,"id": string,"incident_id": string,"payload": NonNullable<Json>,"type": string
                  }
                  ComputedFields: never
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
                    "acked_at": string | null,"acked_by": string | null,"alerted_at": string | null,"auto_resolved": boolean,"client_update_due_at": string | null,"client_update_note": string | null,"client_update_required": boolean,"client_updated_at": string | null,"client_updated_by": string | null,"created_at": string,"detected_at": string,"episode_severity": Database["public"]['Enums']["severity"],"escalation_level": number,"escalation_plan": Json | null,"id": string,"is_flapping": boolean,"is_manual": boolean,"l0_user_id": string | null,"monitor_id": string | null,"number": number,"recovered_at": string | null,"resolved_at": string | null,"resolved_by": string | null,"review_state": string | null,"root_cause": string | null,"root_cause_category": string | null,"root_cause_fix": string | null,"severity": Database["public"]['Enums']["severity"],"site_id": string,"started_at": string,"state": Database["public"]['Enums']["incident_state"],"trigger": Database["public"]['Enums']["incident_trigger"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "acked_at"?: string | null,"acked_by"?: string | null,"alerted_at"?: string | null,"auto_resolved"?: boolean,"client_update_due_at"?: string | null,"client_update_note"?: string | null,"client_update_required"?: boolean,"client_updated_at"?: string | null,"client_updated_by"?: string | null,"created_at"?: string,"detected_at": string,"episode_severity": Database["public"]['Enums']["severity"],"escalation_level"?: number,"escalation_plan"?: Json | null,"id"?: string,"is_flapping"?: boolean,"is_manual"?: boolean,"l0_user_id"?: string | null,"monitor_id"?: string | null,"number"?: never,"recovered_at"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"review_state"?: string | null,"root_cause"?: string | null,"root_cause_category"?: string | null,"root_cause_fix"?: string | null,"severity": Database["public"]['Enums']["severity"],"site_id": string,"started_at": string,"state"?: Database["public"]['Enums']["incident_state"],"trigger": Database["public"]['Enums']["incident_trigger"],"updated_at"?: string
                  }
                  Update: {
                    "acked_at"?: string | null,"acked_by"?: string | null,"alerted_at"?: string | null,"auto_resolved"?: boolean,"client_update_due_at"?: string | null,"client_update_note"?: string | null,"client_update_required"?: boolean,"client_updated_at"?: string | null,"client_updated_by"?: string | null,"created_at"?: string,"detected_at"?: string,"episode_severity"?: Database["public"]['Enums']["severity"],"escalation_level"?: number,"escalation_plan"?: Json | null,"id"?: string,"is_flapping"?: boolean,"is_manual"?: boolean,"l0_user_id"?: string | null,"monitor_id"?: string | null,"number"?: never,"recovered_at"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"review_state"?: string | null,"root_cause"?: string | null,"root_cause_category"?: string | null,"root_cause_fix"?: string | null,"severity"?: Database["public"]['Enums']["severity"],"site_id"?: string,"started_at"?: string,"state"?: Database["public"]['Enums']["incident_state"],"trigger"?: Database["public"]['Enums']["incident_trigger"],"updated_at"?: string
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
      foreignKeyName: "incidents_l0_user_id_fkey"
      columns: ["l0_user_id"]
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
      foreignKeyName: "incidents_resolved_by_fkey"
      columns: ["resolved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "incidents_site_id_fkey"
      columns: ["site_id"]
isOneToOne: false
      referencedRelation: "sites"
      referencedColumns: ["id"]
    }
                  ]
                },"maintenance_windows": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"cancelled_at": string | null,"created_at": string,"created_by": string | null,"end_logged": boolean,"end_reason": string | null,"ended_at": string | null,"ended_by": string | null,"ends_at": string,"id": string,"kind": string,"log": NonNullable<Json>,"outcome": string | null,"outcome_detail": string | null,"reason": string,"reminded_12h_at": string | null,"reminded_1h_at": string | null,"rrule": string | null,"site_id": string,"start_logged": boolean,"starts_at": string,"undo_action": string | null,"undo_before": Json | null,"undo_by": string | null,"undo_key": string | null,"undo_until": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"cancelled_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"end_logged"?: boolean,"end_reason"?: string | null,"ended_at"?: string | null,"ended_by"?: string | null,"ends_at": string,"id"?: string,"kind": string,"log"?: NonNullable<Json>,"outcome"?: string | null,"outcome_detail"?: string | null,"reason": string,"reminded_12h_at"?: string | null,"reminded_1h_at"?: string | null,"rrule"?: string | null,"site_id": string,"start_logged"?: boolean,"starts_at": string,"undo_action"?: string | null,"undo_before"?: Json | null,"undo_by"?: string | null,"undo_key"?: string | null,"undo_until"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"cancelled_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"end_logged"?: boolean,"end_reason"?: string | null,"ended_at"?: string | null,"ended_by"?: string | null,"ends_at"?: string,"id"?: string,"kind"?: string,"log"?: NonNullable<Json>,"outcome"?: string | null,"outcome_detail"?: string | null,"reason"?: string,"reminded_12h_at"?: string | null,"reminded_1h_at"?: string | null,"rrule"?: string | null,"site_id"?: string,"start_logged"?: boolean,"starts_at"?: string,"undo_action"?: string | null,"undo_before"?: Json | null,"undo_by"?: string | null,"undo_key"?: string | null,"undo_until"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "maintenance_windows_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "maintenance_windows_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "maintenance_windows_ended_by_fkey"
      columns: ["ended_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "maintenance_windows_site_id_fkey"
      columns: ["site_id"]
isOneToOne: false
      referencedRelation: "sites"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "maintenance_windows_undo_by_fkey"
      columns: ["undo_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"monitor_status": {
                  Row: {
                    "cause": string | null,"created_at": string,"failing_since": NonNullable<Json>,"last_round_at": string,"monitor_id": string,"site_id": string,"slow_rounds": number,"status": Database["public"]['Enums']["site_state"],"trigger": Database["public"]['Enums']["incident_trigger"] | null,"updated_at": string
                  }
                  ComputedFields: never
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
                  ComputedFields: never
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
                  ComputedFields: never
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
                    "attempts": number,"channel": Database["public"]['Enums']["notification_channel"],"context": NonNullable<Json>,"created_at": string,"dedupe_key": string,"error": string | null,"hold_until": string | null,"id": string,"incident_id": string | null,"maintenance_window_id": string | null,"next_retry_at": string | null,"oncall_event_id": string | null,"provider_message_id": string | null,"sent_at": string | null,"status": Database["public"]['Enums']["notification_status"],"system_alert_id": string | null,"template": string,"thread_key": string | null,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"channel": Database["public"]['Enums']["notification_channel"],"context"?: NonNullable<Json>,"created_at"?: string,"dedupe_key"?: string,"error"?: string | null,"hold_until"?: string | null,"id"?: string,"incident_id"?: string | null,"maintenance_window_id"?: string | null,"next_retry_at"?: string | null,"oncall_event_id"?: string | null,"provider_message_id"?: string | null,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["notification_status"],"system_alert_id"?: string | null,"template": string,"thread_key"?: string | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"channel"?: Database["public"]['Enums']["notification_channel"],"context"?: NonNullable<Json>,"created_at"?: string,"dedupe_key"?: string,"error"?: string | null,"hold_until"?: string | null,"id"?: string,"incident_id"?: string | null,"maintenance_window_id"?: string | null,"next_retry_at"?: string | null,"oncall_event_id"?: string | null,"provider_message_id"?: string | null,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["notification_status"],"system_alert_id"?: string | null,"template"?: string,"thread_key"?: string | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_incident_id_fkey"
      columns: ["incident_id"]
isOneToOne: false
      referencedRelation: "incidents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_maintenance_window_id_fkey"
      columns: ["maintenance_window_id"]
isOneToOne: false
      referencedRelation: "maintenance_windows"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_oncall_event_id_fkey"
      columns: ["oncall_event_id"]
isOneToOne: false
      referencedRelation: "oncall_events"
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
                },"oncall_checklist": {
                  Row: {
                    "created_at": string,"dnd_allowed": boolean,"id": string,"mentions_only": boolean,"test_received_at": string | null,"test_sent_at": string | null,"test_token": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"dnd_allowed"?: boolean,"id"?: string,"mentions_only"?: boolean,"test_received_at"?: string | null,"test_sent_at"?: string | null,"test_token"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"dnd_allowed"?: boolean,"id"?: string,"mentions_only"?: boolean,"test_received_at"?: string | null,"test_sent_at"?: string | null,"test_token"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "oncall_checklist_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"oncall_events": {
                  Row: {
                    "actor_id": string | null,"at": string,"id": string,"kind": string,"payload": NonNullable<Json>,"shift_id": string | null,"swap_id": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"at"?: string,"id"?: string,"kind": string,"payload"?: NonNullable<Json>,"shift_id"?: string | null,"swap_id"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "actor_id"?: string | null,"at"?: string,"id"?: string,"kind"?: string,"payload"?: NonNullable<Json>,"shift_id"?: string | null,"swap_id"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "oncall_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "oncall_events_shift_id_fkey"
      columns: ["shift_id"]
isOneToOne: false
      referencedRelation: "oncall_shifts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "oncall_events_swap_id_fkey"
      columns: ["swap_id"]
isOneToOne: false
      referencedRelation: "oncall_swaps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "oncall_events_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"oncall_rotation": {
                  Row: {
                    "created_at": string,"id": string,"position": number,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"position": number,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"position"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "oncall_rotation_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"oncall_shifts": {
                  Row: {
                    "created_at": string,"ends_at": string,"handed_over_from": string | null,"handover_reason": string | null,"id": string,"slot": number | null,"starts_at": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"ends_at": string,"handed_over_from"?: string | null,"handover_reason"?: string | null,"id"?: string,"slot"?: number | null,"starts_at": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"ends_at"?: string,"handed_over_from"?: string | null,"handover_reason"?: string | null,"id"?: string,"slot"?: number | null,"starts_at"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "oncall_shifts_handed_over_from_fkey"
      columns: ["handed_over_from"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "oncall_shifts_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"oncall_swaps": {
                  Row: {
                    "counterpart_id": string,"counterpart_shift_id": string,"created_at": string,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"id": string,"reason": string | null,"requester_id": string,"requester_shift_id": string,"responded_at": string | null,"response_note": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "counterpart_id": string,"counterpart_shift_id": string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"id"?: string,"reason"?: string | null,"requester_id": string,"requester_shift_id": string,"responded_at"?: string | null,"response_note"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "counterpart_id"?: string,"counterpart_shift_id"?: string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"id"?: string,"reason"?: string | null,"requester_id"?: string,"requester_shift_id"?: string,"responded_at"?: string | null,"response_note"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "oncall_swaps_counterpart_id_fkey"
      columns: ["counterpart_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "oncall_swaps_counterpart_shift_id_fkey"
      columns: ["counterpart_shift_id"]
isOneToOne: false
      referencedRelation: "oncall_shifts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "oncall_swaps_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "oncall_swaps_requester_id_fkey"
      columns: ["requester_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "oncall_swaps_requester_shift_id_fkey"
      columns: ["requester_shift_id"]
isOneToOne: false
      referencedRelation: "oncall_shifts"
      referencedColumns: ["id"]
    }
                  ]
                },"organisation_settings": {
                  Row: {
                    "created_at": string,"down_reminder_min": number,"id": string,"problem_reminder_min": number,"response_days": (number)[],"response_end": string,"response_start": string,"singleton": boolean,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"down_reminder_min"?: number,"id"?: string,"problem_reminder_min"?: number,"response_days"?: (number)[],"response_end"?: string,"response_start"?: string,"singleton"?: boolean,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"down_reminder_min"?: number,"id"?: string,"problem_reminder_min"?: number,"response_days"?: (number)[],"response_end"?: string,"response_start"?: string,"singleton"?: boolean,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"page_baselines": {
                  Row: {
                    "accepted_at": string,"accepted_by": string | null,"created_at": string,"fingerprint": NonNullable<Json>,"fingerprint_hash": string | null,"first_set_at": string,"id": string,"monitor_id": string,"reason": string | null,"source_check_id": string | null,"undo_before": Json | null,"undo_by": string | null,"undo_until": string | null,"updated_at": string,"url": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at": string,"accepted_by"?: string | null,"created_at"?: string,"fingerprint": NonNullable<Json>,"fingerprint_hash"?: never,"first_set_at": string,"id"?: string,"monitor_id": string,"reason"?: string | null,"source_check_id"?: string | null,"undo_before"?: Json | null,"undo_by"?: string | null,"undo_until"?: string | null,"updated_at"?: string,"url": string
                  }
                  Update: {
                    "accepted_at"?: string,"accepted_by"?: string | null,"created_at"?: string,"fingerprint"?: NonNullable<Json>,"fingerprint_hash"?: never,"first_set_at"?: string,"id"?: string,"monitor_id"?: string,"reason"?: string | null,"source_check_id"?: string | null,"undo_before"?: Json | null,"undo_by"?: string | null,"undo_until"?: string | null,"updated_at"?: string,"url"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "page_baselines_accepted_by_fkey"
      columns: ["accepted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "page_baselines_monitor_id_fkey"
      columns: ["monitor_id"]
isOneToOne: true
      referencedRelation: "monitors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "page_baselines_source_check_id_fkey"
      columns: ["source_check_id"]
isOneToOne: false
      referencedRelation: "crawler_checks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "page_baselines_undo_by_fkey"
      columns: ["undo_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"probe_locations": {
                  Row: {
                    "code": string,"created_at": string,"is_active": boolean,"last_heartbeat_at": string | null,"provider": string,"region": string,"updated_at": string
                  }
                  ComputedFields: never
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
                  ComputedFields: never
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
                  ComputedFields: never
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
                    "backup_owner_id": string | null,"behind_waf": boolean,"client_id": string,"created_at": string,"credential_ref": string | null,"hosting": string | null,"id": string,"is_active": boolean,"monitoring_started_at": string | null,"mute_reason": string | null,"muted_at": string | null,"muted_until": string | null,"name": string,"notes": string | null,"primary_owner_id": string | null,"tier": number,"updated_at": string,"waf_allowlist_confirmed": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "backup_owner_id"?: string | null,"behind_waf"?: boolean,"client_id": string,"created_at"?: string,"credential_ref"?: string | null,"hosting"?: string | null,"id"?: string,"is_active"?: boolean,"monitoring_started_at"?: string | null,"mute_reason"?: string | null,"muted_at"?: string | null,"muted_until"?: string | null,"name": string,"notes"?: string | null,"primary_owner_id"?: string | null,"tier": number,"updated_at"?: string,"waf_allowlist_confirmed"?: boolean
                  }
                  Update: {
                    "backup_owner_id"?: string | null,"behind_waf"?: boolean,"client_id"?: string,"created_at"?: string,"credential_ref"?: string | null,"hosting"?: string | null,"id"?: string,"is_active"?: boolean,"monitoring_started_at"?: string | null,"mute_reason"?: string | null,"muted_at"?: string | null,"muted_until"?: string | null,"name"?: string,"notes"?: string | null,"primary_owner_id"?: string | null,"tier"?: number,"updated_at"?: string,"waf_allowlist_confirmed"?: boolean
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
                  ComputedFields: never
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
                  ComputedFields: never
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
            "accept_page_baseline":
{ Args: { "p_check_id": string,"p_reason": string }; Returns: string
                           },
"ack_incident":
{ Args: { "p_incident_id": string }; Returns: string
                           },
"add_incident_note":
{ Args: { "p_incident_id": string,"p_text": string }; Returns: string
                           },
"approve_maintenance":
{ Args: { "p_ends_at": string,"p_window_id": string }; Returns: undefined
                           },
"cancel_window":
{ Args: { "p_reason": string,"p_window_id": string }; Returns: undefined
                           },
"claim_notifications":
{ Args: { "p_channel": Database["public"]['Enums']["notification_channel"],"p_incident_id"?: string,"p_limit"?: number,"p_oncall"?: boolean }; Returns: {
              "attempts": number,
"channel": Database["public"]['Enums']["notification_channel"],
"context": NonNullable<Json>,
"created_at": string,
"dedupe_key": string,
"error": string | null,
"hold_until": string | null,
"id": string,
"incident_id": string | null,
"maintenance_window_id": string | null,
"next_retry_at": string | null,
"oncall_event_id": string | null,
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
"confirm_oncall_test":
{ Args: { "p_token": string }; Returns: string
                           },
"crawler_set_baseline":
{ Args: { "p_check_id": string }; Returns: boolean
                           },
"create_maintenance":
{ Args: { "p_ends_at": string,"p_reason": string,"p_site_id": string,"p_starts_at": string }; Returns: string
                           },
"create_site":
{ Args: { "p_monitors": Json,"p_site": Json,"p_start"?: boolean }; Returns: string
                           },
"current_app_role":
{ Args: Record<PropertyKey, never>; Returns: Database["public"]['Enums']["app_role"]
                           },
"decide_oncall_swap":
{ Args: { "p_approve": boolean,"p_note"?: string,"p_swap_id": string }; Returns: undefined
                           },
"decline_maintenance":
{ Args: { "p_reason": string,"p_window_id": string }; Returns: undefined
                           },
"delete_site":
{ Args: { "p_site_id": string }; Returns: undefined
                           },
"edit_window_end":
{ Args: { "p_ends_at": string,"p_reason": string,"p_window_id": string }; Returns: undefined
                           },
"end_window_early":
{ Args: { "p_reason": string,"p_window_id": string }; Returns: undefined
                           },
"engine_cancel_flap_summary":
{ Args: { "p_incident_id": string }; Returns: undefined
                           },
"engine_cancel_held_problem":
{ Args: { "p_incident_id": string,"p_reason": string }; Returns: number
                           },
"engine_cancel_ladder":
{ Args: { "p_incident_id": string,"p_reason": string }; Returns: number
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
"engine_crawler_checks":
{ Args: { "p_since": string }; Returns: {
              "facts": Json,"monitor_id": string
            }[]
                           },
"engine_escalate_incident":
{ Args: { "p_context": Json,"p_detected_at": string,"p_flapping"?: boolean,"p_incident_id": string,"p_monitors"?: Json,"p_notify": boolean,"p_outside_hours"?: boolean,"p_round_at": string,"p_status"?: Database["public"]['Enums']["site_state"] }; Returns: boolean
                           },
"engine_fire_step":
{ Args: { "p_context"?: Json,"p_due_at": string,"p_incident_id": string,"p_level": number }; Returns: boolean
                           },
"engine_l0_people":
{ Args: { "p_incident_id": string }; Returns: {
              "user_id": string
            }[]
                           },
"engine_log_windows":
{ Args: { "p_now": string }; Returns: undefined
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
"engine_oncall_reminders":
{ Args: { "p_now": string }; Returns: number
                           },
"engine_open_incident":
{ Args: { "p_context": Json,"p_detected_at": string,"p_hold_until"?: string,"p_monitor_id": string,"p_monitors"?: Json,"p_notify": boolean,"p_outside_hours"?: boolean,"p_round_at": string,"p_severity": Database["public"]['Enums']["severity"],"p_site_id": string,"p_started_at": string,"p_status"?: Database["public"]['Enums']["site_state"],"p_trigger": Database["public"]['Enums']["incident_trigger"] }; Returns: string
                           },
"engine_page_fingerprints":
{ Args: { "p_now": string,"p_since": string }; Returns: {
              "accepted_at": string,"baseline": Json,"baseline_hash": string,"facts": Json,"first_set_at": string,"monitor_id": string,"pending_until": string
            }[]
                           },
"engine_post_late_alert":
{ Args: { "p_at": string,"p_hold_until"?: string,"p_incident_id": string,"p_outside_hours"?: boolean }; Returns: boolean
                           },
"engine_queue_l0_emails":
{ Args: { "p_context": Json,"p_dedupe": string,"p_hold": string,"p_incident_id": string,"p_only_unemailed": boolean,"p_template": string }; Returns: number
                           },
"engine_queue_window_messages":
{ Args: { "p_actor"?: string,"p_extra"?: Json,"p_hold"?: string,"p_key"?: string,"p_kind": string,"p_window_id": string }; Returns: number
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
{ Args: { "p_context": Json,"p_detected_at": string,"p_flapping": boolean,"p_hold_until"?: string,"p_incident_id": string,"p_monitors"?: Json,"p_notify": boolean,"p_round_at": string,"p_severity": Database["public"]['Enums']["severity"],"p_started_at": string,"p_status"?: Database["public"]['Enums']["site_state"],"p_trigger": Database["public"]['Enums']["incident_trigger"] }; Returns: boolean
                           },
"engine_remind":
{ Args: { "p_context"?: Json,"p_due_at": string,"p_incident_id": string }; Returns: boolean
                           },
"engine_settle_incident":
{ Args: { "p_at": string,"p_from": Database["public"]['Enums']["incident_state"],"p_incident_id": string,"p_monitors"?: Json,"p_round_at": string,"p_status"?: Database["public"]['Enums']["site_state"],"p_to": Database["public"]['Enums']["incident_state"] }; Returns: boolean
                           },
"engine_silent_incidents":
{ Args: { "p_now": string }; Returns: {
              "detected_at": string,"incident_id": string,"severity": Database["public"]['Enums']["severity"],"site_id": string,"tier": number
            }[]
                           },
"engine_thread_live":
{ Args: { "p_incident_id": string }; Returns: boolean
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
"engine_window_reminders":
{ Args: { "p_now": string }; Returns: number
                           },
"engine_write_monitors":
{ Args: { "p_monitors": Json,"p_round_at": string,"p_site_id": string,"p_status": Database["public"]['Enums']["site_state"] }; Returns: undefined
                           },
"escalation_people":
{ Args: { "p_incident_id": string,"p_targets": Json }; Returns: {
              "chat_user_id": string,"token": string,"user_id": string
            }[]
                           },
"escalation_plan_for":
{ Args: { "p_severity": Database["public"]['Enums']["severity"],"p_tier": number }; Returns: Json
                           },
"expire_verification_jobs":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"hand_over_oncall_shift":
{ Args: { "p_at": string,"p_reason": string,"p_shift_id": string,"p_to": string }; Returns: string
                           },
"hook_before_user_created":
{ Args: { "event": Json }; Returns: Json
                           },
"is_staff":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"mute_site":
{ Args: { "p_ends_at": string,"p_reason": string,"p_site_id": string }; Returns: string
                           },
"my_access":
{ Args: Record<PropertyKey, never>; Returns: {
              "display_name": string,"email": string,"id": string,"role": Database["public"]['Enums']["app_role"],"status": string
            }[]
                           },
"oncall_extend_shifts":
{ Args: { "p_until": string }; Returns: number
                           },
"oncall_notes":
{ Args: { "p_shift_id"?: string,"p_swap_id"?: string }; Returns: {
              "decision_note": string,"handover_reason": string,"reason": string,"response_note": string
            }[]
                           },
"oncall_person_at":
{ Args: { "p_at": string }; Returns: string
                           },
"oncall_week_start":
{ Args: { "p_at": string }; Returns: string
                           },
"open_system_alert":
{ Args: { "p_context": Json,"p_kind": string }; Returns: string
                           },
"overview_response_24h":
{ Args: Record<PropertyKey, never>; Returns: {
              "bucket_starts": (string)[],"checks": (number)[],"hard_fails": (number)[],"p50_ms": (number)[],"site_id": string
            }[]
                           },
"owns_site":
{ Args: { "p_site_id": string }; Returns: boolean
                           },
"post_window_action_now":
{ Args: { "p_window_id": string }; Returns: undefined
                           },
"queue_fallback_emails":
{ Args: { "p_notification_id": string }; Returns: number
                           },
"request_oncall_swap":
{ Args: { "p_reason"?: string,"p_shift_id": string,"p_with_shift_id": string }; Returns: string
                           },
"resolve_incident":
{ Args: { "p_accept_check_id"?: string,"p_category": string,"p_fix": string,"p_incident_id": string,"p_what": string }; Returns: string
                           },
"respond_oncall_swap":
{ Args: { "p_accept": boolean,"p_note"?: string,"p_swap_id": string }; Returns: undefined
                           },
"save_escalation_policies":
{ Args: { "p_down_reminder_min": number,"p_note": string,"p_policies": Json,"p_problem_reminder_min": number }; Returns: undefined
                           },
"save_monitors":
{ Args: { "p_removals"?: (string)[],"p_site_id": string,"p_upserts": Json }; Returns: undefined
                           },
"save_oncall_rotation":
{ Args: { "p_note"?: string,"p_user_ids": (string)[] }; Returns: undefined
                           },
"save_root_cause":
{ Args: { "p_category": string,"p_fix": string,"p_incident_id": string,"p_what": string }; Returns: undefined
                           },
"send_oncall_test":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"set_oncall_checklist":
{ Args: { "p_dnd_allowed": boolean,"p_mentions_only": boolean }; Returns: undefined
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
"undo_page_baseline":
{ Args: { "p_monitor_id": string }; Returns: undefined
                           },
"undo_resolve":
{ Args: { "p_incident_id": string }; Returns: undefined
                           },
"undo_window_action":
{ Args: { "p_window_id": string }; Returns: undefined
                           },
"update_site":
{ Args: { "p_site": Json,"p_site_id": string }; Returns: undefined
                           },
"window_state":
{ Args: { "p_at"?: string,"w": Omit<Database["public"]['Tables']["maintenance_windows"]['Row'], Database["public"]['Tables']["maintenance_windows"]['ComputedFields']> }; Returns: string
                           },
"withdraw_oncall_swap":
{ Args: { "p_swap_id": string }; Returns: undefined
                           },
"withdraw_request":
{ Args: { "p_reason": string,"p_window_id": string }; Returns: undefined
                           },
"write_audit":
{ Args: { "p_action": string,"p_after"?: Json,"p_before"?: Json,"p_entity": string,"p_entity_id"?: string }; Returns: string
                           }
          }
          Enums: {
            "app_role": "admin"|"responder"|"stakeholder"|"viewer"|"client","check_outcome": "pass"|"fail"|"blocked","incident_state": "unacked"|"escalated"|"acknowledged"|"monitoring"|"needs_root_cause"|"resolved"|"in_review"|"closed","incident_trigger": "hard_fail"|"blocked_unverified"|"slow"|"keyword"|"key_page"|"ssl"|"domain"|"redirect"|"regional"|"manual"|"tls_chain"|"content_change","monitor_type": "http"|"keyword"|"ssl"|"domain"|"browser","notification_channel": "google_chat"|"email"|"voice","notification_status": "queued"|"sent"|"failed"|"cancelled","rollup_bucket": "hour"|"day","severity": "problem"|"down","site_state": "ok"|"problem"|"down"|"maintenance"
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
            "app_role": ["admin", "responder", "stakeholder", "viewer", "client"],"check_outcome": ["pass", "fail", "blocked"],"incident_state": ["unacked", "escalated", "acknowledged", "monitoring", "needs_root_cause", "resolved", "in_review", "closed"],"incident_trigger": ["hard_fail", "blocked_unverified", "slow", "keyword", "key_page", "ssl", "domain", "redirect", "regional", "manual", "tls_chain", "content_change"],"monitor_type": ["http", "keyword", "ssl", "domain", "browser"],"notification_channel": ["google_chat", "email", "voice"],"notification_status": ["queued", "sent", "failed", "cancelled"],"rollup_bucket": ["hour", "day"],"severity": ["problem", "down"],"site_state": ["ok", "problem", "down", "maintenance"]
          }
        }
} as const
