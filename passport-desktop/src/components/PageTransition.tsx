import React, { useEffect, useState } from 'react';

interface PageTransitionProps {
  children: React.ReactNode;
  pageKey: string;
}

export default function PageTransition({ children, pageKey }: PageTransitionProps) {
  const [displayChildren, setDisplayChildren] = useState(children);
  const [renderedPageKey, setRenderedPageKey] = useState(pageKey);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    if (pageKey !== renderedPageKey) {
      // Start fade out
      setIsFading(true);
      
      const timeout = setTimeout(() => {
        // Swap content while invisible, then fade back in
        setRenderedPageKey(pageKey);
        setDisplayChildren(children);
        setIsFading(false);
      }, 150); // Matches the CSS transition duration

      return () => clearTimeout(timeout);
    } else {
      // If it's the same page, we MUST update children synchronously
      // so that state changes (like typing in a text box) don't lag or trigger animations.
      setDisplayChildren(children);
    }
  }, [children, pageKey, renderedPageKey]);

  return (
    <div 
      className={`flex flex-col w-full h-full flex-1 transition-opacity duration-150 ease-in-out ${isFading ? 'opacity-0' : 'opacity-100 animate-[slideUpFade_0.3s_ease-out]'}`}
    >
      {displayChildren}
    </div>
  );
}
