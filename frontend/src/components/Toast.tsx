import React, { useEffect } from 'react';
import { Check, X } from 'lucide-react';

interface ToastProps {
  message: string;
  onDismiss: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, onDismiss }) => {
  useEffect(() => {
    const id = setTimeout(onDismiss, 3500);
    return () => clearTimeout(id);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-slide-up">
      <div className="flex items-center gap-3 bg-[#161B22] border border-green-500/30 rounded-xl px-4 py-3 shadow-2xl min-w-[280px]">
        <div className="w-5 h-5 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center flex-shrink-0">
          <Check size={11} className="text-green-400" />
        </div>
        <span className="text-sm text-gray-200 flex-1">{message}</span>
        <button onClick={onDismiss} className="text-gray-600 hover:text-gray-400">
          <X size={13} />
        </button>
      </div>
    </div>
  );
};
