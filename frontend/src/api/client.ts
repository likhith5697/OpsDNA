import {
  Incident,
  CertAlert,
  JiraTicket,
  DriftIncident,
  AgentStatus,
  HealthSummary,
  Pod,
  UnifiedSummary,
  RemediationProposal,
  ExecuteFixResult,
} from '../types';

const BASE = 'http://localhost:8000';

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

// ── Raw backend response shapes (subset of fields we actually use) ──────────
interface SREAgentResultRaw {
  service: string;
  overall_health: 'CRITICAL' | 'DEGRADED' | 'HEALTHY';
  health_metrics: {
    error_rate_pct: number;
    request_rate_per_min: number;
  };
  detected_incidents: { type: string; severity: string; title: string; sop: string; tier: string }[];
  diagnosis: {
    tier: string | null;
    fix_command: string;
    business_impact: string;
    root_cause: string;
    recommended_fix: string;
    evidence: string;
    confidence: string;
  };
  existing_snow_incidents: { number: string; short_description: string; priority: string; state: string; opened_at: string }[];
}

interface CertAssessmentRaw {
  cert_name: string;
  days_left: number;
  urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  business_impact: string;
  recommended_action: string;
  notify: string;
  expires_at: string;
  ci_name: string;
  owner_team: string;
  sans: string[];
}

interface TicketRiskRaw {
  key: string;
  risk_level: 'HIGH' | 'MEDIUM' | 'LOW';
  reasons: string[];
  recommendation: string;
  causing_live_impact: boolean;
  summary: string;
  status: string;
  days_open: number;
  is_unassigned: boolean;
  is_blocked: boolean;
  open_snow_incidents: { number: string }[];
  error_rate: number;
}

// ── Incidents (mapped from the SRE agent's live SNOW incidents) ─────────────
export const getIncidents = async (): Promise<Incident[]> => {
  const sre = await apiFetch<SREAgentResultRaw>('/agents/sre/results');
  return sre.existing_snow_incidents.map((inc) => ({
    sys_id: inc.number,
    number: inc.number,
    short_description: inc.short_description,
    priority: (inc.priority as Incident['priority']) ?? '3',
    state: inc.state,
    opened_at: inc.opened_at,
    cmdb_ci: sre.service,
    tier: (sre.diagnosis.tier as Incident['tier']) ?? undefined,
    fix_command: sre.diagnosis.fix_command || undefined,
    root_cause: sre.diagnosis.root_cause || undefined,
    recommended_fix: sre.diagnosis.recommended_fix || undefined,
  }));
};

export const getIncident = (id: string) => apiFetch<Incident>(`/incidents/${id}`);

// No backend action exists for these yet -- resolve as a no-op rather than
// hitting a 404 (the UI already shows an optimistic toast on the caller side).
export const approveIncident = async (_id: string): Promise<void> => {};
export const closeIncident = async (_id: string): Promise<void> => {};

// ── Agent status (no live workflow-streaming concept in this backend yet) ───
export const getAgentStatus = async (): Promise<AgentStatus> => ({ status: 'idle' });
export const triggerAgent = (_incidentId: string) => apiFetch<void>('/agents/sre/run', { method: 'POST' });

// ── Health ────────────────────────────────────────────────────────────────────
export const getHealthSummary = async (): Promise<HealthSummary> => {
  const sre = await apiFetch<SREAgentResultRaw>('/agents/sre/results');
  return {
    active_incidents: sre.existing_snow_incidents.length,
    error_rate: sre.health_metrics.error_rate_pct,
    requests_per_min: sre.health_metrics.request_rate_per_min,
    alert_count: sre.detected_incidents.length,
  };
};

interface RawPod {
  name: string;
  phase: string;
  ready: string;
  restarts: number;
  age: string;
  status_reason?: string | null;
}

export const getPods = async (namespace = 'checkout-service'): Promise<Pod[]> => {
  const data = await apiFetch<{ pods: RawPod[] }>(`/agents/sre/pods?namespace=${encodeURIComponent(namespace)}`);
  return data.pods.map((p) => ({
    name: p.name,
    status: p.phase,
    restarts: p.restarts,
    age: p.age,
    ready: p.ready,
    status_reason: p.status_reason,
  }));
};

export const getPodLogs = (_name: string) => Promise.resolve({ lines: [] as string[] });

// ── Tier-1 auto-remediation ───────────────────────────────────────────────────
export const proposeFix = (podName: string, namespace = 'checkout-service') =>
  apiFetch<RemediationProposal>('/agents/sre/propose-fix', {
    method: 'POST',
    body: JSON.stringify({ pod_name: podName, namespace }),
  });

export const executeFix = (actionId: string, approved: boolean) =>
  apiFetch<ExecuteFixResult>('/agents/sre/execute-fix', {
    method: 'POST',
    body: JSON.stringify({ action_id: actionId, approved }),
  });

// ── Certs ────────────────────────────────────────────────────────────────────
export const getCerts = async (): Promise<CertAlert[]> => {
  const cert = await apiFetch<{ expiring_soon: CertAssessmentRaw[] }>('/agents/cert/results');
  return cert.expiring_soon.map((c) => ({
    cert_name: c.cert_name,
    expires_at: c.expires_at,
    days_left: c.days_left,
    urgency: c.urgency,
    ci_name: c.ci_name,
    owner_team: c.owner_team,
    cis_affected: Math.max(c.sans.length, 1),
    llm_analysis: c.recommended_action || undefined,
    business_impact: c.business_impact || undefined,
  }));
};

// ── Jira ─────────────────────────────────────────────────────────────────────
export const getJiraTickets = async (): Promise<JiraTicket[]> => {
  const jira = await apiFetch<{ at_risk_tickets: TicketRiskRaw[] }>('/agents/jira/results');
  return jira.at_risk_tickets.map((t) => ({
    key: t.key,
    title: t.summary,
    status: t.status,
    days_open: t.days_open,
    // The Jira agent doesn't track sprint metadata -- best-effort placeholder.
    days_until_sprint_end: 0,
    is_unassigned: t.is_unassigned,
    is_blocked: t.is_blocked,
    risk_level: t.risk_level,
    reason: t.reasons.join('; '),
    causing_live_impact: t.causing_live_impact,
    live_impact_detail: t.causing_live_impact
      ? `Linked to ${t.open_snow_incidents.length} open SNOW incident(s): ${t.open_snow_incidents.map((i) => i.number).join(', ')}`
      : '',
    recommendation: t.recommendation,
    snow_incidents: t.open_snow_incidents,
    error_rate: t.error_rate,
  }));
};

// ── Drift (no drift-detection agent exists yet -- honestly empty) ───────────
export const getDriftIncidents = async (): Promise<DriftIncident[]> => [];
export const approveDrift = (_id: string) => Promise.resolve();

// ── Orchestrator ("Run Full Analysis") ───────────────────────────────────────
// There's no backend orchestrator endpoint -- this runs all 4 real agents and
// composes a UnifiedSummary client-side from their real results.
export const runOrchestrator = async (): Promise<void> => {
  await Promise.all([
    apiFetch('/agents/jira/run?take_actions=false', { method: 'POST' }),
    apiFetch('/agents/cert/run', { method: 'POST' }),
    apiFetch('/agents/github/run', { method: 'POST' }),
    apiFetch('/agents/sre/run', { method: 'POST' }),
  ]);
};

export const getOrchestratorSummary = async (): Promise<UnifiedSummary> => {
  const [incidents, certAlerts, jiraTickets, sre] = await Promise.all([
    getIncidents(),
    getCerts(),
    getJiraTickets(),
    apiFetch<SREAgentResultRaw>('/agents/sre/results'),
  ]);

  const topPriorities: UnifiedSummary['top_priorities'] = [];
  const highRiskJira = jiraTickets.filter((j) => j.risk_level === 'HIGH');
  const criticalCerts = certAlerts.filter((c) => c.urgency === 'CRITICAL');

  highRiskJira.slice(0, 1).forEach((j) =>
    topPriorities.push({ rank: topPriorities.length + 1, label: `Fix ${j.key}`, severity: 'CRITICAL', action: j.recommendation })
  );
  criticalCerts.slice(0, 1).forEach((c) =>
    topPriorities.push({ rank: topPriorities.length + 1, label: `Renew ${c.cert_name}`, severity: 'HIGH', action: c.llm_analysis ?? 'Renew before expiry' })
  );
  sre.detected_incidents.slice(0, 1).forEach((i) =>
    topPriorities.push({ rank: topPriorities.length + 1, label: i.title, severity: i.severity as any, action: sre.diagnosis.fix_command || 'Investigate root cause' })
  );

  return {
    overall_health: sre.overall_health,
    top_priorities: topPriorities,
    connections: `${incidents.length} active SNOW incidents, ${highRiskJira.length} high-risk Jira ticket(s), ${criticalCerts.length} critical cert(s) on ${sre.service}.`,
    insight: sre.diagnosis.root_cause || 'No active incidents detected from live metrics.',
    incidents,
    cert_alerts: certAlerts,
    jira_tickets: jiraTickets,
    timestamp: new Date().toISOString(),
  };
};

// ── Service Assistant chat (real GPT-4o tool-calling agent) ─────────────────
export const askAgent = (question: string) =>
  apiFetch<{ answer: string; tools_used: string[]; raw_data: Record<string, unknown> }>('/agents/sre/ask', {
    method: 'POST',
    body: JSON.stringify({ question }),
  });
