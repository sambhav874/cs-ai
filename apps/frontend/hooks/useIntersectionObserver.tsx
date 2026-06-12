// hooks/useIntersectionObserver.ts
import { useEffect, useState, useRef } from 'react';

export const useIntersectionObserver = ({
  threshold = 0,
  root = null,
  rootMargin = '0px',
  onIntersect,
  triggerOnce = false
}: {
  threshold?: number | number[];
  root?: Element | null;
  rootMargin?: string;
  onIntersect?: () => void;
  triggerOnce?: boolean;
}) => {
  const [isIntersecting, setIsIntersecting] = useState(false);
  const ref = useRef<Element>(null);
  const observed = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || (triggerOnce && observed.current)) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsIntersecting(entry.isIntersecting);
        if (entry.isIntersecting) {
          onIntersect?.();
          if (triggerOnce) {
            observed.current = true;
            observer.unobserve(element);
          }
        }
      },
      { threshold, root, rootMargin }
    );

    observer.observe(element);

    return () => {
      if (element) {
        observer.unobserve(element);
      }
    };
  }, [threshold, root, rootMargin, onIntersect, triggerOnce]);

  return { ref, isIntersecting };
};