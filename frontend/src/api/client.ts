import {
  Incident,
  CertAlert,
  JiraTicket,
  DriftIncident,
  AgentStatus,
  HealthSummary,
  Pod,
  UnifiedSummary,
} from '../types';

const BASE = 'http://localhost:8080';

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

// ── Incidents ────────────────────────────────────────────────────────────────
export const getIncidents = () => apiFetch<Incident[]>('/incidents');
export const getIncident = (id: string) => apiFetch<Incident>(`/incidents/${id}`);
export const approveIncident = (id: string) =>
  apiFetch<void>(`/incidents/${id}/approve`, { method: 'POST' });
export const closeIncident = (id: string) =>
  apiFetch<void>(`/incidents/${id}/close`, { method: 'POST' });

// ── Agent ────────────────────────────────────────────────────────────────────
export const getAgentStatus = () => apiFetch<AgentStatus>('/agent/status');
export const triggerAgent = (incidentId: string) =>
  apiFetch<void>('/agent/trigger', {
    method: 'POST',
    body: JSON.stringify({ incident_id: incidentId }),
  });

// ── Health ───────────────────────────────────────────────────────────────────
export const getHealthSummary = () => apiFetch<HealthSummary>('/health/summary');
export const getPods = () => apiFetch<Pod[]>('/health/pods');
export const getPodLogs = (name: string) =>
  apiFetch<{ lines: string[] }>(`/pods/${name}/logs`);

// ── Certs ────────────────────────────────────────────────────────────────────
export const getCerts = () => apiFetch<CertAlert[]>('/certs/expiring');

// ── Jira ─────────────────────────────────────────────────────────────────────
export const getJiraTickets = () => apiFetch<JiraTicket[]>('/jira/at-risk');

// ── Drift ────────────────────────────────────────────────────────────────────
export const getDriftIncidents = () => apiFetch<DriftIncident[]>('/drift/incidents');
export const approveDrift = (id: string) =>
  apiFetch<void>(`/drift/${id}/approve`, { method: 'POST' });

// ── Orchestrator ─────────────────────────────────────────────────────────────
export const runOrchestrator = () =>
  apiFetch<void>('/orchestrator/run', { method: 'POST' });
export const getOrchestratorSummary = () =>
  apiFetch<UnifiedSummary>('/orchestrator/summary');

// ── Chat (Anthropic proxy via backend) ───────────────────────────────────────
export const sendChatMessage = (messages: { role: string; content: string }[]) =>
  apiFetch<{ content: string; tools_called?: string[] }>('/chat', {
    method: 'POST',
    body: JSON.stringify({ messages }),
  });

// ── Mock data (used when backend is unavailable) ─────────────────────────────
export const MOCK_INCIDENTS: Incident[] = [
  {
    sys_id: 'inc-001',
    number: 'INC0010012',
    short_description: 'checkout-service is DOWN — 503s on all endpoints',
    priority: '1',
    state: 'new',
    opened_at: new Date(Date.now() - 3 * 60 * 60 * 1000 - 27 * 60 * 1000).toISOString(),
    cmdb_ci: 'checkout-service',
    tier: 'TIER1',
    agent_status: 'waiting_approval',
    fix_command: 'kubectl rollout undo deployment/checkout-service -n production',
    business_impact: {
      formatted: '$1,247.50',
      estimated_revenue_impact: 1247.5,
      estimated_orders_lost: 26,
      duration_minutes: 12,
      impact_type: 'revenue',
    },
    workflow_events: [
      { node: 'Detect', status: 'completed', output: 'Incident detected via Prometheus alert', timestamp: '02:14:33' },
      { node: 'Investigate', status: 'completed', output: 'Pulled pod logs, queried KB, found OOMKill pattern', timestamp: '02:14:45', tools_used: ['GET_PODS', 'GET_LOGS', 'QUERY_KB'] },
      { node: 'Diagnose', status: 'completed', output: 'Root cause: memory leak in v2.3.1 introduced 4h ago', timestamp: '02:15:10' },
      { node: 'Recommend', status: 'completed', output: 'Rollback to v2.3.0 — confirmed stable', timestamp: '02:15:22' },
      { node: 'Approve', status: 'waiting', output: '', timestamp: '' },
      { node: 'Execute', status: 'waiting', output: '', timestamp: '' },
      { node: 'Verify', status: 'waiting', output: '', timestamp: '' },
      { node: 'Close', status: 'waiting', output: '', timestamp: '' },
    ],
  },
  {
    sys_id: 'inc-002',
    number: 'INC0010009',
    short_description: 'payment-gateway elevated latency (p99 > 2000ms)',
    priority: '2',
    state: 'in_progress',
    opened_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    cmdb_ci: 'payment-gateway',
    tier: 'TIER2',
    agent_status: 'investigating',
    workflow_events: [
      { node: 'Detect', status: 'completed', output: 'Alert fired: p99 latency threshold exceeded', timestamp: '03:30:12' },
      { node: 'Investigate', status: 'running', output: 'Searching KB for similar patterns...', timestamp: '03:30:25', tools_used: ['QUERY_PROMETHEUS', 'GET_ALERTS'] },
      { node: 'Diagnose', status: 'waiting', output: '', timestamp: '' },
      { node: 'Recommend', status: 'waiting', output: '', timestamp: '' },
      { node: 'Approve', status: 'waiting', output: '', timestamp: '' },
      { node: 'Execute', status: 'waiting', output: '', timestamp: '' },
      { node: 'Verify', status: 'waiting', output: '', timestamp: '' },
      { node: 'Close', status: 'waiting', output: '', timestamp: '' },
    ],
  },
  {
    sys_id: 'inc-003',
    number: 'INC0010001',
    short_description: 'auth-service: intermittent 401 errors for SSO users',
    priority: '3',
    state: 'in_progress',
    opened_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    cmdb_ci: 'auth-service',
    tier: 'TIER2',
    workflow_events: [
      { node: 'Detect', status: 'completed', output: 'Alert detected', timestamp: '01:12:00' },
      { node: 'Investigate', status: 'completed', output: 'Logs reviewed', timestamp: '01:12:30' },
      { node: 'Diagnose', status: 'waiting', output: '', timestamp: '' },
      { node: 'Recommend', status: 'waiting', output: '', timestamp: '' },
      { node: 'Approve', status: 'waiting', output: '', timestamp: '' },
      { node: 'Execute', status: 'waiting', output: '', timestamp: '' },
      { node: 'Verify', status: 'waiting', output: '', timestamp: '' },
      { node: 'Close', status: 'waiting', output: '', timestamp: '' },
    ],
  },
];

export const MOCK_CERTS: CertAlert[] = [
  {
    cert_name: 'api.checkout.prod.example.com',
    expires_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    days_left: 5,
    urgency: 'CRITICAL',
    ci_name: 'checkout-service',
    owner_team: 'Platform Engineering',
    cis_affected: 40,
    llm_analysis: 'This certificate secures all payment API traffic. Expiry will cause immediate 503 errors for all checkout flows, blocking revenue. Renewal requires coordination with the Platform team and DNS validation — typically a 2–4 hour process.',
    business_impact: 'Complete checkout failure affecting ~$300k/day in transactions if not renewed within 5 days.',
  },
  {
    cert_name: 'internal.auth.sso.example.com',
    expires_at: new Date(Date.now() + 11 * 24 * 60 * 60 * 1000).toISOString(),
    days_left: 11,
    urgency: 'HIGH',
    ci_name: 'auth-service',
    owner_team: 'Identity & Access',
    cis_affected: 12,
    llm_analysis: 'SSO certificate for internal services. Expiry will break employee authentication across 12 internal tools. Medium urgency but renewal should begin now to avoid weekend risk.',
    business_impact: 'Employee productivity impact — all SSO-dependent tools become inaccessible.',
  },
];

export const MOCK_JIRA: JiraTicket[] = [
  {
    key: 'SCRUM-5',
    title: 'Payment validation bug causes incorrect tax calculation on international orders',
    status: 'In Progress',
    days_open: 15,
    days_until_sprint_end: 2,
    is_unassigned: false,
    is_blocked: true,
    risk_level: 'HIGH',
    reason: 'Ticket is blocked on external dependency, sprint ends in 2 days, and is actively causing live errors in checkout-service (8.3% error rate traced to this validation path).',
    causing_live_impact: true,
    live_impact_detail: 'Directly linked to INC0010012 — payment validation errors causing 503s in checkout-service',
    recommendation: 'Escalate to team lead immediately. Unblock dependency or implement temporary bypass. This is the root cause of the live incident.',
    snow_incidents: [{ number: 'INC0010012' }, { number: 'INC0010009' }],
    error_rate: 8.3,
  },
  {
    key: 'SCRUM-12',
    title: 'Upgrade Redis client library to v4.x — security patch required',
    status: 'Open',
    days_open: 8,
    days_until_sprint_end: 2,
    is_unassigned: true,
    is_blocked: false,
    risk_level: 'MEDIUM',
    reason: 'Unassigned security ticket with sprint deadline in 2 days. CVE-2024-1234 affects current Redis client version in production.',
    causing_live_impact: false,
    live_impact_detail: '',
    recommendation: 'Assign immediately. Security patch should not slip past sprint.',
    snow_incidents: [],
    error_rate: 0,
  },
];

export const MOCK_DRIFT: DriftIncident[] = [
  {
    sys_id: 'drift-001',
    drift_type: 'config_changed',
    title: 'checkout-service ConfigMap modified outside GitOps',
    description: 'checkout-service-config was modified directly via kubectl. PAYMENT_TIMEOUT changed from 5000ms to 30000ms. This change bypassed the GitOps pipeline and is not reflected in the Git repository.',
    fix_command: 'kubectl apply -f gitops/checkout-service/configmap.yaml --namespace=production',
    detected_at: new Date(Date.now() - 23 * 60 * 1000).toISOString(),
    status: 'detected',
  },
];
