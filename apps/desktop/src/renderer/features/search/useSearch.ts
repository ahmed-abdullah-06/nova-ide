/**
 * Search state for the renderer (spec §7, §21).
 *
 * The renderer debounces the input, cancels the previous request and
 * ignores results of requests that have been superseded.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SearchMatch, SearchMode } from '../../../shared/ipc-types';

/** How long the input has to be idle before a search starts. */
export const SEARCH_DEBOUNCE_MS = 250;

export interface SearchController {
  /** The current (debounced) pattern. */
  pattern: string;
  /** The pattern as typed by the user. */
  input: string;
  /** The active search mode. */
  mode: SearchMode;
  /** True while a search is running. */
  searching: boolean;
  /** The results of the last search. */
  results: SearchMatch[];
  /** True when the result limit was reached. */
  truncated: boolean;
  /** Updates the input (the search is debounced). */
  setInput: (value: string) => void;
  /** Switches the search mode and re-runs the search. */
  setMode: (mode: SearchMode) => void;
  /** Cancels the running search. */
  cancel: () => void;
}

export function useSearch(): SearchController {
  const [input, setInputState] = useState('');
  const [pattern, setPattern] = useState('');
  const [mode, setModeState] = useState<SearchMode>('files');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [truncated, setTruncated] = useState(false);
  /** Id of the request that is currently authoritative. */
  const requestIdRef = useRef<string | null>(null);
  const counterRef = useRef(0);

  // Cancel the running request when the component unmounts.
  useEffect(() => {
    return () => {
      const requestId = requestIdRef.current;
      if (requestId !== null) {
        void window.nova?.search.cancel(requestId);
      }
    };
  }, []);

  // Receive the results of every search; stale ones are discarded.
  useEffect(() => {
    const api = window.nova;
    if (!api) {
      return;
    }
    return api.search.onResults((payload) => {
      if (payload.requestId !== requestIdRef.current) {
        return;
      }
      setSearching(!payload.done);
      setTruncated(payload.truncated);
      // The results arrive in batches; they are appended, so the user sees
      // the first hits while the search is still running. The list is reset
      // when a new search starts.
      setResults((current) => [...current, ...payload.matches]);
    });
  }, []);

  const runSearch = useCallback(
    (nextPattern: string, nextMode: SearchMode): void => {
      const api = window.nova;
      if (!api) {
        return;
      }
      // Cancel the previous request so the main process stops working on it.
      const previous = requestIdRef.current;
      if (previous !== null) {
        void api.search.cancel(previous);
      }
      counterRef.current += 1;
      const requestId = `search-${counterRef.current}`;
      requestIdRef.current = requestId;

      // The previous results are dropped; the new ones arrive in batches.
      setResults([]);
      setTruncated(false);

      if (nextPattern.length === 0) {
        setSearching(false);
        return;
      }
      setSearching(true);
      void api.search.query(requestId, nextMode, nextPattern);
    },
    [],
  );

  // Debounce the input.
  useEffect(() => {
    const timer = setTimeout(() => {
      setPattern(input);
      runSearch(input, mode);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [input, mode, runSearch]);

  const setInput = useCallback((value: string): void => {
    setInputState(value);
  }, []);

  const setMode = useCallback((nextMode: SearchMode): void => {
    setModeState(nextMode);
  }, []);

  const cancel = useCallback((): void => {
    const requestId = requestIdRef.current;
    if (requestId !== null) {
      void window.nova?.search.cancel(requestId);
      requestIdRef.current = null;
    }
    setSearching(false);
  }, []);

  return {
    pattern,
    input,
    mode,
    searching,
    results,
    truncated,
    setInput,
    setMode,
    cancel,
  };
}
