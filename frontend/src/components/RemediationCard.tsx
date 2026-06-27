import React, { useState } from 'react';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import { RemediationProposal, ExecuteFixResult } from '../types';
import { proposeFix, executeFix } from '../api/client';

interface RemediationCardProps {
  podName: string;
  namespace: string;
}

export const RemediationCard: React.FC<RemediationCardProps> = ({ podName, namespace }) => {
  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<RemediationProposal | null>(null);
  const [result, setResult] = useState<ExecuteFixResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePropose = async () => {
    setLoading(true);
    setError(null);
    try {
      setProposal(await proposeFix(podName, namespace));
    } catch {
      setError('Could not generate a fix proposal -- the SRE agent backend may be unavailable.');
    } finally {
      setLoading(false);
    }
  };

  const handleDecision = async (approved: boolean) => {
    if (!proposal) return;
    setLoading(true);
    try {
      setResult(await executeFix(proposal.action_id, approved));
    } catch {
      setError('Could not reach the SRE agent to execute the decision.');
    } finally {
      setLoading(false);
    }
  };

  if (!proposal) {
    return (
      <button
        onClick={handlePropose}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs rounded-lg transition-colors font-medium"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
        Propose Fix
        {error && <span className="ml-1 text-red-200">!</span>}
      </button>
    );
  }

  return (
    <div className="bg-[#161B22] border border-amber-500/30 rounded-lg p-3 mt-2 text-xs">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-mono text-amber-400 font-bold">{proposal.sop_number || 'No SOP'}</span>
        <span className="text-gray-400">{proposal.sop_used}</span>
      </div>
      <p className="text-gray-300 mb-1">
        <span className="text-gray-500">Issue:</span> {proposal.issue_type}
      </p>
      <p className="text-gray-300 mb-1">
        <span className="text-gray-500">Root cause:</span> {proposal.root_cause_guess}
      </p>
      <p className="text-gray-300 mb-1">
        <span className="text-gray-500">Proposed action:</span>{' '}
        <span className="font-mono text-purple-400">{proposal.proposed_action}</span>
      </p>
      <p className="text-gray-400 mb-2 leading-relaxed">{proposal.reasoning}</p>

      {!result && (
        <div className="flex gap-2">
          <button
            onClick={() => handleDecision(true)}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
          </button>
          <button
            onClick={() => handleDecision(false)}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 border border-red-500/40 disabled:opacity-50 text-red-400 rounded-lg transition-colors"
          >
            <X size={12} /> Reject
          </button>
        </div>
      )}

      {result && (
        <div className={`mt-2 rounded-lg p-2 border ${result.success ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
          <p className={result.success ? 'text-green-400' : 'text-red-400'}>{result.message}</p>
          {result.executed_command && <code className="block mt-1 text-gray-400 font-mono">{result.executed_command}</code>}
        </div>
      )}

      {error && <p className="text-red-400 mt-2">{error}</p>}
    </div>
  );
};
