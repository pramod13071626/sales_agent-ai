export const ccState = {
  activeRole: 'ae', // 'ae' | 'manager' | 'exec'
  activeDomainFilters: new Set(), // empty = all domains
  activeAccountId: null, // set when a matrix bubble is clicked, filters the feed
  drawerAccountId: null,
  matrixChart: null,
};
