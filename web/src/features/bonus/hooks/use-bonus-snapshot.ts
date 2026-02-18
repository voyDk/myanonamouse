import { useEffect, useMemo, useState } from 'react';

import { getBonusSnapshot } from '@/features/bonus/api/get-bonus-snapshot';
import type { BonusSnapshot } from '@/features/bonus/types';

type BonusSnapshotState =
  | { status: 'loading'; data: null; error: null }
  | { status: 'loaded'; data: BonusSnapshot; error: null }
  | { status: 'error'; data: null; error: string };

const initialState: BonusSnapshotState = {
  status: 'loading',
  data: null,
  error: null,
};

export function useBonusSnapshot() {
  const [state, setState] = useState<BonusSnapshotState>(initialState);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    setState({ status: 'loading', data: null, error: null });

    void getBonusSnapshot({ forceRefresh: refreshKey > 0 })
      .then((snapshot) => {
        if (!active) {
          return;
        }

        setState({ status: 'loaded', data: snapshot, error: null });
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setState({
          status: 'error',
          data: null,
          error: 'Snapshot request failed. Check site credentials and retry.',
        });
      });

    return () => {
      active = false;
    };
  }, [refreshKey]);

  const refresh = useMemo(() => {
    return () => setRefreshKey((current) => current + 1);
  }, []);

  return { state, refresh };
}
