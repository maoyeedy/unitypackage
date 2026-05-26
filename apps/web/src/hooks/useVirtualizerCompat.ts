import {
  useVirtualizer,
  type PartialKeys,
  type ReactVirtualizerOptions,
  type Virtualizer,
} from '@tanstack/react-virtual';

export function useVirtualizerCompat<TScrollElement extends Element, TItemElement extends Element>(
  options: PartialKeys<
    ReactVirtualizerOptions<TScrollElement, TItemElement>,
    'observeElementRect' | 'observeElementOffset' | 'scrollToFn'
  >,
): Virtualizer<TScrollElement, TItemElement> {
  // eslint-disable-next-line react-hooks/incompatible-library
  return useVirtualizer(options);
}
