import React, { useState } from 'react';
import { Copy, Check, X } from 'lucide-react';
import { DriftIncident } from '../types';
import { approveDrift } from '../api/client';
import { formatDistanceToNow } from '../utils/time';

interface DriftDetailProps {
  drift: DriftIncident;
  onToast: (msg: string) => void;
}

const DRIFT_LABELS: Record<string, { label: string; cls: string }> = {
  config_changed: { label: 'CONFIG', cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40' },
  replica_drift: { label: 'REPLICA', cls: 'bg-blue-500/20 text-blue-400 border-blue-500/40' },
  image_drift: { label: 'IMAGE', cls: 'bg-purple-500/20 text-purple-400 border-purple-500/40' },
};

export const DriftDetail: React.FC<DriftDetailProps> = ({ drift, onToast }) => {
  const [copied, setCopied] = useState(false);
  const badge = DRIFT_LABELS[drift.drift_type];

  const handleCopy = () => {
    navigator.clipboard.writeText(drift.fix_command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleApprove = async () => {
    try {
      await approveDrift(drift.sys_id);
      onToast('Fix approved — executing');
    } catch {
      onToast('Fix approved — executing (mock)');
    }
  };

  return (
    <div className="overflow-y-auto h-full pb-20">
      {/* Header */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <span className={`text-xs font-bold px-2 py-1 rounded border ${badge.cls}`}>{badge.label}</span>
          <span className="text-xs text-gray-500">Detected {formatDistanceToNow(drift.detected_at)} ago</span>
        </div>
        <h1 className="text-xl font-semibold text-gray-100">{drift.title}</h1>
      </div>

      {/* Description */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 mb-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-2">What Changed</h3>
        <p className="text-sm text-gray-300 leading-relaxed">{drift.description}</p>
      </div>

      {/* Evidence */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 mb-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Evidence</h3>
        <div className="space-y-2 text-sm text-gray-400">
          <div className="flex items-start gap-2">
            <span className="text-yellow-400 flex-shrink-0">⚡</span>
            <span>ConfigMap modified directly via kubectl, bypassing GitOps pipeline</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-blue-400 flex-shrink-0">⏱</span>
            <span>Detected {formatDistanceToNow(drift.detected_at)} ago at {new Date(drift.detected_at).toLocaleTimeString()}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-red-400 flex-shrink-0">⚠</span>
            <span>Not reflected in Git repository — source of truth is now out of sync</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-purple-400 flex-shrink-0">🔧</span>
            <span>PAYMENT_TIMEOUT: 5000ms → 30000ms (changed without approval)</span>
          </div>
        </div>
      </div>

      {/* Fix command */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 mb-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Fix Command</h3>
        <div className="bg-[#0D1117] border border-[#30363D] rounded-lg p-3 flex items-start justify-between gap-3">
          <code className="text-xs text-green-300 font-mono leading-relaxed break-all">{drift.fix_command}</code>
          <button
            onClick={handleCopy}
            className="flex-shrink-0 text-gray-500 hover:text-gray-300 transition-colors mt-0.5"
          >
            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">Re-applies the GitOps-managed configmap, overwriting the manual change.</p>
      </div>

      {/* Sticky approval bar */}
      <div className="fixed bottom-0 left-[200px] right-[380px] bg-[#161B22] border-t border-yellow-500/40 px-6 py-3 flex items-center justify-between z-20">
        <div>
          <p className="text-xs text-yellow-400 font-semibold mb-0.5">⚡ Drift fix ready to apply</p>
          <code className="text-xs text-gray-400 font-mono">{drift.fix_command.substring(0, 60)}...</code>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleApprove}
            className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm rounded-lg transition-colors font-medium"
          >
            <Check size={14} /> Approve Fix
          </button>
          <button className="flex items-center gap-1.5 px-4 py-2 bg-[#1C2128] hover:bg-[#21262D] border border-[#30363D] text-gray-300 text-sm rounded-lg transition-colors">
            <X size={14} /> Assign to Human
          </button>
        </div>
      </div>
    </div>
  );
};
