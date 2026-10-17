import { describe, it, expect, beforeEach } from 'vitest';
import { initShiftData, validateAddress, findAddressOwner, createMachine, updateMachine, getMachineById } from '../services/machineService';

const thresholds = { upperAlarm: 10, upperWarning: 5, lowerWarning: -5, lowerAlarm: -10 };

describe('machine IP address and port', () => {
  beforeEach(() => initShiftData());

  it('accepts a normal IPv4 address and port', () => {
    expect(validateAddress('192.168.10.15', 4840)).toBeNull();
    expect(validateAddress(' 10.0.0.1 ', '502')).toBeNull();
  });

  it('rejects a missing, malformed or out-of-range address', () => {
    expect(validateAddress('', 4840)).toMatch(/Enter the IP/);
    expect(validateAddress('999.1.1.1', 4840)).toMatch(/not a valid IP/);
    expect(validateAddress('machine-one', 4840)).toMatch(/not a valid IP/);
    expect(validateAddress('10.0.0.1', 0)).toMatch(/Port/);
    expect(validateAddress('10.0.0.1', 70000)).toMatch(/Port/);
    expect(validateAddress('10.0.0.1', 48.5)).toMatch(/Port/);
    expect(validateAddress('10.0.0.1', 'abc')).toMatch(/Port/);
  });

  it('demo machines come with a gateway address', () => {
    expect(getMachineById('CNC-01')).toMatchObject({ ip: '192.168.10.11', port: 4840 });
  });

  it('stores the address on a new machine and finds who owns it', () => {
    const m = createMachine({ id: 'T-1', name: 'Test 1', type: 'milling', thresholds, ip: ' 10.9.9.9 ', port: 4841 }) as any;
    expect(m).toMatchObject({ ip: '10.9.9.9', port: 4841 });
    expect(findAddressOwner('10.9.9.9', 4841)?.id).toBe('T-1');
    expect(findAddressOwner('10.9.9.9', 4841, 'T-1')).toBeNull(); // not a clash with itself
    expect(findAddressOwner('10.9.9.9', 4842)).toBeNull();
  });

  it('can change the address of an existing machine', () => {
    updateMachine('CNC-02', { ip: '10.1.1.2', port: 502 });
    expect(getMachineById('CNC-02')).toMatchObject({ ip: '10.1.1.2', port: 502 });
  });
});
