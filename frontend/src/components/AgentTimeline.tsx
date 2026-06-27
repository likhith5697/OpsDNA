import React from 'react';
import { Check, Loader2, Clock, X } from 'lucide-react';
import { WorkflowEvent } from '../types';

interface AgentTimelineProps {
  events: WorkflowEvent[];
}

const NODE_ICONS = {
  completed: <Check size={12} className="text-green-400" />,
  running: <Loader2 size={12} className="text-blue-400 animate-spin" />,
  waiting: <Clock size={12} className="text-gray-600" />,
  failed: <X size={12} className="text-red-400" />,
};

const NODE_COLORS = {
  completed: 'bg-green-500/20 border-green-500/40',
  running: 'bg-blue-500/20 border-blue-500/40 animate-pulse',
  waiting: 'bg-[#1C2128] border-[#30363D]',
  failed: 'bg-red-500/20 border-red-500/40',
};

const STATUS_LABELS = {
  completed: { label: 'DONE', cls: 'text-green-400' },
  running: { label: 'RUNNING', cls: 'text-blue-400' },
  waiting: { label: '—', cls: 'text-gray-600' },
  failed: { label: 'FAILED', cls: 'text-red-400' },
};

export const AgentTimeline: React.FC<AgentTimelineProps> = ({ events }) => {
  return (
    <div className="space-y-1">
      {events.map((evt, idx) => {
        const isLast = idx === events.length - 1;
        const statusCfg = STATUS_LABELS[evt.status];
        return (
          <div key={evt.node} className="flex gap-3">
            {/* Node + connector */}
            <div className="flex flex-col items-center">
              <div className={`w-6 h-6 rounded-full border flex items-center justify-center flex-shrink-0 ${NODE_COLORS[evt.status]}`}>
                {NODE_ICONS[evt.status]}
              </div>
              {!isLast && (
                <div className={`w-px flex-1 mt-0.5 ${evt.status === 'completed' ? 'bg-green-500/30' : 'bg-[#30363D]'}`} style={{ minHeight: 16 }} />
              )}
            </div>

            {/* Content */}
            <div className="pb-3 flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${evt.status === 'waiting' ? 'text-gray-600' : 'text-gray-200'}`}>
                  {evt.node}
                </span>
                <span className={`text-[10px] font-mono font-bold ${statusCfg.cls}`}>
                  {statusCfg.label}
                </span>
                {evt.timestamp && (
                  <span className="text-[10px] text-gray-500 font-mono ml-auto">{evt.timestamp}</span>
                )}
              </div>
              {evt.output && (
                <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{evt.output}</p>
              )}
              {evt.tools_used && evt.tools_used.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {evt.tools_used.map(tool => (
                    <span key={tool} className="text-[9px] font-mono bg-[#1C2128] border border-[#30363D] text-gray-500 px-1.5 py-0.5 rounded">
                      {tool}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
