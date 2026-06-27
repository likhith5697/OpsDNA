import React, { useState, useEffect } from 'react';
import { Play, User, X, Check, Copy, ExternalLink, Terminal } from 'lucide-react';
import { Incident, Pod } from '../types';
import { AgentTimeline } from './AgentTimeline';
import { RemediationCard } from './RemediationCard';
import { getPods, triggerAgent, approveIncident, closeIncident } from '../api/client';
import { formatDistanceToNow } from '../utils/time';

interface IncidentDetailProps {
  incident: Incident;
  onLogOpen: (podName: string) => void;
  onToast: (msg: string) => void;
}

const PRIORITY_LABELS: Record<string, { label: string; cls: string }> = {
  '1': { label: 'CRITICAL', cls: 'bg-red-500/20 text-red-400 border-red-500/40' },
  '2': { label: 'HIGH', cls: 'bg-amber-500/20 text-amber-400 border-amber-500/40' },
  '3': { label: 'MEDIUM', cls: 'bg-blue-500/20 text-blue-400 border-blue-500/40' },
  '4': { label: 'LOW', cls: 'bg-gray-500/20 text-gray-400 border-gray-500/40' },
};

const TIER_BADGE: Record<string, string> = {
  TIER1: 'bg-green-500/20 text-green-400 border-green-500/40',
  'TIER1.5': 'bg-teal-500/20 text-teal-400 border-teal-500/40',
  TIER2: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
};

export const IncidentDetail: React.FC<IncidentDetailProps> = ({ incident, onLogOpen, onToast }) => {
  const [pods, setPods] = useState<Pod[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getPods()
      .then(setPods)
      .catch(() => setPods([]));
  }, [incident.cmdb_ci]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleRunAgent = async () => {
    try {
      await triggerAgent(incident.sys_id);
      onToast('Agent started investigation');
    } catch {
      onToast('Agent started investigation (mock)');
    }
  };

  const handleApprove = async () => {
    try {
      await approveIncident(incident.sys_id);
      onToast('Fix approved — executing');
    } catch {
      onToast('Fix approved — executing (mock)');
    }
  };

  const handleClose = async () => {
    try {
      await closeIncident(incident.sys_id);
      onToast('Incident closed');
    } catch {
      onToast('Incident closed (mock)');
    }
  };

  const pBadge = PRIORITY_LABELS[incident.priority];
  const isPending = incident.agent_status === 'waiting_approval';

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-20">
      {/* Header card */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-xs font-bold px-2 py-1 rounded border ${pBadge.cls}`}>{pBadge.label}</span>
          <span className="text-xs bg-[#1C2128] text-gray-400 border border-[#30363D] px-2 py-1 rounded">
            {incident.state?.toUpperCase().replace('_', ' ')}
          </span>
          {incident.tier && (
            <span className={`text-xs font-bold px-2 py-1 rounded border ${TIER_BADGE[incident.tier]}`}>
              {incident.tier}
            </span>
          )}
          <span className="text-xs text-gray-500 ml-1">AUTO</span>
        </div>

        <h1 className="text-xl font-semibold text-gray-100 mb-3">{incident.short_description}</h1>

        <div className="flex items-center gap-3 text-sm text-gray-400 mb-4">
          <span className="font-mono text-blue-400">{incident.number}</span>
          <span>·</span>
          <span>{incident.cmdb_ci}</span>
          <span>·</span>
          <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">prod</span>
          <span>·</span>
          <span>Opened {formatDistanceToNow(incident.opened_at)} ago · Still open</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleRunAgent}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded-lg transition-colors"
          >
            <Play size={13} /> Run Agent
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1C2128] hover:bg-[#21262D] border border-[#30363D] text-gray-300 text-sm rounded-lg transition-colors">
            <User size={13} /> Assign
          </button>
          <button
            onClick={handleClose}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1C2128] hover:bg-[#21262D] border border-[#30363D] text-gray-300 text-sm rounded-lg transition-colors"
          >
            <Check size={13} /> Close
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1C2128] hover:bg-[#21262D] border border-[#30363D] text-gray-300 text-sm rounded-lg transition-colors">
            <ExternalLink size={13} /> Open in SNOW
          </button>
        </div>
      </div>

      {/* Business Impact */}
      {incident.business_impact && (
        <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-amber-400 text-sm font-semibold">💰 Business Impact</span>
          </div>
          <p className="text-2xl font-bold text-amber-300 mb-1">{incident.business_impact.formatted}</p>
          <p className="text-sm text-amber-400/70">
            ~{incident.business_impact.estimated_orders_lost} orders affected over {incident.business_impact.duration_minutes} min
          </p>
        </div>
      )}

      {/* Status grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {[
          { label: 'Priority', value: `P${incident.priority} — ${pBadge.label}` },
          { label: 'State', value: incident.state?.replace('_', ' ').toUpperCase() },
          { label: 'Service', value: incident.cmdb_ci },
          { label: 'Agent Status', value: incident.agent_status ?? 'Not started' },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[#161B22] border border-[#30363D] rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className="text-sm text-gray-200 font-medium">{value}</p>
          </div>
        ))}
      </div>

      {/* Description */}
      <div className="bg-[#0D1117] border border-[#30363D] rounded-xl p-4 mb-4 font-mono text-sm text-gray-300 leading-relaxed">
        <p className="text-xs text-gray-500 mb-2 font-sans">Description</p>
        Service {incident.cmdb_ci} is returning HTTP 503 on all endpoints. Monitoring detected the issue via Prometheus alert 'HighErrorRate'. Initial investigation shows repeated OOMKill events on 2/3 pods. The issue began following a deployment of v2.3.1 approximately 3 hours ago.
      </div>

      {/* Related Pods */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-[#30363D]">
          <h3 className="text-sm font-semibold text-gray-300">Related Pods</h3>
        </div>
        <p style={{ color: 'magenta', fontSize: '14px', padding: '8px', background: 'yellow' }}>
          DEBUG2: {pods.length} pods, matching={pods.filter(p => p.status_reason).length}, reasons={JSON.stringify(pods.map(p => p.status_reason))}
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#30363D]">
              {['Pod Name', 'Status', 'Restarts', 'Ready', 'Age'].map(h => (
                <th key={h} className="text-left text-gray-500 font-medium px-4 py-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pods.map(pod => (
              <tr key={pod.name} className="border-b border-[#30363D]/50 hover:bg-[#1C2128] transition-colors">
                <td className="px-4 py-2.5">
                  <button
                    onClick={() => onLogOpen(pod.name)}
                    className="font-mono text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                  >
                    {pod.name} <Terminal size={10} />
                  </button>
                </td>
                <td className="px-4 py-2.5">
                  {/* status_reason (container waiting/terminated reason) is the real signal --
                      Kubernetes reports phase as "Running" even mid-crash-loop. */}
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    !pod.status_reason && pod.status === 'Running'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}>
                    {pod.status_reason || pod.status}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <span className={pod.restarts > 5 ? 'text-red-400' : pod.restarts > 0 ? 'text-amber-400' : 'text-gray-400'}>
                    {pod.restarts}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-400 font-mono">{pod.ready}</td>
                <td className="px-4 py-2.5 text-gray-500">{pod.age}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <button style={{ background: 'lime', color: 'black', padding: '10px', margin: '8px', fontSize: '16px' }}>
          TEST BUTTON SHOULD APPEAR UNCONDITIONALLY
        </button>

        {pods.filter(p => p.status_reason).length > 0 && (
          <div className="border-t border-[#30363D] p-3 space-y-3">
            {pods.filter(p => p.status_reason).map(pod => (
              <div key={pod.name}>
                <p className="text-[10px] font-mono text-gray-500 mb-1">{pod.name}</p>
                <RemediationCard podName={pod.name} namespace="checkout-service" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Agent Analysis */}
      {incident.fix_command && (
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Agent Analysis</h3>
          <div className="space-y-2 text-sm text-gray-300">
            <div>
              <span className="text-gray-500 text-xs">Root Cause</span>
              <p className="mt-0.5">{incident.root_cause || 'No root cause identified yet -- run the SRE agent for live analysis.'}</p>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Diagnosis</span>
              <p className="mt-0.5">{incident.recommended_fix || 'No diagnosis available yet.'}</p>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Fix Command</span>
              <div className="mt-1 bg-[#0D1117] border border-[#30363D] rounded-lg p-3 font-mono text-xs text-green-300 flex items-start justify-between gap-2">
                <span className="break-all">{incident.fix_command}</span>
                <button
                  onClick={() => handleCopy(incident.fix_command!)}
                  className="flex-shrink-0 text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Agent Timeline */}
      {incident.workflow_events && incident.workflow_events.length > 0 && (
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Agent Timeline</h3>
          <AgentTimeline events={incident.workflow_events} />
        </div>
      )}

      {/* Sticky approval bar */}
      {isPending && incident.fix_command && (
        <div className="sticky bottom-0 -mx-6 bg-[#161B22] border-t border-amber-500/40 px-6 py-3 flex items-center justify-between z-20">
          <div>
            <p className="text-xs text-amber-400 font-semibold mb-0.5">⚠ Agent recommends:</p>
            <code className="text-xs text-gray-300 font-mono">{incident.fix_command}</code>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleApprove}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm rounded-lg transition-colors font-medium"
            >
              <Check size={14} /> Approve
            </button>
            <button className="flex items-center gap-1.5 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/40 text-red-400 text-sm rounded-lg transition-colors">
              <X size={14} /> Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
