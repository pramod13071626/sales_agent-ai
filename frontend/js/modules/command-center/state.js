export const ccState = {
  activeRole: 'ae', // 'ae' | 'manager' | 'exec'
  activeDomainFilters: new Set(), // empty = all domains
  activeAccountId: null, // global active account filter (id or string)
  selectedAccountName: null, // global active account name
  selectedAccountObj: null, // full account object
  drawerAccountId: null,
  timelineFilter: 'all', // 'all' | 'joined' | 'promoted' | 'aging' | 'other'
  matrixChart: null,
};
