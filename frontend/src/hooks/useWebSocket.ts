import { useEffect, useRef, useState, useCallback } from 'react';
import type { WsMessage, WsQuarantineMessage, WsMultiPageMessage } from '../models/types';

 
export const useWebSocket = (url: string | undefined) => {
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('closed');
  const [quarantineAlert, setQuarantineAlert] = useState<WsQuarantineMessage | null>(null);
  const [multiPageAlert, setMultiPageAlert] = useState<WsMultiPageMessage | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!url) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- WebSocket requires state updates on open/close
    setStatus('connecting');
    const socket = new WebSocket(url);
    ws.current = socket;

    socket.onopen = () => {
      console.log('WebSocket Connected');
       
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
      reconnectTimeout.current = setTimeout(() => {
        // Reconnect by triggering effect re-run
      }, 5000);
    };

    socket.onerror = (error) => {
      console.error('WebSocket Error', error);
      socket.close();
    };

    return () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      socket.close();
    };
  }, [url]);

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
