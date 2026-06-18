import React from 'react';
import { JiraTicket } from '../types';

interface JiraDetailProps {
  ticket: JiraTicket;
  onToast: (msg: string) => void;
}

export const JiraDetail: React.FC<JiraDetailProps> = ({ ticket, onToast }) => {
  return (
    <div className="overflow-y-auto h-full pb-6">
      {/* Header */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-mono text-blue-400 text-sm font-bold">{ticket.key}</span>
          <span className="text-xs bg-[#1C2128] border border-[#30363D] text-gray-400 px-2 py-0.5 rounded">
            Sprint ends in {ticket.days_until_sprint_end}d
          </span>
          {ticket.causing_live_impact && (
            <span className="text-xs bg-red-500/20 text-red-400 border border-red-500/40 px-2 py-0.5 rounded font-bold">
              LIVE IMPACT
            </span>
          )}
        </div>
        <h1 className="text-xl font-semibold text-gray-100">{ticket.title}</h1>
      </div>

      {/* Risk assessment */}
      <div className={`border rounded-xl p-4 mb-4 ${
        ticket.risk_level === 'HIGH'
          ? 'bg-red-500/5 border-red-500/30'
          : 'bg-amber-500/5 border-amber-500/30'
      }`}>
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-xs font-bold px-2 py-1 rounded border ${
            ticket.risk_level === 'HIGH'
              ? 'bg-red-500/20 text-red-400 border-red-500/40'
              : 'bg-amber-500/20 text-amber-400 border-amber-500/40'
          }`}>
            RISK: {ticket.risk_level}
          </span>
        </div>
        <p className="text-sm text-gray-300 leading-relaxed">{ticket.reason}</p>
      </div>

      {/* Cross-system evidence */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 mb-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Cross-System Evidence</h3>
        <div className="space-y-2 font-mono text-sm">
          <div className="flex gap-2">
            <span className="text-gray-600">├──</span>
            <span className="text-blue-400 w-16 flex-shrink-0">Jira:</span>
            <span className="text-gray-300">
              {ticket.days_open} days open
              {ticket.is_unassigned ? ', unassigned' : ''}
              {ticket.is_blocked ? ', blocked' : ''}
            </span>
          </div>
          {ticket.snow_incidents.length > 0 && (
            <div className="flex gap-2">
              <span className="text-gray-600">├──</span>
              <span className="text-purple-400 w-16 flex-shrink-0">SNOW:</span>
              <span className="text-gray-300">
                {ticket.snow_incidents.length} open incidents ({ticket.snow_incidents.map((i: any) => i.number).join(', ')})
              </span>
            </div>
          )}
          <div className="flex gap-2">
            <span className="text-gray-600">├──</span>
            <span className="text-teal-400 w-16 flex-shrink-0">K8s:</span>
            <span className="text-gray-300">3/3 pods running, 0 restarts</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-600">└──</span>
            <span className="text-amber-400 w-16 flex-shrink-0">Prom:</span>
            <span className={ticket.error_rate > 5 ? 'text-red-400' : 'text-gray-300'}>
              {ticket.error_rate}% error rate
            </span>
          </div>
        </div>
      </div>

      {/* Recommendation */}
      <div className="bg-purple-500/5 border border-purple-500/30 rounded-xl p-4 mb-4">
        <p className="text-xs text-purple-400 font-semibold mb-2">✦ Recommendation</p>
        <p className="text-sm text-gray-300 font-medium">"{ticket.recommendation}"</p>
      </div>

      {/* Live impact detail */}
      {ticket.causing_live_impact && ticket.live_impact_detail && (
        <div className="bg-red-500/5 border border-red-500/30 rounded-xl p-4 mb-4">
          <p className="text-xs text-red-400 font-semibold mb-2">⚠ Live Impact</p>
          <p className="text-sm text-red-300/80">{ticket.live_impact_detail}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => onToast(`${ticket.key} bumped to P1`)}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg transition-colors font-medium"
        >
          Bump to P1
        </button>
        <button
          onClick={() => onToast('SNOW incident linked')}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors font-medium"
        >
          Link SNOW Incident
        </button>
        <button
          onClick={() => onToast('Ticket assigned')}
          className="flex items-center gap-2 px-4 py-2 bg-[#1C2128] hover:bg-[#21262D] border border-[#30363D] text-gray-300 text-sm rounded-lg transition-colors"
        >
          Assign
        </button>
      </div>
    </div>
  );
};
