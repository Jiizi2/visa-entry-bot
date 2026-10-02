import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  context?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** One page title, optional short context, and nearby actions. Workflow lives in the sidebar. */
export default function PageHeader({ title, context, actions, className = '' }: PageHeaderProps) {
  return (
    <header className={`app-page-header ${className}`}>
      <div className="app-page-header-info">
        <h1 className="app-page-title">{title}</h1>
        {context && <div className="app-page-context">{context}</div>}
      </div>
      {actions && <div className="app-page-actions">{actions}</div>}
    </header>
  );
}
