"use client";

import { useEffect, type RefObject } from "react";

// ref로 감싼 요소 바깥을 mousedown하면 onOutside를 호출한다.
// active가 false인 동안은 리스너를 등록하지 않는다(예: 드롭다운이 닫혀 있을 때).
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onOutside: () => void,
  active: boolean = true
) {
  useEffect(() => {
    if (!active) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [active, onOutside, ref]);
}
