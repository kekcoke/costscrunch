import { useEffect, useRef, useState, useCallback } from 'react';
import type { WsMessage, WsQuarantineMessage, WsMultiPageMessage } from '../models/types';

export const useWebSocket = (url: string | undefined) => {
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('closed');
  const [quarantineAlert, setQuarantineAlert] = useState<WsQuarantineMessage | null>(null);
  const [multiPageAlert, setMultiPageAlert] = useState<WsMultiPageMessage | null>(null);
  const [retrySignal, setRetrySignal] = useState(0);
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);
  const manualClose = useRef(false);

  useEffect(() => {
    if (!url) return;

    manualClose.current = false;
    setStatus('connecting');
    const socket = new WebSocket(url);
    ws.current = socket;

    socket.onopen = () => {
      console.log('WebSocket Connected');
      reconnectDelay.current = 1000;
      setStatus('open');
    };

    socket.onmessage = (event) => {
      try {
        const data: WsMessage = JSON.parse(event.data);
        setLastMessage(data);

        if (data.type === 'QUARANTINE') {
          setQuarantineAlert(data as WsQuarantineMessage);
        }

        if (data.type === 'MULTI_PAGE') {
          setMultiPageAlert(data as WsMultiPageMessage);
        }
      } catch (e) {
        console.error('Failed to parse WS message', e);
      }
    };

    socket.onclose = () => {
      console.log('WebSocket Disconnected');
      setStatus('closed');
      if (!manualClose.current) {
        const delay = reconnectDelay.current;
        reconnectDelay.current = Math.min(delay * 2, 30000);
        reconnectTimeout.current = setTimeout(() => {
          setRetrySignal((s) => s + 1);
        }, delay);
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket Error', error);
      socket.close();
    };

    return () => {
      manualClose.current = true;
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      socket.close();
    };
  }, [url, retrySignal]);

  const sendMessage = useCallback((msg: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
    }
  }, []);

  const clearQuarantineAlert = useCallback(() => setQuarantineAlert(null), []);
  const clearMultiPageAlert = useCallback(() => setMultiPageAlert(null), []);

  return { 
    lastMessage, 
    status, 
    sendMessage,
    quarantineAlert,
    multiPageAlert,
    clearQuarantineAlert,
    clearMultiPageAlert,
  };
};
