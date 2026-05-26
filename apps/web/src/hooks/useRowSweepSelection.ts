import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { getRangeRecordIds } from '../packageModel';

const dragSelectionThresholdPx = 4;
const dragAutoScrollEdgePx = 32;
const dragAutoScrollStepPx = 18;

function scrollElementNearEdge(scrollElement: HTMLElement, clientY: number) {
  const bounds = scrollElement.getBoundingClientRect();
  if (clientY < bounds.top + dragAutoScrollEdgePx) {
    scrollElement.scrollTop -= dragAutoScrollStepPx;
  } else if (clientY > bounds.bottom - dragAutoScrollEdgePx) {
    scrollElement.scrollTop += dragAutoScrollStepPx;
  }
}

type SelectionMode = 'add' | 'remove';

interface DragSelectionState {
  pointerId: number;
  startClientY: number;
  startRecordId: string;
  baseSelectedIds: Set<string>;
  mode: SelectionMode;
  active: boolean;
}

export function useRowSweepSelection({
  orderedRecordIds,
  selectedIds,
  scrollRef,
  onReplaceSelection,
}: {
  orderedRecordIds: string[];
  selectedIds: ReadonlySet<string>;
  scrollRef: { current: HTMLElement | null };
  onReplaceSelection: (selectedIds: Set<string>) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const suppressClickRef = useRef(false);

  const shouldSuppressClick = useCallback(() => suppressClickRef.current, []);

  useEffect(() => {
    if (!isDragging) return undefined;

    document.body.classList.add('range-selecting');
    return () => {
      document.body.classList.remove('range-selecting');
    };
  }, [isDragging]);

  const onPointerDown = useCallback((recordId: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || orderedRecordIds.length === 0) return;
    event.preventDefault();
    event.currentTarget.focus();

    const drag: DragSelectionState = {
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startRecordId: recordId,
      baseSelectedIds: new Set(selectedIds),
      mode: selectedIds.has(recordId) ? 'remove' : 'add',
      active: false,
    };

    const applyRange = (targetRecordId: string) => {
      const rangeIds = getRangeRecordIds(orderedRecordIds, drag.startRecordId, targetRecordId);
      const next = new Set(drag.baseSelectedIds);
      for (const id of rangeIds) {
        if (drag.mode === 'add') next.add(id);
        else next.delete(id);
      }
      onReplaceSelection(next);
    };

    const scrollNearEdge = (clientY: number) => {
      const scrollElement = scrollRef.current;
      if (!scrollElement) return;
      scrollElementNearEdge(scrollElement, clientY);
    };

    const getRecordIdAtPoint = (clientX: number, clientY: number) => {
      const scrollElement = scrollRef.current;
      if (!scrollElement) return null;

      const bounds = scrollElement.getBoundingClientRect();
      if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) {
        return null;
      }

      const element = document.elementFromPoint(clientX, clientY);
      if (!(element instanceof HTMLElement)) return null;
      const row = element.closest<HTMLElement>('[data-record-id]');
      if (!row || !scrollElement.contains(row)) return null;
      return row.dataset.recordId ?? null;
    };

    const onPointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== drag.pointerId) return;

      const targetRecordId = getRecordIdAtPoint(pointerEvent.clientX, pointerEvent.clientY);
      if (!drag.active && Math.abs(pointerEvent.clientY - drag.startClientY) < dragSelectionThresholdPx) return;
      if (!targetRecordId) return;

      scrollNearEdge(pointerEvent.clientY);
      drag.active = true;
      setIsDragging(true);
      pointerEvent.preventDefault();
      window.getSelection()?.removeAllRanges();
      applyRange(targetRecordId);
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };

    const onPointerUp = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== drag.pointerId) return;
      cleanup();
      if (drag.active) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      setIsDragging(false);
    };

    const onPointerCancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== drag.pointerId) return;
      cleanup();
      setIsDragging(false);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }, [onReplaceSelection, orderedRecordIds, scrollRef, selectedIds]);

  return {
    isDragging,
    onPointerDown,
    shouldSuppressClick,
  };
}
