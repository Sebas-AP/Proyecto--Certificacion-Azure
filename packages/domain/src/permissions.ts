export const permissions = {
  branchRead: 'branch.read',
  branchManage: 'branch.manage',
  userManage: 'user.manage',
  auditRead: 'audit.read',
  shiftOpen: 'shift.open',
  shiftClose: 'shift.close',
} as const;

export type Permission = (typeof permissions)[keyof typeof permissions];

export function hasPermission(granted: readonly string[], required: Permission): boolean {
  return granted.includes(required);
}
