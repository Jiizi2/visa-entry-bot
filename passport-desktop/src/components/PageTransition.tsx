import type { ReactNode } from 'react';

interface PageTransitionProps {
  children: ReactNode;
  pageKey: string;
}

export default function PageTransition({ children, pageKey }: PageTransitionProps) {
  return (
    <div
      key={pageKey}
      className="page-transition flex flex-col w-full h-full min-h-0 min-w-0 flex-1"
    >
      {children}
    </div>
  );
}
