import React from 'react';
import { UnifiedSummary } from '../types';
import { X } from 'lucide-react';

interface UnifiedSummaryPanelProps {
  summary: UnifiedSummary;
  onClose: () => void;
}

const HEALTH_CONFIG = {
  CRITICAL: { label: 'CRITICAL', cls: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30', dot: '🔴' },
  DEGRADED: { label: 'DEGRADED', cls: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30', dot: '🟠' },
  HEALTHY: { label: 'HEALTHY', cls: 'text-green-400', bg: 'bg-green-500/10 border-green-500/30', dot: '🟢' },
};

const PRIORITY_ICONS: Record<string, string> = {
  CRITICAL: '🔴',
  HIGH: '🟠',
  MEDIUM: '🟡',
  LOW: '🟢',
};

export const UnifiedSummaryPanel: React.FC<UnifiedSummaryPanelProps> = ({ summary, onClose }) => {
  const health = HEALTH_CONFIG[summary.overall_health];

  return (
    <div className="overflow-y-auto h-full pb-6">
      {/* Main status banner */}
      <div className={`border rounded-xl p-5 mb-5 ${health.bg}`}>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">{health.dot}</span>
              <span className={`text-lg font-bold ${health.cls}`}>{health.label}</span>
              <span className="text-gray-400">—</span>
              <span className="text-gray-300 font-medium">{summary.top_priorities.length} Converging Issues</span>
            </div>
            <p className="text-gray-300 leading-relaxed max-w-2xl">{summary.connections}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors mt-1"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Evidence cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {summary.incidents.slice(0, 1).map(inc => (
          <div key={inc.sys_id} className="bg-[#161B22] border border-red-500/30 rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-red-400 text-xs font-bold">🔴 INCIDENT</span>
            </div>
            <p className="font-mono text-blue-400 text-xs mb-1">{inc.number}</p>
            <p className="text-sm text-gray-200 font-medium line-clamp-2 mb-2">{inc.short_description}</p>
            <p className="text-xs text-gray-500">{inc.cmdb_ci} · {inc.state}</p>
          </div>
        ))}
        {summary.cert_alerts.slice(0, 1).map(cert => (
          <div key={cert.cert_name} className="bg-[#161B22] border border-amber-500/30 rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-amber-400 text-xs font-bold">🔑 CERT</span>
            </div>
            <p className="font-mono text-amber-300 text-xs mb-1 truncate">{cert.cert_name}</p>
            <p className="text-sm text-gray-200 font-medium mb-1">
              <span className="text-red-400">{cert.days_left} days left</span>
            </p>
            <p className="text-xs text-gray-500">{cert.cis_affected} CIs · {cert.owner_team}</p>
          </div>
        ))}
        {summary.jira_tickets.slice(0, 1).map(ticket => (
          <div key={ticket.key} className="bg-[#161B22] border border-blue-500/30 rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-amber-400 text-xs font-bold">⚠ JIRA</span>
            </div>
            <p className="font-mono text-blue-400 text-xs mb-1">{ticket.key}</p>
            <p className="text-sm text-gray-200 font-medium line-clamp-2 mb-1">{ticket.days_open} days open, {ticket.is_unassigned ? 'unassigned' : 'assigned'}</p>
            <p className="text-xs text-gray-500">{ticket.status} · Sprint ends in {ticket.days_until_sprint_end}d</p>
          </div>
        ))}
      </div>

      {/* Connection insight */}
      <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-5 mb-5">
        <p className="text-xs text-amber-400 font-semibold mb-2">⚡ Root Cause Connection</p>
        <p className="text-gray-200 leading-relaxed">{summary.insight}</p>
      </div>

      {/* Priority action list */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Priority Actions</h3>
        <div className="space-y-2">
          {summary.top_priorities.map((p, i) => (
            <div key={i} className="flex items-start gap-3 py-2 border-b border-[#30363D]/50 last:border-0">
              <span className="text-gray-500 text-sm font-mono w-4 flex-shrink-0">{i + 1}.</span>
              <span className="text-base">{PRIORITY_ICONS[p.severity]}</span>
              <div>
                <p className="text-sm text-gray-200 font-medium">{p.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{p.action}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-gray-600 text-center mt-4">
        Analysis generated at {new Date(summary.timestamp).toLocaleString()}
      </p>
    </div>
  );
};
