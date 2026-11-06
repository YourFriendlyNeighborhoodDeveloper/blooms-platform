/** Permission catalog. Roles are stored in the database so the owner can adjust them. */
export const PERMISSIONS = {
  'orders.view': ['Orders', 'See orders, items and fulfilment status'],
  'orders.manage': ['Orders', 'Approve orders and update fulfilment'],
  'orders.financials': ['Orders', 'See prices, totals and payment details'],
  'orders.refund': ['Orders', 'Issue refunds'],
  'orders.export': ['Orders', 'Export order records'],
  'customers.view': ['Customers', 'See customer profiles and contact details'],
  'customers.manage': ['Customers', 'Edit customers, notes and consent records'],
  'customers.privacy': ['Customers', 'Export or erase customer data'],
  'catalog.manage': ['Catalog', 'Create and edit products, prices and categories'],
  'inventory.view': ['Inventory', 'See stock levels and movement history'],
  'inventory.manage': ['Inventory', 'Adjust stock and record waste'],
  'purchasing.manage': ['Inventory', 'Manage suppliers and purchase orders'],
  'weddings.view': ['Weddings', 'See inquiries and projects'],
  'weddings.manage': ['Weddings', 'Work inquiries and projects through the pipeline'],
  'weddings.financials': ['Weddings', 'See wedding budgets, quotes and payments'],
  'quotes.manage': ['Weddings', 'Create and send quotes and invoices'],
  'rentals.manage': ['Weddings', 'Manage rental items and reservations'],
  'deliveries.view': ['Delivery', 'See the delivery schedule'],
  'deliveries.manage': ['Delivery', 'Assign drivers and record delivery progress'],
  'delivery.settings': ['Delivery', 'Change zones, fees and windows'],
  'calendar.view': ['Calendar', 'See the shared calendar'],
  'calendar.manage': ['Calendar', 'Reschedule and add calendar items'],
  'tasks.view': ['Tasks', 'See staff tasks'],
  'tasks.manage': ['Tasks', 'Create, assign and complete tasks'],
  'staff.view': ['Team', 'See the team and their schedules'],
  'staff.manage': ['Team', 'Invite, deactivate and schedule staff, and change roles'],
  'reports.view': ['Reports', 'See operational reports'],
  'reports.financials': ['Reports', 'See revenue and financial reports'],
  'marketing.manage': ['Marketing', 'Manage promotions, Facebook videos and site content'],
  'settings.manage': ['Settings', 'Change business rules and policies'],
  'templates.manage': ['Settings', 'Edit message templates and automation rules'],
  'integrations.manage': ['Settings', 'See integration status and run verification'],
  'concierge.view': ['Flora', 'Read Flora conversations, transcripts and costs'],
  'concierge.manage': ['Flora', "Edit Flora's knowledge base and clear the demonstration sandbox"],
  'audit.view': ['System', 'Read the audit log'],
  'system.manage': ['System', 'Review failed jobs and system alerts'],
} as const satisfies Record<string, readonly [string, string]>;

export type Permission = keyof typeof PERMISSIONS;

const all = Object.keys(PERMISSIONS) as Permission[];

export const SYSTEM_ROLES: Array<{ code: string; name: string; description: string; permissions: Permission[] }> = [
  { code: 'owner', name: 'Owner', description: 'Full access to everything', permissions: all },
  {
    code: 'administrator',
    name: 'Administrator',
    description: 'Runs daily operations. Cannot change team roles or erase customer data.',
    permissions: all.filter((p) => !['staff.manage', 'customers.privacy', 'integrations.manage'].includes(p)),
  },
  {
    code: 'sales',
    name: 'Sales & consultations',
    description: 'Works inquiries and consultations, and sends quotes.',
    permissions: [
      'orders.view', 'orders.financials', 'customers.view', 'customers.manage', 'weddings.view', 'weddings.manage',
      'weddings.financials', 'quotes.manage', 'calendar.view', 'calendar.manage', 'tasks.view', 'tasks.manage', 'concierge.view',
    ],
  },
  {
    code: 'florist',
    name: 'Florist & production',
    description: 'Prepares orders and sees materials. No customer financial details.',
    permissions: ['orders.view', 'orders.manage', 'inventory.view', 'inventory.manage', 'calendar.view', 'tasks.view', 'tasks.manage', 'weddings.view'],
  },
  {
    code: 'coordinator',
    name: 'Event coordinator',
    description: 'Runs confirmed events, rentals and crews.',
    permissions: [
      'weddings.view', 'weddings.manage', 'rentals.manage', 'customers.view', 'calendar.view', 'calendar.manage',
      'tasks.view', 'tasks.manage', 'inventory.view', 'deliveries.view', 'staff.view',
    ],
  },
  {
    code: 'delivery',
    name: 'Delivery',
    description: 'Sees assigned deliveries and records progress. No prices or customer history.',
    permissions: ['deliveries.view', 'deliveries.manage', 'calendar.view', 'tasks.view'],
  },
  {
    code: 'finance',
    name: 'Finance (read only)',
    description: 'Sees financial records and reports. Cannot change anything.',
    permissions: ['orders.view', 'orders.financials', 'orders.export', 'weddings.view', 'weddings.financials', 'reports.view', 'reports.financials', 'customers.view'],
  },
];
