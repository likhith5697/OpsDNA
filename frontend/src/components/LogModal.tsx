import React, { useState, useEffect, useRef } from 'react';
import { X, Filter } from 'lucide-react';
import { getPodLogs } from '../api/client';

interface LogModalProps {
  podName: string;
  onClose: () => void;
}

const MOCK_LOGS = [
  '2024-01-15T02:12:33Z INFO  Starting checkout-service v2.3.1',
  '2024-01-15T02:12:34Z INFO  Connecting to database postgres://db.prod.internal:5432',
  '2024-01-15T02:12:35Z INFO  Server listening on :8080',
  '2024-01-15T02:13:01Z INFO  GET /health 200 2ms',
  '2024-01-15T02:13:15Z WARN  High memory usage detected: 78% of limit',
  '2024-01-15T02:13:45Z ERROR Failed to process payment: timeout after 5000ms',
  '2024-01-15T02:13:46Z ERROR payment-service connection refused: dial tcp 10.0.1.45:8080: connect: connection refused',
  '2024-01-15T02:13:47Z ERROR HTTP 503: Service Unavailable',
  '2024-01-15T02:13:48Z WARN  Memory usage critical: 94% of limit',
  '2024-01-15T02:13:49Z ERROR OOMKill signal received — process terminated',
  '2024-01-15T02:14:01Z INFO  Container restarting (restart #8)',
  '2024-01-15T02:14:02Z INFO  Starting checkout-service v2.3.1',
  '2024-01-15T02:14:05Z ERROR Failed to process payment: timeout after 5000ms',
  '2024-01-15T02:14:06Z ERROR HTTP 503: Service Unavailable',
  '2024-01-15T02:14:33Z ERROR OOMKill signal received — process terminated',
];

export const LogModal: React.FC<LogModalProps> = ({ podName, onClose }) => {
  const [logs, setLogs] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  useEffect(() => {
    setLoading(true);
    getPodLogs(podName)
      .then(data => setLogs(data.lines))
      .catch(() => setLogs(MOCK_LOGS))
      .finally(() => setLoading(false));
  }, [podName]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const filteredLogs = logs.filter(line => {
    if (errorsOnly && !line.includes('ERROR')) return false;
    if (filter && !line.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  const lineColor = (line: string) => {
    if (line.includes('ERROR')) return 'text-red-400';
    if (line.includes('WARN')) return 'text-amber-400';
    if (line.includes('INFO')) return 'text-gray-300';
    return 'text-gray-500';
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-8">
      <div className="bg-[#0D1117] border border-[#30363D] rounded-xl w-full max-w-4xl h-[70vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#30363D]">
          <h2 className="text-sm font-mono text-gray-200 font-semibold">Logs — {podName}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 px-5 py-2.5 border-b border-[#30363D]">
          <div className="flex items-center gap-2 flex-1 bg-[#161B22] border border-[#30363D] rounded-lg px-3 py-1.5">
            <Filter size={13} className="text-gray-500" />
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter logs..."
              className="flex-1 bg-transparent text-sm text-gray-300 placeholder-gray-600 outline-none"
            />
          </div>
          <div className="flex rounded-lg bg-[#161B22] border border-[#30363D] p-0.5">
            {['All', 'Errors only'].map(opt => (
              <button
                key={opt}
                onClick={() => setErrorsOnly(opt === 'Errors only')}
                className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                  (opt === 'Errors only') === errorsOnly
                    ? 'bg-[#30363D] text-gray-200'
                    : 'text-gray-500 hover:text-gray-400'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
          <span className="text-xs text-gray-500">{filteredLogs.length} lines</span>
        </div>

        {/* Log output */}
        <div className="flex-1 overflow-y-auto p-5 font-mono text-xs leading-relaxed">
          {loading ? (
            <div className="text-gray-500 animate-pulse">Loading logs...</div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-gray-600">No matching log lines.</div>
          ) : (
            filteredLogs.map((line, i) => (
              <div
                key={i}
                className={`py-0.5 ${lineColor(line)} ${line.includes('ERROR') ? 'bg-red-500/5 -mx-5 px-5' : ''}`}
              >
                {line}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
};
