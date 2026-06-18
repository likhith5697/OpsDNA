import React from 'react';
import { Key, Calendar, Users, AlertTriangle } from 'lucide-react';
import { CertAlert } from '../types';

interface CertDetailProps {
  cert: CertAlert;
  onToast: (msg: string) => void;
}

export const CertDetail: React.FC<CertDetailProps> = ({ cert, onToast }) => {
  const expiryDate = new Date(cert.expires_at);
  const daysColor =
    cert.days_left < 7
      ? 'text-red-400'
      : cert.days_left < 14
      ? 'text-amber-400'
      : 'text-yellow-300';

  const urgencyBg: Record<string, string> = {
    CRITICAL: 'bg-red-500/10 border-red-500/30',
    HIGH: 'bg-amber-500/10 border-amber-500/30',
    MEDIUM: 'bg-yellow-500/10 border-yellow-500/30',
    LOW: 'bg-gray-500/10 border-gray-500/30',
  };

  return (
    <div className="overflow-y-auto h-full pb-6">
      {/* Header */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Key size={16} className="text-amber-400" />
          <span className={`text-xs font-bold px-2 py-1 rounded border ${urgencyBg[cert.urgency]} text-amber-400 border-amber-500/40`}>
            {cert.urgency}
          </span>
        </div>
        <h1 className="text-xl font-semibold text-gray-100 font-mono mb-1">{cert.cert_name}</h1>
        <p className={`text-4xl font-bold tabular-nums mt-3 ${daysColor}`}>
          {cert.days_left} <span className="text-lg font-normal text-gray-400">days until expiry</span>
        </p>
        <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
          <Calendar size={12} />
          Expires: {expiryDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Impact grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {[
          { label: 'CIs Affected', value: cert.cis_affected, icon: <Users size={14} className="text-blue-400" /> },
          { label: 'Owner Team', value: cert.owner_team, icon: <Users size={14} className="text-purple-400" /> },
          { label: 'Environment', value: 'production', icon: <AlertTriangle size={14} className="text-red-400" /> },
          { label: 'CI Name', value: cert.ci_name, icon: <Key size={14} className="text-teal-400" /> },
        ].map(({ label, value, icon }) => (
          <div key={label} className="bg-[#161B22] border border-[#30363D] rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1 text-gray-500 text-xs">
              {icon} {label}
            </div>
            <p className="text-sm text-gray-200 font-medium">{value}</p>
          </div>
        ))}
      </div>

      {/* LLM Analysis */}
      {cert.llm_analysis && (
        <div className="bg-purple-500/5 border border-purple-500/30 rounded-xl p-4 mb-4">
          <p className="text-xs text-purple-400 font-semibold mb-2 flex items-center gap-1">
            <span>✦</span> Claude Analysis
          </p>
          <p className="text-sm text-gray-300 leading-relaxed">{cert.llm_analysis}</p>
        </div>
      )}

      {/* Business Impact */}
      {cert.business_impact && (
        <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-4 mb-4">
          <p className="text-xs text-amber-400 font-semibold mb-2">💰 Business Impact</p>
          <p className="text-sm text-amber-300/80">{cert.business_impact}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => onToast('SNOW ticket created')}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors font-medium"
        >
          Create SNOW Ticket
        </button>
        <button
          onClick={() => onToast(`Assigned to ${cert.owner_team}`)}
          className="flex items-center gap-2 px-4 py-2 bg-[#1C2128] hover:bg-[#21262D] border border-[#30363D] text-gray-300 text-sm rounded-lg transition-colors"
        >
          Assign to Team
        </button>
      </div>
    </div>
  );
};
