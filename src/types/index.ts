export interface BusinessImpact {
  formatted: string;
  estimated_revenue_impact: number;
  estimated_orders_lost: number;
  duration_minutes: number;
  impact_type: string;
}

export interface WorkflowEvent {
  node: string;
  status: 'completed' | 'running' | 'waiting' | 'failed';
  output: string;
  timestamp: string;
  tools_used?: string[];
}

export interface Incident {
  sys_id: string;
  number: string;
  short_description: string;
  priority: '1' | '2' | '3' | '4';
  state: string;
  opened_at: string;
  cmdb_ci: string;
  tier?: 'TIER1' | 'TIER1.5' | 'TIER2';
  agent_status?: string;
  fix_command?: string;
  business_impact?: BusinessImpact;
  workflow_events?: WorkflowEvent[];
}

export interface CertAlert {
  cert_name: string;
  expires_at: string;
  days_left: number;
  urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  ci_name: string;
  owner_team: string;
  cis_affected: number;
  llm_analysis?: string;
  business_impact?: string;
}

export interface JiraTicket {
  key: string;
  title: string;
  status: string;
  days_open: number;
  days_until_sprint_end: number;
  is_unassigned: boolean;
  is_blocked: boolean;
  risk_level: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
  causing_live_impact: boolean;
  live_impact_detail: string;
  recommendation: string;
  snow_incidents: any[];
  error_rate: number;
}

export interface DriftIncident {
  sys_id: string;
  drift_type: 'config_changed' | 'replica_drift' | 'image_drift';
  title: string;
  description: string;
  fix_command: string;
  detected_at: string;
  status: 'detected' | 'approved' | 'resolved';
}

export interface Priority {
  rank: number;
  label: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  action: string;
}

export interface UnifiedSummary {
  overall_health: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  top_priorities: Priority[];
  connections: string;
  insight: string;
  incidents: Incident[];
  cert_alerts: CertAlert[];
  jira_tickets: JiraTicket[];
  timestamp: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  tools_called?: string[];
}

export interface AgentStatus {
  status: 'idle' | 'investigating' | 'waiting_approval' | 'executing';
  current_task?: string;
}

export interface HealthSummary {
  active_incidents: number;
  error_rate: number;
  requests_per_min: number;
  alert_count: number;
}

export interface Pod {
  name: string;
  status: string;
  restarts: number;
  age: string;
  ready: string;
}

export type SelectedItem =
  | { type: 'incident'; id: string }
  | { type: 'cert'; id: string }
  | { type: 'jira'; id: string }
  | { type: 'drift'; id: string }
  | { type: 'summary' }
  | null;
