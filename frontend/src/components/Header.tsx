import React, { useState, useEffect } from 'react';
import { Zap, AlertTriangle, Key, AlertCircle, Play, Loader2 } from 'lucide-react';
import { AgentStatus, Incident, CertAlert, JiraTicket, DriftIncident } from '../types';

interface HeaderProps {
  agentStatus: AgentStatus;
  incidents: Incident[];
  certAlerts: CertAlert[];
  jiraTickets: JiraTicket[];
  driftIncidents: DriftIncident[];
  isAnalysisRunning: boolean;
  onRunAnalysis: () => void;
}

const DNAIcon = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 2C8 2 14 6 14 14C14 22 20 26 20 26" stroke="url(#dna1)" strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M20 2C20 2 14 6 14 14C14 22 8 26 8 26" stroke="url(#dna2)" strokeWidth="2.5" strokeLinecap="round"/>
    <line x1="9.5" y1="8" x2="18.5" y2="10" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" opacity="0.7"/>
    <line x1="10" y1="14" x2="18" y2="14" stroke="#14B8A6" strokeWidth="1.5" strokeLinecap="round" opacity="0.7"/>
    <line x1="9.5" y1="20" x2="18.5" y2="18" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" opacity="0.7"/>
    <defs>
      <linearGradient id="dna1" x1="8" y1="2" x2="20" y2="26" gradientUnits="userSpaceOnUse">
        <stop stopColor="#7C3AED"/>
        <stop offset="1" stopColor="#14B8A6"/>
      </linearGradient>
      <linearGradient id="dna2" x1="20" y1="2" x2="8" y2="26" gradientUnits="userSpaceOnUse">
        <stop stopColor="#14B8A6"/>
        <stop offset="1" stopColor="#7C3AED"/>
      </linearGradient>
    </defs>
  </svg>
);

const AgentStatusPill = ({ status }: { status: AgentStatus }) => {
  const configs = {
    idle: { dot: 'bg-green-400', pulse: 'animate-pulse', label: 'Agent: idle', border: 'border-green-500/30' },
    investigating: { dot: 'bg-amber-400', pulse: 'animate-pulse', label: 'Agent: investigating', border: 'border-amber-500/30' },
    waiting_approval: { dot: 'bg-purple-400', pulse: 'animate-pulse', label: 'Agent: waiting approval', border: 'border-purple-500/30' },
    executing: { dot: 'bg-blue-400', pulse: 'animate-pulse', label: 'Agent: executing', border: 'border-blue-500/30' },
  };
  const cfg = configs[status.status];
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${cfg.border} bg-[#161B22]`}>
      <span className={`w-2 h-2 rounded-full ${cfg.dot} ${cfg.pulse}`} />
      <span className="text-xs text-gray-300 font-medium">{cfg.label}</span>
    </div>
  );
};

export const Header: React.FC<HeaderProps> = ({
  agentStatus,
  incidents,
  certAlerts,
  jiraTickets,
  driftIncidents,
  isAnalysisRunning,
  onRunAnalysis,
}) => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const critical = incidents.filter(i => i.priority === '1').length;
  const high = incidents.filter(i => i.priority === '2').length;
  const low = incidents.filter(i => i.priority === '4').length;
  const pending = incidents.filter(i => i.agent_status === 'waiting_approval').length;
  const certCount = certAlerts.length;
  const jiraRisk = jiraTickets.filter(j => j.risk_level === 'HIGH').length;

  return (
    <header className="flex items-center justify-between px-5 h-14 border-b border-[#30363D] bg-[#0D1117] flex-shrink-0 z-10">
      {/* Left: Logo */}
      <div className="flex items-center gap-2.5">
        <DNAIcon />
        <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-purple-400 to-teal-400 bg-clip-text text-transparent">
          OpsDNA
        </span>
      </div>

      {/* Center: Live stat pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {critical > 0 && (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            {critical} Critical
          </span>
        )}
        {high > 0 && (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-medium">
            <AlertTriangle size={10} />
            {high} High
          </span>
        )}
        {low > 0 && (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-medium">
            <AlertCircle size={10} />
            {low} Low
          </span>
        )}
        {pending > 0 && (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-400 text-xs font-medium">
            <AlertTriangle size={10} />
            {pending} Pending Approval
          </span>
        )}
        {driftIncidents.length > 0 && (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs font-medium">
            <Zap size={10} />
            {driftIncidents.length} Drift Detected
          </span>
        )}
        {certCount > 0 && (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-medium">
            <Key size={10} />
            {certCount} Cert Expiring
          </span>
        )}
        {jiraRisk > 0 && (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-medium">
            <AlertTriangle size={10} />
            {jiraRisk} Jira At-Risk
          </span>
        )}
      </div>

      {/* Right: Agent status + button + clock */}
      <div className="flex items-center gap-3">
        <AgentStatusPill status={agentStatus} />
        <button
          onClick={onRunAnalysis}
          disabled={isAnalysisRunning}
          className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          {isAnalysisRunning ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Play size={14} />
          )}
          Run Full Analysis
        </button>
        <span className="text-xs text-gray-500 font-mono tabular-nums w-16 text-right">
          {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </div>
    </header>
  );
};
