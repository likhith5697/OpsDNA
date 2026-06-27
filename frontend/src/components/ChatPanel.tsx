import React, { useState, useRef, useEffect } from 'react';
import { Send, Trash2, Loader2, Copy, Check } from 'lucide-react';
import { ChatMessage } from '../types';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (content: string) => Promise<void>;
  onClear: () => void;
  isLoading: boolean;
  width: number;
}

const SUGGESTIONS = [
  'Full health report',
  'Current error rate?',
  'Pod status',
  'Is anything broken?',
  'At-risk Jira tickets',
  'Expiring certs',
];

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      result.push(
        <CodeBlock key={i} code={codeLines.join('\n')} lang={lang} />
      );
      i++;
      continue;
    }

    // Bullet
    if (line.startsWith('- ') || line.startsWith('* ')) {
      result.push(
        <li key={i} className="ml-4 list-disc text-gray-300 text-sm leading-relaxed">
          {renderInline(line.slice(2))}
        </li>
      );
      i++;
      continue;
    }

    // Heading
    if (line.startsWith('### ')) {
      result.push(<h4 key={i} className="text-sm font-semibold text-gray-200 mt-3 mb-1">{line.slice(4)}</h4>);
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      result.push(<h3 key={i} className="text-sm font-bold text-gray-100 mt-3 mb-1">{line.slice(3)}</h3>);
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      result.push(<div key={i} className="h-2" />);
      i++;
      continue;
    }

    // Paragraph
    result.push(
      <p key={i} className="text-sm text-gray-300 leading-relaxed">
        {renderInline(line)}
      </p>
    );
    i++;
  }
  return result;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-gray-100 font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="bg-[#1C2128] border border-[#30363D] text-purple-300 px-1.5 py-0.5 rounded text-xs font-mono">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

const CodeBlock: React.FC<{ code: string; lang: string }> = ({ code }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="relative bg-[#0D1117] border border-[#30363D] rounded-lg my-2 overflow-hidden">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 text-gray-600 hover:text-gray-400 transition-colors"
      >
        {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
      </button>
      <pre className="text-xs text-green-300 font-mono p-3 overflow-x-auto leading-relaxed">{code}</pre>
    </div>
  );
};

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  onSendMessage,
  onClear,
  isLoading,
  width,
}) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    await onSendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  const isEmpty = messages.length === 0;

  return (
    <aside
      style={{ width }}
      className="flex-shrink-0 border-l border-[#30363D] bg-[#0D1117] flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363D]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-200">Service Assistant</span>
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded-full font-mono">
            gpt-4o
          </span>
          <button
            onClick={onClear}
            className="text-gray-600 hover:text-gray-400 transition-colors"
            title="Clear chat"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isEmpty ? (
          <div className="space-y-4">
            <p className="text-xs text-gray-600 text-center mt-2">Ask about your infrastructure</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => onSendMessage(s)}
                  className="text-xs bg-[#161B22] hover:bg-[#1C2128] border border-[#30363D] text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded-full transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'user' ? (
                <div className="max-w-[80%] bg-blue-600 text-white rounded-2xl rounded-tr-sm px-3 py-2 text-sm leading-relaxed">
                  {msg.content}
                </div>
              ) : (
                <div className="max-w-full w-full">
                  {msg.tools_called && msg.tools_called.length > 0 && (
                    <p className="text-[10px] text-gray-600 mb-1.5 font-mono">
                      Called: {msg.tools_called.join(' · ')}
                    </p>
                  )}
                  <div className="text-gray-300">
                    {renderMarkdown(msg.content)}
                  </div>
                  <p className="text-[10px] text-gray-600 mt-1">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 text-gray-500">
              <Loader2 size={14} className="animate-spin" />
              <span className="text-xs">Thinking...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[#30363D] p-3">
        <div className="flex items-end gap-2 bg-[#161B22] border border-[#30363D] rounded-xl px-3 py-2 focus-within:border-purple-500/50 transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your services..."
            rows={1}
            className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-600 resize-none outline-none leading-relaxed min-h-[20px]"
            style={{ maxHeight: 120 }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="flex-shrink-0 w-7 h-7 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
          >
            {isLoading ? (
              <Loader2 size={13} className="animate-spin text-white" />
            ) : (
              <Send size={13} className="text-white" />
            )}
          </button>
        </div>
        <p className="text-[10px] text-gray-600 mt-1.5 text-center">
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </aside>
  );
};
