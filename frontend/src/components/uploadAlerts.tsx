// ─── CostsCrunch — Upload Alert Toasts ────────────────────────────────────────
// Displays QUARANTINE and MULTI_PAGE WebSocket notifications uniformly
// for both authenticated (ScanModal) and guest (GuestScanWidget) flows.

import { useEffect, useCallback } from 'react';
import type { WsQuarantineMessage, WsMultiPageMessage } from '../models/types';

interface UploadAlertToastProps {
  alert: WsQuarantineMessage | WsMultiPageMessage | null;
  onDismiss: () => void;
  autoCloseMs?: number;
}

const QUARANTINE_ICONS: Record<WsQuarantineMessage['reason'], string> = {
  unreadable:        '📷',
  oversized:         '📦',
  corrupt:           '💾',
  unsupported_format:'❌',
};

const QUARANTINE_LABELS: Record<WsQuarantineMessage['reason'], string> = {
  unreadable:        'Unreadable File',
  oversized:         'File Too Large',
  corrupt:           'Corrupt File',
  unsupported_format: 'Unsupported Format',
};

export default function UploadAlertToast({ alert, onDismiss, autoCloseMs = 8000 }: UploadAlertToastProps) {
  const isQuarantine = (a: WsQuarantineMessage | WsMultiPageMessage | null): a is WsQuarantineMessage => a?.type === 'QUARANTINE';
  const isMultiPage  = (a: WsQuarantineMessage | WsMultiPageMessage | null): a is WsMultiPageMessage  => a?.type === 'MULTI_PAGE';

  const handleDismiss = useCallback(() => onDismiss(), [onDismiss]);

  // Auto-dismiss
  useEffect(() => {
    if (!alert) return;
    const timer = setTimeout(handleDismiss, autoCloseMs);
    return () => clearTimeout(timer);
  }, [alert, autoCloseMs, handleDismiss]);

  if (!alert) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 9999,
        maxWidth: '380px',
        width: '100%',
        animation: 'slideUp 0.3s ease-out',
      }}
    >
      {isQuarantine(alert) && (
        <div style={{
          background: '#1a0a0a',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          borderRadius: '12px',
          padding: '16px 20px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <span style={{ fontSize: '24px', flexShrink: 0 }}>
              {QUARANTINE_ICONS[alert.reason]}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: '12px',
                fontWeight: 700,
                color: '#f87171',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '4px',
              }}>
                {QUARANTINE_LABELS[alert.reason]}
              </div>
              <div style={{ fontSize: '13px', color: '#fca5a5', marginBottom: '6px' }}>
                {alert.message}
              </div>
              <div style={{ fontSize: '11px', color: '#7f1d1d' }}>
                File: {alert.fileName}
              </div>
            </div>
            <button
              onClick={handleDismiss}
              aria-label="Dismiss"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#64748b',
                cursor: 'pointer',
                fontSize: '16px',
                padding: '2px',
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {isMultiPage(alert) && (
        <div style={{
          background: '#0a1a1a',
          border: '1px solid rgba(34, 197, 94, 0.4)',
          borderRadius: '12px',
          padding: '16px 20px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <span style={{ fontSize: '24px', flexShrink: 0 }}>📄</span>
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: '12px',
                fontWeight: 700,
                color: '#4ade80',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '4px',
              }}>
                Multi-Page Document
              </div>
              <div style={{ fontSize: '13px', color: '#86efac', marginBottom: '6px' }}>
                {alert.message}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  background: 'rgba(34,197,94,0.15)',
                  border: '1px solid rgba(34,197,94,0.3)',
                  borderRadius: '4px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  color: '#4ade80',
                  fontWeight: 600,
                }}>
                  {alert.pageCount} pages detected
                </span>
                <span style={{ fontSize: '11px', color: '#14532d' }}>
                  File: {alert.fileName}
                </span>
              </div>
            </div>
            <button
              onClick={handleDismiss}
              aria-label="Dismiss"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#64748b',
                cursor: 'pointer',
                fontSize: '16px',
                padding: '2px',
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
