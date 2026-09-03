import { describe, expect, it } from 'vitest';
import { hasPermission, permissions } from '../packages/domain/src/permissions.js';

describe('autorizacion', () => {
  it('permite una accion otorgada', () => {
    expect(hasPermission([permissions.branchRead], permissions.branchRead)).toBe(true);
  });

  it('rechaza una accion no otorgada', () => {
    expect(hasPermission([permissions.branchRead], permissions.userManage)).toBe(false);
  });
});
