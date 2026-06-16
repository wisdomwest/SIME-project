import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: number;
}

export function Drawer({ open, onClose, title, children, width = 480 }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-ink/40 backdrop-blur-[1px]"
            onClick={onClose}
          />
          <motion.aside
            ref={ref}
            initial={{ x: width }}
            animate={{ x: 0 }}
            exit={{ x: width }}
            transition={{ type: 'tween', ease: [0.16, 1, 0.3, 1], duration: 0.32 }}
            style={{ width }}
            className="relative ml-auto h-full bg-paper border-l border-rule overflow-y-auto"
          >
            <header className="sticky top-0 z-10 bg-paper border-b border-rule px-6 py-4 flex items-center justify-between">
              <span className="font-display text-xl text-ink font-light">{title}</span>
              <button
                onClick={onClose}
                aria-label="Close drawer"
                className="p-1 -mr-1 text-ink-mute hover:text-ink transition-colors"
              >
                <X size={18} />
              </button>
            </header>
            <div className="p-6">{children}</div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
