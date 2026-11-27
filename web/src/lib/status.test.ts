import { describe, expect, it } from 'vitest';
import { deriveTunnelStatus } from './status';

describe('deriveTunnelStatus', () => {
  it('maps running status to success without attention', () => {
    const res = deriveTunnelStatus({ status: 'running', mode: 'tailscale' });
    expect(res.severity).toBe('success');
    expect(res.titleKey).toBe('home.statusRunning');
    expect(res.needsAttention).toBe(false);
    expect(res.attentionSeverity).toBeNull();
    expect(res.isActive).toBe(true);
    expect(res.isBusy).toBe(false);
  });

  it('maps stopped status to neutral without attention', () => {
    const res = deriveTunnelStatus({ status: 'stopped', mode: 'tailscale' });
    expect(res.severity).toBe('neutral');
    expect(res.titleKey).toBe('home.statusStopped');
    expect(res.needsAttention).toBe(false);
    expect(res.attentionSeverity).toBeNull();
    expect(res.isActive).toBe(false);
  });

  it('maps needs_action status to caution with attention', () => {
    const res = deriveTunnelStatus({ status: 'needs_action', mode: 'tailscale' });
    expect(res.severity).toBe('caution');
    expect(res.titleKey).toBe('home.statusNeedsAction');
    expect(res.needsAttention).toBe(true);
    expect(res.attentionSeverity).toBe('caution');
  });

  it('maps error status to critical with attention', () => {
    const res = deriveTunnelStatus({ status: 'error', mode: 'tailscale' });
    expect(res.severity).toBe('critical');
    expect(res.titleKey).toBe('home.statusError');
    expect(res.needsAttention).toBe(true);
    expect(res.attentionSeverity).toBe('critical');
  });
});
