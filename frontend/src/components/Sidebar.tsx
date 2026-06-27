import React, { useState } from 'react';
import { AlertTriangle, Key, Zap } from 'lucide-react';
import { Incident, CertAlert, JiraTicket, DriftIncident, SelectedItem } from '../types';
import { formatDistanceToNow } from '../utils/time';

interface SidebarProps {
  incidents: Incident[];
  certAlerts: CertAlert[];
  jiraTickets: JiraTicket[];
  driftIncidents: DriftIncident[];
  selectedItem: SelectedItem;
  onSelect: (item: SelectedItem) => void;
  width: number;
}

const PRIORITY_COLORS: Record<string, string> = {
  '1': 'border-red-500',
  '2': 'border-amber-500',
  '3': 'border-blue-500',
  '4': 'border-gray-500',
};

const PRIORITY_BADGE: Record<string, { label: string; cls: string }> = {
  '1': { label: 'CRITICAL', cls: 'bg-red-500/20 text-red-400 border-red-500/40' },
  '2': { label: 'HIGH', cls: 'bg-amber-500/20 text-amber-400 border-amber-500/40' },
  '3': { label: 'MEDIUM', cls: 'bg-blue-500/20 text-blue-400 border-blue-500/40' },
  '4': { label: 'LOW', cls: 'bg-gray-500/20 text-gray-400 border-gray-500/40' },
};

const FILTER_TABS = ['All', 'Active', 'Pending', 'Resolved'];

function isSelected(selected: SelectedItem, type: string, id: string): boolean {
  if (!selected) return false;
  if (selected.type === 'summary') return false;
  return selected.type === type && selected.id === id;
}

export const Sidebar: React.FC<SidebarProps> = ({
  incidents,
  certAlerts,
  jiraTickets,
  driftIncidents,
  selectedItem,
  onSelect,
  width,
}) => {
  const [incidentFilter, setIncidentFilter] = useState('All');

  const filteredIncidents = incidents.filter(inc => {
    if (incidentFilter === 'All') return true;
    if (incidentFilter === 'Active') return inc.state !== 'resolved' && inc.state !== 'closed';
    if (incidentFilter === 'Pending') return inc.agent_status === 'waiting_approval';
    if (incidentFilter === 'Resolved') return inc.state === 'resolved' || inc.state === 'closed';
    return true;
  });

  return (
    <aside
      style={{ width }}
      className="flex-shrink-0 overflow-y-auto border-r border-[#30363D] bg-[#0D1117] flex flex-col"
    >
      {/* ── Incidents ── */}
      <section>
        <div className="flex items-center justify-between px-3 pt-4 pb-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Incidents</span>
          <span className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded-full font-medium">
            {incidents.length}
          </span>
        </div>

        {/* Filter tabs */}
        <div className="flex mx-2 mb-2 bg-[#161B22] rounded-md p-0.5">
          {FILTER_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setIncidentFilter(tab)}
              className={`flex-1 text-[9px] py-1 rounded font-medium transition-colors ${
                incidentFilter === tab
                  ? 'bg-[#30363D] text-gray-200'
                  : 'text-gray-500 hover:text-gray-400'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1 px-2 pb-3">
          {filteredIncidents.map(inc => {
            const sel = isSelected(selectedItem, 'incident', inc.sys_id);
            const badge = PRIORITY_BADGE[inc.priority];
            return (
              <button
                key={inc.sys_id}
                onClick={() => onSelect({ type: 'incident', id: inc.sys_id })}
                className={`w-full text-left rounded-md border-l-2 px-2 py-2 transition-colors ${
                  PRIORITY_COLORS[inc.priority]
                } ${
                  sel
                    ? 'bg-purple-500/10 border-l-purple-500'
                    : 'bg-[#161B22] hover:bg-[#1C2128]'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>
                <p className="text-xs text-gray-200 leading-tight line-clamp-2 mb-1">
                  {inc.short_description}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full truncate max-w-[90px]">
                    {inc.cmdb_ci}
                  </span>
                  <span className="text-[9px] text-gray-500 ml-1 flex-shrink-0">
                    {formatDistanceToNow(inc.opened_at)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <div className="border-t border-[#30363D] mx-2" />

      {/* ── Certs Expiring ── */}
      <section>
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span className="text-xs font-semibold text-amber-400 flex items-center gap-1">
            <Key size={11} /> Certs
          </span>
          <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded-full font-medium">
            {certAlerts.length}
          </span>
        </div>
        <div className="flex flex-col gap-1 px-2 pb-3">
          {certAlerts.map(cert => {
            const sel = isSelected(selectedItem, 'cert', cert.cert_name);
            const daysColor = cert.days_left < 7 ? 'bg-red-500/20 text-red-400 border-red-500/40' : 'bg-amber-500/20 text-amber-400 border-amber-500/40';
            return (
              <button
                key={cert.cert_name}
                onClick={() => onSelect({ type: 'cert', id: cert.cert_name })}
                className={`w-full text-left rounded-md border-l-2 border-yellow-500 px-2 py-2 transition-colors ${
                  sel ? 'bg-yellow-500/10' : 'bg-[#161B22] hover:bg-[#1C2128]'
                }`}
              >
                <div className="flex items-center gap-1 mb-1">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${daysColor}`}>
                    {cert.days_left}d left
                  </span>
                </div>
                <p className="text-xs text-gray-200 truncate mb-0.5">{cert.cert_name}</p>
                <p className="text-[9px] text-gray-500">{cert.cis_affected} CIs · {cert.owner_team}</p>
              </button>
            );
          })}
        </div>
      </section>

      <div className="border-t border-[#30363D] mx-2" />

      {/* ── Jira At-Risk ── */}
      <section>
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span className="text-xs font-semibold text-amber-400 flex items-center gap-1">
            <AlertTriangle size={11} /> Jira
          </span>
          <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded-full font-medium">
            {jiraTickets.length}
          </span>
        </div>
        <div className="flex flex-col gap-1 px-2 pb-3">
          {jiraTickets.map(ticket => {
            const sel = isSelected(selectedItem, 'jira', ticket.key);
            const riskCls = ticket.risk_level === 'HIGH'
              ? 'bg-red-500/20 text-red-400 border-red-500/40'
              : 'bg-amber-500/20 text-amber-400 border-amber-500/40';
            return (
              <button
                key={ticket.key}
                onClick={() => onSelect({ type: 'jira', id: ticket.key })}
                className={`w-full text-left rounded-md border-l-2 border-blue-500 px-2 py-2 transition-colors ${
                  sel ? 'bg-blue-500/10' : 'bg-[#161B22] hover:bg-[#1C2128]'
                }`}
              >
                <div className="flex items-center gap-1 mb-1">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${riskCls}`}>
                    {ticket.risk_level}
                  </span>
                  {ticket.causing_live_impact && (
                    <span className="text-[9px] bg-red-500/20 text-red-400 border border-red-500/40 px-1.5 py-0.5 rounded font-bold">
                      LIVE
                    </span>
                  )}
                </div>
                <p className="text-[10px] font-mono text-blue-400 mb-0.5">{ticket.key}</p>
                <p className="text-xs text-gray-200 line-clamp-2 mb-0.5">{ticket.title}</p>
                <p className="text-[9px] text-gray-500">Sprint ends in {ticket.days_until_sprint_end}d</p>
              </button>
            );
          })}
        </div>
      </section>

      <div className="border-t border-[#30363D] mx-2" />

      {/* ── Drift Detected ── */}
      <section>
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span className="text-xs font-semibold text-yellow-400 flex items-center gap-1">
            <Zap size={11} /> Drift
          </span>
          <span className="text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-1.5 py-0.5 rounded-full font-medium">
            {driftIncidents.length}
          </span>
        </div>
        <div className="flex flex-col gap-1 px-2 pb-4">
          {driftIncidents.map(drift => {
            const sel = isSelected(selectedItem, 'drift', drift.sys_id);
            const typeLabel = { config_changed: 'CONFIG', replica_drift: 'REPLICA', image_drift: 'IMAGE' }[drift.drift_type];
            return (
              <button
                key={drift.sys_id}
                onClick={() => onSelect({ type: 'drift', id: drift.sys_id })}
                className={`w-full text-left rounded-md border-l-2 border-yellow-500 px-2 py-2 transition-colors ${
                  sel ? 'bg-yellow-500/10' : 'bg-[#161B22] hover:bg-[#1C2128]'
                }`}
              >
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/40">
                  {typeLabel}
                </span>
                <p className="text-xs text-gray-200 line-clamp-2 mt-1 mb-0.5">{drift.title}</p>
                <p className="text-[9px] text-gray-500">{formatDistanceToNow(drift.detected_at)} ago</p>
              </button>
            );
          })}
        </div>
      </section>
    </aside>
  );
};
