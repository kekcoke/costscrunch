import { useEffect, useRef, useState, useCallback } from 'react';

interface WsMessage {
  type: string;
  [key: string]: any;
}

export const useWebSocket = (url: string | undefined) => {
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('closed');
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<number | null>(null);

  const connect = useCallback(() => {
    if (!url) return;

    setStatus('connecting');
    ws.current = new WebSocket(url);

    ws.current.onopen = () => {
      console.log('WebSocket Connected');
      setStatus('open');
    };

    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setLastMessage(data);
      } catch (e) {
        console.error('Failed to parse WS message', e);
      }
    };

    ws.current.onclose = () => {
      console.log('WebSocket Disconnected');
      setStatus('closed');
      // Simple exponential backoff or static retry
      reconnectTimeout.current = window.setTimeout(connect, 5000);
    };

    ws.current.onerror = (error) => {
      console.error('WebSocket Error', error);
      ws.current?.close();
    };
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      ws.current?.close();
    };
  }, [connect]);

  const sendMessage = useCallback((msg: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
    }
  }, []);

  return { lastMessage, status, sendMessage };
};
