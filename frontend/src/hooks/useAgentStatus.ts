import { useState, useEffect } from 'react';
import { AgentStatus } from '../types';
import { getAgentStatus } from '../api/client';

export function useAgentStatus(pollInterval = 5000) {
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ status: 'idle' });

  useEffect(() => {
    let mounted = true;

    const poll = async () => {
      try {
        const status = await getAgentStatus();
        if (mounted) setAgentStatus(status);
      } catch {
        // keep last known status
      }
    };

    poll();
    const id = setInterval(poll, pollInterval);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [pollInterval]);

  return { agentStatus, setAgentStatus };
}
