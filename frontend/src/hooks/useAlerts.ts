import { useState, useEffect, useCallback } from 'react';
import type { Alert } from '../types';
import { api, connectSSE } from '../services/api';

export function useAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    try {
      const data = await api.getAlerts();
      setAlerts(data);
    } catch {
      // API not available yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch
    fetchAlerts();

    // SSE connection for real-time updates
    const disconnect = connectSSE((event) => {
      if (event.type === 'alert') {
        setAlerts((prev) => [event.alert, ...prev]);
      }
      if (event.type === 'connected') {
        setConnected(true);
      }
    });

    // Poll as fallback
    const interval = setInterval(fetchAlerts, 10000);

    return () => {
      disconnect();
      clearInterval(interval);
    };
  }, [fetchAlerts]);

  const dismissAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { alerts, connected, loading, fetchAlerts, dismissAlert };
}
