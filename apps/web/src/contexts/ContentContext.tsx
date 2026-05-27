import { createContext, useContext } from 'react';

export type GetContentFn = (id: string) => Uint8Array<ArrayBuffer> | undefined;

export const ContentContext = createContext<GetContentFn | null>(null);

export function useContent(): GetContentFn {
  const context = useContext(ContentContext);
  if (!context) {
    throw new Error('useContent must be used within a ContentProvider');
  }
  return context;
}
