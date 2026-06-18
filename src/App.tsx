import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ChatPanel } from './components/ChatPanel';
import { IncidentDetail } from './components/IncidentDetail';
import { CertDetail } from './components/CertDetail';
import { JiraDetail } from './components/JiraDetail';
import { DriftDetail } from './components/DriftDetail';
import { UnifiedSummaryPanel } from './components/UnifiedSummary';
import { MetricCards } from './components/MetricCards';
import { LogModal } from './components/LogModal';
import { Toast } from './components/Toast';
import { useWebSocket } from './hooks/useWebSocket';
import { useAgentStatus } from './hooks/useAgentStatus';
import {
  getIncidents,
  getCerts,
  getJiraTickets,
  getDriftIncidents,
  getHealthSummary,
  getOrchestratorSummary,
  runOrchestrator,
  MOCK_INCIDENTS,
  MOCK_CERTS,
  MOCK_JIRA,
  MOCK_DRIFT,
} from './api/client';
import {
  Incident,
  CertAlert,
  JiraTicket,
  DriftIncident,
  SelectedItem,
  ChatMessage,
  UnifiedSummary,
  HealthSummary,
} from './types';

// ── System prompt for the chat assistant ────────────────────────────────────
const SYSTEM_PROMPT = `You are OpsDNA's intelligent service assistant — an expert SRE and DevOps AI embedded in an enterprise operations platform. You have deep knowledge of Kubernetes, distributed systems, incident response, certificate management, and Jira project management.

The platform monitors: checkout-service (CRITICAL — currently DOWN), payment-gateway (HIGH — elevated latency), auth-service (MEDIUM — intermittent 401s). 

Active data:
- INC0010012: checkout-service DOWN, memory leak in v2.3.1, fix: kubectl rollout undo, $1,247.50 business impact
- INC0010009: payment-gateway p99 latency >2000ms, under investigation  
- Cert expiring: api.checkout.prod.example.com in 5 days (40 CIs affected)
- SCRUM-5: Payment validation bug, HIGH risk, causing live impact, sprint ends in 2 days
- Drift: checkout-service ConfigMap modified outside GitOps

Be concise, technical, and action-oriented. Use markdown formatting. When discussing fixes, provide actual kubectl/commands. Reference specific incident numbers, ticket keys, and cert names from the live data above.`;

export default function App() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [certAlerts, setCertAlerts] = useState<CertAlert[]>([]);
  const [jiraTickets, setJiraTickets] = useState<JiraTicket[]>([]);
  const [driftIncidents, setDriftIncidents] = useState<DriftIncident[]>([]);
  const [healthSummary, setHealthSummary] = useState<HealthSummary | null>(null);
  const [unifiedSummary, setUnifiedSummary] = useState<UnifiedSummary | null>(null);
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isAnalysisRunning, setIsAnalysisRunning] = useState(false);
  const [logPod, setLogPod] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const { agentStatus, setAgentStatus } = useAgentStatus();

  // ── Load initial data ────────────────────────────────────────────────────
  useEffect(() => {
    const loadAll = async () => {
      const load = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
        try { return await fn(); } catch { return fallback; }
      };

      const [incs, certs, jira, drift, health] = await Promise.all([
        load(getIncidents, MOCK_INCIDENTS),
        load(getCerts, MOCK_CERTS),
        load(getJiraTickets, MOCK_JIRA),
        load(getDriftIncidents, MOCK_DRIFT),
        load(getHealthSummary, { active_incidents: 2, error_rate: 0, requests_per_min: 847, alert_count: 0 }),
      ]);

      setIncidents(incs);
      setCertAlerts(certs);
      setJiraTickets(jira);
      setDriftIncidents(drift);
      setHealthSummary(health);
    };

    loadAll();

    // Poll health summary every 30s
    const id = setInterval(async () => {
      try {
        const h = await getHealthSummary();
        setHealthSummary(h);
      } catch { /* keep last */ }
    }, 30000);

    return () => clearInterval(id);
  }, []);

  // ── WebSocket ────────────────────────────────────────────────────────────
  const handleWsEvent = useCallback((event: { type: string; payload: any }) => {
    switch (event.type) {
      case 'agent_update':
        setIncidents(prev =>
          prev.map(inc =>
            inc.sys_id === event.payload.incident_id
              ? { ...inc, workflow_events: event.payload.workflow_events, agent_status: event.payload.agent_status }
              : inc
          )
        );
        break;
      case 'agent_done':
        setAgentStatus({ status: 'idle' });
        showToast('Agent investigation complete');
        break;
      case 'drift_detected':
        setDriftIncidents(prev => [event.payload, ...prev]);
        showToast('New drift detected');
        break;
      case 'incident_closed':
        setIncidents(prev => prev.filter(i => i.sys_id !== event.payload.incident_id));
        showToast('Incident closed');
        break;
      case 'new_incident':
        setIncidents(prev => [event.payload, ...prev]);
        showToast('New incident detected');
        break;
      case 'orchestrator_done':
        setUnifiedSummary(event.payload);
        setSelectedItem({ type: 'summary' });
        setIsAnalysisRunning(false);
        showToast('Full analysis complete');
        break;
    }
  }, []);

  useWebSocket('ws://localhost:8080/ws/live', handleWsEvent);

  // ── Chat ─────────────────────────────────────────────────────────────────
  const handleSendMessage = async (content: string) => {
    const userMsg: ChatMessage = {
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };
    setChatMessages(prev => [...prev, userMsg]);
    setIsChatLoading(true);

    try {
      const history = [...chatMessages, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: history,
        }),
      });

      if (!response.ok) throw new Error('API error');
      const data = await response.json();
      const text = data.content?.find((b: any) => b.type === 'text')?.text ?? 'No response.';

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: text,
        timestamp: new Date().toISOString(),
        tools_called: [],
      };
      setChatMessages(prev => [...prev, assistantMsg]);
    } catch {
      // Fallback when API isn't directly accessible from browser
      const fallback = generateFallbackResponse(content);
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: fallback,
        timestamp: new Date().toISOString(),
        tools_called: ['GET_INCIDENTS', 'QUERY_PROMETHEUS'],
      }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // ── Full Analysis ────────────────────────────────────────────────────────
  const handleRunAnalysis = async () => {
    setIsAnalysisRunning(true);
    showToast('Agent started full analysis');

    try {
      await runOrchestrator();
      // Wait for WS event orchestrator_done, or poll
      const poll = async () => {
        try {
          const summary = await getOrchestratorSummary();
          setUnifiedSummary(summary);
          setSelectedItem({ type: 'summary' });
          setIsAnalysisRunning(false);
          showToast('Full analysis complete');
        } catch {
          setTimeout(poll, 2000);
        }
      };
      setTimeout(poll, 3000);
    } catch {
      // Mock summary
      setTimeout(() => {
        setUnifiedSummary(MOCK_SUMMARY);
        setSelectedItem({ type: 'summary' });
        setIsAnalysisRunning(false);
        showToast('Full analysis complete');
      }, 3000);
    }
  };

  const showToast = (msg: string) => setToast(msg);

  // ── Derived ──────────────────────────────────────────────────────────────
  const selectedIncident =
    selectedItem?.type === 'incident'
      ? incidents.find(i => i.sys_id === selectedItem.id) ?? null
      : null;
  const selectedCert =
    selectedItem?.type === 'cert'
      ? certAlerts.find(c => c.cert_name === selectedItem.id) ?? null
      : null;
  const selectedJira =
    selectedItem?.type === 'jira'
      ? jiraTickets.find(j => j.key === selectedItem.id) ?? null
      : null;
  const selectedDrift =
    selectedItem?.type === 'drift'
      ? driftIncidents.find(d => d.sys_id === selectedItem.id) ?? null
      : null;

  const centerTitle = selectedIncident
    ? selectedIncident.number
    : selectedCert
    ? 'Certificate Detail'
    : selectedJira
    ? selectedJira.key
    : selectedDrift
    ? 'Drift Detail'
    : selectedItem?.type === 'summary'
    ? 'Full Analysis'
    : 'Overview';

  return (
    <div className="flex flex-col h-screen bg-[#0D1117] text-[#F9FAFB] overflow-hidden">
      {/* Narrow viewport warning */}
      <div className="hidden max-[1199px]:flex items-center justify-center h-screen text-gray-400 text-sm">
        OpsDNA requires a minimum viewport of 1200px.
      </div>

      <div className="flex flex-col h-screen min-[1200px]:flex hidden-on-small">
        <Header
          agentStatus={agentStatus}
          incidents={incidents}
          certAlerts={certAlerts}
          jiraTickets={jiraTickets}
          driftIncidents={driftIncidents}
          isAnalysisRunning={isAnalysisRunning}
          onRunAnalysis={handleRunAnalysis}
        />

        <div className="flex flex-1 overflow-hidden">
          <Sidebar
            incidents={incidents}
            certAlerts={certAlerts}
            jiraTickets={jiraTickets}
            driftIncidents={driftIncidents}
            selectedItem={selectedItem}
            onSelect={setSelectedItem}
          />

          {/* Center panel */}
          <main className="flex-1 overflow-hidden flex flex-col">
            {selectedItem && (
              <div className="flex items-center gap-2 px-6 py-3 border-b border-[#30363D] bg-[#0D1117]">
                <span className="text-xs text-gray-500">
                  {selectedItem.type === 'incident' && 'Incident'}
                  {selectedItem.type === 'cert' && 'Certificate'}
                  {selectedItem.type === 'jira' && 'Jira Ticket'}
                  {selectedItem.type === 'drift' && 'Drift'}
                  {selectedItem.type === 'summary' && 'Analysis'}
                </span>
                <span className="text-gray-600">/</span>
                <span className="text-sm font-medium text-gray-200">{centerTitle}</span>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="ml-auto text-xs text-gray-600 hover:text-gray-400 transition-colors"
                >
                  ✕ Close
                </button>
              </div>
            )}

            <div className="flex-1 overflow-hidden p-6">
              {!selectedItem && (
                <div className="flex flex-col items-center justify-center h-full gap-8">
                  <div className="text-center">
                    <div className="w-16 h-16 mx-auto mb-4 opacity-30">
                      <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                        <path d="M8 2C8 2 14 6 14 14C14 22 20 26 20 26" stroke="url(#lg1)" strokeWidth="2.5" strokeLinecap="round"/>
                        <path d="M20 2C20 2 14 6 14 14C14 22 8 26 8 26" stroke="url(#lg2)" strokeWidth="2.5" strokeLinecap="round"/>
                        <line x1="9.5" y1="8" x2="18.5" y2="10" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round"/>
                        <line x1="10" y1="14" x2="18" y2="14" stroke="#14B8A6" strokeWidth="1.5" strokeLinecap="round"/>
                        <line x1="9.5" y1="20" x2="18.5" y2="18" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round"/>
                        <defs>
                          <linearGradient id="lg1" x1="8" y1="2" x2="20" y2="26" gradientUnits="userSpaceOnUse">
                            <stop stopColor="#7C3AED"/><stop offset="1" stopColor="#14B8A6"/>
                          </linearGradient>
                          <linearGradient id="lg2" x1="20" y1="2" x2="8" y2="26" gradientUnits="userSpaceOnUse">
                            <stop stopColor="#14B8A6"/><stop offset="1" stopColor="#7C3AED"/>
                          </linearGradient>
                        </defs>
                      </svg>
                    </div>
                    <p className="text-gray-600 text-sm">Select an item to investigate</p>
                  </div>
                  <MetricCards summary={healthSummary} />
                </div>
              )}

              {selectedIncident && (
                <IncidentDetail
                  incident={selectedIncident}
                  onLogOpen={setLogPod}
                  onToast={showToast}
                />
              )}
              {selectedCert && (
                <CertDetail cert={selectedCert} onToast={showToast} />
              )}
              {selectedJira && (
                <JiraDetail ticket={selectedJira} onToast={showToast} />
              )}
              {selectedDrift && (
                <DriftDetail drift={selectedDrift} onToast={showToast} />
              )}
              {selectedItem?.type === 'summary' && unifiedSummary && (
                <UnifiedSummaryPanel
                  summary={unifiedSummary}
                  onClose={() => setSelectedItem(null)}
                />
              )}
            </div>
          </main>

          <ChatPanel
            messages={chatMessages}
            onSendMessage={handleSendMessage}
            onClear={() => setChatMessages([])}
            isLoading={isChatLoading}
          />
        </div>
      </div>

      {logPod && (
        <LogModal podName={logPod} onClose={() => setLogPod(null)} />
      )}

      {toast && (
        <Toast message={toast} onDismiss={() => setToast(null)} />
      )}
    </div>
  );
}

// ── Fallback chat responses ──────────────────────────────────────────────────
function generateFallbackResponse(query: string): string {
  const q = query.toLowerCase();
  if (q.includes('error rate') || q.includes('error')) {
    return '**Current Error Rate: 8.3%**\n\nThe error rate is elevated, traced directly to **SCRUM-5** — a payment validation bug affecting international orders. This is causing failures in `checkout-service`.\n\n```\nGET /api/checkout → 503 (payment validation timeout)\n```\n\n**Recommended action:** Escalate SCRUM-5 to P1 immediately. The bug is causing live revenue impact.';
  }
  if (q.includes('pod') || q.includes('k8s') || q.includes('kubernetes')) {
    return '**Pod Status — checkout-service**\n\n- `checkout-service-7d4f9b-xk2zp` → **CrashLoopBackOff** (14 restarts)\n- `checkout-service-7d4f9b-mn8pq` → Running ✓\n- `checkout-service-7d4f9b-rt5wv` → **OOMKilled** (8 restarts)\n\n2/3 pods are failing due to a memory leak in v2.3.1. Rollback is the recommended fix:\n\n```bash\nkubectl rollout undo deployment/checkout-service -n production\n```';
  }
  if (q.includes('broken') || q.includes('health') || q.includes('status')) {
    return '**System Health Summary**\n\n🔴 **checkout-service** — DOWN (INC0010012)\n🟠 **payment-gateway** — Degraded, high latency\n🟡 **auth-service** — Intermittent 401s\n\n**Root cause connection:** SCRUM-5 payment validation bug is the common thread across all three. Fixing it should resolve the cascade.\n\n**Immediate actions:**\n- Approve kubectl rollout undo for INC0010012\n- Renew api.checkout cert (5 days left)\n- Escalate SCRUM-5 to P1';
  }
  if (q.includes('cert') || q.includes('certificate')) {
    return '**Certificates Expiring**\n\n🔴 `api.checkout.prod.example.com` — **5 days left**\n- Affects 40 CIs in production\n- Owner: Platform Engineering\n- Expiry will cause complete checkout failure\n\n🟠 `internal.auth.sso.example.com` — 11 days left\n- Affects 12 internal tools\n- Owner: Identity & Access\n\n**Action:** Create SNOW ticket for cert renewal immediately. Renewal takes 2–4 hours.';
  }
  if (q.includes('jira') || q.includes('ticket') || q.includes('at-risk')) {
    return '**At-Risk Jira Tickets**\n\n🔴 **SCRUM-5** — HIGH RISK\n- Payment validation bug causing live 8.3% error rate\n- 15 days open, blocked, sprint ends in 2 days\n- Linked to INC0010012 and INC0010009\n- **Action: Escalate to P1 immediately**\n\n🟠 **SCRUM-12** — MEDIUM RISK\n- Redis security patch (CVE-2024-1234)\n- Unassigned, sprint ends in 2 days\n- **Action: Assign now**';
  }
  return '**OpsDNA Analysis**\n\nI\'m connected to your service data. Current system state:\n\n- **2 Critical incidents** active\n- **8.3% error rate** on checkout-service\n- **847 req/min** throughput\n- **1 cert expiring** in 5 days\n\nAsk me about specific incidents, pod status, error rates, certificates, or Jira tickets for detailed analysis.';
}

// ── Mock unified summary ─────────────────────────────────────────────────────
const MOCK_SUMMARY: UnifiedSummary = {
  overall_health: 'CRITICAL',
  top_priorities: [
    { rank: 1, label: 'Fix SCRUM-5 immediately', severity: 'CRITICAL', action: 'Unblock payment validation bug — root cause of live incident. Escalate to P1 now.' },
    { rank: 2, label: 'Renew api.checkout cert this week', severity: 'HIGH', action: 'Certificate expires in 5 days. Renewal takes 2–4 hours. Involves Platform Engineering + DNS validation.' },
    { rank: 3, label: 'Monitor INC0010012 resolution', severity: 'MEDIUM', action: 'Approve kubectl rollout undo to restore checkout-service. Verify error rate drops to 0%.' },
  ],
  connections: 'checkout-service has three connected problems detected simultaneously. Immediate action required.',
  insight: 'These 3 issues share a root cause: the payment validation bug in SCRUM-5 is causing the live error rate in checkout-service (INC0010012). The cert expiry on api.checkout will add a second failure vector by Friday. Fix SCRUM-5 TODAY, then renew the cert.',
  incidents: MOCK_INCIDENTS,
  cert_alerts: MOCK_CERTS,
  jira_tickets: MOCK_JIRA,
  timestamp: new Date().toISOString(),
};
