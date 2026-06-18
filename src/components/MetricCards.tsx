import React from 'react';
import { HealthSummary } from '../types';
import { Activity, AlertCircle, Zap, CheckCircle } from 'lucide-react';

interface MetricCardsProps {
  summary: HealthSummary | null;
}

export const MetricCards: React.FC<MetricCardsProps> = ({ summary }) => {
  const metrics = [
    {
      label: 'Active Incidents',
      value: summary?.active_incidents ?? '—',
      icon: <AlertCircle size={18} className="text-red-400" />,
      accent: 'border-red-500/30',
      valueCls: 'text-red-400',
    },
    {
      label: 'Error Rate',
      value: summary ? `${summary.error_rate.toFixed(1)}%` : '—',
      icon: <Activity size={18} className="text-amber-400" />,
      accent: 'border-amber-500/30',
      valueCls: summary && summary.error_rate > 0 ? 'text-amber-400' : 'text-green-400',
    },
    {
      label: 'req/min',
      value: summary?.requests_per_min ?? '—',
      icon: <Zap size={18} className="text-blue-400" />,
      accent: 'border-blue-500/30',
      valueCls: 'text-blue-400',
    },
    {
      label: 'Alerts Firing',
      value: summary?.alert_count ?? '—',
      icon: <CheckCircle size={18} className="text-teal-400" />,
      accent: 'border-teal-500/30',
      valueCls: summary && summary.alert_count === 0 ? 'text-green-400' : 'text-amber-400',
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-3 w-full max-w-2xl">
      {metrics.map(m => (
        <div
          key={m.label}
          className={`bg-[#161B22] border ${m.accent} rounded-xl p-4 flex flex-col items-center gap-2`}
        >
          {m.icon}
          <span className={`text-2xl font-bold tabular-nums ${m.valueCls}`}>{m.value}</span>
          <span className="text-xs text-gray-500 text-center">{m.label}</span>
        </div>
      ))}
    </div>
  );
};
