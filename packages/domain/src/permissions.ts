export const permissions = {
  branchRead: 'branch.read',
  branchManage: 'branch.manage',
  userManage: 'user.manage',
  auditRead: 'audit.read',
  shiftOpen: 'shift.open',
  shiftClose: 'shift.close',
  cashRead: 'cash.read',
  cashOpen: 'cash.open',
  cashClose: 'cash.close',
  cashMove: 'cash.move',
  paymentCreate: 'payment.create',
  paymentRefundRequest: 'payment.refund.request',
  paymentRefundApprove: 'payment.refund.approve',
  reportBranchRead: 'report.branch.read',
  reportCompanyRead: 'report.company.read',
  exportRead: 'export.read',
  inventoryRead: 'inventory.read',
  inventoryManage: 'inventory.manage',
  inventoryAdjust: 'inventory.adjust',
  recipeRead: 'recipe.read',
  recipeManage: 'recipe.manage',
} as const;

export type Permission = (typeof permissions)[keyof typeof permissions];

export function hasPermission(granted: readonly string[], required: Permission): boolean {
  return granted.includes(required);
}
