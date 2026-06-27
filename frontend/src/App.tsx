import React, { useState, useEffect } from 'react';
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
import { ResizeHandle } from './components/ResizeHandle';
import { useAgentStatus } from './hooks/useAgentStatus';
import { useResizablePanel } from './hooks/useResizablePanel';
import {
  getIncidents,
  getCerts,
  getJiraTickets,
  getDriftIncidents,
  getHealthSummary,
  getOrchestratorSummary,
  runOrchestrator,
  askAgent,
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

  const { agentStatus } = useAgentStatus();
  const sidebarPanel = useResizablePanel(200, 160, 420, 1);
  const chatPanel = useResizablePanel(380, 280, 600, -1);

  // ── Load initial data (real agent results; empty/unavailable on failure) ──
  useEffect(() => {
    const loadAll = async () => {
      const load = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
        try { return await fn(); } catch { return fallback; }
      };

      const [incs, certs, jira, drift, health] = await Promise.all([
        load(getIncidents, []),
        load(getCerts, []),
        load(getJiraTickets, []),
        load(getDriftIncidents, []),
        load<HealthSummary | null>(getHealthSummary, null),
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

  // ── Chat (real GPT-4o tool-calling agent via /agents/sre/ask) ─────────────
  const handleSendMessage = async (content: string) => {
    const userMsg: ChatMessage = {
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };
    setChatMessages(prev => [...prev, userMsg]);
    setIsChatLoading(true);

    try {
      const { answer, tools_used } = await askAgent(content);
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: answer,
        timestamp: new Date().toISOString(),
        tools_called: tools_used,
      }]);
    } catch {
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: "Sorry, I couldn't reach the agent backend to answer that.",
        timestamp: new Date().toISOString(),
        tools_called: [],
      }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // ── Full Analysis (runs all 4 real agents, then composes a summary) ───────
  const handleRunAnalysis = async () => {
    setIsAnalysisRunning(true);
    showToast('Agent started full analysis');

    try {
      await runOrchestrator();
      const summary = await getOrchestratorSummary();
      setUnifiedSummary(summary);
      setSelectedItem({ type: 'summary' });
      showToast('Full analysis complete');
    } catch {
      showToast('Full analysis failed -- one or more agents unavailable');
    } finally {
      setIsAnalysisRunning(false);
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
            width={sidebarPanel.width}
          />
          <ResizeHandle onMouseDown={sidebarPanel.startDrag} />

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

          <ResizeHandle onMouseDown={chatPanel.startDrag} />
          <ChatPanel
            messages={chatMessages}
            onSendMessage={handleSendMessage}
            onClear={() => setChatMessages([])}
            isLoading={isChatLoading}
            width={chatPanel.width}
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

