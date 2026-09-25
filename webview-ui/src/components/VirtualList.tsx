// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { useSignal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';

export interface VirtualListProps<T> {
    readonly items: readonly T[];
    readonly rowHeight: number;
    readonly overscan?: number;
    readonly getKey: (item: T, index: number) => string;
    readonly renderItem: (item: T, index: number) => ComponentChildren;
    readonly className?: string;
    readonly ariaLabel?: string;
}

export function VirtualList<T>(props: VirtualListProps<T>): JSX.Element {
    const { items, rowHeight, getKey, renderItem } = props;
    const overscan = props.overscan ?? 6;

    const containerRef = useRef<HTMLDivElement | null>(null);
    const scrollTop = useSignal(0);
    const viewportHeight = useSignal(0);

    // Track viewport height through ResizeObserver so dynamic
    // sidebar resizes recompute the window without a full reflow.
    useLayoutEffect(() => {
        const el = containerRef.current;
        if (el === null) return;
        viewportHeight.value = el.clientHeight;
        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                viewportHeight.value = entry.contentRect.height;
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        const el = containerRef.current;
        if (el === null) return;
        const onScroll = (): void => {
            scrollTop.value = el.scrollTop;
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        return () => el.removeEventListener('scroll', onScroll);
    }, []);

    const visibleStart = Math.max(0, Math.floor(scrollTop.value / rowHeight) - overscan);
    const desiredCount = Math.ceil(viewportHeight.value / rowHeight) + overscan * 2;
    const visibleEnd = Math.min(items.length, visibleStart + desiredCount);
    const renderedWindow = items.slice(visibleStart, visibleEnd);
    const totalHeight = items.length * rowHeight;
    const offsetY = visibleStart * rowHeight;

    return (
        <div
            ref={containerRef}
            class={`verzeta-virt${props.className !== undefined ? ` ${props.className}` : ''}`}
            role="list"
            aria-label={props.ariaLabel}
        >
            <div class="verzeta-virt__inner" style={{ height: `${totalHeight}px` }}>
                <div class="verzeta-virt__window" style={{ transform: `translateY(${offsetY}px)` }}>
                    {renderedWindow.map((item, idx) => {
                        const absoluteIndex = visibleStart + idx;
                        return (
                            <div
                                key={getKey(item, absoluteIndex)}
                                class="verzeta-virt__row"
                                style={{ height: `${rowHeight}px` }}
                                role="listitem"
                            >
                                {renderItem(item, absoluteIndex)}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
